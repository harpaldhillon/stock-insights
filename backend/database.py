import os
from datetime import datetime
from sqlalchemy import (
    Column,
    Text,
    Date,
    DateTime,
    Float,
    Index,
    Integer,
    JSON,
    String,
    create_engine,
    text,
)
from sqlalchemy.orm import declarative_base, sessionmaker

# Defaults to a file next to the code for local development; the Docker image
# sets DATABASE_URL to a path on its /data volume.
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./ftse_analyser.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Price(Base):
    __tablename__ = "prices"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True, nullable=False)
    date = Column(Date, index=True, nullable=False)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Float, nullable=False)

    __table_args__ = (
        # Covers "latest price per ticker" lookups (ORDER BY date DESC per
        # ticker, and the bulk GROUP BY ticker / MAX(date) query in
        # main.py's get_summary) without a full table scan.
        Index("ix_prices_ticker_date", "ticker", "date"),
    )


class CompanyProfile(Base):
    """Company description from Yahoo Finance, fetched on first view and cached."""
    __tablename__ = "company_profiles"

    ticker = Column(String, primary_key=True)
    summary = Column(Text, nullable=True)
    industry = Column(String, nullable=True)
    website = Column(String, nullable=True)
    city = Column(String, nullable=True)
    country = Column(String, nullable=True)
    employees = Column(Integer, nullable=True)
    fetched_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Recommendation(Base):
    __tablename__ = "recommendations"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True, nullable=False)
    period = Column(String, nullable=False)
    strong_buy = Column(Integer, nullable=False)
    buy = Column(Integer, nullable=False)
    hold = Column(Integer, nullable=False)
    sell = Column(Integer, nullable=False)
    strong_sell = Column(Integer, nullable=False)


class Analysis(Base):
    __tablename__ = "analysis"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True, nullable=False)
    run_date = Column(DateTime, default=datetime.utcnow, nullable=False)
    signal = Column(String, nullable=False)
    conviction = Column(String, nullable=False)
    score = Column(Float, nullable=False)
    entry_zone_low = Column(Float, nullable=False)
    entry_zone_high = Column(Float, nullable=False)
    stop_loss = Column(Float, nullable=False)
    target_price = Column(Float, nullable=False)
    rr_ratio = Column(Float, nullable=False)
    sma20 = Column(Float, nullable=True)
    sma50 = Column(Float, nullable=True)
    sma200 = Column(Float, nullable=True)
    ema20 = Column(Float, nullable=True)
    rsi14 = Column(Float, nullable=True)
    macd_line = Column(Float, nullable=True)
    macd_signal = Column(Float, nullable=True)
    macd_hist = Column(Float, nullable=True)
    atr14 = Column(Float, nullable=True)
    bb_upper = Column(Float, nullable=True)
    bb_lower = Column(Float, nullable=True)
    week52_high = Column(Float, nullable=True)
    week52_low = Column(Float, nullable=True)
    ytd_return = Column(Float, nullable=True)
    notes = Column(JSON, nullable=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    # create_all() only creates indices for tables it creates fresh — for a
    # database file that already existed before this index was introduced,
    # add it defensively (this app has no migration framework).
    with engine.connect() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_prices_ticker_date ON prices (ticker, date)"))
        conn.commit()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
