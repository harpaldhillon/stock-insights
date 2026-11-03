# Stock Insight

A FastAPI + React application that loads stock data for the FTSE 100, FTSE 250, FTSE SmallCap and NASDAQ-100, computes technical indicators, and displays Buy / Hold / Sell advice.

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

## Docker / Podman

```bash
cd ftse-analyser
podman-compose up --build    # or: docker-compose up --build
```

The app is served on localhost only (http://localhost:3000, API on :8000).
Both containers run as an unprivileged user with UID 1000, not root. The compose
file sets `userns_mode: keep-id` so rootless podman maps your host UID into the
containers and they can write the bind-mounted source folders (the SQLite
database, caches). Docker does not support `keep-id`: remove those two lines
when using Docker. Rootful Docker maps UID 1000 straight through, so it works
if your host user is UID 1000; otherwise build with `--build-arg APP_UID=$(id -u)`.

### Publishing images

Builds are tagged `docker.io/containerssimplfied/ftse-analyser-backend:latest`
and `docker.io/containerssimplfied/ftse-analyser-frontend:latest`. To push them
to Docker Hub:

```bash
podman login docker.io
podman-compose build
podman-compose push
```

The images contain source code only (see the `.dockerignore` files): no
database, virtualenv or `.env` files. Docker Hub repositories are public
unless you make them private.

## Notes

- Uses APScheduler to refresh data daily at 18:30 UK time.
- Stores OHLCV price history and analysis results in SQLite.
- Includes a lightweight dashboard and stock detail screens with charts.
- For educational purposes only. Not financial advice.
