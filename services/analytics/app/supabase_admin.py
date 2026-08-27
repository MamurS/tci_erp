"""Thin Supabase admin/REST client for user provisioning.

Holds the SERVICE ROLE key. That key bypasses RLS entirely and must never
leave this process: it is read from the environment, never logged, never
echoed in a response, and never sent to the frontend.

Only the handful of calls provisioning needs are wrapped; there is no
general-purpose escape hatch on purpose.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

TIMEOUT = 15.0


class SupabaseConfigError(RuntimeError):
    """The service is running without the credentials provisioning needs."""


class SupabaseAdminError(RuntimeError):
    """A Supabase admin call failed. `status` is its HTTP status."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _env() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SupabaseConfigError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for user provisioning"
        )
    return url, key


def is_configured() -> bool:
    try:
        _env()
    except SupabaseConfigError:
        return False
    return True


class SupabaseAdmin:
    """Service-role client. Construct per request; it holds no state."""

    def __init__(self) -> None:
        self.url, self._key = _env()

    # -- headers ------------------------------------------------------------

    @property
    def _auth_headers(self) -> dict[str, str]:
        return {"apikey": self._key, "Authorization": f"Bearer {self._key}"}

    def _rest_headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            **self._auth_headers,
            "Content-Type": "application/json",
            # Every TCI table lives in the dedicated `tci` schema.
            "Accept-Profile": "tci",
            "Content-Profile": "tci",
        }
        if extra:
            headers.update(extra)
        return headers

    # -- caller identity ----------------------------------------------------

    async def user_from_token(self, access_token: str) -> dict[str, Any]:
        """Resolve the CALLER from their own access token.

        The token is verified by Supabase, not by us, and the identity comes
        back from Supabase - never from anything the client asserted.
        """
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(
                f"{self.url}/auth/v1/user",
                headers={"apikey": self._key, "Authorization": f"Bearer {access_token}"},
            )
        if response.status_code != 200:
            raise SupabaseAdminError(401, "invalid or expired access token")
        return response.json()

    # -- REST (service role: bypasses RLS) ----------------------------------

    async def select(
        self, table: str, params: dict[str, str]
    ) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(
                f"{self.url}/rest/v1/{table}",
                headers=self._rest_headers(),
                params=params,
            )
        self._raise_for_status(response)
        return response.json()

    async def insert(
        self, table: str, rows: list[dict[str, Any]], *, upsert: bool = False
    ) -> None:
        if not rows:
            return
        extra = {"Prefer": "resolution=merge-duplicates"} if upsert else {}
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"{self.url}/rest/v1/{table}",
                headers=self._rest_headers(extra),
                json=rows,
            )
        self._raise_for_status(response)

    async def delete(self, table: str, params: dict[str, str]) -> None:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.request(
                "DELETE",
                f"{self.url}/rest/v1/{table}",
                headers=self._rest_headers(),
                params=params,
            )
        self._raise_for_status(response)

    # -- auth admin ---------------------------------------------------------

    async def create_user(
        self, email: str, password: str, user_metadata: dict[str, Any]
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"{self.url}/auth/v1/admin/users",
                headers={**self._auth_headers, "Content-Type": "application/json"},
                json={
                    "email": email,
                    "password": password,
                    # No SMTP is configured, so the address is trusted as
                    # entered and the user can sign in straight away.
                    "email_confirm": True,
                    "user_metadata": user_metadata,
                },
            )
        self._raise_for_status(response)
        return response.json()

    async def update_user(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.put(
                f"{self.url}/auth/v1/admin/users/{user_id}",
                headers={**self._auth_headers, "Content-Type": "application/json"},
                json=payload,
            )
        self._raise_for_status(response)
        return response.json()

    async def get_user(self, user_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(
                f"{self.url}/auth/v1/admin/users/{user_id}",
                headers=self._auth_headers,
            )
        self._raise_for_status(response)
        return response.json()

    async def delete_user(self, user_id: str) -> None:
        """Only used to unwind a half-created user, and by the smoke check."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.delete(
                f"{self.url}/auth/v1/admin/users/{user_id}",
                headers=self._auth_headers,
            )
        self._raise_for_status(response)

    # -- errors -------------------------------------------------------------

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        # Surface Supabase's own message, which never contains our key.
        detail = response.text[:300]
        try:
            body = response.json()
            detail = str(body.get("msg") or body.get("message") or body.get("error_description") or detail)
        except ValueError:
            pass
        raise SupabaseAdminError(response.status_code, detail)
