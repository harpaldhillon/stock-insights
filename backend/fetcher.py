import logging
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session

from database import Price
from tickers import FTSE_TICKERS

logger = logging.getLogger(__name__)


def fetch_price_history(ticker: str) -> pd.DataFrame | None:
    try:
        end_date = datetime.utcnow().date()
        start_date = end_date - timedelta(days=730)
        df = yf.download(ticker, start=start_date.isoformat(), end=end_date.isoformat(), progress=False, auto_adjust=False, threads=False)
        if df.empty:
            logger.warning("No data returned for %s", ticker)
            return None
        df = df.reset_index()
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [col[0] if col[0] else col[1] for col in df.columns.to_flat_index()]
            logger.debug("Flattened MultiIndex columns for %s: %s", ticker, list(df.columns))
        if "Date" not in df.columns and "index" in df.columns:
            df = df.rename(columns={"index": "Date"})
        df = df.rename(columns={"Date": "date", "Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})
        required_columns = ["date", "open", "high", "low", "close", "volume"]
        if not set(required_columns).issubset(df.columns):
            logger.warning("Unexpected columns for %s: %s", ticker, list(df.columns))
            return None
        df = df[required_columns]
        df = df.dropna()
        return df
    except Exception as err:
        logger.exception("Failed to fetch ticker %s: %s", ticker, err)
        return None


def save_price_history(db: Session, ticker: str, df: pd.DataFrame) -> None:
    db.query(Price).filter(Price.ticker == ticker).delete()
    db.bulk_save_objects([
        Price(
            ticker=ticker,
            date=row["date"].date() if hasattr(row["date"], "date") else row["date"],
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row["volume"]),
        )
        for _, row in df.iterrows()
    ])
    db.commit()


def load_all_ticker_metadata() -> list[dict]:
    return FTSE_TICKERS
