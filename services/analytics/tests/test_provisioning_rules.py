"""The authorization matrix and the temporary-password contract.

Pure rules, no I/O — the endpoint tests exercise the same rules through
HTTP with Supabase mocked out.
"""

from __future__ import annotations

import pytest

from app.provisioning_rules import (
    MIN_TEMP_PASSWORD_LENGTH,
    ProvisioningDenied,
    authorize_admin_only,
    authorize_create,
    authorize_manage,
    generate_temp_password,
    normalise_roles,
    password_classes,
    requires_entity,
)

STAFF_ROLES = ["sales", "commercial_underwriter", "credit_underwriter", "claims", "information_manager"]


class TestTempPassword:
    def test_is_long_and_uses_every_class(self) -> None:
        for _ in range(50):
            password = generate_temp_password()
            assert len(password) >= MIN_TEMP_PASSWORD_LENGTH
            assert password_classes(password) == {"lower", "upper", "digit", "symbol"}

    def test_excludes_look_alike_characters(self) -> None:
        # These get read off a screen and typed by hand.
        for _ in range(50):
            assert not set(generate_temp_password()) & set("O0lI1")

    def test_passwords_do_not_repeat(self) -> None:
        assert len({generate_temp_password() for _ in range(200)}) == 200

    def test_refuses_to_generate_a_weak_one(self) -> None:
        with pytest.raises(ValueError):
            generate_temp_password(length=8)

    def test_guaranteed_characters_are_not_pinned_to_the_front(self) -> None:
        # A naive implementation puts lower/upper/digit/symbol at 0..3.
        firsts = {generate_temp_password()[0] for _ in range(100)}
        assert len(firsts) > 4


class TestAuthorizeCreate:
    def test_admin_may_create_any_roles(self) -> None:
        for roles in (["admin"], ["client"], ["sales", "credit_underwriter"]):
            authorize_create({"admin"}, normalise_roles(roles))

    @pytest.mark.parametrize("caller", ["sales", "commercial_underwriter"])
    def test_client_provisioners_may_create_clients(self, caller: str) -> None:
        authorize_create({caller}, ["client"])

    @pytest.mark.parametrize("caller", ["sales", "commercial_underwriter"])
    @pytest.mark.parametrize(
        "roles",
        [["sales"], ["admin"], ["credit_underwriter"], ["client", "sales"], ["claims"]],
    )
    def test_client_provisioners_may_not_create_anything_else(
        self, caller: str, roles: list[str]
    ) -> None:
        with pytest.raises(ProvisioningDenied) as exc:
            authorize_create({caller}, normalise_roles(roles))
        assert exc.value.code == "client_only"

    @pytest.mark.parametrize("caller", ["credit_underwriter", "claims", "information_manager", "client"])
    def test_everyone_else_is_denied_outright(self, caller: str) -> None:
        with pytest.raises(ProvisioningDenied) as exc:
            authorize_create({caller}, ["client"])
        assert exc.value.code == "forbidden"

    def test_no_roles_at_all_is_rejected(self) -> None:
        with pytest.raises(ProvisioningDenied) as exc:
            authorize_create({"admin"}, [])
        assert exc.value.code == "no_roles"

    def test_unknown_roles_are_rejected_before_authorization(self) -> None:
        # Checked first, so a denied caller cannot probe the role vocabulary.
        with pytest.raises(ProvisioningDenied) as exc:
            authorize_create({"client"}, ["superuser"])
        assert exc.value.code == "unknown_role"

    def test_a_multi_role_caller_gets_the_union(self) -> None:
        # Holding admin alongside sales lifts the client-only restriction.
        authorize_create({"sales", "admin"}, ["credit_underwriter"])


class TestAuthorizeManage:
    def test_admin_manages_anyone(self) -> None:
        authorize_manage({"admin"}, {"credit_underwriter"})
        authorize_manage({"admin"}, set())

    @pytest.mark.parametrize("caller", ["sales", "commercial_underwriter"])
    def test_client_provisioners_manage_only_clients(self, caller: str) -> None:
        authorize_manage({caller}, {"client"})
        with pytest.raises(ProvisioningDenied) as exc:
            authorize_manage({caller}, {"credit_underwriter"})
        assert exc.value.code == "client_only"

    @pytest.mark.parametrize("caller", ["sales", "commercial_underwriter"])
    def test_a_client_who_is_also_staff_is_out_of_reach(self, caller: str) -> None:
        # Resetting such a user would hand out a staff account's password.
        with pytest.raises(ProvisioningDenied):
            authorize_manage({caller}, {"client", "sales"})

    def test_a_roleless_user_is_not_a_client(self, ) -> None:
        with pytest.raises(ProvisioningDenied):
            authorize_manage({"sales"}, set())


class TestAuthorizeAdminOnly:
    def test_only_admins_disable_and_enable(self) -> None:
        authorize_admin_only({"admin"}, "disable")
        for role in STAFF_ROLES + ["client"]:
            with pytest.raises(ProvisioningDenied) as exc:
                authorize_admin_only({role}, "disable")
            assert exc.value.code == "admin_only"


class TestHelpers:
    def test_roles_are_deduplicated_and_ordered(self) -> None:
        assert normalise_roles(["sales", "admin", "sales", " "]) == ["admin", "sales"]

    def test_only_client_users_need_a_company(self) -> None:
        assert requires_entity(["client"]) is True
        assert requires_entity(["sales", "client"]) is True
        assert requires_entity(["sales"]) is False
