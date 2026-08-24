"""Rating model tests: tables, weighting, adjustments, missing-data policy."""

from __future__ import annotations

import pytest

from credit_engine.models import CompanyFinancials, CourtCasesSummary, FactorStatus
from credit_engine.ratios import build_ratio_reports
from credit_engine.scoring.calculator import FactorInputs, calculate_rating
from credit_engine.scoring.tables import (
    CURRENT_RATIO,
    EQUITY_RATIO,
    NET_PROFITABILITY,
    RatingConfig,
    grade_for,
)
from tests.conftest import make_period


def inputs_for(company: CompanyFinancials) -> FactorInputs:
    reports = build_ratio_reports(company)
    latest = reports[-1]
    return FactorInputs(
        ratios=latest.ratios,
        dynamics=latest.dynamics,
        age_years=company.age_years,
        exchange_rate_usd=company.exchange_rate_usd,
    )


class TestScoreTables:
    def test_thresholds_are_inclusive_upper_bounds(self) -> None:
        assert EQUITY_RATIO.score(0.0) == (97, "negative")
        assert EQUITY_RATIO.score(0.30) == (74, "below_average")
        assert EQUITY_RATIO.score(0.31) == (64, "moderate")
        assert EQUITY_RATIO.score(0.9) == (14, "excellent")

    def test_negative_values_hit_first_band(self) -> None:
        assert NET_PROFITABILITY.score(-0.5) == (99, "deep_loss")
        assert CURRENT_RATIO.score(-1.0) == (84, "negative")

    def test_grade_bands(self) -> None:
        assert grade_for(5).code == "A1"
        assert grade_for(25).code == "A2"
        assert grade_for(40.5).code == "B2"
        assert grade_for(76).code == "D"
        assert grade_for(76).risk_coefficient == 0.0


class TestHealthyCompany:
    def test_gets_a_good_rating(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        rating = calculate_rating(healthy_company, inputs_for(healthy_company))
        assert rating.score is not None
        assert rating.score < 45  # solid company scores well
        assert rating.grade in ("A2", "B1", "B2")
        assert rating.data_coverage == 1.0
        assert not rating.adjustments

    def test_factors_are_fully_explained(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        rating = calculate_rating(healthy_company, inputs_for(healthy_company))
        assert len(rating.factors) == 13
        scored = [f for f in rating.factors if f.status == FactorStatus.SCORED]
        assert len(scored) == 13
        assert all(f.band_label for f in scored)


class TestDistressedCompany:
    def test_rating_is_bad(self, distressed_company) -> None:  # type: ignore[no-untyped-def]
        rating = calculate_rating(distressed_company, inputs_for(distressed_company))
        assert rating.score is not None
        assert rating.score > 75
        assert rating.grade == "D"

    def test_negative_equity_caps_an_otherwise_good_rating(self) -> None:
        # Profitable and liquid, but equity slipped below zero: the ceiling
        # rules must prevent a good rating.
        company = CompanyFinancials(
            age_years=10,
            currency="USD",
            periods=[make_period(2024), make_period(2025, equity=-100_000)],
        )
        rating = calculate_rating(company, inputs_for(company))
        assert rating.score is not None
        assert rating.score > 65  # without the cap this profile scores ~55
        codes = {a.code for a in rating.adjustments}
        assert codes & {"negative_equity", "negative_equity_with_loss", "weak_equity_dominance"}

    def test_revenue_collapse_dominates_weights(self, distressed_company) -> None:  # type: ignore[no-untyped-def]
        rating = calculate_rating(distressed_company, inputs_for(distressed_company))
        rev_dyn = next(f for f in rating.factors if f.factor == "revenue_dynamic")
        # base 5 + loss adjustment 3 + collapse extra 50
        assert rev_dyn.weight == 58
        assert rev_dyn.score == 96  # collapse band


class TestAdjustmentRules:
    def test_new_company_floor_only_worsens(self) -> None:
        young = CompanyFinancials(
            age_years=0.8,
            currency="USD",
            periods=[make_period(2025)],
        )
        rating = calculate_rating(young, inputs_for(young))
        assert rating.score is not None
        assert rating.score >= 70  # pulled to ~74 despite great financials
        assert any(a.code == "new_company" for a in rating.adjustments)

    def test_new_company_rule_does_not_improve_bad_rating(self) -> None:
        young_and_bad = CompanyFinancials(
            age_years=0.8,
            currency="USD",
            periods=[
                make_period(
                    2025,
                    equity=-1_000_000,
                    net_profit=-3_000_000,
                    profit_before_tax=-3_200_000,
                    operating_profit=-2_500_000,
                )
            ],
        )
        rating = calculate_rating(young_and_bad, inputs_for(young_and_bad))
        assert rating.score is not None
        assert rating.score > 74  # stays bad; the floor never improves
        assert not any(a.code == "new_company" for a in rating.adjustments)

    def test_litigation_pressure_uses_own_revenue(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        sued = healthy_company.model_copy(
            update={
                "court_cases": CourtCasesSummary(
                    defendant_count=3,
                    defendant_amount=45_000_000,  # > 50% of 80M revenue
                )
            }
        )
        base = calculate_rating(healthy_company, inputs_for(healthy_company))
        adjusted = calculate_rating(sued, inputs_for(sued))
        assert adjusted.score is not None and base.score is not None
        assert adjusted.score > base.score
        assert any(a.code == "litigation_pressure" for a in adjusted.adjustments)

    def test_small_litigation_ignored(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        sued = healthy_company.model_copy(
            update={
                "court_cases": CourtCasesSummary(defendant_count=2, defendant_amount=100_000)
            }
        )
        rating = calculate_rating(sued, inputs_for(sued))
        assert not any(a.code == "litigation_pressure" for a in rating.adjustments)

    def test_low_interest_debt_relief(self) -> None:
        # Heavy debt but almost no interest paid -> leverage weight halved.
        company = CompanyFinancials(
            age_years=10,
            currency="USD",
            periods=[
                make_period(
                    2025,
                    long_term_debt=40_000_000,
                    short_term_debt=20_000_000,
                    interest_expenses=-100_000,  # implied rate ~0.17%
                )
            ],
        )
        rating = calculate_rating(company, inputs_for(company))
        d2e = next(f for f in rating.factors if f.factor == "debt_to_equity")
        assert d2e.weight == pytest.approx(1.0)  # base 2 halved


class TestMissingDataPolicy:
    def test_core_factor_missing_is_penalized(self) -> None:
        company = CompanyFinancials(
            age_years=10,
            currency="USD",
            periods=[make_period(2025, revenue=None)],
        )
        rating = calculate_rating(company, inputs_for(company))
        rev = next(f for f in rating.factors if f.factor == "revenue_usd")
        assert rev.status == FactorStatus.MISSING_PENALIZED
        assert rev.score == 90.0

    def test_secondary_factor_missing_is_excluded(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        single_period = healthy_company.model_copy(
            update={"periods": [healthy_company.sorted_periods()[-1]]}
        )
        rating = calculate_rating(single_period, inputs_for(single_period))
        rev_dyn = next(f for f in rating.factors if f.factor == "revenue_dynamic")
        assert rev_dyn.status == FactorStatus.EXCLUDED
        assert rating.data_coverage < 1.0

    def test_empty_statements_floor_the_rating(self) -> None:
        from credit_engine.models import FinancialPeriod

        empty = CompanyFinancials(
            age_years=None,
            currency="USD",
            periods=[FinancialPeriod(year=2025)],
        )
        rating = calculate_rating(empty, inputs_for(empty))
        assert rating.score is not None
        assert rating.score >= 70
        assert any(a.code == "insufficient_data" for a in rating.adjustments) or (
            rating.score >= 85
        )

    def test_config_is_tunable(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        config = RatingConfig(weights={"equity_ratio": 1.0})
        rating = calculate_rating(healthy_company, inputs_for(healthy_company), config)
        assert len(rating.factors) == 1
        assert rating.factors[0].factor == "equity_ratio"
