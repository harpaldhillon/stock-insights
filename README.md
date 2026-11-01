# Stock Insight

A production-ready FastAPI + React application that loads FTSE100 and FTSE250 stock data, computes technical indicators, and displays Buy / Hold / Sell advice.

## Backend

### Run locally

```bash
cd ftse-analyser/backend
pip install -r requirements.txt
python main.py
```

The backend serves API endpoints on `http://localhost:8000` and exposes `/docs` for Swagger.

### API endpoints

- `GET /api/summary` — grouped stock analysis by signal
- `GET /api/stock/{ticker}` — detail view for a ticker
- `GET /api/refresh` — manual refresh job trigger
- `GET /api/status` — last updated and signal counts

### Run tests

```bash
cd ftse-analyser/backend
pip install -r requirements-dev.txt
pytest
```

Tests use an isolated in-memory SQLite database and mock `yfinance` calls — they never touch `ftse_analyser.db` or the network.

## Frontend

### Run locally

```bash
cd ftse-analyser/frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:3000` by default.

## Docker

```bash
cd ftse-analyser
docker-compose up --build
```

## Notes

- Uses APScheduler to refresh data daily at 18:30 UK time.
- Stores OHLCV price history and analysis results in SQLite.
- Includes a lightweight dashboard and stock detail screens with charts.
- For educational purposes only. Not financial advice.
