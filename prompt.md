You are an expert Python/React full-stack developer. Build a web application
called "Stock Insight" (subtitle: "Technical signals for UK & US stocks") that
runs technical analysis daily on the FTSE 100, FTSE 250, FTSE SmallCap and
NASDAQ-100 stocks and displays Buy / Hold / Sell recommendations.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECH STACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Backend:
  - Python 3.12
  - FastAPI (REST API) + uvicorn
  - yfinance (prices, analyst recommendations, company profiles)
  - pandas + pandas-ta (indicator calculations)
  - APScheduler (daily refresh at 18:30 Europe/London, after UK market close)
  - SQLite with SQLAlchemy ORM (no migration framework; create_all on startup)
  - Pydantic v2 (response schemas)
  - pytest (unit tests; yfinance is always mocked, DB is in-memory SQLite)

Frontend:
  - React 18 + Vite
  - Chart.js with react-chartjs-2 (price, RSI, MACD, volume, analyst charts)
  - Axios (API calls; base URL from VITE_API_BASE_URL, default
    http://localhost:8000)
  - Tailwind CSS (styling, dark mode by default with a light/dark toggle)
  - React Router v6 (routing)

Containers (podman-compose or docker-compose):
  - backend/Dockerfile: python:3.12-slim, runs as non-root user "app"
    (UID/GID 1000, overridable with --build-arg APP_UID/APP_GID); HOME and
    XDG_CACHE_HOME pinned to /home/app
  - frontend/Dockerfile: node:20-alpine, installs `serve` globally as root,
    then runs as the image's non-root "node" user (UID 1000)
  - .dockerignore in both: never copy .venv, *.db, caches, .env or the host's
    node_modules into an image
  - docker-compose.yml:
      * images named docker.io/containerssimplified/ftse-analyser-backend:latest
        and docker.io/containerssimplified/ftse-analyser-frontend:latest
      * ports published on localhost only (127.0.0.1:8000 and 127.0.0.1:3000):
        the API has no authentication
      * ./backend and ./frontend bind-mounted for live development; the
        frontend service runs `npm run dev -- --host 0.0.0.0`
      * userns_mode: keep-id on both services, so rootless podman maps the
        host UID into the containers and the non-root user can write the
        bind-mounted files (remove for Docker, which doesn't support keep-id)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. tickers.py holds a hardcoded, easily updated list (~590 entries). Each
   entry has: ticker (Yahoo format), name, sector, index and quote currency.
   - FTSE_TICKERS: FTSE 100 (current constituents after the 1 Oct 2026
     review), FTSE 250 and FTSE SmallCap, in sections sorted by ticker
   - NASDAQ100_TICKERS: all 101 NASDAQ-100 securities (Alphabet has two share
     classes), with ICB industries mapped onto the same sector names
   - ALL_TICKERS = FTSE_TICKERS + NASDAQ100_TICKERS; every ticker appears
     exactly once (enforced by a test)
   - Sector names: Basic Materials, Communication Services, Consumer
     Cyclical, Consumer Defensive, Energy, Financials, Healthcare,
     Industrials, Real Estate, Technology, Utilities
   - currency defaults to "GBp" (pence) for .L tickers and "USD" otherwise;
     set it explicitly for London lines quoted in USD, EUR or GBP
     (e.g. CPG.L and IHG.L are USD, MTLN.L is EUR, LTI.L is GBP)
   - Lookup tables built at import: TICKERS_BY_TICKER, TICKERS_BY_INDEX,
     TICKERS_BY_SECTOR (lower-cased sector)
   - Remove delisted tickers; check membership against the index's current
     constituents list when refreshing it

2. Tables:
   - prices(ticker, date, open, high, low, close, volume), index on
     (ticker, date)
   - analysis(ticker, run_date, signal, conviction, score, entry_zone_low,
     entry_zone_high, stop_loss, target_price, rr_ratio, sma20, sma50,
     sma200, ema20, rsi14, macd_line, macd_signal, macd_hist, atr14,
     bb_upper, bb_lower, week52_high, week52_low, ytd_return, notes JSON);
     one row per ticker (replaced on each run)
   - recommendations(ticker, period, strong_buy, buy, hold, sell,
     strong_sell): analyst recommendation trend from yfinance
   - company_profiles(ticker PK, summary, industry, website, city, country,
     employees, fetched_at): fetched on demand, cached 30 days

3. Refresh job (on startup, on the 18:30 schedule, and from /api/refresh):
   - For each ticker: download ~5 years of daily OHLCV with yfinance
     (end = today, exclusive, so only completed sessions are used), replace
     its price rows, and fetch analyst recommendations
   - Analyse only the tickers whose prices were fetched in this run; if
     nothing was fetched (network/Yahoo outage), skip analysis and leave
     last_updated unchanged, so stale data never looks freshly updated
   - Then prune stale signals: delete analyses for tickers no longer in the
     list, and for tickers whose latest price is more than 10 days
     (STALE_PRICE_DAYS) behind the newest price in the database (delisted
     stocks often still return old history)
   - Only one refresh at a time: every path claims a non-blocking
     threading.Lock first (the request thread claims it, the worker thread
     releases it); the scheduled/startup path skips if one is running
   - Errors are logged per ticker and never stop the run; after a failed
     ticker, roll back the session and drop that ticker's old analysis
   - A ticker with no prices, or too little history for every required
     indicator (~200 trading days), is skipped and its old analysis removed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANALYSIS ENGINE — SCORING LOGIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Indicators (pandas-ta, daily data): SMA20/50/200, EMA20, RSI(14),
MACD(12,26,9), ATR(14), Bollinger Bands(20, 2), 52-week high/low (highest
and lowest close over 252 trading days), 5- and 20-day average volume.

Keep every weight and threshold as a named constant. compute_score_breakdown
returns one entry per rule {key, points, max} (keys: sma200, sma50,
sma_cross, ema20, rsi, macd, macd_hist, volume_trend, volume_confirms, atr,
bb_lower_half, bb_above_upper, bb_squeeze); compute_score sums it.

TREND:
  ±1.5  Close above / below the 200-day SMA
  ±1.0  Close above / below the 50-day SMA
  ±1.0  50-day SMA above / below the 200-day SMA
  ±0.5  Close above / below the 20-day EMA

MOMENTUM:
  +1.0  RSI 40–65 (healthy)
  +0.5  RSI 65–70 (strong, not overbought)
  -1.0  RSI > 70 (overbought)
  -1.5  RSI < 30 (oversold)
  ±1.0  MACD above its signal with a positive histogram / below with a
        negative histogram (0 if they disagree)
  ±0.5  MACD histogram rising / falling versus the previous day

VOLUME:
  +1.0 / -0.5  5-day average volume above / below the 20-day average
  +0.5         Up day on above-average volume

VOLATILITY:
  +0.5  ATR below 3% of price;  -0.5  ATR above 5% of price
  +0.5  Close in the lower half of the Bollinger Bands
  -0.5  Close above the upper Bollinger Band
  +0.5  Bollinger Band width narrowing (squeeze)

SIGNAL and CONVICTION:
  score >= +3.5 → BUY;  score <= -3.5 → SELL;  otherwise HOLD
  conviction HIGH beyond ±6, MEDIUM from ±3.5, otherwise LOW

TRADE LEVELS:
  entry_zone_low/high = max(ema20, sma50) × 0.99 / × 1.01
  stop_loss           = entry_zone_low - 2 × ATR
  target_price        = entry_zone_high + 3 × ATR × score / 10
  rr_ratio            = (target - entry_mid) / (entry_mid - stop_loss)

NOTES JSON (stored on each analysis):
  - golden_cross, golden_cross_date: the most recent real 50/200 SMA cross
    (a sign change versus a real previous day; the first row never counts)
  - pattern: "Golden Cross" / "Death Cross" only if that cross happened in
    the last 20 trading days; otherwise "Breakout" if today's close beats
    the prior 20-day high, "Breakdown" if below the prior 20-day low, else
    "None"
  - volume_events: up to 5 recent up days on volume > 1.8× the 20-day average
  - key_support / key_resistance: 30-day rolling low / high levels
  - highs: at_52w_high (latest close within 2% of the 52-week high),
    pct_from_52w_high, multi_year_breakout (at a 52-week high AND the peak
    of the last 5 trading days is the highest close in at least 2 years),
    years_high (years since the price last closed at or above that peak),
    years_high_is_min (true if never higher in the fetched history, shown
    as e.g. "5y+")
  - score_breakdown: the per-rule list above

The highs and breakdown never change the score; they explain it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND API ENDPOINTS (all GET)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GET /api/summary?index=ALL|FTSE100|FTSE250|FTSE SmallCap|NASDAQ100
                &sector=&sort=score_desc|score_asc|ticker
    Latest analysis for every stock, grouped {BUY: [], HOLD: [], SELL: []}.
    Each row: ticker, name, sector, index, currency, signal, conviction,
    score, entry zone, stop, target, rr_ratio, notes, current_price (one
    bulk latest-price query, no N+1).

GET /api/stock/{ticker}
    company (ticker, name, sector, index, currency), latest analysis (all
    indicators + notes), full daily price history, analyst recommendation
    periods. 404 for unknown tickers or when no analysis exists yet.

GET /api/stock/{ticker}/profile
    Company description: summary, industry, website, city, country,
    employees. Ticker must be in the list (404 otherwise). Fetched from
    Yahoo on first request, cached 30 days; a stale copy is served if a
    re-fetch fails; empty fields when Yahoo has nothing.

GET /api/strategy
    The scoring rules (group, rule text, points), BUY/SELL and conviction
    thresholds, highs parameters and trade-level multipliers, generated
    from the analyser's own constants so the explanation can't drift.

GET /api/refresh?force=false
    Starts a background refresh. Returns {status: "started", job_id},
    {status: "already_running", job_id}, or, if data was already refreshed
    on the current UK calendar date, {status: "already_refreshed_today",
    last_updated} (prices only change after the next close). force=true
    overrides. The scheduled 18:30 refresh is not subject to this.

GET /api/status
    last_updated (newest analysis run_date, so it survives restarts),
    total_stocks, buy/hold/sell counts, initializing, refreshing.

CORS: allow only the frontend origin (default http://localhost:3000 and
http://127.0.0.1:3000, override with FRONTEND_ORIGINS), GET only, no
credentials. FastAPI's /docs stays enabled for local use.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — HEADER AND APP STATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - Logo + "Stock Insight" + subtitle, linking to the dashboard
  - "Updated 3 Nov, 22:01" label (backend timestamps are naive UTC: parse
    them as UTC so the time is right in BST)
  - Strategy button (dashboard only), light/dark toggle (remembered in
    localStorage), Refresh button
  - Refresh: calls /api/refresh, then polls /api/status until the refresh
    finishes and tells the dashboard to reload; on
    "already_refreshed_today" show a 6-second notice "Already up to date:
    data was refreshed today at HH:MM" instead of a spinner
  - Footer: "Data refreshes daily after UK market close · For educational
    purposes only — not financial advice."
  - Dashboard state (filters, search, fetched rows, table pages, expanded
    panel) lives in App, so it survives opening a stock and coming back

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — DASHBOARD (/)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary pills: Total stocks | Buy % | Hold % | Sell % | Avg score, all
computed for the current selection (index + sector + highs), so Buy/Hold/Sell
add up to ~100%.

Filter bar:
  - Search (ticker or company name)
  - Index: ALL, FTSE100, FTSE250, FTSE SmallCap, NASDAQ100
  - Sector (options from the current index; reset if it disappears)
  - Highs: All stocks / At 52-week high (n) / Multi-year breakout (n)
  - Sort: Score (high → low), Score (low → high), Alphabetical
  Only index and sort go to the backend. Sector, highs and search filter
  client-side (shared helpers in lib/filters.js). Any filter change resets
  tables to page 1.

Data loading: fetch /api/summary only when index, sort or a finished
refresh changes, not on returning to the page. Abort the previous request
when the key changes (a slow ALL response must never show under FTSE100),
and only show rows that match the current key. Show "Analysing stocks…"
while loading and an error panel with a Retry button if loading fails.

Three panels: BUY (green), HOLD (amber), SELL (red):
  - Header: name, count badge, signal badge, expand button (top right)
  - Table: Ticker | Name | Price | Score | Conv., 25 rows per page with a
    pager; rows open /stock/{ticker}
  - Name cell shows a badge for highs: blue "52W" (at a 52-week high) or
    purple "3y" / "5y+" (multi-year breakout; "3y high" when expanded),
    with a tooltip describing it
  - Price formatted in the stock's quote currency (see below)
  - Expand: the panel opens as a full-window overlay (above the header)
    with 50 rows per page, larger text and a wider Name column; close with
    X or Esc; the page behind doesn't scroll

Strategy popup (header button): a modal that updates with the filters:
  - "Your selection" in plain English
  - Funnel: All analysed stocks → Index → Sector → Highs → Search, with
    counts and bars, then the BUY / HOLD / SELL split
  - What each active filter means (index descriptions, highs definitions
    using the backend's parameters)
  - Every scoring rule with its points and the thresholds (from
    /api/strategy)
  - How trade levels are set
  - Top 5 BUY candidates in the selection, each opening its stock page
  - Close with X, Esc or a click outside

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND — STOCK DETAIL (/stock/:ticker)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1. Header card: "Dashboard / sector / index" breadcrumb, ticker, name,
     current price, signal badge with conviction. Below it "About the
     company" (loaded separately from /profile): a preview of up to 2
     sentences / ~350 characters (not splitting on "Inc." etc.) with
     Read more / Show less, plus Industry, HQ, Employees and Website
     (opens in a new tab, rel="noopener noreferrer") chips. Hidden if Yahoo
     has no profile.
  2. Metric cards: EMA 20, SMA 50, SMA 200
  3. Price Trend chart: close with EMA20, SMA50 and SMA200 overlays
  4. Momentum Indicators: RSI (14), MACD Line, MACD Histogram, each with a
     BUY/HOLD/SELL badge, or "No data" when the value is missing (never
     compare null: in JS null <= 30 is true); RSI Trend chart with 70/30
     lines
  5. MACD Momentum chart and Volume Trend chart
  6. Analyst Recommendations (if any): stacked bars per period (Strong Buy …
     Strong Sell, oldest to newest) and a consensus badge (mean score out of
     5 and analyst count)
  7. Cards: 52W High (with "Reached 6 Oct 2026 (24 days ago)", the date of
     the highest close in the last 252 trading days, and the highs
     description, e.g. "Highest close in 5+ years"), 52W Low, ATR (14),
     BB Upper
  8. Risk / Reward: Entry Zone, Stop Loss, Target, R:R Ratio
  9. Verdict: signal and conviction, a one-line summary, Bullish Factors and
     Risk Factors
 10. Summary: an opening paragraph (score, signal, conviction, how many
     indicators help or hurt, the biggest supports and drags), then a table
     grouped into Trend, Momentum, Volume, Volatility and Context (not in
     the score). Each row: Indicator | Value | What it says about this
     stock (plain English, using its values) | Score impact (points / max,
     from notes.score_breakdown) | Weight (High ±1.5, Medium ±1, Low ±0.5,
     or Context). Context rows: 52-week range and breakout, analyst
     consensus, entry zone, stop/target, R:R.

Prices: format with the listing's quote currency from the API: GBp as
"3921p", GBP "£5.96", EUR "€47.62", USD "$204.64" (en-US, not "US$"). Fall
back to the ticker suffix (.L → pence, otherwise USD) if no currency.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ftse-analyser/
├── backend/
│   ├── main.py              # FastAPI app, routes, CORS, refresh job + lock
│   ├── database.py          # SQLAlchemy models, init_db
│   ├── fetcher.py           # yfinance prices, recommendations, profiles
│   ├── analyser.py          # indicators, scoring, notes, highs, strategy,
│   │                        # stale-signal pruning
│   ├── scheduler.py         # APScheduler daily job (18:30 Europe/London)
│   ├── tickers.py           # FTSE + NASDAQ-100 ticker list and lookups
│   ├── schemas.py           # Pydantic response schemas
│   ├── tests/               # pytest: analyser, database, fetcher, API,
│   │                        # scheduler (~100 tests)
│   ├── requirements.txt, requirements-dev.txt, pytest.ini
│   ├── Dockerfile, .dockerignore
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # header, refresh, dashboard state, Strategy
│   │   ├── pages/           # Dashboard.jsx, StockDetail.jsx
│   │   ├── components/      # SignalPanel, StockTable, HighBadge,
│   │   │                    # StrategyModal, StockSummary, CompanyProfile,
│   │   │                    # PriceChart, RSIChart, MACDChart, VolumeChart,
│   │   │                    # RecommendationsChart, MetricCard,
│   │   │                    # SignalBadge, VerdictPanel, ThemeToggle
│   │   ├── lib/             # filters.js (shared filters), format.js (prices)
│   │   └── api/client.js    # Axios client
│   ├── package.json, vite.config.js (port 3000), tailwind.config.js
│   ├── Dockerfile, .dockerignore
├── docker-compose.yml
├── .gitignore               # venvs, caches, *.db, node_modules, dist, .env
└── README.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADDITIONAL REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. On startup, run a full refresh in a background thread; /api/status
   reports initializing/refreshing while it runs and the dashboard shows
   its loading state.
2. Keep generated files out of git: the SQLite database, venvs,
   __pycache__, coverage output, node_modules and dist.
3. Tests must cover the scoring breakdown, cross and breakout detection
   (including "no cross" and old-cross cases), 52-week/multi-year highs,
   stale-signal pruning, session rollback after a failing ticker, the
   refresh lock (concurrent requests, scheduled vs manual), the same-day
   refresh skip, fetch-failure handling, profiles and their cache, CORS
   (allowed and rejected origins), index filters including NASDAQ100, and
   quote currencies.
4. Security: no secrets in the repo; CORS restricted; ports bound to
   localhost; containers run as non-root; images contain source only.
5. Disclaimer: "For educational purposes only. Not financial advice."

Run locally with:
  cd backend && pip install -r requirements.txt && python main.py
  cd frontend && npm install && npm run dev
Or in containers:
  podman-compose up --build    (Docker: remove the userns_mode lines)
