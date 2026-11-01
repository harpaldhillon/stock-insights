import time
from datetime import date

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
    main.app.state.running_refresh = True
    resp = client.get("/api/refresh")
    assert resp.status_code == 200
    assert resp.json()["status"] == "already_running"


def test_manual_refresh_starts_job(monkeypatch, client_env):
    client, _ = client_env
    monkeypatch.setattr(main, "refresh_all_data", lambda: None)

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
