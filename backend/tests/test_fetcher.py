import pandas as pd
import pytest

from database import Price
from fetcher import fetch_price_history, load_all_ticker_metadata, save_price_history
from tickers import FTSE_TICKERS


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


def test_load_all_ticker_metadata():
    tickers = load_all_ticker_metadata()
    assert tickers is FTSE_TICKERS
    assert len(tickers) > 0
    assert {"ticker", "name", "sector", "index"}.issubset(tickers[0].keys())
