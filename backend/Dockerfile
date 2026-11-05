# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: install dependencies into a self-contained virtualenv, so the
# runtime image gets them without pip, wheels caches or build tooling.
# ---------------------------------------------------------------------------
FROM docker.io/library/python:3.12-slim-bookworm AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv
RUN python -m venv "${VIRTUAL_ENV}"
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM docker.io/library/python:3.12-slim-bookworm AS runtime

LABEL org.opencontainers.image.title="ftse-analyser-backend" \
      org.opencontainers.image.description="Stock Insight API (FastAPI)" \
      org.opencontainers.image.licenses="MIT"

# Run as an unprivileged user, not root. UID/GID 1000 matches the usual first
# host user, so files written through a bind mount stay owned by you.
# Override with --build-arg.
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd --gid "${APP_GID}" app \
 && useradd --uid "${APP_UID}" --gid app --create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data/cache \
 && chown -R app:app /data

# HOME is pinned explicitly: under podman's keep-id the passwd entry for this
# UID can be the host user's, whose home directory doesn't exist here.
# The SQLite database and yfinance's cache live in /data (a volume), so the
# application directory can stay read-only.
ENV VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:${PATH}" \
    HOME=/home/app \
    XDG_CACHE_HOME=/data/cache \
    DATABASE_URL=sqlite:////data/ftse_analyser.db \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
# Source is owned by root and not writable by the app user.
COPY . /app
# Precompile bytecode now, since the runtime filesystem may be read-only.
RUN python -m compileall -q /app /opt/venv

USER app
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"]

# Exactly ONE worker: the daily refresh scheduler and the refresh lock live
# in-process, so extra workers would each run their own scheduled refresh
# against the same SQLite file. Scale with more CPU, not more workers.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--no-server-header", \
     "--timeout-graceful-shutdown", "20"]
