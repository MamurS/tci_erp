"""Pure rules for user provisioning: who may create whom, and what a
temporary password looks like. No I/O — the endpoint layer applies these.
"""

from __future__ import annotations

import secrets
import string

# Roles the app knows (tci.user_role, migration 0016).
ALL_ROLES = frozenset(
    {
        "admin",
        "sales",
        "commercial_underwriter",
        "credit_underwriter",
        "claims",
        "information_manager",
        "client",
    }
)

#: Roles that may provision anyone, with any role set.
ADMIN_ROLES = frozenset({"admin"})

#: Roles that may provision CLIENT users only — sales and commercial
#: underwriting invite their own policyholders (owner decision).
CLIENT_PROVISIONER_ROLES = frozenset({"sales", "commercial_underwriter"})

TEMP_PASSWORD_LENGTH = 20
MIN_TEMP_PASSWORD_LENGTH = 16

#: Excludes look-alike characters — these passwords get read off a screen
#: and typed by hand, so O/0 and l/1/I would cost support calls.
_LOWER = "abcdefghijkmnopqrstuvwxyz"
_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_DIGITS = "23456789"
_SYMBOLS = "!@#$%^&*-_=+?"
_ALPHABET = _LOWER + _UPPER + _DIGITS + _SYMBOLS


class ProvisioningDenied(Exception):
    """The caller may not perform this provisioning action."""

    def __init__(self, detail: str, code: str) -> None:
        super().__init__(detail)
        self.detail = detail
        self.code = code


def generate_temp_password(length: int = TEMP_PASSWORD_LENGTH) -> str:
    """A strong temporary password with at least one of each class.

    Built by drawing every character from the CSPRNG, then reshuffling, so
    the guaranteed-class characters do not land in predictable positions.
    """
    if length < MIN_TEMP_PASSWORD_LENGTH:
        raise ValueError(f"temporary passwords must be at least {MIN_TEMP_PASSWORD_LENGTH} characters")

    required = [
        secrets.choice(_LOWER),
        secrets.choice(_UPPER),
        secrets.choice(_DIGITS),
        secrets.choice(_SYMBOLS),
    ]
    rest = [secrets.choice(_ALPHABET) for _ in range(length - len(required))]
    chars = required + rest
    # secrets.SystemRandom for the shuffle too — random.shuffle is not CS.
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def password_classes(password: str) -> set[str]:
    """Which character classes a password uses — used by the strength check
    and mirrored by the frontend rules."""
    classes: set[str] = set()
    for char in password:
        if char.islower():
            classes.add("lower")
        elif char.isupper():
            classes.add("upper")
        elif char.isdigit():
            classes.add("digit")
        elif char in string.punctuation:
            classes.add("symbol")
    return classes


def normalise_roles(roles: list[str] | tuple[str, ...]) -> list[str]:
    """Deduplicate, drop blanks, keep a stable order for storage and tests."""
    seen: list[str] = []
    for role in roles:
        role = (role or "").strip()
        if role and role not in seen:
            seen.append(role)
    return sorted(seen)


def authorize_create(caller_roles: set[str], requested_roles: list[str]) -> None:
    """Who may create a user with THIS role set.

    * admin                                 -> any roles
    * sales / commercial_underwriter        -> exactly ['client'], nothing else
    * anyone else                           -> denied

    Raises ProvisioningDenied; returns None when allowed.
    """
    unknown = [r for r in requested_roles if r not in ALL_ROLES]
    if unknown:
        raise ProvisioningDenied(f"unknown role(s): {', '.join(sorted(unknown))}", "unknown_role")
    if not requested_roles:
        raise ProvisioningDenied("at least one role is required", "no_roles")

    if caller_roles & ADMIN_ROLES:
        return

    if caller_roles & CLIENT_PROVISIONER_ROLES:
        if set(requested_roles) != {"client"}:
            raise ProvisioningDenied(
                "sales and commercial underwriting may only create client users",
                "client_only",
            )
        return

    raise ProvisioningDenied("not allowed to create users", "forbidden")


def authorize_manage(caller_roles: set[str], target_roles: set[str]) -> None:
    """Who may reset the password of an EXISTING user.

    Same shape as creation: admins manage anyone; sales and commercial
    underwriting manage client users only. The caller's view of which
    clients is narrowed one level up (they can only reach users of companies
    they can see).
    """
    if caller_roles & ADMIN_ROLES:
        return
    if caller_roles & CLIENT_PROVISIONER_ROLES:
        if target_roles != {"client"}:
            raise ProvisioningDenied(
                "sales and commercial underwriting may only manage client users",
                "client_only",
            )
        return
    raise ProvisioningDenied("not allowed to manage users", "forbidden")


def authorize_admin_only(caller_roles: set[str], action: str) -> None:
    """Disable/enable are administrative: admins only."""
    if caller_roles & ADMIN_ROLES:
        return
    raise ProvisioningDenied(f"only an administrator may {action} a user", "admin_only")


def requires_entity(roles: list[str]) -> bool:
    """A client user is meaningless without the company it belongs to."""
    return "client" in roles
