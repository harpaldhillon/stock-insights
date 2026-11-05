# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# deps: install exactly what package-lock.json pins.
# ---------------------------------------------------------------------------
FROM docker.io/library/node:22-alpine AS deps
WORKDIR /app
RUN chown node:node /app
USER node
ENV HOME=/home/node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# dev: Vite dev server, used by docker-compose.yml (source is bind-mounted).
# Not part of the production image; build it with `--target dev`.
# ---------------------------------------------------------------------------
FROM deps AS dev
COPY --chown=node:node . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---------------------------------------------------------------------------
# build: compile the static bundle.
# ---------------------------------------------------------------------------
FROM deps AS build
# The production image serves the API from the same origin (nginx proxies
# /api to the backend), so the browser calls relative URLs. Override at build
# time if the API is hosted elsewhere.
ARG VITE_API_BASE_URL=/
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY --chown=node:node . .
RUN npm run build

# ---------------------------------------------------------------------------
# runtime (default target): static files served by unprivileged nginx.
# ---------------------------------------------------------------------------
FROM docker.io/nginxinc/nginx-unprivileged:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="ftse-analyser-frontend" \
      org.opencontainers.image.description="Stock Insight web UI (React, served by nginx)" \
      org.opencontainers.image.licenses="MIT"

# Replace the stock config entirely (no envsubst templates), so the container
# can run with a read-only root filesystem; nginx only writes to /tmp.
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/proxy_params.conf /etc/nginx/proxy_params.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Runs as the image's "nginx" user (UID 101); 8080 because it isn't root.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
CMD ["nginx", "-g", "daemon off;"]
