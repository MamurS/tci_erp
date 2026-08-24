"""Credit rating calculation.

Replaces the legacy `grade_calculator.py`. The core mechanism is preserved
(threshold tables -> weighted average -> named caps/floors) but implemented
as an explicit, explainable weighted model instead of score-list duplication.

Deliberate fixes vs legacy (documented in README):
* `total_assets_dynamic` participates in the weighted sum (legacy scored it
  against the wrong input and then dropped it).
* The missing-data policy is explicit: core factors are penalized, secondary
  factors are excluded with a warning; heavy incompleteness floors the rating.
* The new-company rule only worsens a rating, never improves it.
* Court-case thresholds use the assessed company's own latest revenue.
* The implied-interest-rate relief rule uses interest/debt < 1% (the legacy
  formula `interest/debt - 1 < 0.01` was true almost always).
* At a net loss, revenue-dynamic weight increases by +3 (legacy applied +3
  and then an unconditional -4, neutralizing its own rule).
"""

from __future__ import annotations

from dataclasses import dataclass

from credit_engine.models import (
    Adjustment,
    CompanyFinancials,
    CourtCasesSummary,
    FactorScore,
    FactorStatus,
    RatingResult,
)
from credit_engine.scoring import tables
from credit_engine.scoring.tables import CORE_FACTORS, INF, RatingConfig, ScoreTable, grade_for


@dataclass(frozen=True)
class FactorInputs:
    """Everything factor scoring needs for the assessed period."""

    ratios: dict[str, float | None]
    dynamics: dict[str, float | None]
    age_years: float | None
    exchange_rate_usd: float


def _pick_debt_to_equity_table(inputs: FactorInputs) -> ScoreTable:
    icr = inputs.ratios.get("interest_coverage")
    if icr is not None and icr > 6:
        return tables.DEBT_TO_EQUITY_STRONG_ICR
    return tables.DEBT_TO_EQUITY


def _pick_debt_to_assets_table(inputs: FactorInputs) -> ScoreTable:
    tad = inputs.dynamics.get("total_assets")
    if tad is not None and tad < -0.50:
        return tables.DEBT_TO_ASSETS_ASSET_COLLAPSE
    return tables.DEBT_TO_ASSETS


def _factor_value(factor: str, inputs: FactorInputs) -> float | None:
    match factor:
        case "net_profitability":
            return inputs.ratios.get("net_profitability")
        case "equity_ratio":
            return inputs.ratios.get("equity_ratio")
        case "debt_to_assets":
            return inputs.ratios.get("debt_to_assets")
        case "total_assets_dynamic":
            return inputs.dynamics.get("total_assets")
        case "current_ratio":
            return inputs.ratios.get("current_ratio")
        case "interest_coverage":
            return inputs.ratios.get("interest_coverage")
        case "interest_coverage_dynamic":
            return inputs.dynamics.get("interest_coverage")
        case "debt_to_equity":
            return inputs.ratios.get("debt_to_equity")
        case "cash_conversion_cycle":
            return inputs.ratios.get("cash_conversion_cycle")
        case "revenue_usd":
            revenue = inputs.ratios.get("revenue")
            if revenue is None:
                return None
            return revenue / inputs.exchange_rate_usd
        case "age_years":
            return inputs.age_years
        case "debt_to_ebit":
            return inputs.ratios.get("debt_to_ebit")
        case "revenue_dynamic":
            return inputs.dynamics.get("revenue")
    raise ValueError(f"unknown factor: {factor}")


def _factor_table(factor: str, inputs: FactorInputs) -> ScoreTable:
    match factor:
        case "net_profitability":
            return tables.NET_PROFITABILITY
        case "equity_ratio":
            return tables.EQUITY_RATIO
        case "debt_to_assets":
            return _pick_debt_to_assets_table(inputs)
        case "total_assets_dynamic":
            return tables.TOTAL_ASSETS_DYNAMIC
        case "current_ratio":
            return tables.CURRENT_RATIO
        case "interest_coverage":
            return tables.INTEREST_COVERAGE
        case "interest_coverage_dynamic":
            return tables.INTEREST_COVERAGE_DYNAMIC
        case "debt_to_equity":
            return _pick_debt_to_equity_table(inputs)
        case "cash_conversion_cycle":
            return tables.CASH_CONVERSION_CYCLE
        case "revenue_usd":
            return tables.REVENUE_USD
        case "age_years":
            return tables.AGE_YEARS
        case "debt_to_ebit":
            return tables.DEBT_TO_EBIT
        case "revenue_dynamic":
            return tables.REVENUE_DYNAMIC
    raise ValueError(f"unknown factor: {factor}")


def _adjusted_weights(inputs: FactorInputs, config: RatingConfig) -> dict[str, float]:
    """Legacy dynamic weight adjustments, as explicit rules."""
    weights = dict(config.weights)

    equity_ratio = inputs.ratios.get("equity_ratio")
    if equity_ratio is not None:
        if equity_ratio > 0.6:
            weights["equity_ratio"] += 1
        elif equity_ratio < 0.03:
            weights["equity_ratio"] += 7

    tad = inputs.dynamics.get("total_assets")
    if tad is not None and tad <= -0.50:
        weights["total_assets_dynamic"] += 5

    net_profitability = inputs.ratios.get("net_profitability")
    if net_profitability is not None:
        if net_profitability < 0:
            # At a loss, revenue growth matters more for recovery prospects.
            weights["revenue_dynamic"] += 3
        elif net_profitability > 0.15:
            weights["revenue_dynamic"] = max(1, weights["revenue_dynamic"] - 2)

    revenue_dynamic = inputs.dynamics.get("revenue")
    if revenue_dynamic is not None and revenue_dynamic <= -0.50:
        # Revenue collapse dominates the assessment (legacy design intent).
        weights["revenue_dynamic"] += config.revenue_collapse_extra_weight

    # Implied interest rate < 1% on a highly-scored debt load suggests
    # non-market (e.g. intragroup) financing: soften both leverage factors.
    interest = inputs.ratios.get("interest_expenses")
    debt = inputs.ratios.get("gross_debt")
    if interest is not None and debt is not None and debt > 0:
        implied_rate = abs(interest) / debt
        if implied_rate < config.low_interest_rate_threshold:
            weights["debt_to_assets"] *= 0.5
            weights["debt_to_equity"] *= 0.5

    return weights


def score_factors(inputs: FactorInputs, config: RatingConfig) -> list[FactorScore]:
    weights = _adjusted_weights(inputs, config)
    factors: list[FactorScore] = []

    for factor, weight in weights.items():
        value = _factor_value(factor, inputs)
        if value is None or value in (INF, -INF):
            if factor in CORE_FACTORS:
                factors.append(
                    FactorScore(
                        factor=factor,
                        value=None,
                        score=config.missing_core_score,
                        weight=weight,
                        status=FactorStatus.MISSING_PENALIZED,
                        note="core input missing - penalized",
                    )
                )
            else:
                factors.append(
                    FactorScore(
                        factor=factor,
                        value=None,
                        score=None,
                        weight=weight,
                        status=FactorStatus.EXCLUDED,
                        note="input missing - excluded from weighting",
                    )
                )
            continue

        score, band = _factor_table(factor, inputs).score(value)
        factors.append(
            FactorScore(
                factor=factor,
                value=value,
                score=score,
                weight=weight,
                status=FactorStatus.SCORED,
                band_label=band,
            )
        )
    return factors


def _weighted_rating(factors: list[FactorScore]) -> float | None:
    total = sum(f.weight for f in factors if f.is_scored)
    if total == 0:
        return None
    weighted = sum(f.score * f.weight for f in factors if f.is_scored and f.score is not None)
    return weighted / total


def _blend_toward(rating: float, target: float, target_parts: int = 9) -> float:
    """Legacy blend: mix the rating with `target_parts` copies of `target`."""
    return (rating + target * target_parts) / (target_parts + 1)


def calculate_rating(
    company: CompanyFinancials,
    inputs: FactorInputs,
    config: RatingConfig | None = None,
) -> RatingResult:
    config = config or RatingConfig()
    warnings: list[str] = []
    adjustments: list[Adjustment] = []

    factors = score_factors(inputs, config)

    for f in factors:
        if f.status == FactorStatus.MISSING_PENALIZED:
            warnings.append(f"missing core input for factor '{f.factor}' - penalized")
        elif f.status == FactorStatus.EXCLUDED:
            warnings.append(f"missing input for factor '{f.factor}' - excluded")

    total_weight = sum(f.weight for f in factors)
    scored_weight = sum(f.weight for f in factors if f.is_scored)
    coverage = scored_weight / total_weight if total_weight else 0.0

    rating = _weighted_rating(factors)
    if rating is None:
        return RatingResult(
            score=None,
            grade=None,
            grade_label_key=None,
            factors=factors,
            adjustments=[],
            data_coverage=0.0,
            warnings=[*warnings, "no scorable factors - rating not computable"],
        )

    # --- Rule: weak equity dominance (legacy equity re-weighting) ---
    equity_factor = next((f for f in factors if f.factor == "equity_ratio"), None)
    if equity_factor is not None and equity_factor.score is not None:
        multiplier = 0.0
        if equity_factor.score > 65 and rating < 65:
            multiplier = 6.0
        elif equity_factor.score > 55 and rating < 55:
            multiplier = 4.0
        if multiplier:
            before = rating
            boosted = [
                f.model_copy(update={"weight": f.weight * multiplier})
                if f.factor == "equity_ratio"
                else f
                for f in factors
            ]
            new_rating = _weighted_rating(boosted)
            if new_rating is not None and new_rating > rating:
                rating = new_rating
                adjustments.append(
                    Adjustment(
                        code="weak_equity_dominance",
                        rating_before=before,
                        rating_after=rating,
                        detail=(
                            f"equity score {equity_factor.score:.0f} outweighs an otherwise "
                            f"favorable rating (weight x{multiplier:.0f})"
                        ),
                    )
                )

    # --- Rule: negative equity ceiling ---
    equity_ratio = inputs.ratios.get("equity_ratio")
    net_profit = inputs.ratios.get("net_profit")
    if equity_ratio is not None and equity_ratio <= 0:
        if rating <= config.negative_equity_ceiling:
            before = rating
            rating = _blend_toward(rating, config.negative_equity_ceiling)
            adjustments.append(
                Adjustment(
                    code="negative_equity",
                    rating_before=before,
                    rating_after=rating,
                    detail="equity is zero or negative",
                )
            )
        at_loss = net_profit is not None and net_profit <= 0
        if at_loss and rating <= config.negative_equity_loss_ceiling:
            before = rating
            rating = _blend_toward(rating, config.negative_equity_loss_ceiling)
            adjustments.append(
                Adjustment(
                    code="negative_equity_with_loss",
                    rating_before=before,
                    rating_after=rating,
                    detail="negative equity combined with a net loss",
                )
            )

    # --- Rule: new company floor (only ever worsens the rating) ---
    if (
        inputs.age_years is not None
        and inputs.age_years <= config.new_company_age_years
        and rating < config.new_company_floor
    ):
        before = rating
        rating = _blend_toward(rating, config.new_company_floor, target_parts=20)
        adjustments.append(
            Adjustment(
                code="new_company",
                rating_before=before,
                rating_after=rating,
                detail=f"company age {inputs.age_years:.1f}y - insufficient track record",
            )
        )

    # --- Rule: litigation pressure ---
    rating = _apply_court_rules(rating, company.court_cases, inputs, config, adjustments)

    # --- Rule: insufficient data floor ---
    low_coverage = coverage < config.insufficient_coverage_threshold
    if low_coverage and rating < config.insufficient_coverage_floor:
        before = rating
        rating = config.insufficient_coverage_floor
        adjustments.append(
            Adjustment(
                code="insufficient_data",
                rating_before=before,
                rating_after=rating,
                detail=f"only {coverage:.0%} of factor weight is backed by data",
            )
        )

    rating = min(100.0, max(1.0, rating))
    band = grade_for(rating)
    return RatingResult(
        score=round(rating, 1),
        grade=band.code,
        grade_label_key=band.label_key,
        factors=factors,
        adjustments=adjustments,
        data_coverage=round(coverage, 3),
        warnings=warnings,
    )


def _apply_court_rules(
    rating: float,
    court: CourtCasesSummary | None,
    inputs: FactorInputs,
    config: RatingConfig,
    adjustments: list[Adjustment],
) -> float:
    if court is None:
        return rating
    revenue = inputs.ratios.get("revenue")

    amount_trigger = (
        revenue is not None
        and revenue > 0
        and court.defendant_amount > revenue * config.court_defendant_amount_revenue_share
    )
    count_trigger = court.defendant_count > config.court_defendant_count_threshold

    if (amount_trigger or count_trigger) and rating <= config.court_floor:
        before = rating
        rating = _blend_toward(rating, config.court_floor)
        reason = (
            "defendant claims exceed half of annual revenue"
            if amount_trigger
            else f"more than {config.court_defendant_count_threshold} defendant cases"
        )
        adjustments.append(
            Adjustment(
                code="litigation_pressure",
                rating_before=before,
                rating_after=rating,
                detail=reason,
            )
        )
    return rating
