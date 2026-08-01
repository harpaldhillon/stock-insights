import logging
from datetime import datetime

import pandas as pd
import pandas_ta as ta
from sqlalchemy.orm import Session

from database import Analysis, Price
from tickers import FTSE_TICKERS, TICKERS_BY_TICKER

logger = logging.getLogger(__name__)


def get_ticker_metadata(ticker: str) -> dict | None:
    return TICKERS_BY_TICKER.get(ticker)


def calculate_indicators(price_df: pd.DataFrame) -> pd.DataFrame:
    df = price_df.copy()
    df = df.sort_values("date").reset_index(drop=True)
    df["sma20"] = ta.sma(df["close"], length=20)
    df["sma50"] = ta.sma(df["close"], length=50)
    df["sma200"] = ta.sma(df["close"], length=200)
    df["ema20"] = ta.ema(df["close"], length=20)
    df["rsi14"] = ta.rsi(df["close"], length=14)
    macd = ta.macd(df["close"], fast=12, slow=26, signal=9)
    df["macd_line"] = macd["MACD_12_26_9"]
    df["macd_signal"] = macd["MACDs_12_26_9"]
    df["macd_hist"] = macd["MACDh_12_26_9"]
    atr = ta.atr(df["high"], df["low"], df["close"], length=14)
    df["atr14"] = atr
    bb = ta.bbands(df["close"], length=20, std=2)
    if isinstance(bb.columns, pd.MultiIndex):
        bb.columns = [col[0] if col[0] else col[1] for col in bb.columns.to_flat_index()]
    bb_upper_cols = bb.filter(regex=r"^BBU").columns
    bb_lower_cols = bb.filter(regex=r"^BBL").columns
    if bb_upper_cols.empty or bb_lower_cols.empty:
        raise ValueError(f"Unexpected Bollinger Bands columns: {list(bb.columns)}")
    df["bb_upper"] = bb[bb_upper_cols[0]]
    df["bb_lower"] = bb[bb_lower_cols[0]]
    df["bb_width"] = df["bb_upper"] - df["bb_lower"]
    df["week52_high"] = df["close"].rolling(window=252, min_periods=1).max()
    df["week52_low"] = df["close"].rolling(window=252, min_periods=1).min()
    df["volume20"] = df["volume"].rolling(window=20, min_periods=1).mean()
    df["volume5"] = df["volume"].rolling(window=5, min_periods=1).mean()
    df["close_diff"] = df["close"].diff()
    return df


def build_notes(df: pd.DataFrame) -> dict:
    latest = df.iloc[-1]
    notes = {
        "golden_cross": False,
        "golden_cross_date": None,
        "volume_events": [],
        "pattern": "None",
        "key_support": [],
        "key_resistance": [],
    }

    if not df.empty and "sma50" in df.columns and "sma200" in df.columns:
        cross_rows = df[~df["sma50"].isna() & ~df["sma200"].isna()].copy()
        cross_rows["cross"] = cross_rows["sma50"] - cross_rows["sma200"]
        cross_rows["cross_sign"] = cross_rows["cross"].apply(lambda x: 1 if x >= 0 else -1)
        cross_points = cross_rows[cross_rows["cross_sign"] != cross_rows["cross_sign"].shift(1)]
        recent_cross = cross_points.tail(1)
        if not recent_cross.empty:
            cross_date = recent_cross.iloc[-1]["date"]
            is_golden = recent_cross.iloc[-1]["cross"] > 0
            notes["golden_cross"] = bool(is_golden)
            notes["golden_cross_date"] = cross_date.isoformat()
            notes["pattern"] = "Golden Cross" if is_golden else "Death Cross"

    spike_rows = df[(df["volume"] > df["volume20"] * 1.8) & (df["close_diff"] > 0)].tail(5)
    notes["volume_events"] = [r["date"].isoformat() for _, r in spike_rows.iterrows()]

    supports = df["low"].rolling(window=30, min_periods=1).min().tail(3).tolist()
    resistances = df["high"].rolling(window=30, min_periods=1).max().tail(3).tolist()
    notes["key_support"] = [round(float(x), 2) for x in sorted(set(supports)) if pd.notna(x)][:3]
    notes["key_resistance"] = [round(float(x), 2) for x in sorted(set(resistances), reverse=True) if pd.notna(x)][:3]
    if notes["pattern"] == "None":
        if latest["close"] > df["close"].rolling(window=20, min_periods=1).max().iloc[-2]:
            notes["pattern"] = "Breakout"
        elif latest["close"] < df["close"].rolling(window=20, min_periods=1).min().iloc[-2]:
            notes["pattern"] = "Breakdown"
    return notes


# Indicators compute_score() reads directly off the latest row. NaN here (e.g. a
# recently-listed ticker with <200 days of history, so sma200 hasn't warmed up
# yet) compares as False in both directions, silently steering the score toward
# a bearish result instead of signalling "not enough data yet".
REQUIRED_INDICATORS = [
    "sma50", "sma200", "ema20", "rsi14",
    "macd_line", "macd_signal", "macd_hist",
    "atr14", "bb_upper", "bb_lower",
]

# ---------------------------------------------------------------------------
# compute_score() weights and thresholds, named so each rule can be found,
# tuned, and reasoned about without parsing the scoring logic itself.
# ---------------------------------------------------------------------------

# Trend — price vs. moving averages
SCORE_ABOVE_SMA200 = 1.5
SCORE_ABOVE_SMA50 = 1.0
SCORE_SMA50_ABOVE_SMA200 = 1.0
SCORE_ABOVE_EMA20 = 0.5

# RSI (momentum) bands
RSI_HEALTHY_LOW = 40
RSI_HEALTHY_HIGH = 65
RSI_OVERBOUGHT = 70
RSI_OVERSOLD = 30
SCORE_RSI_HEALTHY = 1.0
SCORE_RSI_STRONG = 0.5              # RSI_HEALTHY_HIGH < RSI <= RSI_OVERBOUGHT: strong but not yet overbought
SCORE_RSI_OVERBOUGHT_PENALTY = 1.0
SCORE_RSI_OVERSOLD_PENALTY = 1.5

# MACD
SCORE_MACD_ALIGNED = 1.0            # MACD/signal cross agrees with histogram sign (either direction)
SCORE_MACD_HIST_RISING = 0.5

# Volume
SCORE_VOLUME_RISING = 1.0           # 5-day avg volume above the 20-day avg
SCORE_VOLUME_FALLING_PENALTY = 0.5
SCORE_VOLUME_CONFIRMS_MOVE = 0.5    # up day on above-average volume

# Volatility (ATR) and Bollinger Bands
ATR_PCT_LOW = 3.0                   # ATR as a % of price
ATR_PCT_HIGH = 5.0
SCORE_LOW_VOLATILITY = 0.5
SCORE_HIGH_VOLATILITY_PENALTY = 0.5
BB_LOWER_HALF_FRACTION = 0.5        # "close sits in the lower half of the band" cutoff
SCORE_NEAR_LOWER_BAND = 0.5
SCORE_ABOVE_UPPER_BAND_PENALTY = 0.5
SCORE_BANDS_TIGHTENING = 0.5        # Bollinger Band squeeze (narrowing width)

# Signal / conviction thresholds
CONVICTION_HIGH_THRESHOLD = 6.0
SIGNAL_THRESHOLD = 3.5              # BUY/SELL cutoff; also doubles as the MEDIUM-conviction band

# analyze_ticker() entry/stop/target math
ENTRY_ZONE_LOW_MULTIPLIER = 0.99    # entry zone = +/-1% around max(ema20, sma50)
ENTRY_ZONE_HIGH_MULTIPLIER = 1.01
STOP_LOSS_ATR_MULTIPLIER = 2.0
TARGET_ATR_MULTIPLIER = 3.0
SCORE_NORMALIZATION_DIVISOR = 10.0  # scales score into a target-price multiplier


def compute_score(latest: pd.Series, df: pd.DataFrame) -> tuple[float, str, str]:
    score = 0.0

    if latest["close"] > latest["sma200"]:
        score += SCORE_ABOVE_SMA200
    else:
        score -= SCORE_ABOVE_SMA200
    if latest["close"] > latest["sma50"]:
        score += SCORE_ABOVE_SMA50
    else:
        score -= SCORE_ABOVE_SMA50
    if latest["sma50"] > latest["sma200"]:
        score += SCORE_SMA50_ABOVE_SMA200
    else:
        score -= SCORE_SMA50_ABOVE_SMA200
    if latest["close"] > latest["ema20"]:
        score += SCORE_ABOVE_EMA20
    else:
        score -= SCORE_ABOVE_EMA20

    if RSI_HEALTHY_LOW <= latest["rsi14"] <= RSI_HEALTHY_HIGH:
        score += SCORE_RSI_HEALTHY
    elif RSI_HEALTHY_HIGH < latest["rsi14"] <= RSI_OVERBOUGHT:
        score += SCORE_RSI_STRONG
    elif latest["rsi14"] > RSI_OVERBOUGHT:
        score -= SCORE_RSI_OVERBOUGHT_PENALTY
    elif latest["rsi14"] < RSI_OVERSOLD:
        score -= SCORE_RSI_OVERSOLD_PENALTY

    if latest["macd_line"] > latest["macd_signal"] and latest["macd_hist"] > 0:
        score += SCORE_MACD_ALIGNED
    elif latest["macd_line"] < latest["macd_signal"] and latest["macd_hist"] < 0:
        score -= SCORE_MACD_ALIGNED
    if df["macd_hist"].iloc[-1] > df["macd_hist"].iloc[-2]:
        score += SCORE_MACD_HIST_RISING
    else:
        score -= SCORE_MACD_HIST_RISING

    if latest["volume5"] > latest["volume20"]:
        score += SCORE_VOLUME_RISING
    else:
        score -= SCORE_VOLUME_FALLING_PENALTY
    if latest["close_diff"] > 0 and latest["volume"] > latest["volume20"]:
        score += SCORE_VOLUME_CONFIRMS_MOVE

    atr_pct = latest["atr14"] / latest["close"] * 100.0 if latest["close"] else 0.0
    if atr_pct < ATR_PCT_LOW:
        score += SCORE_LOW_VOLATILITY
    elif atr_pct > ATR_PCT_HIGH:
        score -= SCORE_HIGH_VOLATILITY_PENALTY
    if latest["close"] < latest["bb_lower"] + (latest["bb_upper"] - latest["bb_lower"]) * BB_LOWER_HALF_FRACTION:
        score += SCORE_NEAR_LOWER_BAND
    if latest["close"] > latest["bb_upper"]:
        score -= SCORE_ABOVE_UPPER_BAND_PENALTY
    bb_width_now = latest["bb_width"]
    bb_width_prev = df["bb_width"].iloc[-2] if len(df) >= 2 else bb_width_now
    if bb_width_now < bb_width_prev:
        score += SCORE_BANDS_TIGHTENING

    if score >= CONVICTION_HIGH_THRESHOLD:
        conviction = "HIGH"
    elif score >= SIGNAL_THRESHOLD:
        conviction = "MEDIUM"
    elif score <= -CONVICTION_HIGH_THRESHOLD:
        conviction = "HIGH"
    elif score <= -SIGNAL_THRESHOLD:
        conviction = "MEDIUM"
    else:
        conviction = "LOW"

    signal = "HOLD"
    if score >= SIGNAL_THRESHOLD:
        signal = "BUY"
    elif score <= -SIGNAL_THRESHOLD:
        signal = "SELL"
    return round(score, 2), signal, conviction


def analyze_ticker(db: Session, ticker: str) -> bool:
    price_rows = db.query(Price).filter(Price.ticker == ticker).order_by(Price.date).all()
    if not price_rows:
        logger.warning("No price data for %s", ticker)
        return False
    df = pd.DataFrame([{
        "date": p.date,
        "open": p.open,
        "high": p.high,
        "low": p.low,
        "close": p.close,
        "volume": p.volume,
    } for p in price_rows])
    indicator_df = calculate_indicators(df)
    latest = indicator_df.iloc[-1]
    if latest[REQUIRED_INDICATORS].isna().any():
        logger.warning(
            "Insufficient price history for %s (%d rows) to compute all indicators; skipping",
            ticker, len(price_rows),
        )
        return False
    score, signal, conviction = compute_score(latest, indicator_df)
    entry_pivot = max(latest["ema20"], latest["sma50"])
    entry_zone_low = entry_pivot * ENTRY_ZONE_LOW_MULTIPLIER
    entry_zone_high = entry_pivot * ENTRY_ZONE_HIGH_MULTIPLIER
    atr = latest["atr14"] if latest["atr14"] else 0.0
    stop_loss = max(0.0, entry_zone_low - STOP_LOSS_ATR_MULTIPLIER * atr)
    target_price = entry_zone_high + TARGET_ATR_MULTIPLIER * atr * (score / SCORE_NORMALIZATION_DIVISOR)
    entry_mid = (entry_zone_low + entry_zone_high) / 2.0
    rr_ratio = (target_price - entry_mid) / (entry_mid - stop_loss) if entry_mid > stop_loss else 0.0
    ytd_return = None
    year_start = next((row["close"] for _, row in indicator_df.iterrows() if row["date"].year == latest["date"].year and row["date"] <= latest["date"]), None)
    if year_start and year_start > 0:
        ytd_return = round((latest["close"] / year_start - 1.0) * 100.0, 2)

    notes = build_notes(indicator_df)
    analysis = Analysis(
        ticker=ticker,
        run_date=datetime.utcnow(),
        signal=signal,
        conviction=conviction,
        score=score,
        entry_zone_low=round(entry_zone_low, 2),
        entry_zone_high=round(entry_zone_high, 2),
        stop_loss=round(stop_loss, 2),
        target_price=round(target_price, 2),
        rr_ratio=round(rr_ratio, 2),
        sma20=round(float(latest["sma20"]), 2) if pd.notna(latest["sma20"]) else None,
        sma50=round(float(latest["sma50"]), 2) if pd.notna(latest["sma50"]) else None,
        sma200=round(float(latest["sma200"]), 2) if pd.notna(latest["sma200"]) else None,
        ema20=round(float(latest["ema20"]), 2) if pd.notna(latest["ema20"]) else None,
        rsi14=round(float(latest["rsi14"]), 2) if pd.notna(latest["rsi14"]) else None,
        macd_line=round(float(latest["macd_line"]), 4) if pd.notna(latest["macd_line"]) else None,
        macd_signal=round(float(latest["macd_signal"]), 4) if pd.notna(latest["macd_signal"]) else None,
        macd_hist=round(float(latest["macd_hist"]), 4) if pd.notna(latest["macd_hist"]) else None,
        atr14=round(float(latest["atr14"]), 4) if pd.notna(latest["atr14"]) else None,
        bb_upper=round(float(latest["bb_upper"]), 2) if pd.notna(latest["bb_upper"]) else None,
        bb_lower=round(float(latest["bb_lower"]), 2) if pd.notna(latest["bb_lower"]) else None,
        week52_high=round(float(latest["week52_high"]), 2) if pd.notna(latest["week52_high"]) else None,
        week52_low=round(float(latest["week52_low"]), 2) if pd.notna(latest["week52_low"]) else None,
        ytd_return=round(float(ytd_return), 2) if ytd_return is not None else None,
        notes=notes,
    )
    db.query(Analysis).filter(Analysis.ticker == ticker).delete()
    db.add(analysis)
    db.commit()
    return True


def run_full_analysis(db: Session) -> tuple[int, int]:
    tickers = [item["ticker"] for item in FTSE_TICKERS]
    total = len(tickers)
    success = 0
    for ticker in tickers:
        try:
            if analyze_ticker(db, ticker):
                success += 1
        except Exception as err:
            logger.exception("Analysis failed for %s: %s", ticker, err)
            continue
    return success, total
