"""User provisioning endpoints.

These are the ONLY part of the system that may create auth users, because
they are the only part that holds the Supabase service_role key. The key
lives in this process's environment and never reaches the browser.

Authorization model: the frontend sends the CALLER's own Supabase access
token as `Authorization: Bearer …`. We hand that token to Supabase to
resolve the caller, then read their roles from tci.user_roles with the
service key. A role claim in the request body is never trusted — there
isn't one.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from app.hardening import client_ip
from app.ratelimit import provisioning_limiter
from app.settings import get_settings

from app.provisioning_rules import (
    ProvisioningDenied,
    authorize_admin_only,
    authorize_create,
    authorize_manage,
    generate_temp_password,
    normalise_roles,
    requires_entity,
)
from app.supabase_admin import (
    SupabaseAdmin,
    SupabaseAdminError,
    SupabaseConfigError,
    is_configured,
)

logger = logging.getLogger(__name__)


def _throttle_ip(request: Request) -> None:
    """Per-IP bucket, as a ROUTER dependency so it runs before get_caller.

    Inside an endpoint body it would be useless: an unauthenticated request
    is rejected while resolving CallerDep and would never reach it, making a
    401 flood free. Caught by a test that asserted the opposite.
    """
    settings = get_settings()
    decision = provisioning_limiter.check(
        f"ip:{client_ip(request, settings)}", settings.provisioning_per_ip_per_hour
    )
    if not decision.allowed:
        logger.warning("provisioning rate limit (ip) path=%s", request.url.path)
        raise HTTPException(
            status_code=429,
            detail="too many provisioning requests, try again later",
            headers={"Retry-After": str(decision.retry_after)},
        )


router = APIRouter(
    prefix="/users",
    tags=["provisioning"],
    dependencies=[Depends(_throttle_ip)],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str | None = None
    roles: list[str] = Field(min_length=1)
    #: Required iff roles == ['client'] — the company the portal user belongs to.
    entity_id: str | None = None
    #: Reserved: no SMTP is configured, so the password is shown on screen.
    send_email: bool = False


class ProvisionedUser(BaseModel):
    """The temporary password is returned ONCE and never persisted by us."""

    user_id: str
    email: str
    temporary_password: str
    roles: list[str]
    entity_id: str | None = None
    must_change_password: bool = True


class UserStateResponse(BaseModel):
    user_id: str
    disabled: bool


class Caller(BaseModel):
    user_id: str
    email: str | None
    roles: set[str]


# ---------------------------------------------------------------------------
# Caller resolution
# ---------------------------------------------------------------------------


def _admin() -> SupabaseAdmin:
    try:
        return SupabaseAdmin()
    except SupabaseConfigError as exc:
        # 503, not 500: the service is up, provisioning is not configured.
        raise HTTPException(status_code=503, detail=str(exc)) from exc


async def get_caller(
    authorization: Annotated[str | None, Header()] = None,
) -> Caller:
    """Resolve and authenticate the caller from their bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="missing bearer token")

    admin = _admin()
    try:
        user = await admin.user_from_token(token)
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=401, detail=exc.detail) from exc

    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="invalid or expired access token")

    rows = await admin.select(
        "user_roles", {"select": "role", "user_id": f"eq.{user_id}"}
    )
    return Caller(
        user_id=str(user_id),
        email=user.get("email"),
        roles={str(r["role"]) for r in rows},
    )


CallerDep = Annotated[Caller, Depends(get_caller)]


def _deny(exc: ProvisioningDenied) -> HTTPException:
    return HTTPException(status_code=403, detail={"code": exc.code, "message": exc.detail})


async def _roles_of(admin: SupabaseAdmin, user_id: str) -> set[str]:
    rows = await admin.select("user_roles", {"select": "role", "user_id": f"eq.{user_id}"})
    return {str(r["role"]) for r in rows}


async def _assert_can_reach_client(
    admin: SupabaseAdmin, caller: Caller, user_id: str
) -> None:
    """A sales/commercial caller may only touch client users of a company
    they can see. With no portal mapping the user is not theirs to manage."""
    if caller.roles & {"admin"}:
        return
    rows = await admin.select(
        "policyholder_users", {"select": "entity_id", "user_id": f"eq.{user_id}"}
    )
    if not rows:
        raise HTTPException(
            status_code=403,
            detail={"code": "not_your_client", "message": "this user is not a client of any company"},
        )


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


def _throttle_caller(request: Request, caller_id: str) -> None:
    """Per-caller bucket, on top of the per-IP one the router already applied.
    One compromised token stays capped however many addresses it comes from.

    The 429 body never says WHICH bucket ran out: that would tell an attacker
    whether their token was recognised.
    """
    settings = get_settings()
    decision = provisioning_limiter.check(
        f"caller:{caller_id}", settings.provisioning_per_caller_per_hour
    )
    if not decision.allowed:
        logger.warning("provisioning rate limit (caller) path=%s", request.url.path)
        raise HTTPException(
            status_code=429,
            detail="too many provisioning requests, try again later",
            headers={"Retry-After": str(decision.retry_after)},
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/provisioning-status")
async def provisioning_status() -> dict[str, bool]:
    """Unauthenticated liveness probe for the UI's service-unavailable state.

    Says only whether provisioning is configured — never what with.
    """
    return {"configured": is_configured()}


@router.post("", response_model=ProvisionedUser, status_code=201)
async def create_user(
    request: Request, payload: CreateUserRequest, caller: CallerDep
) -> ProvisionedUser:
    _throttle_caller(request, caller.user_id)
    roles = normalise_roles(payload.roles)
    try:
        authorize_create(caller.roles, roles)
    except ProvisioningDenied as exc:
        raise _deny(exc) from exc

    if requires_entity(roles) and not payload.entity_id:
        raise HTTPException(
            status_code=422,
            detail={"code": "entity_required", "message": "a client user needs a company"},
        )
    if not requires_entity(roles) and payload.entity_id:
        raise HTTPException(
            status_code=422,
            detail={"code": "entity_not_allowed", "message": "only a client user belongs to a company"},
        )

    admin = _admin()
    password = generate_temp_password()

    try:
        created = await admin.create_user(
            email=str(payload.email),
            password=password,
            user_metadata={
                "full_name": payload.full_name,
                "must_change_password": True,
            },
        )
    except SupabaseAdminError as exc:
        # 422 on a duplicate address so the UI can say so precisely.
        status = 409 if exc.status in (400, 422) and "already" in exc.detail.lower() else exc.status
        raise HTTPException(
            status_code=status,
            detail={"code": "auth_create_failed", "message": exc.detail},
        ) from exc

    user_id = str(created["id"])

    # Everything after this point is ours to unwind if it fails: a user who
    # exists in auth but has no roles could sign in with no access at all.
    try:
        await admin.insert(
            "user_roles", [{"user_id": user_id, "role": role} for role in roles]
        )
        await admin.insert(
            "user_profiles",
            [
                {
                    "user_id": user_id,
                    "full_name": payload.full_name,
                    "must_change_password": True,
                    "created_by": caller.user_id,
                }
            ],
            upsert=True,
        )
        if requires_entity(roles):
            await admin.insert(
                "policyholder_users",
                [
                    {
                        "entity_id": payload.entity_id,
                        "user_id": user_id,
                        "created_by": caller.user_id,
                    }
                ],
                upsert=True,
            )
    except SupabaseAdminError as exc:
        await _rollback_user(admin, user_id)
        raise HTTPException(
            status_code=502,
            detail={"code": "provisioning_failed", "message": exc.detail},
        ) from exc

    # Deliberately no password in this log line, at any level.
    logger.info("provisioned user %s with roles %s by %s", user_id, roles, caller.user_id)

    return ProvisionedUser(
        user_id=user_id,
        email=str(payload.email),
        temporary_password=password,
        roles=roles,
        entity_id=payload.entity_id,
    )


async def _rollback_user(admin: SupabaseAdmin, user_id: str) -> None:
    """Best-effort unwind of a half-created user."""
    try:
        await admin.delete_user(user_id)
    except SupabaseAdminError:
        logger.exception("failed to roll back partially provisioned user %s", user_id)


@router.post("/{user_id}/reset-password", response_model=ProvisionedUser)
async def reset_password(
    request: Request, user_id: str, caller: CallerDep
) -> ProvisionedUser:
    _throttle_caller(request, caller.user_id)
    admin = _admin()
    target_roles = await _roles_of(admin, user_id)
    try:
        authorize_manage(caller.roles, target_roles)
    except ProvisioningDenied as exc:
        raise _deny(exc) from exc
    await _assert_can_reach_client(admin, caller, user_id)

    password = generate_temp_password()
    try:
        updated = await admin.update_user(
            user_id,
            {
                "password": password,
                "user_metadata": {"must_change_password": True},
            },
        )
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=exc.status if exc.status >= 400 else 502,
            detail={"code": "reset_failed", "message": exc.detail},
        ) from exc

    await admin.insert(
        "user_profiles",
        [{"user_id": user_id, "must_change_password": True}],
        upsert=True,
    )
    logger.info("reset password for user %s by %s", user_id, caller.user_id)

    return ProvisionedUser(
        user_id=user_id,
        email=str(updated.get("email") or ""),
        temporary_password=password,
        roles=sorted(target_roles),
    )


@router.post("/{user_id}/disable", response_model=UserStateResponse)
async def disable_user(
    request: Request, user_id: str, caller: CallerDep
) -> UserStateResponse:
    _throttle_caller(request, caller.user_id)
    try:
        authorize_admin_only(caller.roles, "disable")
    except ProvisioningDenied as exc:
        raise _deny(exc) from exc
    if user_id == caller.user_id:
        raise HTTPException(
            status_code=422,
            detail={"code": "self_disable", "message": "you cannot disable your own account"},
        )
    await _set_ban(user_id, "876000h")  # ~100 years: Supabase has no "forever".
    logger.info("disabled user %s by %s", user_id, caller.user_id)
    return UserStateResponse(user_id=user_id, disabled=True)


@router.post("/{user_id}/enable", response_model=UserStateResponse)
async def enable_user(
    request: Request, user_id: str, caller: CallerDep
) -> UserStateResponse:
    _throttle_caller(request, caller.user_id)
    try:
        authorize_admin_only(caller.roles, "enable")
    except ProvisioningDenied as exc:
        raise _deny(exc) from exc
    await _set_ban(user_id, "none")
    logger.info("enabled user %s by %s", user_id, caller.user_id)
    return UserStateResponse(user_id=user_id, disabled=False)


async def _set_ban(user_id: str, duration: str) -> dict[str, Any]:
    admin = _admin()
    try:
        return await admin.update_user(user_id, {"ban_duration": duration})
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=exc.status if exc.status >= 400 else 502,
            detail={"code": "state_change_failed", "message": exc.detail},
        ) from exc
