FROM python:3.12-slim

# Run as an unprivileged user, not root. UID/GID 1000 matches the usual first
# host user, so files written through the ./backend bind mount (the SQLite
# database, yfinance's cache) stay owned by you. Override with --build-arg.
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd --gid "${APP_GID}" app \
 && useradd --uid "${APP_UID}" --gid app --create-home --shell /usr/sbin/nologin app

# Pinned explicitly: under podman's keep-id the passwd entry for this UID can
# be the host user's, whose home directory doesn't exist in the container.
ENV HOME=/home/app \
    XDG_CACHE_HOME=/home/app/.cache \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=app:app . /app

USER app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
