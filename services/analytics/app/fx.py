"""FX rate proxy for the Central Bank of Uzbekistan open JSON API.

The frontend cannot call cbu.uz directly (no CORS headers on their API), so
this endpoint proxies a single (currency, date) lookup:

    GET /fx?ccy=USD&date=2025-12-31
    -> {"ccy": "USD", "date": "2025-12-31", "rate_to_uzs": 12345.67}

CBU convention: Rate = UZS per 1 unit of the currency (per their published
nominal). The frontend caches results into tci.fx_rates (source='cbu').
"""

from __future__ import annotations

import datetime as dt
import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

CBU_URL = "https://cbu.uz/ru/arkhiv-kursov-valyut/json/{ccy}/{date}/"


class FxResponse(BaseModel):
    ccy: str
    date: str
    rate_to_uzs: float
    source: str = "cbu"


@router.get("/fx", response_model=FxResponse)
async def get_fx(ccy: str, date: str) -> FxResponse:
    ccy = ccy.upper().strip()
    if len(ccy) != 3 or not ccy.isalpha():
        raise HTTPException(status_code=422, detail="ccy must be a 3-letter code")
    try:
        parsed = dt.date.fromisoformat(date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD") from exc

    url = CBU_URL.format(ccy=ccy, date=parsed.isoformat())
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        # The upstream error text names the URL we called and can carry its
        # response body. That belongs in the log, not in a public response.
        logger.warning("CBU lookup failed ccy=%s date=%s: %s", ccy, parsed, exc)
        raise HTTPException(status_code=502, detail="CBU API unavailable") from exc

    if not isinstance(payload, list) or not payload:
        raise HTTPException(status_code=404, detail=f"no CBU rate for {ccy} on {date}")

    entry = payload[0]
    try:
        rate = float(str(entry["Rate"]).replace(",", "."))
        nominal = float(str(entry.get("Nominal", "1")).replace(",", "."))
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="unexpected CBU payload") from exc

    if rate <= 0 or nominal <= 0:
        raise HTTPException(status_code=404, detail=f"no CBU rate for {ccy} on {date}")

    return FxResponse(ccy=ccy, date=parsed.isoformat(), rate_to_uzs=rate / nominal)
