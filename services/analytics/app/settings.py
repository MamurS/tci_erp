"""Runtime configuration, all environment-driven.

The service is deployed to a public host from Phase 3d on, so every knob that
matters for exposure lives here rather than being scattered as literals: the
CORS allowlist, the body-size cap, the request timeout and the provisioning
rate limits.

Nothing here reads a secret. SUPABASE_SERVICE_ROLE_KEY is read only in
app/supabase_admin.py, and nothing in this module ever logs or returns it.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _csv(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


#: Local development. The deployed origins come from CORS_ALLOW_ORIGINS.
LOCAL_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
]

#: Cloudflare Pages gives every branch and every commit its own subdomain, so
#: previews cannot be enumerated as literals. Production is matched exactly by
#: the origins list; this covers `<hash>.tci-erp.pages.dev` only — note the
#: escaped dots, so `evil-tci-erp.pages.dev.attacker.com` does NOT match.
PREVIEW_ORIGIN_REGEX = r"^https://[a-z0-9][a-z0-9-]*\.tci-erp\.pages\.dev$"


@dataclass(frozen=True)
class Settings:
    #: Exact origins allowed by CORS, on top of PREVIEW_ORIGIN_REGEX.
    cors_origins: list[str] = field(
        default_factory=lambda: _csv(
            "CORS_ALLOW_ORIGINS", ["https://tci-erp.pages.dev", *LOCAL_ORIGINS]
        )
    )
    #: Largest request body we will read, in bytes. Statement payloads are the
    #: biggest legitimate body and are far under this.
    max_body_bytes: int = field(default_factory=lambda: _int("MAX_BODY_BYTES", 1_000_000))
    #: Hard ceiling on how long any single request may take.
    request_timeout_seconds: int = field(
        default_factory=lambda: _int("REQUEST_TIMEOUT_SECONDS", 30)
    )
    #: Provisioning rate limits — these endpoints create auth users.
    provisioning_per_ip_per_hour: int = field(
        default_factory=lambda: _int("PROVISIONING_PER_IP_PER_HOUR", 20)
    )
    provisioning_per_caller_per_hour: int = field(
        default_factory=lambda: _int("PROVISIONING_PER_CALLER_PER_HOUR", 30)
    )
    #: Set by the host (Render sets RENDER, Railway RAILWAY_*). Only used to
    #: decide whether to trust X-Forwarded-For.
    behind_proxy: bool = field(
        default_factory=lambda: os.environ.get("TRUST_PROXY_HEADERS", "").lower()
        in {"1", "true", "yes"}
    )

    def preview_origin_regex(self) -> str:
        return os.environ.get("CORS_PREVIEW_REGEX", "").strip() or PREVIEW_ORIGIN_REGEX


def get_settings() -> Settings:
    """Read fresh each call: the tests set environment per case."""
    return Settings()


def origin_allowed(origin: str, settings: Settings) -> bool:
    """Pure mirror of what CORSMiddleware will do — used by the tests so the
    allowlist is asserted rather than assumed."""
    if origin in settings.cors_origins:
        return True
    return re.match(settings.preview_origin_regex(), origin) is not None
