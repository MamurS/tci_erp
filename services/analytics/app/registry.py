"""Official company registries, behind one search interface.

An information manager asked to register a company first looks it up in an
official source. Each source is a CONNECTOR that turns its own payload into
the same record, so the screen never knows which registry answered:

    GET /registry/sources
    -> [{"source": "gleif", "countries": null, "available": true}, ...]

    GET /registry/search?source=gleif&q=Delcreda&country=UZ
    -> {"source": "gleif", "records": [RegistryRecord, ...]}

Sources today:

* ``gleif``            — the Global LEI Index (api.gleif.org). Free, no key,
  worldwide: the legal name, registered address, registration number with
  the issuing register, legal form and LEI status. Covers companies that
  hold an LEI, which is most banks, larger traders and exporters.
* ``companies_house``  — the UK register (api.company-information.service.
  gov.uk). Free with a key, set as COMPANIES_HOUSE_API_KEY; without it the
  source is listed as unavailable rather than failing at search time.

Uzbekistan, Russia and Kazakhstan have no free official API this service can
rely on; their companies are entered by hand until a provider is chosen.
A record is a SUGGESTION: the information manager confirms it in the
company form, which runs the registry's duplicate check as usual.

Upstream errors are logged, never returned (the same rule as /fx), and the
key is never logged.
"""

from __future__ import annotations

import logging
import os
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.hardening import throttle_compute

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(throttle_compute)])

GLEIF_URL = "https://api.gleif.org/api/v1/lei-records"
COMPANIES_HOUSE_URL = "https://api.company-information.service.gov.uk/search/companies"
TIMEOUT = 10.0
MAX_RESULTS = 10

Source = Literal["gleif", "companies_house"]


class RegistryRecord(BaseModel):
    source: Source
    source_id: str
    name: str
    country_code: str | None
    registration_number: str | None
    address: str | None
    legal_form: str | None
    status: str | None
    founded_date: str | None
    url: str | None


class RegistrySearch(BaseModel):
    source: Source
    records: list[RegistryRecord]


class SourceInfo(BaseModel):
    source: Source
    # None = worldwide
    countries: list[str] | None
    available: bool


def _companies_house_key() -> str:
    return os.environ.get("COMPANIES_HOUSE_API_KEY", "").strip()


@router.get("/registry/sources", response_model=list[SourceInfo])
async def list_sources() -> list[SourceInfo]:
    return [
        SourceInfo(source="gleif", countries=None, available=True),
        SourceInfo(source="companies_house", countries=["GB"], available=bool(_companies_house_key())),
    ]


def _clean_query(q: str) -> str:
    q = " ".join(q.split())
    if len(q) < 3:
        raise HTTPException(status_code=422, detail="the search needs at least 3 characters")
    if len(q) > 120:
        raise HTTPException(status_code=422, detail="the search is too long")
    return q


def _clean_country(country: str | None) -> str | None:
    if country is None or country == "":
        return None
    country = country.strip().upper()
    if len(country) != 2 or not country.isalpha():
        raise HTTPException(status_code=422, detail="country must be a 2-letter code")
    return country


@router.get("/registry/search", response_model=RegistrySearch)
async def search(source: Source, q: str, country: str | None = None) -> RegistrySearch:
    query = _clean_query(q)
    iso = _clean_country(country)
    if source == "gleif":
        records = await _search_gleif(query, iso)
    else:
        records = await _search_companies_house(query)
    return RegistrySearch(source=source, records=records[:MAX_RESULTS])


# ---------------------------------------------------------------------------
# GLEIF
# ---------------------------------------------------------------------------


async def _search_gleif(query: str, country: str | None) -> list[RegistryRecord]:
    params: dict[str, str] = {"filter[fulltext]": query, "page[size]": str(MAX_RESULTS)}
    if country:
        params["filter[entity.legalAddress.country]"] = country
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(
                GLEIF_URL, params=params, headers={"Accept": "application/vnd.api+json"}
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        logger.warning("GLEIF search failed: %s", exc)
        raise HTTPException(status_code=502, detail="GLEIF unavailable") from exc
    return [r for r in (gleif_record(item) for item in _items(payload, "data")) if r]


def gleif_record(item: object) -> RegistryRecord | None:
    """One GLEIF lei-record → RegistryRecord; None when it lacks a name."""
    if not isinstance(item, dict):
        return None
    attributes = item.get("attributes") or {}
    entity = attributes.get("entity") or {}
    name = ((entity.get("legalName") or {}).get("name") or "").strip()
    if not name:
        return None
    address = entity.get("legalAddress") or {}
    registered = entity.get("registeredAs")
    lei = str(attributes.get("lei") or item.get("id") or "")
    return RegistryRecord(
        source="gleif",
        source_id=lei,
        name=name,
        country_code=(address.get("country") or None),
        registration_number=(str(registered).strip() or None) if registered else None,
        address=_join_address(
            [*(address.get("addressLines") or []), address.get("postalCode"), address.get("city")]
        ),
        legal_form=((entity.get("legalForm") or {}).get("other") or (entity.get("legalForm") or {}).get("id")),
        status=entity.get("status"),
        founded_date=_date_only(entity.get("creationDate")),
        url=f"https://search.gleif.org/#/record/{lei}" if lei else None,
    )


# ---------------------------------------------------------------------------
# Companies House
# ---------------------------------------------------------------------------


async def _search_companies_house(query: str) -> list[RegistryRecord]:
    key = _companies_house_key()
    if not key:
        raise HTTPException(status_code=503, detail="Companies House is not configured")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(
                COMPANIES_HOUSE_URL,
                params={"q": query, "items_per_page": str(MAX_RESULTS)},
                auth=(key, ""),
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        # The exception names the URL, never the key (basic auth is a header).
        logger.warning("Companies House search failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Companies House unavailable") from exc
    return [r for r in (companies_house_record(item) for item in _items(payload, "items")) if r]


def companies_house_record(item: object) -> RegistryRecord | None:
    if not isinstance(item, dict):
        return None
    name = str(item.get("title") or "").strip()
    number = str(item.get("company_number") or "").strip()
    if not name or not number:
        return None
    return RegistryRecord(
        source="companies_house",
        source_id=number,
        name=name,
        country_code="GB",
        registration_number=number,
        address=(str(item.get("address_snippet") or "").strip() or None),
        legal_form=item.get("company_type"),
        status=item.get("company_status"),
        founded_date=_date_only(item.get("date_of_creation")),
        url=f"https://find-and-update.company-information.service.gov.uk/company/{number}",
    )


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _items(payload: object, key: str) -> list[object]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="unexpected registry payload")
    items = payload.get(key) or []
    return items if isinstance(items, list) else []


def _join_address(parts: list[object]) -> str | None:
    text = ", ".join(str(p).strip() for p in parts if p and str(p).strip())
    return text or None


def _date_only(value: object) -> str | None:
    text = str(value or "").strip()
    return text[:10] if len(text) >= 10 else None
