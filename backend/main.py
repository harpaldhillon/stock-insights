import logging
import threading
import uuid
from datetime import datetime

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

from analyser import get_ticker_metadata, run_full_analysis
from database import Analysis, Price, SessionLocal, init_db, get_db
from fetcher import fetch_price_history, save_price_history, load_all_ticker_metadata
from scheduler import init_scheduler
from schemas import PricePoint, StatusResponse, StockDetailResponse
from tickers import TICKERS_BY_INDEX, TICKERS_BY_SECTOR

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("ftse-analyser")

app = FastAPI(title="FTSE Compass", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.initializing = True
app.state.last_updated = None
app.state.running_refresh = False
app.state.refresh_job_id = None


def refresh_all_data() -> None:
    if app.state.running_refresh:
        return
    app.state.running_refresh = True
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
    finally:
        app.state.running_refresh = False
        app.state.initializing = False


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
        "last_updated": app.state.last_updated,
        "total_stocks": total,
        "buy_count": buy,
        "hold_count": hold,
        "sell_count": sell,
        "initializing": app.state.initializing,
        "refreshing": app.state.running_refresh,
    }


@app.get("/api/summary")
def get_summary(
    index: str = Query("ALL", pattern="^(ALL|FTSE100|FTSE250|FTSE SmallCap)$"),
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
    return {
        "company": meta,
        "analysis": latest_analysis,
        "prices": prices,
    }


@app.get("/api/refresh")
def manual_refresh():
    if app.state.running_refresh:
        return {"job_id": app.state.refresh_job_id, "status": "already_running"}
    job_id = str(uuid.uuid4())
    app.state.refresh_job_id = job_id
    thread = threading.Thread(target=refresh_all_data, daemon=True)
    thread.start()
    return {"job_id": job_id, "status": "started"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
