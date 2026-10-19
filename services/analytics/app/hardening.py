"""Middleware for public exposure (Phase 3d).

Until 3d this service ran on an operator's laptop behind nothing at all. On a
public host the same code is reachable by anyone who finds the URL, so:

  * bodies are capped before we read them;
  * every request has a deadline;
  * an unhandled exception returns an opaque 500 — the traceback goes to the
    log, never to the client;
  * every request produces one structured log line with a request id, and
    never an Authorization header, a token or a password.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.ratelimit import compute_limiter
from app.settings import Settings, get_settings

logger = logging.getLogger("app.access")

#: Never log these, in any casing, from headers or bodies.
REDACTED_HEADERS = frozenset(
    {"authorization", "cookie", "set-cookie", "apikey", "x-api-key"}
)


def throttle_compute(request: Request) -> None:
    """Per-IP bucket for /rating, /credit-limit and /fx, as a route
    dependency so it runs before the body is validated."""
    settings = get_settings()
    decision = compute_limiter.check(f"ip:{client_ip(request, settings)}", settings.compute_per_ip_per_hour)
    if not decision.allowed:
        raise HTTPException(
            status_code=429,
            detail="too many requests, try again later",
            headers={"Retry-After": str(decision.retry_after)},
        )


def client_ip(request: Request, settings: Settings) -> str:
    """The caller's address. Proxy headers are only trusted when the deploy
    says it sits behind a proxy — otherwise a client could forge its own
    rate-limit bucket just by sending the header.

    Behind a proxy, CF-Connecting-IP wins (Cloudflare overwrites whatever the
    client sent). Otherwise the RIGHT-most X-Forwarded-For hop: each proxy
    appends the address it saw, so the left-most entries are whatever the
    client chose to send and a fresh one per request would mint a fresh
    bucket each time.
    """
    if settings.behind_proxy:
        cf = request.headers.get("cf-connecting-ip", "").strip()
        if cf:
            return cf
        hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
        if hops:
            return hops[-1]
    return request.client.host if request.client else "unknown"


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """413 before the body is parsed.

    Content-Length is checked first because it is free, but a chunked request
    can omit it, so the streamed body is counted too.
    """

    def __init__(self, app, max_bytes: int) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            return _too_large(self.max_bytes)

        body = await request.body()
        if len(body) > self.max_bytes:
            return _too_large(self.max_bytes)
        return await call_next(request)


def _too_large(limit: int) -> JSONResponse:
    return JSONResponse(
        status_code=413,
        content={"detail": f"request body exceeds {limit} bytes"},
    )


class TimeoutMiddleware(BaseHTTPMiddleware):
    """A request that outlives its deadline gets 504 and its task cancelled,
    so one slow upstream cannot pin a worker indefinitely."""

    def __init__(self, app, seconds: int) -> None:
        super().__init__(app)
        self.seconds = seconds

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        try:
            return await asyncio.wait_for(call_next(request), timeout=self.seconds)
        except (asyncio.TimeoutError, TimeoutError):
            logger.warning(
                json.dumps(
                    {
                        "event": "request.timeout",
                        "path": request.url.path,
                        "method": request.method,
                        "seconds": self.seconds,
                    }
                )
            )
            return JSONResponse(status_code=504, content={"detail": "request timed out"})


class AccessLogMiddleware(BaseHTTPMiddleware):
    """One structured line per request, and the only place a traceback is
    allowed to exist. Secrets never reach a log record: no header values are
    logged at all, and no request or response body."""

    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self.settings = settings

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        request.state.request_id = request_id
        started = time.monotonic()

        try:
            response = await call_next(request)
        except Exception:
            # The traceback belongs in the log and nowhere else.
            logger.exception(
                json.dumps(
                    {
                        "event": "request.failed",
                        "request_id": request_id,
                        "method": request.method,
                        "path": request.url.path,
                        "ip": client_ip(request, self.settings),
                    }
                )
            )
            return JSONResponse(
                status_code=500,
                content={"detail": "internal error", "request_id": request_id},
                headers={"x-request-id": request_id},
            )

        logger.info(
            json.dumps(
                {
                    "event": "request",
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "ms": round((time.monotonic() - started) * 1000, 1),
                    "ip": client_ip(request, self.settings),
                }
            )
        )
        response.headers["x-request-id"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """This service returns JSON only, never HTML, so the headers are the
    boring restrictive set: nothing may frame it, nothing may sniff it."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Cache-Control", "no-store, no-cache, must-revalidate"
        )
        return response
