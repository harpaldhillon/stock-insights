import logging
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

from analyser import get_ticker_metadata, run_full_analysis, strategy_rules
from database import Analysis, CompanyProfile, Price, Recommendation, SessionLocal, init_db, get_db
from fetcher import (
    fetch_company_profile,
    fetch_price_history,
    fetch_recommendations,
    save_price_history,
    save_recommendations,
    load_all_ticker_metadata,
)
from scheduler import init_scheduler
from schemas import CompanyProfileResponse, PricePoint, RecommendationPeriod, StatusResponse, StockDetailResponse
from tickers import TICKERS_BY_INDEX, TICKERS_BY_SECTOR

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("ftse-analyser")

app = FastAPI(title="Stock Insight", version="1.0")
# Only the frontend may call the API from a browser. "*" with credentials made
# Starlette echo back any Origin, so any website could read API responses.
# Override with a comma-separated FRONTEND_ORIGINS if the frontend moves.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.state.initializing = True
app.state.last_updated = None
app.state.running_refresh = False
app.state.refresh_job_id = None


# One refresh at a time, whichever way it is started (startup, the 18:30
# schedule, or /api/refresh). Checking app.state.running_refresh alone was a
# race: the flag was only set inside the new thread, so two quick requests
# could both pass the check and run two refreshes over the same rows.
# threading.Lock (not RLock) because the request thread claims it and the
# worker thread releases it.
_refresh_lock = threading.Lock()


def _claim_refresh() -> str | None:
    """Atomically take the refresh slot; returns a job id, or None if taken."""
    if not _refresh_lock.acquire(blocking=False):
        return None
    job_id = str(uuid.uuid4())
    app.state.running_refresh = True
    app.state.refresh_job_id = job_id
    return job_id


def _release_refresh() -> None:
    app.state.running_refresh = False
    app.state.initializing = False
    _refresh_lock.release()


def _run_claimed_refresh() -> None:
    try:
        _refresh_body()
    finally:
        _release_refresh()


def refresh_all_data() -> None:
    """Run a refresh in the calling thread (startup and the daily schedule),
    or do nothing if one is already running."""
    if _claim_refresh() is None:
        logger.info("Refresh already running; skipping this one")
        return
    _run_claimed_refresh()


def _refresh_body() -> None:
    try:
        logger.info("Starting full data refresh")
        with SessionLocal() as db:
            tickers = load_all_ticker_metadata()
            fetch_success = 0
            fetch_failed = 0
            for ticker_meta in tickers:
                ticker = ticker_meta["ticker"]
                df = fetch_price_history(ticker)
                if df is None or df.empty:
                    logger.warning("Skipping analysis for %s due to fetch failure", ticker)
                    fetch_failed += 1
                    continue
                save_price_history(db, ticker, df)
                fetch_success += 1
                rec_df = fetch_recommendations(ticker)
                if rec_df is not None and not rec_df.empty:
                    save_recommendations(db, ticker, rec_df)
            analysis_success, analysis_total = run_full_analysis(db)
            app.state.last_updated = datetime.utcnow()
            logger.info(
                "Data refresh complete: fetched %s/%s tickers, analyzed %s/%s successfully",
                fetch_success,
                len(tickers),
                analysis_success,
                analysis_total,
            )
    except Exception as exc:
        logger.exception("Error during refresh: %s", exc)


MARKET_TZ = ZoneInfo("Europe/London")  # same timezone the daily schedule runs in


def last_refresh_time(db: Session) -> datetime | None:
    """When data was last refreshed (UTC). Read from the newest analysis row so
    it survives restarts, unlike the in-memory app.state.last_updated."""
    return db.query(func.max(Analysis.run_date)).scalar()


def refreshed_today(last_utc: datetime | None, now_utc: datetime | None = None) -> bool:
    """Whether the last refresh happened on today's UK calendar date."""
    if last_utc is None:
        return False
    now_utc = now_utc or datetime.utcnow()
    to_uk = lambda dt: dt.replace(tzinfo=timezone.utc).astimezone(MARKET_TZ).date()
    return to_uk(last_utc) == to_uk(now_utc)


@app.on_event("startup")
async def startup_event():
    init_db()
    init_scheduler(app, refresh_all_data)
    def initial_load():
        app.state.initializing = True
        refresh_all_data()

    thread = threading.Thread(target=initial_load, daemon=True)
    thread.start()


@app.get("/api/status", response_model=StatusResponse)
def get_status(db: Session = Depends(get_db)):
    total = db.query(func.count(func.distinct(Analysis.ticker))).scalar() or 0
    buy = db.query(func.count(Analysis.id)).filter(Analysis.signal == "BUY").scalar() or 0
    hold = db.query(func.count(Analysis.id)).filter(Analysis.signal == "HOLD").scalar() or 0
    sell = db.query(func.count(Analysis.id)).filter(Analysis.signal == "SELL").scalar() or 0
    return {
        "last_updated": app.state.last_updated or last_refresh_time(db),
        "total_stocks": total,
        "buy_count": buy,
        "hold_count": hold,
        "sell_count": sell,
        "initializing": app.state.initializing,
        "refreshing": app.state.running_refresh,
    }


@app.get("/api/summary")
def get_summary(
    index: str = Query("ALL", pattern="^(ALL|FTSE100|FTSE250|FTSE SmallCap|NASDAQ100)$"),
    sector: str | None = None,
    sort: str = Query("score_desc", pattern="^(score_desc|score_asc|ticker)$"),
    db: Session = Depends(get_db),
):
    query = db.query(Analysis)
    if index != "ALL":
        allowed = TICKERS_BY_INDEX.get(index, set())
        query = query.filter(Analysis.ticker.in_(allowed))
    if sector:
        tickers_in_sector = TICKERS_BY_SECTOR.get(sector.lower(), set())
        query = query.filter(Analysis.ticker.in_(tickers_in_sector))
    results = query.all()

    # One bulk "latest price per ticker" query instead of a per-row round-trip
    # (previously N+1: a separate SELECT ... ORDER BY date DESC LIMIT 1 for
    # every result row, up to ~485 individual queries for an unfiltered request).
    tickers_needed = {row.ticker for row in results}
    latest_price_by_ticker: dict[str, float] = {}
    if tickers_needed:
        latest_dates = (
            db.query(Price.ticker, func.max(Price.date).label("max_date"))
            .filter(Price.ticker.in_(tickers_needed))
            .group_by(Price.ticker)
            .subquery()
        )
        latest_prices = db.query(Price.ticker, Price.close).join(
            latest_dates,
            (Price.ticker == latest_dates.c.ticker) & (Price.date == latest_dates.c.max_date),
        )
        latest_price_by_ticker = dict(latest_prices.all())

    rows = []
    for row in results:
        meta = get_ticker_metadata(row.ticker)
        if not meta:
            continue
        rows.append({
            "ticker": row.ticker,
            "name": meta["name"],
            "sector": meta["sector"],
            "index": meta["index"],
            "signal": row.signal,
            "conviction": row.conviction,
            "score": row.score,
            "entry_zone_low": row.entry_zone_low,
            "entry_zone_high": row.entry_zone_high,
            "stop_loss": row.stop_loss,
            "target_price": row.target_price,
            "rr_ratio": row.rr_ratio,
            "notes": row.notes or {},
            "current_price": latest_price_by_ticker.get(row.ticker),
        })
    if sort == "score_desc":
        rows.sort(key=lambda x: x["score"], reverse=True)
    elif sort == "score_asc":
        rows.sort(key=lambda x: x["score"])
    else:
        rows.sort(key=lambda x: x["ticker"])
    grouped = {"BUY": [], "HOLD": [], "SELL": []}
    for item in rows:
        grouped[item["signal"]].append(item)
    return {"BUY": grouped["BUY"], "HOLD": grouped["HOLD"], "SELL": grouped["SELL"]}


@app.get("/api/strategy")
def get_strategy():
    """How stocks are scored and classified, for the dashboard's Strategy popup."""
    return strategy_rules()


PROFILE_MAX_AGE = timedelta(days=30)


@app.get("/api/stock/{ticker}/profile", response_model=CompanyProfileResponse)
def get_company_profile(ticker: str, db: Session = Depends(get_db)):
    """What the company does. Fetched from Yahoo on first request, then cached
    for PROFILE_MAX_AGE; if a re-fetch fails the stale copy is still served."""
    ticker = ticker.upper()
    if not get_ticker_metadata(ticker):
        raise HTTPException(status_code=404, detail="Ticker not found")

    cached = db.get(CompanyProfile, ticker)
    if cached and datetime.utcnow() - cached.fetched_at < PROFILE_MAX_AGE:
        return cached

    fresh = fetch_company_profile(ticker)
    if fresh is None:
        return cached or CompanyProfileResponse(ticker=ticker)
    profile = cached or CompanyProfile(ticker=ticker)
    for field, value in fresh.items():
        setattr(profile, field, value)
    profile.fetched_at = datetime.utcnow()
    db.add(profile)
    db.commit()
    return profile


@app.get("/api/stock/{ticker}", response_model=StockDetailResponse)
def get_stock_detail(ticker: str, db: Session = Depends(get_db)):
    ticker = ticker.upper()
    meta = get_ticker_metadata(ticker)
    if not meta:
        raise HTTPException(status_code=404, detail="Ticker not found")

    latest_analysis = db.query(Analysis).filter(Analysis.ticker == ticker).order_by(Analysis.run_date.desc()).first()
    if not latest_analysis:
        raise HTTPException(status_code=404, detail="Analysis not yet available")

    price_rows = db.query(Price).filter(Price.ticker == ticker).order_by(Price.date).all()
    prices = [PricePoint.from_orm(row) for row in price_rows]
    recommendation_rows = (
        db.query(Recommendation)
        .filter(Recommendation.ticker == ticker)
        .order_by(Recommendation.id)
        .all()
    )
    recommendations = [RecommendationPeriod.from_orm(row) for row in recommendation_rows]
    return {
        "company": meta,
        "analysis": latest_analysis,
        "prices": prices,
        "recommendations": recommendations,
    }


@app.get("/api/refresh")
def manual_refresh(force: bool = False, db: Session = Depends(get_db)):
    """Start a refresh, unless one is running or data was already refreshed
    today (UK date). Prices are fetched up to the previous close, so a second
    same-day refresh would only re-download identical data. force=true overrides.
    The scheduled 18:30 refresh does not go through here and always runs."""
    job_id = _claim_refresh()
    if job_id is None:
        return {"job_id": app.state.refresh_job_id, "status": "already_running"}
    last = last_refresh_time(db)
    if not force and refreshed_today(last):
        _release_refresh()
        return {"job_id": None, "status": "already_refreshed_today", "last_updated": last}
    threading.Thread(target=_run_claimed_refresh, daemon=True).start()
    return {"job_id": job_id, "status": "started"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
