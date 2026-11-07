# Context Workbench image: React UI (built) + FastAPI backend.
# Build from the repo root: docker build -t context-workbench .

# ---- stage 1: build the web UI
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- stage 2: Python runtime
FROM python:3.12-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /uvx /bin/

ENV CTX_ROOT=/app \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app

# Dependencies first (cached until pyproject.toml / uv.lock change).
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# Project code, then install it.
COPY src/ ./src/
RUN uv sync --frozen --no-dev
COPY data/ ./data/
COPY --from=web /web/dist ./web/dist

# Non-root user; /app/out holds the state (mounted as a volume in compose).
RUN useradd --uid 1000 --no-create-home --home-dir /app app \
    && mkdir -p /app/out \
    && chown -R app:app /app/out
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

CMD ["ctx", "workbench", "--host", "0.0.0.0", "--port", "8000"]
