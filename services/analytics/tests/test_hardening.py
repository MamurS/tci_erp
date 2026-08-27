"""Public-exposure hardening (Phase 3d).

Every one of these is a property the service must keep now that it is
reachable from the internet, not an implementation detail.
"""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ratelimit import FixedWindowLimiter
from app.settings import Settings, get_settings, origin_allowed

client = TestClient(app)



# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------


class TestCorsAllowlist:
    def test_production_origin_is_allowed(self) -> None:
        assert origin_allowed("https://tci-erp.pages.dev", Settings())

    def test_preview_subdomains_are_allowed(self) -> None:
        settings = Settings()
        assert origin_allowed("https://abc123.tci-erp.pages.dev", settings)
        assert origin_allowed("https://feature-branch.tci-erp.pages.dev", settings)

    def test_localhost_is_allowed_for_development(self) -> None:
        assert origin_allowed("http://localhost:5173", Settings())

    @pytest.mark.parametrize(
        "origin",
        [
            "https://evil.com",
            # The regex anchors both ends: a suffix attack must not match.
            "https://tci-erp.pages.dev.evil.com",
            "https://eviltci-erp.pages.dev.attacker.io",
            # http, not https, on the deployed domain
            "http://tci-erp.pages.dev",
            # A sibling Pages project is a different origin.
            "https://other-app.pages.dev",
        ],
    )
    def test_everything_else_is_denied(self, origin: str) -> None:
        assert not origin_allowed(origin, Settings())

    def test_denied_origin_gets_no_allow_origin_header(self) -> None:
        response = client.get("/health", headers={"Origin": "https://evil.com"})
        assert "access-control-allow-origin" not in {
            k.lower() for k in response.headers
        }

    def test_allowed_origin_gets_the_header_back(self) -> None:
        origin = "https://tci-erp.pages.dev"
        response = client.get("/health", headers={"Origin": origin})
        assert response.headers.get("access-control-allow-origin") == origin


# ---------------------------------------------------------------------------
# Body size, timeouts, headers
# ---------------------------------------------------------------------------


class TestRequestLimits:
    def test_oversized_body_is_refused_with_413(self) -> None:
        settings = get_settings()
        payload = "x" * (settings.max_body_bytes + 1024)
        response = client.post(
            "/rating", content=payload, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 413
        assert "exceeds" in response.json()["detail"]

    def test_a_normal_body_passes(self) -> None:
        # Malformed but small: it must reach validation (422), not be capped.
        response = client.post("/rating", json={"nope": True})
        assert response.status_code == 422

    def test_health_is_public_and_cheap(self) -> None:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestSecurityHeaders:
    def test_json_service_sets_the_restrictive_set(self) -> None:
        headers = client.get("/health").headers
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert headers["referrer-policy"] == "no-referrer"

    def test_every_response_carries_a_request_id(self) -> None:
        assert client.get("/health").headers.get("x-request-id")


# ---------------------------------------------------------------------------
# Error opacity
# ---------------------------------------------------------------------------


class TestNoInternalsInResponses:
    def test_unhandled_error_returns_an_opaque_500(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        class Exploding:
            def __iter__(self):
                raise RuntimeError("secret-value-in-traceback")

        # Patch what the handler reads at call time. Patching the handler
        # itself does nothing: FastAPI captured the function object when the
        # route was declared.
        monkeypatch.setattr("app.main.GRADE_BANDS", Exploding())
        # TestClient re-raises server exceptions by default; we want the
        # response the middleware actually produces.
        local = TestClient(app, raise_server_exceptions=False)
        with caplog.at_level(logging.ERROR):
            response = local.get("/grade-scale")

        assert response.status_code == 500
        body = response.text
        assert "secret-value-in-traceback" not in body
        assert "Traceback" not in body
        assert response.json()["detail"] == "internal error"
        # ...but it IS in the log, with a request id to correlate on.
        assert "secret-value-in-traceback" in caplog.text

    def test_fx_does_not_echo_the_upstream_error(self) -> None:
        # An impossible date reaches validation before any network call.
        response = client.get("/fx", params={"ccy": "USD", "date": "not-a-date"})
        assert response.status_code == 422
        assert "cbu.uz" not in response.text


# ---------------------------------------------------------------------------
# Access log
# ---------------------------------------------------------------------------


class TestAccessLog:
    def test_one_structured_line_per_request(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger="app.access"):
            client.get("/health")
        lines = [r.message for r in caplog.records if r.name == "app.access"]
        assert lines, "no access log line emitted"
        entry = json.loads(lines[-1])
        assert entry["event"] == "request"
        assert entry["path"] == "/health"
        assert entry["status"] == 200
        assert "ms" in entry and "request_id" in entry

    def test_the_authorization_header_is_never_logged(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        token = "super-secret-access-token"
        with caplog.at_level(logging.DEBUG):
            client.get("/health", headers={"Authorization": f"Bearer {token}"})
        assert token not in caplog.text


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


class TestFixedWindowLimiter:
    def test_allows_up_to_the_limit_then_refuses(self) -> None:
        limiter = FixedWindowLimiter(window_seconds=3600)
        now = 1_000_000.0
        assert all(limiter.check("k", 3, now=now).allowed for _ in range(3))
        assert not limiter.check("k", 3, now=now).allowed

    def test_keys_are_independent(self) -> None:
        limiter = FixedWindowLimiter()
        now = 1_000_000.0
        limiter.check("a", 1, now=now)
        assert not limiter.check("a", 1, now=now).allowed
        assert limiter.check("b", 1, now=now).allowed

    def test_the_window_rolls_over(self) -> None:
        limiter = FixedWindowLimiter(window_seconds=60)
        now = 1_000_000.0
        limiter.check("k", 1, now=now)
        assert not limiter.check("k", 1, now=now).allowed
        assert limiter.check("k", 1, now=now + 61).allowed

    def test_closed_windows_are_evicted_so_the_map_cannot_grow(self) -> None:
        limiter = FixedWindowLimiter(window_seconds=60)
        for i in range(50):
            limiter.check(f"k{i}", 10, now=1_000_000.0)
        assert len(limiter._counts) == 50
        limiter.check("later", 10, now=1_000_000.0 + 600)
        assert len(limiter._counts) == 1

    def test_retry_after_is_always_positive(self) -> None:
        limiter = FixedWindowLimiter(window_seconds=60)
        assert limiter.check("k", 1, now=1_000_059.999).retry_after >= 1


class TestProvisioningIsThrottled:
    def test_the_unauthenticated_status_probe_is_capped_per_ip(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PROVISIONING_PER_IP_PER_HOUR", "3")
        for _ in range(3):
            assert client.get("/users/provisioning-status").status_code == 200
        blocked = client.get("/users/provisioning-status")
        assert blocked.status_code == 429
        assert int(blocked.headers["retry-after"]) >= 1

    def test_the_429_body_does_not_say_which_bucket_ran_out(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PROVISIONING_PER_IP_PER_HOUR", "1")
        client.get("/users/provisioning-status")
        blocked = client.get("/users/provisioning-status")
        assert blocked.status_code == 429
        body = blocked.text.lower()
        assert "ip" not in body and "caller" not in body

    def test_creating_a_user_is_throttled_before_it_reaches_supabase(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PROVISIONING_PER_IP_PER_HOUR", "2")
        # No token: these 401 but still consume the IP bucket, which is the
        # point - an unauthenticated flood must not be free.
        for _ in range(2):
            client.post("/users", json={"email": "a@b.co", "roles": ["client"]})
        blocked = client.post("/users", json={"email": "a@b.co", "roles": ["client"]})
        assert blocked.status_code == 429


# ---------------------------------------------------------------------------
# Proxy header trust
# ---------------------------------------------------------------------------


class TestProxyHeaderTrust:
    def test_forwarded_for_is_ignored_unless_the_deploy_opts_in(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from starlette.requests import Request

        from app.hardening import client_ip

        scope = {
            "type": "http",
            "headers": [(b"x-forwarded-for", b"1.2.3.4")],
            "client": ("10.0.0.1", 1234),
        }
        request = Request(scope)  # type: ignore[arg-type]

        monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
        assert client_ip(request, Settings()) == "10.0.0.1"

        monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
        assert client_ip(request, Settings()) == "1.2.3.4"
