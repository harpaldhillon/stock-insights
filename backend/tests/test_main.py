import time
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from database import Analysis, Base, Price, Recommendation


def _make_analysis(ticker, signal, score=0.0, conviction="LOW", **overrides):
    defaults = dict(
        ticker=ticker, signal=signal, conviction=conviction, score=score,
        entry_zone_low=90.0, entry_zone_high=100.0, stop_loss=80.0,
        target_price=110.0, rr_ratio=1.5,
    )
    defaults.update(overrides)
    return Analysis(**defaults)


@pytest.fixture()
def client_env():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[main.get_db] = override_get_db
    main.app.state.initializing = False
    main.app.state.last_updated = None
    main.app.state.running_refresh = False
    main.app.state.refresh_job_id = None

    client = TestClient(main.app)
    session = TestSessionLocal()
    try:
        yield client, session
    finally:
        session.close()
        main.app.dependency_overrides.clear()
        # A refresh thread started by a test must finish before the next test.
        assert main._refresh_lock.acquire(timeout=5), "refresh lock still held after test"
        main._refresh_lock.release()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


# ---- /api/status ----------------------------------------------------

def test_get_status_counts(client_env):
    client, session = client_env
    session.add_all([
        _make_analysis("AAL.L", "BUY"),
        _make_analysis("ABF.L", "HOLD"),
        _make_analysis("ADM.L", "SELL"),
    ])
    session.commit()

    resp = client.get("/api/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_stocks"] == 3
    assert data["buy_count"] == 1
    assert data["hold_count"] == 1
    assert data["sell_count"] == 1
    assert data["initializing"] is False
    assert data["refreshing"] is False


def test_get_status_reflects_running_refresh(client_env):
    client, _ = client_env
    main.app.state.running_refresh = True

    resp = client.get("/api/status")
    assert resp.status_code == 200
    assert resp.json()["refreshing"] is True


# ---- /api/summary ----------------------------------------------------

def test_get_summary_groups_by_signal_and_sorts_by_score_desc(client_env):
    client, session = client_env
    session.add_all([
        _make_analysis("AAL.L", "BUY", score=8.0),   # FTSE100, Basic Materials
        _make_analysis("ABF.L", "HOLD", score=1.0),  # FTSE100, Consumer Defensive
        _make_analysis("ADM.L", "BUY", score=4.0),   # FTSE100, Financials
    ])
    session.commit()

    resp = client.get("/api/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert [r["ticker"] for r in data["BUY"]] == ["AAL.L", "ADM.L"]
    assert len(data["HOLD"]) == 1
    assert len(data["SELL"]) == 0


def test_get_summary_sort_ticker(client_env):
    client, session = client_env
    session.add_all([
        _make_analysis("ADM.L", "BUY", score=1.0),
        _make_analysis("AAL.L", "BUY", score=8.0),
    ])
    session.commit()

    resp = client.get("/api/summary", params={"sort": "ticker"})
    data = resp.json()
    assert [r["ticker"] for r in data["BUY"]] == ["AAL.L", "ADM.L"]


def test_get_summary_filters_by_sector(client_env):
    client, session = client_env
    session.add_all([
        _make_analysis("AAL.L", "BUY", score=8.0),  # Basic Materials
        _make_analysis("ADM.L", "BUY", score=4.0),  # Financials
    ])
    session.commit()

    resp = client.get("/api/summary", params={"sector": "Financials"})
    data = resp.json()
    assert [r["ticker"] for r in data["BUY"]] == ["ADM.L"]


def test_get_summary_filters_by_index(client_env):
    client, session = client_env
    session.add_all([
        _make_analysis("AAL.L", "BUY", score=8.0),   # FTSE100
        _make_analysis("FOUR.L", "BUY", score=4.0),  # FTSE250
    ])
    session.commit()

    resp = client.get("/api/summary", params={"index": "FTSE250"})
    data = resp.json()
    assert [r["ticker"] for r in data["BUY"]] == ["FOUR.L"]


def test_get_summary_invalid_index_is_rejected(client_env):
    client, _ = client_env
    resp = client.get("/api/summary", params={"index": "NOTREAL"})
    assert resp.status_code == 422


def test_get_summary_current_price_uses_most_recent_row(client_env):
    # Regression test for the bulk "latest price per ticker" query: with
    # multiple Price rows per ticker, current_price must reflect the row
    # with the max date, not the first-inserted or an arbitrary row.
    client, session = client_env
    session.add(_make_analysis("AAL.L", "BUY", score=8.0))
    session.add_all([
        Price(ticker="AAL.L", date=date(2024, 1, 1), open=1, high=2, low=0.5, close=100.0, volume=1000),
        Price(ticker="AAL.L", date=date(2024, 1, 3), open=1, high=2, low=0.5, close=102.0, volume=1000),
        Price(ticker="AAL.L", date=date(2024, 1, 2), open=1, high=2, low=0.5, close=101.0, volume=1000),
    ])
    session.commit()

    resp = client.get("/api/summary")
    data = resp.json()
    assert data["BUY"][0]["ticker"] == "AAL.L"
    assert data["BUY"][0]["current_price"] == 102.0


def test_get_summary_current_price_null_when_no_price_rows(client_env):
    client, session = client_env
    session.add(_make_analysis("AAL.L", "BUY", score=8.0))
    session.commit()

    resp = client.get("/api/summary")
    data = resp.json()
    assert data["BUY"][0]["current_price"] is None


# ---- /api/stock/{ticker} ----------------------------------------------------

def test_get_stock_detail_found(client_env):
    client, session = client_env
    session.add(_make_analysis("AAL.L", "BUY", score=5.0))
    session.add(Price(ticker="AAL.L", date=date(2024, 1, 1), open=1, high=2, low=0.5, close=1.5, volume=1000))
    session.commit()

    resp = client.get("/api/stock/AAL.L")
    assert resp.status_code == 200
    body = resp.json()
    assert body["company"]["ticker"] == "AAL.L"
    assert body["analysis"]["signal"] == "BUY"
    assert len(body["prices"]) == 1


def test_get_stock_detail_includes_recommendations_in_order(client_env):
    client, session = client_env
    session.add(_make_analysis("AAL.L", "BUY", score=5.0))
    session.add_all([
        Recommendation(ticker="AAL.L", period="0m", strong_buy=6, buy=22, hold=14, sell=2, strong_sell=2),
        Recommendation(ticker="AAL.L", period="-1m", strong_buy=6, buy=22, hold=16, sell=1, strong_sell=2),
    ])
    session.commit()

    resp = client.get("/api/stock/AAL.L")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["recommendations"]) == 2
    assert body["recommendations"][0]["period"] == "0m"
    assert body["recommendations"][0]["strong_buy"] == 6


def test_get_stock_detail_empty_recommendations_when_none_stored(client_env):
    client, session = client_env
    session.add(_make_analysis("AAL.L", "BUY", score=5.0))
    session.commit()

    resp = client.get("/api/stock/AAL.L")
    assert resp.json()["recommendations"] == []


def test_get_stock_detail_unknown_ticker_404(client_env):
    client, _ = client_env
    resp = client.get("/api/stock/NOPE.L")
    assert resp.status_code == 404


def test_get_stock_detail_no_analysis_yet_404(client_env):
    client, _ = client_env
    resp = client.get("/api/stock/AAL.L")
    assert resp.status_code == 404


# ---- /api/refresh ----------------------------------------------------

def test_manual_refresh_returns_already_running(client_env):
    client, _ = client_env
    job_id = main._claim_refresh()  # e.g. the startup or 18:30 refresh is running
    try:
        resp = client.get("/api/refresh")
        assert resp.status_code == 200
        assert resp.json() == {"job_id": job_id, "status": "already_running"}
    finally:
        main._release_refresh()


def test_manual_refresh_concurrent_requests_start_only_one(monkeypatch, client_env):
    import threading
    client, _ = client_env
    release = threading.Event()
    runs = []
    def slow_body():
        runs.append(1)
        release.wait(5)
    monkeypatch.setattr(main, "_refresh_body", slow_body)
    first = client.get("/api/refresh").json()
    second = client.get("/api/refresh").json()
    release.set()
    assert first["status"] == "started"
    assert second == {"job_id": first["job_id"], "status": "already_running"}
    assert main._refresh_lock.acquire(timeout=5)
    main._refresh_lock.release()
    assert runs == [1]
    assert main.app.state.running_refresh is False


def test_scheduled_refresh_skips_while_manual_refresh_runs(monkeypatch, client_env):
    runs = []
    monkeypatch.setattr(main, "_refresh_body", lambda: runs.append(1))
    main._claim_refresh()
    try:
        main.refresh_all_data()  # what APScheduler calls at 18:30
    finally:
        main._release_refresh()
    assert runs == []
    main.refresh_all_data()
    assert runs == [1]


def test_skipped_same_day_refresh_frees_the_slot(monkeypatch, client_env):
    client, session = client_env
    monkeypatch.setattr(main, "_refresh_body", lambda: None)
    session.add(_make_analysis("AAL.L", "BUY", run_date=datetime.utcnow()))
    session.commit()
    assert client.get("/api/refresh").json()["status"] == "already_refreshed_today"
    assert main._refresh_lock.locked() is False


def test_manual_refresh_starts_job(monkeypatch, client_env):
    client, _ = client_env
    monkeypatch.setattr(main, "_refresh_body", lambda: None)

    resp = client.get("/api/refresh")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "started"
    assert body["job_id"]
    time.sleep(0.05)


# ---- /api/strategy --------------------------------------------------

def test_get_strategy_reflects_analyser_constants(client_env):
    import analyser
    client, _ = client_env
    resp = client.get("/api/strategy")
    assert resp.status_code == 200
    body = resp.json()
    assert body["signal_threshold"] == analyser.SIGNAL_THRESHOLD
    assert body["highs"]["multi_year_min_years"] == analyser.MULTI_YEAR_MIN_YEARS
    assert body["trade_levels"]["stop_atr"] == analyser.STOP_LOSS_ATR_MULTIPLIER
    groups = {r["group"] for r in body["rules"]}
    assert groups == {"Trend", "Momentum", "Volume", "Volatility"}
    sma200 = next(r for r in body["rules"] if "200-day SMA (long-term" in r["rule"])
    assert sma200["points"].startswith(f"+{analyser.SCORE_ABOVE_SMA200:g}")


def test_summary_nasdaq100_filter(client_env):
    client, session = client_env
    session.add_all([
        _make_analysis("AAL.L", "BUY", score=8.0),  # FTSE100
        _make_analysis("NVDA", "BUY", score=7.0),   # NASDAQ100
        _make_analysis("AAPL", "HOLD", score=1.0),  # NASDAQ100
    ])
    session.commit()
    resp = client.get("/api/summary", params={"index": "NASDAQ100"})
    assert resp.status_code == 200
    body = resp.json()
    assert [r["ticker"] for r in body["BUY"]] == ["NVDA"]
    assert [r["ticker"] for r in body["HOLD"]] == ["AAPL"]
    assert body["BUY"][0]["index"] == "NASDAQ100"


# ---- /api/stock/{ticker}/profile ------------------------------------------

def _profile(summary="Makes chips."):
    return {"summary": summary, "industry": "Semiconductors", "website": "https://x.com",
            "city": "Santa Clara", "country": "United States", "employees": 42000}


def test_profile_fetches_then_serves_from_cache(client_env, monkeypatch):
    client, _ = client_env
    calls = []
    monkeypatch.setattr(main, "fetch_company_profile", lambda t: calls.append(t) or _profile())
    first = client.get("/api/stock/nvda/profile")
    second = client.get("/api/stock/NVDA/profile")
    assert first.status_code == second.status_code == 200
    assert first.json()["summary"] == "Makes chips."
    assert first.json()["employees"] == 42000
    assert second.json() == first.json()
    assert calls == ["NVDA"]  # second request served from the cache


def test_profile_refetches_when_stale(client_env, monkeypatch):
    from datetime import datetime, timedelta
    from database import CompanyProfile
    client, session = client_env
    session.add(CompanyProfile(ticker="NVDA", summary="Old.", fetched_at=datetime.utcnow() - timedelta(days=31)))
    session.commit()
    monkeypatch.setattr(main, "fetch_company_profile", lambda t: _profile("New."))
    assert client.get("/api/stock/NVDA/profile").json()["summary"] == "New."


def test_profile_serves_stale_copy_when_refetch_fails(client_env, monkeypatch):
    from datetime import datetime, timedelta
    from database import CompanyProfile
    client, session = client_env
    session.add(CompanyProfile(ticker="NVDA", summary="Old.", fetched_at=datetime.utcnow() - timedelta(days=31)))
    session.commit()
    monkeypatch.setattr(main, "fetch_company_profile", lambda t: None)
    assert client.get("/api/stock/NVDA/profile").json()["summary"] == "Old."


def test_profile_unavailable_returns_empty(client_env, monkeypatch):
    client, _ = client_env
    monkeypatch.setattr(main, "fetch_company_profile", lambda t: None)
    resp = client.get("/api/stock/NVDA/profile")
    assert resp.status_code == 200
    assert resp.json()["summary"] is None


def test_profile_unknown_ticker_404(client_env):
    client, _ = client_env
    assert client.get("/api/stock/NOPE.L/profile").status_code == 404


def test_manual_refresh_skipped_when_refreshed_today(monkeypatch, client_env):
    client, session = client_env
    started = []
    monkeypatch.setattr(main, "_refresh_body", lambda: started.append(1))
    session.add(_make_analysis("AAL.L", "BUY", run_date=datetime.utcnow()))
    session.commit()
    resp = client.get("/api/refresh")
    assert resp.json()["status"] == "already_refreshed_today"
    assert resp.json()["last_updated"] is not None
    assert started == []


def test_manual_refresh_runs_when_last_refresh_was_before_today(monkeypatch, client_env):
    client, session = client_env
    monkeypatch.setattr(main, "_refresh_body", lambda: None)
    session.add(_make_analysis("AAL.L", "BUY", run_date=datetime.utcnow() - timedelta(days=2)))
    session.commit()
    assert client.get("/api/refresh").json()["status"] == "started"


def test_manual_refresh_force_overrides_same_day_skip(monkeypatch, client_env):
    client, session = client_env
    monkeypatch.setattr(main, "_refresh_body", lambda: None)
    session.add(_make_analysis("AAL.L", "BUY", run_date=datetime.utcnow()))
    session.commit()
    assert client.get("/api/refresh", params={"force": "true"}).json()["status"] == "started"


def test_refreshed_today_uses_uk_calendar_date():
    # 23:30 UTC on 30 Jun is 00:30 BST on 1 Jul in the UK, so "today" there.
    assert main.refreshed_today(datetime(2026, 6, 30, 23, 30), now_utc=datetime(2026, 7, 1, 9, 0)) is True
    assert main.refreshed_today(datetime(2026, 6, 30, 22, 30), now_utc=datetime(2026, 7, 1, 9, 0)) is False
    assert main.refreshed_today(None) is False


def test_status_last_updated_falls_back_to_database(client_env):
    client, session = client_env
    run = datetime(2026, 11, 1, 18, 45)
    session.add(_make_analysis("AAL.L", "BUY", run_date=run))
    session.commit()
    assert client.get("/api/status").json()["last_updated"] == run.isoformat()


# ---- CORS -----------------------------------------------------------

def test_cors_allows_frontend_origin(client_env):
    client, _ = client_env
    resp = client.get("/api/status", headers={"Origin": "http://localhost:3000"})
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-credentials" not in resp.headers


def test_cors_rejects_other_origins(client_env):
    client, _ = client_env
    resp = client.get("/api/status", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in resp.headers
    preflight = client.options(
        "/api/refresh",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in preflight.headers


# ---- refresh body: fetch failures --------------------------------------

def _patch_refresh_io(monkeypatch, session_factory, fetch):
    analysed = []
    monkeypatch.setattr(main, "SessionLocal", session_factory)
    monkeypatch.setattr(main, "load_all_ticker_metadata", lambda: [{"ticker": "AAL.L"}, {"ticker": "ABF.L"}])
    monkeypatch.setattr(main, "fetch_price_history", fetch)
    monkeypatch.setattr(main, "save_price_history", lambda db, t, df: None)
    monkeypatch.setattr(main, "fetch_recommendations", lambda t: None)
    monkeypatch.setattr(main, "run_full_analysis", lambda db, tickers=None: analysed.append(tickers) or (len(tickers), len(tickers)))
    return analysed


def test_refresh_with_all_fetches_failing_keeps_last_updated(monkeypatch, client_env):
    _, session = client_env
    factory = lambda: session.__class__(bind=session.get_bind())
    analysed = _patch_refresh_io(monkeypatch, factory, lambda t: None)
    main.app.state.last_updated = None
    main.refresh_all_data()
    assert analysed == []
    assert main.app.state.last_updated is None


def test_refresh_analyses_only_fetched_tickers(monkeypatch, client_env):
    import pandas as pd
    _, session = client_env
    factory = lambda: session.__class__(bind=session.get_bind())
    ok = pd.DataFrame({"close": [1.0]})
    analysed = _patch_refresh_io(monkeypatch, factory, lambda t: ok if t == "AAL.L" else None)
    main.refresh_all_data()
    assert analysed == [["AAL.L"]]
    assert main.app.state.last_updated is not None
