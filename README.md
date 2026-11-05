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

### Development

```bash
podman-compose up --build    # or: docker compose up --build
```

Source is bind-mounted with hot reload (uvicorn `--reload`, Vite dev server):
UI on http://localhost:3000, API on http://localhost:8000, database in
`backend/ftse_analyser.db`. Both containers run as UID 1000, not root. The
compose file sets `userns_mode: keep-id` so rootless podman maps your host UID
into the containers and they can write the bind-mounted folders. Docker does
not support `keep-id`: remove those lines when using Docker (rootful Docker maps
UID 1000 straight through; otherwise build with `--build-arg APP_UID=$(id -u)`).

### Production

```bash
podman-compose -f docker-compose.prod.yml up -d            # pull published images
podman-compose -f docker-compose.prod.yml up -d --build    # or build locally
```

The app is served on http://localhost:8080. Settings (environment variables or
a `.env` file next to the compose file):

| Variable    | Default     | Meaning                                    |
|-------------|-------------|--------------------------------------------|
| `IMAGE_TAG` | `latest`    | Image tag to run, e.g. a commit SHA        |
| `HTTP_PORT` | `8080`      | Host port for the UI and API               |
| `HTTP_BIND` | `127.0.0.1` | Host interface to listen on                |

What the production images do:

- **Backend** (`python:3.12-slim`, multi-stage): dependencies in a virtualenv
  copied from a build stage, no build tools or pip cache. Runs uvicorn with a
  **single worker** (the daily refresh scheduler is in-process; more workers
  would run duplicate refreshes). The SQLite database and yfinance cache live
  on the `/data` volume (`backend-data`), set by `DATABASE_URL`. Not published
  on the host: only nginx can reach it.
- **Frontend** (multi-stage, `nginx-unprivileged`): the Vite build is served by
  nginx as UID 101, which also proxies `/api` to the backend, so the browser
  uses a single origin (no CORS, no hardcoded API host). Adds gzip, long-lived
  caching for fingerprinted assets, `no-cache` for `index.html`, security
  headers including a strict Content-Security-Policy, and rate-limits
  `/api/refresh` to 2 requests per minute per client.
- **Both:** non-root, read-only root filesystem, all capabilities dropped,
  `no-new-privileges`, healthchecks (`/api/health`, `/healthz`), memory limits,
  restart policy and log rotation.

The API has **no authentication**. Before exposing it beyond this host, put a
TLS-terminating reverse proxy with authentication in front of it.

Back up the database (SQLite's online backup, safe while the app is running):

```bash
podman exec stock-insights_backend_1 python -c \
  "import sqlite3; s=sqlite3.connect('/data/ftse_analyser.db'); d=sqlite3.connect('/data/backup.db'); s.backup(d); d.close()"
podman cp stock-insights_backend_1:/data/backup.db ./backup.db
```

### Publishing images

Production images are tagged `docker.io/containerssimplified/ftse-analyser-backend`
and `docker.io/containerssimplified/ftse-analyser-frontend`. CI pushes them
(see below); to push by hand:

```bash
podman login docker.io
podman-compose -f docker-compose.prod.yml build
podman-compose -f docker-compose.prod.yml push
```

The images contain the application only (see the `.dockerignore` files): no
database, tests, virtualenv or `.env` files. Docker Hub repositories are public
unless you make them private.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`/`master`, on pull
requests, and on demand (Actions > CI > Run workflow):

- **Backend tests:** Python 3.12, `pytest` (yfinance is mocked, so no network
  or data is needed).
- **Frontend build:** Node 22, `npm ci`, `npm run build`, and
  `npm audit --omit=dev --audit-level=high` (fails on high/critical
  advisories in packages shipped to the browser).
- **Docker images:** builds both images after the tests pass. On the default
  branch it also pushes them to Docker Hub as `:latest` and `:<commit sha>`,
  once the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a
  Docker Hub access token) are set. Without them, it only builds.

## Notes

- Uses APScheduler to refresh data daily at 18:30 UK time.
- Stores OHLCV price history and analysis results in SQLite.
- Includes a lightweight dashboard and stock detail screens with charts.
- For educational purposes only. Not financial advice.
