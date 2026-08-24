"""FastAPI service wrapping the credit engine.

One core endpoint: POST /v1/assess takes canonical financials and returns
the full structured assessment (rating, limit, factors, adjustments,
findings, ratio reports) plus AI narrative commentary in the requested
language.

Availability policy (hard requirement): the structured assessment NEVER
depends on the AI. When the Claude API is unreachable or its output fails
validation, `narrative.status` is "unavailable" with
`message_key = "commentary.service_unavailable"` - rating, limit and the
justification are returned as usual.

Configuration (environment variables):
    ANTHROPIC_API_KEY      Claude API key for the narrative layer.
    CREDIT_ENGINE_API_KEY  If set, clients must send it as X-API-Key.
    NARRATIVE_MODEL        Claude model override (default claude-opus-5).

Run:
    uv run --extra service uvicorn credit_engine_api.app:app --port 8100
"""

from __future__ import annotations

import os
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from credit_engine import (
    CompanyFinancials,
    CreditAssessment,
    NarrativeConfig,
    NarrativeUnavailableError,
    assess,
    narrate,
)
from credit_engine import __version__ as engine_version
from credit_engine.narrative import Completer

# ---------------------------------------------------------------------------
# API schemas
# ---------------------------------------------------------------------------


class AssessRequest(BaseModel):
    """Input: canonical financials plus narrative options."""

    company: CompanyFinancials
    language: str = Field(
        default="ru",
        description="Target language for the AI narrative (e.g. 'en', 'ru', 'uz').",
    )
    narrative: bool = Field(
        default=True,
        description="Set false to skip the AI narrative call entirely.",
    )


class NarrativeResult(BaseModel):
    status: Literal["ok", "unavailable", "skipped"]
    language: str | None = None
    sections: dict[str, str] | None = None
    #: i18n key for the UI when status == "unavailable"
    #: ("commentary.service_unavailable" -> "Service unavailable, try later").
    message_key: str | None = None


class AssessResponse(BaseModel):
    assessment: CreditAssessment
    narrative: NarrativeResult


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    narrative_configured: bool


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def _default_completer() -> Completer | None:
    """Build the Claude adapter when configured; None -> narrative unavailable."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    try:
        from credit_engine.narrative import AnthropicCompleter
    except ImportError:
        return None
    model = os.getenv("NARRATIVE_MODEL")
    config = NarrativeConfig(model=model) if model else NarrativeConfig()
    try:
        return AnthropicCompleter(config=config)
    except Exception:  # anthropic missing or misconfigured -> degrade gracefully
        return None


def create_app(
    completer: Completer | None | Literal["auto"] = "auto",
    api_key: str | None = None,
) -> FastAPI:
    """Build the service. Tests inject a fake `completer`; production uses
    "auto" (Claude API from environment). `api_key` defaults to the
    CREDIT_ENGINE_API_KEY environment variable; when set, every /v1 request
    must carry it in the X-API-Key header."""
    resolved_completer = _default_completer() if completer == "auto" else completer
    required_key = api_key if api_key is not None else os.getenv("CREDIT_ENGINE_API_KEY")

    app = FastAPI(
        title="Credit Engine API",
        version=engine_version,
        description=(
            "Credit rating, credit limit and financial analysis service "
            "(TCI ERP / Mosaic Insurance Group). Scale 1-100, lower is better."
        ),
    )

    def require_key(
        x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    ) -> None:
        if required_key and x_api_key != required_key:
            raise HTTPException(status_code=401, detail="invalid or missing API key")

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            version=engine_version,
            narrative_configured=resolved_completer is not None,
        )

    @app.post(
        "/v1/assess",
        response_model=AssessResponse,
        dependencies=[Depends(require_key)],
    )
    async def assess_company(request: AssessRequest) -> AssessResponse:
        assessment = assess(request.company)

        if not request.narrative:
            narrative = NarrativeResult(status="skipped")
        elif resolved_completer is None:
            narrative = NarrativeResult(
                status="unavailable",
                message_key=NarrativeUnavailableError.message_key,
            )
        else:
            try:
                sections = await narrate(assessment, request.language, resolved_completer)
                narrative = NarrativeResult(
                    status="ok", language=request.language, sections=sections
                )
            except NarrativeUnavailableError as exc:
                narrative = NarrativeResult(
                    status="unavailable", message_key=exc.message_key
                )

        return AssessResponse(assessment=assessment, narrative=narrative)

    return app


app = create_app()
