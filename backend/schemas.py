from datetime import date, datetime
from pydantic import BaseModel


class TickerMeta(BaseModel):
    ticker: str
    name: str
    sector: str
    index: str


class AnalysisBase(BaseModel):
    """Fields that exist directly on the Analysis ORM row."""
    ticker: str
    signal: str
    conviction: str
    score: float
    entry_zone_low: float
    entry_zone_high: float
    stop_loss: float
    target_price: float
    rr_ratio: float
    notes: dict | None = None

    model_config = {"from_attributes": True}


class AnalysisSummary(AnalysisBase):
    """Extends AnalysisBase with denormalised metadata for the summary list."""
    name: str
    sector: str
    index: str


class AnalysisDetail(AnalysisBase):
    """Full analysis detail — serialised directly from the ORM object."""
    run_date: datetime
    sma20: float | None = None
    sma50: float | None = None
    sma200: float | None = None
    ema20: float | None = None
    rsi14: float | None = None
    macd_line: float | None = None
    macd_signal: float | None = None
    macd_hist: float | None = None
    atr14: float | None = None
    bb_upper: float | None = None
    bb_lower: float | None = None
    week52_high: float | None = None
    week52_low: float | None = None
    ytd_return: float | None = None


class PricePoint(BaseModel):
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: float

    model_config = {"from_attributes": True}


class RecommendationPeriod(BaseModel):
    period: str
    strong_buy: int
    buy: int
    hold: int
    sell: int
    strong_sell: int

    model_config = {"from_attributes": True}


class StockDetailResponse(BaseModel):
    company: TickerMeta
    analysis: AnalysisDetail
    prices: list[PricePoint]
    recommendations: list[RecommendationPeriod] = []

    model_config = {"from_attributes": True}


class StatusResponse(BaseModel):
    last_updated: datetime | None
    total_stocks: int
    buy_count: int
    hold_count: int
    sell_count: int
    initializing: bool
    refreshing: bool
