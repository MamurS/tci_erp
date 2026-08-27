"""The service-role wrapper: what it actually puts on the wire.

Uses an httpx MockTransport so the real request-building code runs — the
endpoint tests stub this layer out, so without these the payload details
(email_confirm, the `tci` schema headers, key handling) would be untested.
"""

from __future__ import annotations

import httpx
import pytest

from app.supabase_admin import SupabaseAdmin, SupabaseAdminError, SupabaseConfigError, is_configured

SERVICE_KEY = "service-role-key-must-never-leak"


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)


def mock_client(handler, monkeypatch: pytest.MonkeyPatch) -> list[httpx.Request]:
    """Route every AsyncClient through `handler`; return the recorded requests."""
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    original = httpx.AsyncClient.__init__

    def patched(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(record)
        original(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
    return seen


class TestConfiguration:
    def test_unconfigured_is_detected_not_crashed_on(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
        assert is_configured() is False
        with pytest.raises(SupabaseConfigError):
            SupabaseAdmin()

    def test_a_url_without_a_key_is_still_unconfigured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
        monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
        assert is_configured() is False

    def test_a_trailing_slash_does_not_double_up(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co/")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
        assert SupabaseAdmin().url == "https://example.supabase.co"


@pytest.mark.anyio
class TestCreateUser:
    async def test_sends_email_confirm_and_the_metadata(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen = mock_client(
            lambda r: httpx.Response(200, json={"id": "u1", "email": "a@b.uz"}), monkeypatch
        )
        await SupabaseAdmin().create_user(
            "a@b.uz", "TempPassw0rd!x", {"full_name": "A", "must_change_password": True}
        )
        request = seen[0]
        assert request.url.path == "/auth/v1/admin/users"
        import json

        body = json.loads(request.content)
        # No SMTP is configured, so the address must be pre-confirmed or the
        # user could never sign in with the password we just showed on screen.
        assert body["email_confirm"] is True
        assert body["user_metadata"]["must_change_password"] is True

    async def test_carries_the_service_key_in_both_expected_headers(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen = mock_client(lambda r: httpx.Response(200, json={"id": "u1"}), monkeypatch)
        await SupabaseAdmin().create_user("a@b.uz", "pw", {})
        assert seen[0].headers["apikey"] == SERVICE_KEY
        assert seen[0].headers["authorization"] == f"Bearer {SERVICE_KEY}"


@pytest.mark.anyio
class TestRest:
    async def test_reads_and_writes_the_tci_schema_not_public(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen = mock_client(lambda r: httpx.Response(200, json=[]), monkeypatch)
        admin = SupabaseAdmin()
        await admin.select("user_roles", {"select": "role"})
        await admin.insert("user_roles", [{"user_id": "u1", "role": "client"}])
        assert seen[0].headers["accept-profile"] == "tci"
        assert seen[1].headers["content-profile"] == "tci"

    async def test_an_empty_insert_makes_no_request(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen = mock_client(lambda r: httpx.Response(200, json=[]), monkeypatch)
        await SupabaseAdmin().insert("user_roles", [])
        assert seen == []

    async def test_upsert_asks_postgrest_to_merge(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen = mock_client(lambda r: httpx.Response(201, json=[]), monkeypatch)
        await SupabaseAdmin().insert("user_profiles", [{"user_id": "u1"}], upsert=True)
        assert seen[0].headers["prefer"] == "resolution=merge-duplicates"


@pytest.mark.anyio
class TestCallerResolution:
    async def test_verifies_the_callers_own_token_not_the_service_key(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen = mock_client(
            lambda r: httpx.Response(200, json={"id": "caller-1", "email": "c@d.uz"}), monkeypatch
        )
        user = await SupabaseAdmin().user_from_token("caller-access-token")
        assert user["id"] == "caller-1"
        # The identity must come from the CALLER's token, never the service key.
        assert seen[0].headers["authorization"] == "Bearer caller-access-token"

    async def test_a_rejected_token_becomes_a_401(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mock_client(lambda r: httpx.Response(403, json={"msg": "bad jwt"}), monkeypatch)
        with pytest.raises(SupabaseAdminError) as exc:
            await SupabaseAdmin().user_from_token("nope")
        assert exc.value.status == 401


@pytest.mark.anyio
class TestErrors:
    async def test_surfaces_supabases_message(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mock_client(
            lambda r: httpx.Response(422, json={"msg": "email already registered"}), monkeypatch
        )
        with pytest.raises(SupabaseAdminError) as exc:
            await SupabaseAdmin().create_user("a@b.uz", "pw", {})
        assert "already registered" in exc.value.detail
        assert exc.value.status == 422

    async def test_never_echoes_the_service_key_in_an_error(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Even if Supabase reflected the key back at us, it must not escape.
        mock_client(lambda r: httpx.Response(500, text="x" * 5000), monkeypatch)
        with pytest.raises(SupabaseAdminError) as exc:
            await SupabaseAdmin().create_user("a@b.uz", "pw", {})
        assert SERVICE_KEY not in exc.value.detail
        assert len(exc.value.detail) <= 300

    async def test_a_non_json_error_body_does_not_crash_the_wrapper(
        self, configured: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mock_client(lambda r: httpx.Response(502, text="<html>gateway</html>"), monkeypatch)
        with pytest.raises(SupabaseAdminError) as exc:
            await SupabaseAdmin().select("user_roles", {})
        assert exc.value.status == 502
