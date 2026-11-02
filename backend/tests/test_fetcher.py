import pandas as pd
import pytest

from database import Price, Recommendation
from fetcher import (
    fetch_company_profile,
    fetch_price_history,
    fetch_recommendations,
    load_all_ticker_metadata,
    save_price_history,
    save_recommendations,
)
from tickers import ALL_TICKERS


def _make_single_level_df(n=5):
    """Shape yfinance returns for a single-ticker download (DatetimeIndex, flat columns)."""
    idx = pd.date_range("2024-01-01", periods=n, freq="D")
    return pd.DataFrame({
        "Open": [10.0] * n,
        "High": [11.0] * n,
        "Low": [9.0] * n,
        "Close": [10.5] * n,
        "Volume": [1000.0] * n,
    }, index=idx)


def _make_multiindex_df(n=5, ticker="AAL.L"):
    """Shape yfinance can return when columns are grouped by ticker."""
    idx = pd.date_range("2024-01-01", periods=n, freq="D")
    idx.name = "Date"
    columns = pd.MultiIndex.from_tuples([
        ("Open", ticker), ("High", ticker), ("Low", ticker), ("Close", ticker), ("Volume", ticker),
    ])
    data = [[10.0, 11.0, 9.0, 10.5, 1000.0] for _ in range(n)]
    return pd.DataFrame(data, index=idx, columns=columns)


def test_fetch_price_history_success_single_level(monkeypatch):
    monkeypatch.setattr("fetcher.yf.download", lambda *a, **k: _make_single_level_df())
    df = fetch_price_history("AAL.L")
    assert df is not None
    assert list(df.columns) == ["date", "open", "high", "low", "close", "volume"]
    assert len(df) == 5


def test_fetch_price_history_success_multiindex(monkeypatch):
    monkeypatch.setattr("fetcher.yf.download", lambda *a, **k: _make_multiindex_df())
    df = fetch_price_history("AAL.L")
    assert df is not None
    assert list(df.columns) == ["date", "open", "high", "low", "close", "volume"]
    assert len(df) == 5


def test_fetch_price_history_empty_returns_none(monkeypatch):
    monkeypatch.setattr("fetcher.yf.download", lambda *a, **k: pd.DataFrame())
    assert fetch_price_history("AAL.L") is None


def test_fetch_price_history_exception_returns_none(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("network down")
    monkeypatch.setattr("fetcher.yf.download", boom)
    assert fetch_price_history("AAL.L") is None


def test_fetch_price_history_unexpected_columns_returns_none(monkeypatch):
    df = pd.DataFrame({"Date": pd.date_range("2024-01-01", periods=3), "Foo": [1, 2, 3]})
    monkeypatch.setattr("fetcher.yf.download", lambda *a, **k: df)
    assert fetch_price_history("AAL.L") is None


def test_save_price_history_inserts_rows(db_session, sample_price_df):
    ticker = "AAL.L"
    save_price_history(db_session, ticker, sample_price_df)
    count = db_session.query(Price).filter(Price.ticker == ticker).count()
    assert count == len(sample_price_df)


def test_save_price_history_replaces_existing(db_session, sample_price_df):
    ticker = "AAL.L"
    save_price_history(db_session, ticker, sample_price_df)
    save_price_history(db_session, ticker, sample_price_df.iloc[:10])
    count = db_session.query(Price).filter(Price.ticker == ticker).count()
    assert count == 10


def _make_recommendations_df():
    return pd.DataFrame({
        "period": ["0m", "-1m", "-2m", "-3m"],
        "strongBuy": [6, 6, 7, 7],
        "buy": [22, 22, 23, 25],
        "hold": [14, 16, 15, 14],
        "sell": [2, 1, 1, 1],
        "strongSell": [2, 2, 2, 1],
    })


class _FakeTicker:
    def __init__(self, recommendations):
        self.recommendations = recommendations


def test_fetch_recommendations_success(monkeypatch):
    df = _make_recommendations_df()
    monkeypatch.setattr("fetcher.yf.Ticker", lambda ticker: _FakeTicker(df))
    result = fetch_recommendations("AAPL")
    assert result is not None
    assert list(result.columns) == ["period", "strongBuy", "buy", "hold", "sell", "strongSell"]
    assert len(result) == 4


def test_fetch_recommendations_empty_returns_none(monkeypatch):
    monkeypatch.setattr("fetcher.yf.Ticker", lambda ticker: _FakeTicker(pd.DataFrame()))
    assert fetch_recommendations("AAPL") is None


def test_fetch_recommendations_none_returns_none(monkeypatch):
    monkeypatch.setattr("fetcher.yf.Ticker", lambda ticker: _FakeTicker(None))
    assert fetch_recommendations("AAPL") is None


def test_fetch_recommendations_unexpected_columns_returns_none(monkeypatch):
    df = pd.DataFrame({"period": ["0m"], "foo": [1]})
    monkeypatch.setattr("fetcher.yf.Ticker", lambda ticker: _FakeTicker(df))
    assert fetch_recommendations("AAPL") is None


def test_fetch_recommendations_exception_returns_none(monkeypatch):
    def boom(ticker):
        raise RuntimeError("network down")
    monkeypatch.setattr("fetcher.yf.Ticker", boom)
    assert fetch_recommendations("AAPL") is None


def test_save_recommendations_inserts_rows(db_session):
    df = _make_recommendations_df()
    save_recommendations(db_session, "AAPL", df)
    rows = db_session.query(Recommendation).filter(Recommendation.ticker == "AAPL").all()
    assert len(rows) == 4
    latest = next(r for r in rows if r.period == "0m")
    assert latest.strong_buy == 6
    assert latest.buy == 22
    assert latest.hold == 14
    assert latest.sell == 2
    assert latest.strong_sell == 2


def test_save_recommendations_replaces_existing(db_session):
    df = _make_recommendations_df()
    save_recommendations(db_session, "AAPL", df)
    save_recommendations(db_session, "AAPL", df.iloc[:1])
    count = db_session.query(Recommendation).filter(Recommendation.ticker == "AAPL").count()
    assert count == 1


def test_load_all_ticker_metadata():
    tickers = load_all_ticker_metadata()
    assert tickers is ALL_TICKERS
    assert len(tickers) > 0
    assert {"ticker", "name", "sector", "index"}.issubset(tickers[0].keys())


class _FakeInfoTicker:
    def __init__(self, info):
        self.info = info


def test_fetch_company_profile_maps_fields(monkeypatch):
    info = {
        "longBusinessSummary": "  NVIDIA designs GPUs.  ", "industry": "Semiconductors",
        "website": "https://www.nvidia.com", "city": "Santa Clara",
        "country": "United States", "fullTimeEmployees": 42000, "unrelated": 1,
    }
    monkeypatch.setattr("fetcher.yf.Ticker", lambda t: _FakeInfoTicker(info))
    assert fetch_company_profile("NVDA") == {
        "summary": "NVIDIA designs GPUs.", "industry": "Semiconductors",
        "website": "https://www.nvidia.com", "city": "Santa Clara",
        "country": "United States", "employees": 42000,
    }


def test_fetch_company_profile_empty_info_returns_none(monkeypatch):
    monkeypatch.setattr("fetcher.yf.Ticker", lambda t: _FakeInfoTicker({"quoteType": "EQUITY"}))
    assert fetch_company_profile("NVDA") is None


def test_fetch_company_profile_exception_returns_none(monkeypatch):
    class Boom:
        @property
        def info(self):
            raise RuntimeError("rate limited")
    monkeypatch.setattr("fetcher.yf.Ticker", lambda t: Boom())
    assert fetch_company_profile("NVDA") is None
