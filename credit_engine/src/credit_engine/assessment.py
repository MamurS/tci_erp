"""The engine facade: one call from canonical financials to a full assessment.

    from credit_engine import assess, CompanyFinancials, FinancialPeriod

    result = assess(company, language="ru")
    result.rating.score, result.limit.recommended_limit, result.commentary

    # with the buyer's sector grade and country risk category:
    result = assess(company, risk_context=RiskContext(sector_grade="B", ...))
    result.rating.base_grade, result.rating.grade, result.rating.risk_adjustments
"""

from __future__ import annotations

from credit_engine.commentary.generator import build_findings, render_commentary
from credit_engine.limits import LimitConfig, calculate_limit
from credit_engine.models import CompanyFinancials, CreditAssessment, RiskContext
from credit_engine.ratios import build_ratio_reports
from credit_engine.risk_context import apply_risk_context
from credit_engine.scoring.calculator import FactorInputs, calculate_rating
from credit_engine.scoring.tables import RatingConfig


def assess(
    company: CompanyFinancials,
    *,
    rating_config: RatingConfig | None = None,
    limit_config: LimitConfig | None = None,
    language: str = "en",
    risk_context: RiskContext | None = None,
) -> CreditAssessment:
    """Assess a company: ratios -> rating -> limit -> findings -> commentary.

    The latest period is the assessed one; earlier periods feed dynamics.

    ``commentary`` is the deterministic ENGLISH DRAFT - the factual anchor
    for the AI narrative layer (`credit_engine.narrative`), not end-user
    text. Final polished/translated commentary is produced by `narrate()`;
    when the AI service is unavailable the ERP shows the structured rating,
    limit and findings without narrative text.

    ``risk_context`` (optional) moves the grade by the buyer's sector grade
    and country risk category after the score is computed, and the limit
    follows the adjusted grade (`credit_engine.risk_context`). Without it the
    result is exactly what it was before risk contexts existed.
    """
    ratio_reports = build_ratio_reports(company)
    latest = ratio_reports[-1]

    inputs = FactorInputs(
        ratios=latest.ratios,
        dynamics=latest.dynamics,
        age_years=company.age_years,
        exchange_rate_usd=company.exchange_rate_usd,
    )

    rating = calculate_rating(company, inputs, rating_config)
    limit_score = rating.score
    if risk_context is not None:
        rating = apply_risk_context(rating, risk_context)
        if rating.effective_score is not None:
            limit_score = rating.effective_score
    limit = calculate_limit(
        limit_score,
        latest.ratios,
        company.currency,
        company.exchange_rate_usd,
        limit_config,
    )
    findings = build_findings(rating, limit)
    commentary = render_commentary(rating, limit, latest, company.currency, language)

    return CreditAssessment(
        company_name=company.name,
        assessed_year=latest.year,
        currency=company.currency,
        rating=rating,
        limit=limit,
        ratio_reports=ratio_reports,
        findings=findings,
        commentary=commentary,
        language=language,
    )
