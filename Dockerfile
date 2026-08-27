# TCI analytics service (services/analytics).
#
# The build context is the REPOSITORY ROOT, not services/analytics: the
# service depends on ../../credit_engine as an editable path dependency
# (see [tool.uv.sources] in its pyproject.toml), so a context rooted at the
# service directory cannot see the library it imports.
#
#   docker build -t tci-analytics .
#   docker run -p 8000:8000 --env-file services/analytics/.env tci-analytics
#
# Hosts that build from a repo (Render, Railway, Fly) all default to the
# repository root, so this needs no extra configuration there.

FROM python:3.12-slim AS base

# uv resolves the workspace + path dependency that plain pip cannot.
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

WORKDIR /app

# Dependency layer first: these change far less often than the source, so a
# code-only push reuses the resolved environment.
COPY credit_engine/pyproject.toml credit_engine/README.md ./credit_engine/
COPY credit_engine/src ./credit_engine/src
COPY services/analytics/pyproject.toml services/analytics/uv.lock ./services/analytics/

WORKDIR /app/services/analytics
RUN uv sync --frozen --no-dev --no-install-project

# Now the application itself.
COPY services/analytics/app ./app
RUN uv sync --frozen --no-dev

# Never run as root on a public host.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

ENV PATH="/app/services/analytics/.venv/bin:$PATH" \
    PORT=8000

EXPOSE 8000

# The host injects $PORT. --proxy-headers because we sit behind the host's
# load balancer; app/settings.py still decides whether to TRUST them for
# rate-limit bucketing (TRUST_PROXY_HEADERS).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --timeout-keep-alive 30 --workers 1"]
