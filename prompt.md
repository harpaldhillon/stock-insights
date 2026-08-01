You are an expert Python/React full-stack developer. Build a production-ready 
web application called "FTSE Analyser" that runs technical analysis on all 
FTSE100 and FTSE250 stocks daily and displays Buy / Hold / Sell recommendations.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECH STACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Backend:
  - Python 3.11+
  - FastAPI (REST API)
  - yfinance (data fetching)
  - pandas + pandas-ta (indicator calculations)
  - APScheduler (daily refresh job at 18:30 UK time, after market close)
  - SQLite (default) with SQLAlchemy ORM
  - Pydantic v2 (data validation)
  - uvicorn (server)

Frontend:
  - React 18 + Vite
  - Chart.js with react-chartjs-2 (price, RSI, MACD, volume charts)
  - Axios (API calls)
  - Tailwind CSS (styling)
  - React Router v6 (routing)

Deployment (optional, Docker):
  - Dockerfile for backend
  - Dockerfile for frontend
  - docker-compose.yml combining both

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATA REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Maintain a hardcoded (but easily updatable) list of:
   - FTSE100 tickers in Yahoo Finance format (e.g. SHEL.L, AZN.L, HSBA.L)
   - FTSE250 tickers in Yahoo Finance format
   - For each: ticker, company name, sector, index (FTSE100 / FTSE250)

2. On startup AND on daily schedule:
   - Fetch 2 years of daily OHLCV data for every ticker via yfinance
   - Store raw prices in SQLite table: prices(ticker, date, open, high, low, 
     close, volume)
   - Run full analysis pipeline and store results in: analysis(ticker, 
     run_date, signal, conviction, score, entry_zone_low, entry_zone_high, 
     stop_loss, target_price, rr_ratio, sma20, sma50, sma200, ema20, rsi14, 
     macd_line, macd_signal, macd_hist, atr14, bb_upper, bb_lower, 
     week52_high, week52_low, ytd_return, notes JSON)

3. Handle errors gracefully: if a ticker fails to fetch, log the error and 
   continue with the rest.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANALYSIS ENGINE — SCORING LOGIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Calculate all indicators using pandas-ta on the 2-year daily OHLCV data. 
Then assign a score from -10 (strong sell) to +10 (strong buy) using 
this weighted rules engine:

TREND SIGNALS (max ±4 points):
  +1.5  Price > 200-day SMA (uptrend)
  -1.5  Price < 200-day SMA (downtrend)
  +1.0  Price > 50-day SMA
  -1.0  Price < 50-day SMA
  +1.0  50-SMA > 200-SMA (Golden Cross)
  -1.0  50-SMA < 200-SMA (Death Cross)
  +0.5  Price > 20-EMA
  -0.5  Price < 20-EMA

MOMENTUM SIGNALS (max ±3 points):
  +1.0  RSI 40–65 (healthy momentum)
  +0.5  RSI 65–70 (strong, not overbought)
  -1.0  RSI > 70 (overbought)
  -1.5  RSI < 30 (oversold — contrarian: flag as potential reversal)
  +1.0  MACD line > signal line AND histogram positive
  -1.0  MACD line < signal line AND histogram negative
  +0.5  MACD histogram expanding (accelerating)
  -0.5  MACD histogram contracting (decelerating)

VOLUME SIGNALS (max ±1.5 points):
  +1.0  Last 5 days avg volume > 20-day avg volume (confirming move)
  -0.5  Last 5 days avg volume < 20-day avg volume (weak move)
  +0.5  Price up on above-average volume (accumulation)

VOLATILITY SIGNALS (max ±1.5 points):
  +0.5  ATR% < 3% (low volatility, controlled)
  -0.5  ATR% > 5% (high volatility, risky)
  +0.5  Price in lower 50% of Bollinger Band (room to run)
  -0.5  Price above upper Bollinger Band (stretched)
  +0.5  Bollinger Band width contracting (squeeze — potential breakout)

CATEGORISE based on final score:
  score >= +3.5  → BUY    (conviction: HIGH if >=6, MEDIUM if 3.5–6)
  score -3.5 to +3.5 → HOLD
  score <= -3.5  → SELL   (conviction: HIGH if <=-6, MEDIUM if -3.5 to -6)

Also compute:
  entry_zone_low  = max(ema20, sma50) × 0.99
  entry_zone_high = max(ema20, sma50) × 1.01
  stop_loss       = entry_zone_low - (2 × ATR)
  target_price    = entry_zone_high + (3 × ATR × score/10)
  rr_ratio        = (target - entry_mid) / (entry_mid - stop_loss)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND API ENDPOINTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GET  /api/summary
     Returns all stocks with latest analysis results, grouped by signal.
     Supports query params: ?index=FTSE100|FTSE250|ALL&sector=&sort=score

GET  /api/stock/{ticker}
     Returns full detail for one stock:
     - Company info (name, sector, index)
     - Latest analysis (all indicators + verdict)
     - 2 years of daily OHLCV prices (for charting)
     - Computed moving averages for charting (sma50, sma200, ema20 series)

GET  /api/refresh
     Manually triggers a full data refresh and re-analysis (returns job ID)

GET  /api/status
     Returns last_updated timestamp, total stocks analysed, counts per signal

Include CORS middleware to allow the React frontend to call the API.
Add a /docs endpoint (FastAPI auto-generates Swagger UI).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — PAGE 1: DASHBOARD (/)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Header:
  - "FTSE Analyser" logo
  - Last updated timestamp
  - "Refresh Now" button (calls /api/refresh, shows loading spinner)
  - Filter bar: Index toggle (ALL / FTSE100 / FTSE250), Sector dropdown, 
    Sort dropdown (Score ↓, Score ↑, Alphabetical)

Main content — three side-by-side collapsible panels:

  BUY panel (green header):
    Table columns: Ticker | Company | Sector | Score | Conviction | 
                   Entry Zone | Stop | Target | R:R
    Each row is clickable → navigates to /stock/{ticker}
    Show count badge on panel header e.g. "BUY (23)"

  HOLD panel (amber header):
    Same columns as BUY panel
    Show count badge

  SELL panel (red header):
    Same columns as BUY panel
    Show count badge

Add a summary stats bar at top:
  Total stocks | % BUY | % HOLD | % SELL | Avg score

Dark/light mode toggle in header.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — PAGE 2: STOCK DETAIL (/stock/:ticker)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Build a detailed analysis page for each stock, matching this structure:

Header section:
  - Ticker, company name, sector, index badge
  - Current price, day change %
  - Signal badge (BUY/HOLD/SELL) with conviction label
  - Back to dashboard button

Section 1 — Trend Analysis:
  - 4 metric cards: EMA20, SMA50, SMA200, Trend Phase
  - Chart: 2-year price line with EMA20 (orange dashed), SMA50 (blue dashed), 
    SMA200 (gold dashed) overlaid. Use Chart.js line chart.
  - Golden/Death cross event noted with annotation

Section 2 — Momentum Indicators:
  - Indicator table: RSI, MACD line, MACD signal, MACD histogram, divergence
    Each row has: Name | Value | Interpretation | Signal badge
  - RSI chart: 6-month line chart with overbought (70) and oversold (30) 
    reference lines drawn as horizontal dashed annotations

Section 3 — Volume Analysis:
  - 3 metric cards: Avg Volume (30d), Volume Trend, Avg Volume USD
  - Volume bar chart: monthly average bars, colour-coded 
    (red for high-volume reversal days, green for accumulation days)

Section 4 — Support & Resistance:
  - 4 metric cards: 52-week high, 52-week low, current price, distance from 200MA
  - Two columns: Support levels (S1/S2/S3) and Resistance levels (R1/R2/R3)
    Each level shows price, description, and a strength badge

Section 5 — Volatility:
  - 4 metric cards: ATR, Bollinger Upper, Bollinger Lower, Band Width
  - Progress bars showing: ATR%, Bollinger position, max drawdown

Section 6 — Risk / Reward:
  - 4-column grid: Entry Zone | Stop Loss | Target | R:R Ratio
  - Position sizing note (based on ATR and 2% rule)

Section 7 — Verdict:
  - Two columns: Bullish Factors and Risk Factors (bullet lists)
  - Prominent verdict box with signal, conviction, time horizon, 
    and one-line summary for portfolio committee

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT STRUCTURE TO GENERATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ftse-analyser/
├── backend/
│   ├── main.py              # FastAPI app, routes, CORS, scheduler setup
│   ├── database.py          # SQLAlchemy models and DB init
│   ├── fetcher.py           # yfinance data fetching logic
│   ├── analyser.py          # Full analysis engine + scoring logic
│   ├── scheduler.py         # APScheduler daily job
│   ├── tickers.py           # FTSE100 + FTSE250 ticker/company/sector list
│   ├── schemas.py           # Pydantic response schemas
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   └── StockDetail.jsx
│   │   ├── components/
│   │   │   ├── StockTable.jsx
│   │   │   ├── PriceChart.jsx
│   │   │   ├── RSIChart.jsx
│   │   │   ├── MACDChart.jsx
│   │   │   ├── VolumeChart.jsx
│   │   │   ├── MetricCard.jsx
│   │   │   ├── SignalBadge.jsx
│   │   │   └── VerdictPanel.jsx
│   │   └── api/
│   │       └── client.js    # Axios API client with base URL config
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── Dockerfile
├── docker-compose.yml
└── README.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADDITIONAL REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. On first startup with empty DB, automatically trigger a full data fetch 
   and analysis run before the API starts accepting requests (or return a 
   "loading" status from /api/status while it runs in background)

2. Add a simple loading state on the dashboard while data is being fetched 
   with a progress indicator (e.g. "Analysing 45/350 stocks...")

3. Include at least 30 real FTSE100 tickers in tickers.py to make the app 
   immediately usable (e.g. AZN.L, HSBA.L, SHEL.L, ULVR.L, BP.L, 
   LLOY.L, VOD.L, GSK.L, RIO.L, BT-A.L, BARC.L, NWG.L, REL.L, 
   NG.L, SSE.L, SGE.L, EXPN.L, JD.L, PSN.L, BME.L...)

4. The analysis notes field (JSON) should store:
   - golden_cross: true/false and date if recent
   - volume_events: list of significant volume spike dates
   - pattern: detected chart pattern name
   - key_support: list of 3 price levels
   - key_resistance: list of 3 price levels

5. All monetary values displayed in GBp (pence) or £ as appropriate for 
   LSE-listed stocks (Yahoo Finance returns .L tickers in pence)

6. Add a disclaimer footer: "For educational purposes only. Not financial advice."

Generate all files completely, with no placeholders. The app should run 
with: cd backend && pip install -r requirements.txt && python main.py
and: cd frontend && npm install && npm run dev
