"""TCI ERP analytics service: credit rating, credit limit, user provisioning.

Localhost-only for now (see repo README). The rating and limit endpoints
have no database access - the frontend supplies statement data in the
request and persists results to Supabase. The /users endpoints DO reach
Supabase, with the service_role key, because creating auth users cannot be
done from the browser; that key never leaves this process.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from credit_engine import CompanyFinancials
from credit_engine import __version__ as engine_version
from credit_engine.limits import calculate_limit
from credit_engine.ratios import build_ratio_reports
from credit_engine.scoring.calculator import FactorInputs, calculate_rating
from credit_engine.scoring.tables import GRADE_BANDS

from app.adapter import build_company
from app.fx import router as fx_router
from app.users import router as users_router
from app.schemas import (
    GradeBandOut,
    CreditLimitRequest,
    CreditLimitResponse,
    HealthResponse,
    LimitModelTrace,
    RatingAdjustment,
    RatingComponent,
    RatingResponse,
    StatementPayload,
)

# Provisioning writes an audit line per action (who created or reset whom).
# uvicorn does not configure application loggers, so without this the calls
# would be silent. Never add the temporary password or the service key to a
# log record - see app/users.py.
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

app = FastAPI(
    title="TCI Analytics",
    version=engine_version,
    description=(
        "Credit rating and credit limit service for TCI ERP. "
        "Rating scale 1-100, lower is better."
    ),
)

# Local development: the Vite frontend runs on another localhost port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(fx_router)
# User provisioning. Holds the service_role key - see app/users.py.
app.include_router(users_router)


def _factor_inputs(
    payload: StatementPayload,
) -> tuple[FactorInputs, list[str], CompanyFinancials]:
    company, warnings = build_company(payload)
    reports = build_ratio_reports(company)
    latest = reports[-1]
    inputs = FactorInputs(
        ratios=latest.ratios,
        dynamics=latest.dynamics,
        age_years=company.age_years,
        exchange_rate_usd=company.exchange_rate_usd,
    )
    return inputs, warnings, company


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", engine_version=engine_version)


@app.post("/rating", response_model=RatingResponse)
def rating(payload: StatementPayload) -> RatingResponse:
    inputs, adapter_warnings, company = _factor_inputs(payload)
    result = calculate_rating(company, inputs)

    return RatingResponse(
        score=result.score,
        grade=result.grade,
        grade_label_key=result.grade_label_key,
        data_coverage=result.data_coverage,
        components=[
            RatingComponent(
                factor=f.factor,
                value=f.value,
                score=f.score,
                weight=f.weight,
                status=str(f.status),
                band=f.band_label,
            )
            for f in result.factors
        ],
        adjustments=[
            RatingAdjustment(
                code=a.code,
                detail=a.detail,
                rating_before=round(a.rating_before, 1),
                rating_after=round(a.rating_after, 1),
            )
            for a in result.adjustments
        ],
        warnings=[*adapter_warnings, *result.warnings],
        engine_version=engine_version,
    )


@app.post("/credit-limit", response_model=CreditLimitResponse)
def credit_limit(payload: CreditLimitRequest) -> CreditLimitResponse:
    inputs, _, company = _factor_inputs(payload)

    result = calculate_limit(
        payload.rating_score,
        inputs.ratios,
        payload.currency,
        company.exchange_rate_usd,
    )
    return CreditLimitResponse(
        suggested_limit=result.recommended_limit,
        currency=result.currency,
        model_used=result.model_used,
        trace=[
            LimitModelTrace(
                model=m.model,
                limit=m.limit,
                components=m.components,
                reasons=m.reasons,
            )
            for m in result.models
        ],
        reasons=result.reasons,
        engine_version=engine_version,
    )


@app.get("/grade-scale", response_model=list[GradeBandOut])
def grade_scale() -> list[GradeBandOut]:
    """Grade zone boundaries of the rating scale (1-100, lower is better).

    Single source of truth is credit_engine.scoring.tables.GRADE_BANDS; the
    frontend renders the GradeScale component from this - never hardcodes.
    """
    bands: list[GradeBandOut] = []
    lower = 0.0
    for band in GRADE_BANDS:
        bands.append(
            GradeBandOut(
                code=band.code,
                label_key=band.label_key,
                lower=lower,
                upper=band.upper,
                risk_coefficient=band.risk_coefficient,
                family=band.code[0],
            )
        )
        lower = band.upper
    return bands
