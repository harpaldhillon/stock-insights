from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from analyser import (
    analyze_ticker,
    build_notes,
    calculate_indicators,
    compute_high_breakout,
    compute_score,
    get_ticker_metadata,
    run_full_analysis,
)
from database import Analysis, Price
from conftest import make_price_df


def _dates(n, start=None):
    start = start or date(2023, 1, 2)
    return [start + timedelta(days=i) for i in range(n)]


# ---- get_ticker_metadata ----------------------------------------------------

def test_get_ticker_metadata_known():
    meta = get_ticker_metadata("AAL.L")
    assert meta is not None
    assert meta["name"] == "Anglo American PLC"
    assert meta["index"] == "FTSE100"


def test_ftse_tickers_has_no_duplicate_tickers():
    # FTSE_TICKERS used to contain 33 tickers listed twice (once per index
    # tier they'd moved between, e.g. BME.L under both FTSE100 and FTSE250),
    # which made TICKERS_BY_INDEX incorrectly show the same ticker under two
    # different index filters at once. Every ticker must now appear exactly once.
    from collections import Counter
    from tickers import FTSE_TICKERS
    counts = Counter(item["ticker"] for item in FTSE_TICKERS)
    duplicates = {ticker: n for ticker, n in counts.items() if n > 1}
    assert duplicates == {}


def test_ticker_lookup_index_prefers_first_occurrence_on_duplicates():
    # Defends the setdefault()-based construction pattern in tickers.py
    # itself: if a duplicate ever creeps back in, the first-listed entry must
    # win (matching the old linear-scan next(...) lookup's semantics), not
    # silently flip to "last one wins" the way a plain dict comprehension would.
    synthetic = [
        {"ticker": "DUP.L", "name": "First Listing", "sector": "Financials", "index": "FTSE100"},
        {"ticker": "DUP.L", "name": "Second Listing", "sector": "Technology", "index": "FTSE250"},
    ]
    index: dict[str, dict] = {}
    for item in synthetic:
        index.setdefault(item["ticker"], item)
    assert index["DUP.L"]["name"] == "First Listing"


def test_get_ticker_metadata_unknown():
    assert get_ticker_metadata("NOPE.L") is None


# ---- calculate_indicators ----------------------------------------------------

def test_calculate_indicators_columns_and_values(sample_price_df):
    df = calculate_indicators(sample_price_df)
    expected_cols = {
        "sma20", "sma50", "sma200", "ema20", "rsi14",
        "macd_line", "macd_signal", "macd_hist", "atr14",
        "bb_upper", "bb_lower", "bb_width",
        "week52_high", "week52_low", "volume20", "volume5", "close_diff",
    }
    assert expected_cols.issubset(df.columns)
    tail = df.iloc[-1]
    assert pd.notna(tail["sma200"])
    assert 0 <= tail["rsi14"] <= 100
    assert tail["bb_upper"] >= tail["bb_lower"]
    assert tail["week52_high"] >= tail["week52_low"]


def test_calculate_indicators_sorts_by_date(sample_price_df):
    shuffled = sample_price_df.sample(frac=1, random_state=1).reset_index(drop=True)
    df = calculate_indicators(shuffled)
    assert df["date"].is_monotonic_increasing


# ---- compute_score ----------------------------------------------------

def _df_for_score(macd_hist_prev, macd_hist_now, bb_width_prev, bb_width_now):
    return pd.DataFrame({
        "macd_hist": [macd_hist_prev, macd_hist_now],
        "bb_width": [bb_width_prev, bb_width_now],
    })


def test_compute_score_strong_buy():
    latest = pd.Series({
        "close": 100.0, "sma200": 90.0, "sma50": 95.0, "ema20": 98.0,
        "rsi14": 50.0, "macd_line": 1.0, "macd_signal": 0.5, "macd_hist": 0.5,
        "volume5": 6_000_000.0, "volume20": 5_000_000.0, "volume": 6_000_000.0,
        "close_diff": 1.0, "atr14": 2.0, "bb_lower": 90.0, "bb_upper": 110.0,
        "bb_width": 20.0,
    })
    df = _df_for_score(0.2, 0.5, 22.0, 20.0)
    score, signal, conviction = compute_score(latest, df)
    assert score == pytest.approx(9.0)
    assert signal == "BUY"
    assert conviction == "HIGH"


def test_compute_score_strong_sell():
    latest = pd.Series({
        "close": 80.0, "sma200": 95.0, "sma50": 90.0, "ema20": 92.0,
        "rsi14": 75.0, "macd_line": 0.2, "macd_signal": 0.8, "macd_hist": -0.3,
        "volume5": 3_000_000.0, "volume20": 5_000_000.0, "volume": 6_000_000.0,
        "close_diff": -1.0, "atr14": 6.0, "bb_lower": 90.0, "bb_upper": 110.0,
        "bb_width": 20.0,
    })
    df = _df_for_score(-0.1, -0.3, 18.0, 20.0)
    score, signal, conviction = compute_score(latest, df)
    assert score == pytest.approx(-7.0)
    assert signal == "SELL"
    assert conviction == "HIGH"


def test_compute_score_hold_neutral():
    latest = pd.Series({
        "close": 100.0, "sma200": 95.0, "sma50": 105.0, "ema20": 102.0,
        "rsi14": 50.0, "macd_line": 0.4, "macd_signal": 0.6, "macd_hist": -0.2,
        "volume5": 4_000_000.0, "volume20": 5_000_000.0, "volume": 4_000_000.0,
        "close_diff": -0.5, "atr14": 3.5, "bb_lower": 90.0, "bb_upper": 110.0,
        "bb_width": 20.0,
    })
    df = _df_for_score(-0.1, -0.2, 20.0, 20.0)
    score, signal, conviction = compute_score(latest, df)
    assert score == pytest.approx(0.0)
    assert signal == "HOLD"
    assert conviction == "LOW"


# ---- build_notes ----------------------------------------------------

def test_build_notes_golden_cross():
    n = 40
    dates = pd.to_datetime(_dates(n, date(2023, 1, 2)))
    sma50 = np.array([90.0] * 20 + [105.0] * 20)
    sma200 = np.full(n, 100.0)
    close = sma50 + 1.0
    df = pd.DataFrame({
        "date": dates,
        "close": close,
        "high": close + 1.0,
        "low": close - 1.0,
        "volume": np.full(n, 1_000_000.0),
        "volume20": np.full(n, 1_000_000.0),
        "close_diff": np.diff(close, prepend=close[0]),
        "sma50": sma50,
        "sma200": sma200,
    })
    notes = build_notes(df)
    assert notes["golden_cross"] is True
    assert notes["pattern"] == "Golden Cross"
    assert notes["golden_cross_date"] is not None


def test_build_notes_death_cross():
    n = 40
    dates = pd.to_datetime(_dates(n, date(2023, 1, 2)))
    sma50 = np.array([105.0] * 20 + [90.0] * 20)
    sma200 = np.full(n, 100.0)
    close = sma50 + 1.0
    df = pd.DataFrame({
        "date": dates,
        "close": close,
        "high": close + 1.0,
        "low": close - 1.0,
        "volume": np.full(n, 1_000_000.0),
        "volume20": np.full(n, 1_000_000.0),
        "close_diff": np.diff(close, prepend=close[0]),
        "sma50": sma50,
        "sma200": sma200,
    })
    notes = build_notes(df)
    assert notes["golden_cross"] is False
    assert notes["pattern"] == "Death Cross"


def test_build_notes_volume_spike_and_breakout():
    n = 30
    dates = pd.to_datetime(_dates(n, date(2023, 3, 1)))
    close = np.linspace(100.0, 130.0, n)
    volume = np.full(n, 1_000_000.0)
    volume[25] = 3_000_000.0
    df = pd.DataFrame({
        "date": dates,
        "close": close,
        "high": close + 1.0,
        "low": close - 1.0,
        "volume": volume,
        "volume20": np.full(n, 1_000_000.0),
        "close_diff": np.diff(close, prepend=close[0]),
    })
    notes = build_notes(df)
    assert notes["pattern"] == "Breakout"
    assert notes["volume_events"] == [dates[25].isoformat()]
    assert len(notes["key_support"]) >= 1
    assert len(notes["key_resistance"]) >= 1
    assert notes["key_resistance"][0] >= notes["key_support"][0]


# ---- analyze_ticker / run_full_analysis ----------------------------------------------------

def _insert_prices(db_session, ticker, price_df):
    for _, row in price_df.iterrows():
        db_session.add(Price(
            ticker=ticker,
            date=row["date"].date(),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row["volume"]),
        ))
    db_session.commit()


def test_analyze_ticker_creates_analysis(db_session, sample_price_df):
    ticker = "AAL.L"
    _insert_prices(db_session, ticker, sample_price_df)

    assert analyze_ticker(db_session, ticker) is True

    analysis = db_session.query(Analysis).filter(Analysis.ticker == ticker).one()
    assert analysis.signal in {"BUY", "HOLD", "SELL"}
    assert analysis.conviction in {"LOW", "MEDIUM", "HIGH"}
    assert analysis.entry_zone_high >= analysis.entry_zone_low
    assert analysis.notes is not None


def test_analyze_ticker_no_data_returns_false(db_session):
    assert analyze_ticker(db_session, "NONE.L") is False


def test_analyze_ticker_insufficient_history_returns_false(db_session):
    # sma200 needs 200 rows to warm up; 60 rows leaves it (and other
    # longer-window indicators) NaN for the whole series.
    ticker = "THIN.L"
    _insert_prices(db_session, ticker, make_price_df(n=60))

    assert analyze_ticker(db_session, ticker) is False
    assert db_session.query(Analysis).filter(Analysis.ticker == ticker).count() == 0


def test_analyze_ticker_replaces_existing_analysis(db_session, sample_price_df):
    ticker = "AAL.L"
    _insert_prices(db_session, ticker, sample_price_df)
    analyze_ticker(db_session, ticker)
    analyze_ticker(db_session, ticker)
    count = db_session.query(Analysis).filter(Analysis.ticker == ticker).count()
    assert count == 1


def test_run_full_analysis(db_session, sample_price_df, monkeypatch):
    monkeypatch.setattr(
        "analyser.FTSE_TICKERS",
        [
            {"ticker": "AAA.L", "name": "A", "sector": "Financials", "index": "FTSE100"},
            {"ticker": "BBB.L", "name": "B", "sector": "Financials", "index": "FTSE100"},
        ],
    )
    _insert_prices(db_session, "AAA.L", sample_price_df)
    # BBB.L has no price history and should be skipped, not raise.

    success, total = run_full_analysis(db_session)
    assert total == 2
    assert success == 1
    assert db_session.query(Analysis).filter(Analysis.ticker == "AAA.L").count() == 1
    assert db_session.query(Analysis).filter(Analysis.ticker == "BBB.L").count() == 0


# ---- compute_high_breakout --------------------------------------------------

def _closes_df(closes, start=date(2020, 1, 1)):
    # One row per trading day; spacing rows ~1.45 calendar days apart makes
    # 252 rows span roughly one calendar year, like real trading data.
    dates = pd.to_datetime([start + timedelta(days=round(i * 365.25 / 252)) for i in range(len(closes))])
    return pd.DataFrame({"date": dates, "close": np.asarray(closes, dtype=float)})


def test_high_breakout_multi_year_when_new_all_time_high():
    # 4 years flat at 100, then a rally to 130 — highest close in all history.
    closes = [100.0] * (252 * 4) + list(np.linspace(101, 130, 20))
    result = compute_high_breakout(_closes_df(closes))
    assert result["at_52w_high"] is True
    assert result["multi_year_breakout"] is True
    assert result["years_high_is_min"] is True
    assert result["years_high"] >= 4.0
    assert result["pct_from_52w_high"] == 0.0


def test_high_breakout_measures_years_since_last_higher_close():
    # Peak of 160 three years ago, then a long decline, now rallied to 155 —
    # the highest close since that old peak, so a 3-year (not all-time) high.
    closes = [160.0] + [100.0] * (252 * 3) + list(np.linspace(110, 155, 20))
    result = compute_high_breakout(_closes_df(closes))
    assert result["multi_year_breakout"] is True
    assert result["years_high_is_min"] is False
    assert 2.9 <= result["years_high"] <= 3.2


def test_high_breakout_52w_high_but_not_multi_year():
    # Exceeded 200 eighteen months ago; today's 52-week high is below that.
    closes = [200.0] * 10 + [100.0] * (252 + 126) + list(np.linspace(101, 120, 20))
    result = compute_high_breakout(_closes_df(closes))
    assert result["at_52w_high"] is True
    assert result["multi_year_breakout"] is False
    assert result["years_high"] < 2.0


def test_high_breakout_within_tolerance_after_small_pullback():
    # New high of 130 three days ago, 1.5% pullback since: still "at" the high,
    # and the recent peak still counts as the breakout.
    closes = [100.0] * (252 * 3) + list(np.linspace(101, 130, 20)) + [129.0, 128.05]
    result = compute_high_breakout(_closes_df(closes))
    assert result["at_52w_high"] is True
    assert result["multi_year_breakout"] is True


def test_high_breakout_not_at_high_when_well_below():
    closes = [100.0] * 300 + [90.0] * 10
    result = compute_high_breakout(_closes_df(closes))
    assert result["at_52w_high"] is False
    assert result["multi_year_breakout"] is False
    assert result["years_high"] is None
    assert result["pct_from_52w_high"] == -10.0


def test_build_notes_includes_highs():
    closes = [100.0] * 300 + [120.0]
    df = _closes_df(closes)
    df["high"] = df["close"] + 1
    df["low"] = df["close"] - 1
    df["volume"] = 1_000_000.0
    df["volume20"] = 1_000_000.0
    df["close_diff"] = df["close"].diff()
    notes = build_notes(df)
    assert notes["highs"]["at_52w_high"] is True
