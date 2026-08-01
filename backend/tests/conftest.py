from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base


@pytest.fixture()
def db_engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    TestSession = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


def make_price_df(n=300, start_price=100.0, trend=0.15, seed=42, start_date=None):
    """Synthetic OHLCV data with a mild uptrend, for deterministic indicator tests."""
    rng = np.random.default_rng(seed)
    start_date = start_date or (date.today() - timedelta(days=n))
    dates = pd.to_datetime([start_date + timedelta(days=i) for i in range(n)])
    close = start_price + np.cumsum(np.full(n, trend)) + rng.normal(0, 1.0, n)
    close = np.maximum(close, 1.0)
    open_ = close - rng.normal(0, 0.3, n)
    high = np.maximum(open_, close) + np.abs(rng.normal(0, 0.5, n))
    low = np.minimum(open_, close) - np.abs(rng.normal(0, 0.5, n))
    volume = rng.integers(1_000_000, 5_000_000, n).astype(float)
    return pd.DataFrame({
        "date": dates,
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    })


@pytest.fixture()
def sample_price_df():
    return make_price_df()
