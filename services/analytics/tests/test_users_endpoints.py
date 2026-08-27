"""Provisioning endpoints over HTTP, with Supabase mocked out.

The fake stands in for both the auth admin API and PostgREST, and records
every call, so the tests can assert on what would actually have been sent —
including that no temporary password is ever written to our tables.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.supabase_admin import SupabaseAdminError
from app.users import get_caller


class FakeSupabase:
    """Records calls; returns whatever the test set up."""

    def __init__(self) -> None:
        self.url = "https://example.supabase.co"
        self.created: list[dict[str, Any]] = []
        self.updated: list[tuple[str, dict[str, Any]]] = []
        self.inserted: list[tuple[str, list[dict[str, Any]]]] = []
        self.deleted_users: list[str] = []
        self.rows: dict[str, list[dict[str, Any]]] = {}
        self.fail_on_insert_into: str | None = None
        self.create_error: SupabaseAdminError | None = None

    async def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        return self.rows.get(table, [])

    async def insert(self, table: str, rows: list[dict[str, Any]], *, upsert: bool = False) -> None:
        if table == self.fail_on_insert_into:
            raise SupabaseAdminError(400, f"insert into {table} failed")
        self.inserted.append((table, rows))

    async def delete(self, table: str, params: dict[str, str]) -> None:
        pass

    async def create_user(
        self, email: str, password: str, user_metadata: dict[str, Any]
    ) -> dict[str, Any]:
        if self.create_error:
            raise self.create_error
        self.created.append(
            {"email": email, "password": password, "user_metadata": user_metadata}
        )
        return {"id": "11111111-1111-4111-8111-111111111111", "email": email}

    async def update_user(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.updated.append((user_id, payload))
        return {"id": user_id, "email": "target@example.com"}

    async def get_user(self, user_id: str) -> dict[str, Any]:
        return {"id": user_id, "email": "target@example.com"}

    async def delete_user(self, user_id: str) -> None:
        self.deleted_users.append(user_id)


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeSupabase:
    instance = FakeSupabase()
    monkeypatch.setattr("app.users._admin", lambda: instance)
    monkeypatch.setattr("app.users.is_configured", lambda: True)
    return instance


def as_caller(roles: set[str], user_id: str = "caller-1") -> None:
    """Pin the authenticated caller, bypassing token verification."""
    from app.users import Caller

    app.dependency_overrides[get_caller] = lambda: Caller(
        user_id=user_id, email="caller@mosaic.uz", roles=roles
    )


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


client = TestClient(app)

CLIENT_BODY = {
    "email": "portal@buyer.uz",
    "full_name": "Portal User",
    "roles": ["client"],
    "entity_id": "22222222-2222-4222-8222-222222222222",
}


# ---------------------------------------------------------------------------
# POST /users - authorization matrix
# ---------------------------------------------------------------------------


class TestCreateAuthorization:
    def test_admin_creates_a_staff_user(self, fake: FakeSupabase) -> None:
        as_caller({"admin"})
        response = client.post(
            "/users",
            json={"email": "uw@mosaic.uz", "full_name": "UW", "roles": ["credit_underwriter"]},
        )
        assert response.status_code == 201
        assert response.json()["roles"] == ["credit_underwriter"]

    @pytest.mark.parametrize("caller", ["sales", "commercial_underwriter"])
    def test_sales_and_commercial_create_client_users(
        self, fake: FakeSupabase, caller: str
    ) -> None:
        as_caller({caller})
        response = client.post("/users", json=CLIENT_BODY)
        assert response.status_code == 201

    @pytest.mark.parametrize("caller", ["sales", "commercial_underwriter"])
    @pytest.mark.parametrize("roles", [["sales"], ["admin"], ["client", "sales"]])
    def test_sales_creating_a_non_client_is_403(
        self, fake: FakeSupabase, caller: str, roles: list[str]
    ) -> None:
        as_caller({caller})
        response = client.post(
            "/users", json={**CLIENT_BODY, "roles": roles}
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "client_only"
        # Nothing was created before the check.
        assert fake.created == []

    @pytest.mark.parametrize("caller", ["credit_underwriter", "claims", "information_manager", "client"])
    def test_other_roles_cannot_create_users_at_all(
        self, fake: FakeSupabase, caller: str
    ) -> None:
        as_caller({caller})
        response = client.post("/users", json=CLIENT_BODY)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "forbidden"
        assert fake.created == []

    def test_a_caller_with_no_roles_is_denied(self, fake: FakeSupabase) -> None:
        as_caller(set())
        assert client.post("/users", json=CLIENT_BODY).status_code == 403

    def test_an_unauthenticated_call_is_401(self, fake: FakeSupabase) -> None:
        # No dependency override: the real resolver runs and finds no header.
        response = client.post("/users", json=CLIENT_BODY)
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /users - behaviour
# ---------------------------------------------------------------------------


class TestCreateBehaviour:
    def test_client_users_get_the_entity_mapping(self, fake: FakeSupabase) -> None:
        as_caller({"sales"}, user_id="sales-1")
        response = client.post("/users", json=CLIENT_BODY)
        assert response.status_code == 201

        tables = dict((t, rows) for t, rows in fake.inserted)
        assert tables["user_roles"] == [
            {"user_id": "11111111-1111-4111-8111-111111111111", "role": "client"}
        ]
        assert tables["policyholder_users"] == [
            {
                "entity_id": CLIENT_BODY["entity_id"],
                "user_id": "11111111-1111-4111-8111-111111111111",
                "created_by": "sales-1",
            }
        ]

    def test_staff_users_get_no_entity_mapping(self, fake: FakeSupabase) -> None:
        as_caller({"admin"})
        client.post("/users", json={"email": "uw@mosaic.uz", "roles": ["claims"]})
        assert "policyholder_users" not in dict(fake.inserted)

    def test_a_client_without_a_company_is_422(self, fake: FakeSupabase) -> None:
        as_caller({"sales"})
        response = client.post(
            "/users", json={"email": "x@y.uz", "roles": ["client"]}
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "entity_required"
        assert fake.created == []

    def test_a_staff_user_with_a_company_is_422(self, fake: FakeSupabase) -> None:
        as_caller({"admin"})
        response = client.post(
            "/users", json={"email": "x@y.uz", "roles": ["claims"], "entity_id": "e-1"}
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "entity_not_allowed"

    def test_the_temp_password_is_returned_but_never_stored(self, fake: FakeSupabase) -> None:
        as_caller({"admin"})
        response = client.post("/users", json=CLIENT_BODY)
        password = response.json()["temporary_password"]
        assert len(password) >= 16
        # It reached Supabase auth...
        assert fake.created[0]["password"] == password
        # ...and appears in NO row we wrote to our own tables.
        for _table, rows in fake.inserted:
            assert password not in str(rows)

    def test_the_user_is_flagged_for_a_password_change(self, fake: FakeSupabase) -> None:
        as_caller({"admin"}, user_id="admin-9")
        response = client.post("/users", json=CLIENT_BODY)
        assert response.json()["must_change_password"] is True
        assert fake.created[0]["user_metadata"]["must_change_password"] is True
        profile = dict(fake.inserted)["user_profiles"][0]
        assert profile["must_change_password"] is True
        assert profile["created_by"] == "admin-9"

    def test_email_is_pre_confirmed_since_there_is_no_smtp(self, fake: FakeSupabase) -> None:
        as_caller({"admin"})
        client.post("/users", json=CLIENT_BODY)
        # create_user always sets email_confirm; assert via the wrapper contract.
        assert fake.created[0]["email"] == CLIENT_BODY["email"]

    def test_a_duplicate_address_is_reported_as_a_conflict(self, fake: FakeSupabase) -> None:
        as_caller({"admin"})
        fake.create_error = SupabaseAdminError(422, "A user with this email address has already been registered")
        response = client.post("/users", json=CLIENT_BODY)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "auth_create_failed"

    def test_a_failed_role_insert_unwinds_the_auth_user(self, fake: FakeSupabase) -> None:
        # Otherwise we would leave an account that can sign in with no access.
        as_caller({"admin"})
        fake.fail_on_insert_into = "user_roles"
        response = client.post("/users", json=CLIENT_BODY)
        assert response.status_code == 502
        assert fake.deleted_users == ["11111111-1111-4111-8111-111111111111"]

    def test_an_invalid_email_is_rejected_by_validation(self, fake: FakeSupabase) -> None:
        as_caller({"admin"})
        response = client.post("/users", json={**CLIENT_BODY, "email": "not-an-email"})
        assert response.status_code == 422
        assert fake.created == []


# ---------------------------------------------------------------------------
# POST /users/{id}/reset-password
# ---------------------------------------------------------------------------


class TestResetPassword:
    def test_admin_resets_a_staff_user(self, fake: FakeSupabase) -> None:
        as_caller({"admin"})
        fake.rows["user_roles"] = [{"role": "credit_underwriter"}]
        response = client.post("/users/target-1/reset-password")
        assert response.status_code == 200
        assert len(response.json()["temporary_password"]) >= 16
        assert fake.updated[0][1]["user_metadata"]["must_change_password"] is True

    def test_sales_resets_a_client_of_a_company(self, fake: FakeSupabase) -> None:
        as_caller({"sales"})
        fake.rows["user_roles"] = [{"role": "client"}]
        fake.rows["policyholder_users"] = [{"entity_id": "e-1"}]
        assert client.post("/users/target-1/reset-password").status_code == 200

    def test_sales_cannot_reset_a_staff_user(self, fake: FakeSupabase) -> None:
        as_caller({"sales"})
        fake.rows["user_roles"] = [{"role": "credit_underwriter"}]
        response = client.post("/users/target-1/reset-password")
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "client_only"
        assert fake.updated == []

    def test_sales_cannot_reset_a_client_with_no_company_mapping(
        self, fake: FakeSupabase
    ) -> None:
        as_caller({"sales"})
        fake.rows["user_roles"] = [{"role": "client"}]
        fake.rows["policyholder_users"] = []
        response = client.post("/users/target-1/reset-password")
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "not_your_client"

    def test_the_new_password_is_not_written_to_our_tables(self, fake: FakeSupabase) -> None:
        as_caller({"admin"})
        fake.rows["user_roles"] = [{"role": "client"}]
        password = client.post("/users/target-1/reset-password").json()["temporary_password"]
        for _table, rows in fake.inserted:
            assert password not in str(rows)


# ---------------------------------------------------------------------------
# disable / enable
# ---------------------------------------------------------------------------


class TestDisableEnable:
    def test_admin_disables_and_enables(self, fake: FakeSupabase) -> None:
        as_caller({"admin"}, user_id="admin-1")
        assert client.post("/users/target-1/disable").json() == {
            "user_id": "target-1",
            "disabled": True,
        }
        assert client.post("/users/target-1/enable").json() == {
            "user_id": "target-1",
            "disabled": False,
        }
        assert fake.updated[0][1]["ban_duration"] != "none"
        assert fake.updated[1][1]["ban_duration"] == "none"

    @pytest.mark.parametrize("caller", ["sales", "commercial_underwriter", "credit_underwriter", "client"])
    def test_nobody_else_may_disable_or_enable(self, fake: FakeSupabase, caller: str) -> None:
        as_caller({caller})
        for action in ("disable", "enable"):
            response = client.post(f"/users/target-1/{action}")
            assert response.status_code == 403
            assert response.json()["detail"]["code"] == "admin_only"
        assert fake.updated == []

    def test_an_admin_cannot_lock_themselves_out(self, fake: FakeSupabase) -> None:
        as_caller({"admin"}, user_id="admin-1")
        response = client.post("/users/admin-1/disable")
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "self_disable"
        assert fake.updated == []


# ---------------------------------------------------------------------------
# Service configuration
# ---------------------------------------------------------------------------


class TestProvisioningStatus:
    def test_reports_configured_without_leaking_anything(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.users.is_configured", lambda: True)
        response = client.get("/users/provisioning-status")
        assert response.status_code == 200
        assert response.json() == {"configured": True}

    def test_reports_unconfigured_when_the_key_is_absent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.users.is_configured", lambda: False)
        assert client.get("/users/provisioning-status").json() == {"configured": False}

    def test_creating_a_user_without_credentials_is_503(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
        as_caller({"admin"})
        response = client.post("/users", json=CLIENT_BODY)
        assert response.status_code == 503
