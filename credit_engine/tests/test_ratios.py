"""Ratio and dynamics calculation tests."""

from __future__ import annotations

import pytest

from credit_engine.models import FinancialPeriod, PeriodType
from credit_engine.ratios import build_ratio_reports, compute_dynamic, compute_period_ratios
from tests.conftest import make_period


class TestPeriodRatios:
    def test_core_ratios(self) -> None:
        r = compute_period_ratios(make_period(2025))
        assert r["gross_debt"] == 15_000_000
        assert r["equity_ratio"] == pytest.approx(0.5)
        assert r["current_ratio"] == pytest.approx(2.0)
        assert r["debt_to_equity"] == pytest.approx(0.6)
        assert r["debt_to_assets"] == pytest.approx(0.3)
        assert r["net_profitability"] == pytest.approx(9 / 80)
        assert r["net_working_capital"] == 15_000_000

    def test_ebit_from_pbt_and_interest(self) -> None:
        r = compute_period_ratios(make_period(2025))
        # EBIT = PBT + |interest expense| - |interest income|
        assert r["ebit"] == pytest.approx(11_600_000 + 1_500_000 - 100_000)
        assert r["interest_coverage"] == pytest.approx(13_000_000 / 1_500_000)

    def test_ebit_falls_back_to_operating_profit(self) -> None:
        r = compute_period_ratios(make_period(2025, profit_before_tax=None))
        assert r["ebit"] == 13_000_000

    def test_missing_interest_income_treated_as_zero(self) -> None:
        r = compute_period_ratios(make_period(2025, interest_income=None))
        assert r["ebit"] == pytest.approx(11_600_000 + 1_500_000)
        assert r["interest_coverage"] is not None

    def test_gross_profit_derived_from_revenue_and_cogs(self) -> None:
        r = compute_period_ratios(make_period(2025, gross_profit=None))
        assert r["gross_profit"] == pytest.approx(20_000_000)
        assert r["gross_margin"] == pytest.approx(0.25)

    def test_working_capital_cycle(self) -> None:
        r = compute_period_ratios(make_period(2025))
        assert r["days_inventory_outstanding"] == pytest.approx(8 / 60 * 365)
        assert r["days_sales_outstanding"] == pytest.approx(10 / 80 * 365)
        assert r["days_payable_outstanding"] == pytest.approx(6 / 60 * 365)
        assert r["cash_conversion_cycle"] == pytest.approx(
            r["days_inventory_outstanding"]
            + r["days_sales_outstanding"]
            - r["days_payable_outstanding"]
        )

    def test_quarterly_period_uses_90_days(self) -> None:
        r = compute_period_ratios(
            make_period(2025).model_copy(update={"period_type": PeriodType.QUARTERLY})
        )
        assert r["days_sales_outstanding"] == pytest.approx(10 / 80 * 90)


class TestNoneSafety:
    def test_zero_denominator_yields_none_not_inf(self) -> None:
        r = compute_period_ratios(make_period(2025, current_liabilities=0))
        assert r["current_ratio"] is None

    def test_missing_inputs_yield_none(self) -> None:
        empty = FinancialPeriod(year=2025)
        r = compute_period_ratios(empty)
        assert r["equity_ratio"] is None
        assert r["interest_coverage"] is None
        assert r["cash_conversion_cycle"] is None
        assert r["gross_debt"] is None

    def test_partial_debt_still_sums(self) -> None:
        r = compute_period_ratios(make_period(2025, long_term_debt=None))
        assert r["gross_debt"] == 5_000_000


class TestDynamics:
    def test_growth(self) -> None:
        assert compute_dynamic(120, 100) == pytest.approx(0.2)

    def test_decline_with_negative_previous_uses_abs(self) -> None:
        # from -100 to -50 is an improvement of +50%
        assert compute_dynamic(-50, -100) == pytest.approx(0.5)

    def test_none_on_zero_previous(self) -> None:
        assert compute_dynamic(100, 0) is None
        assert compute_dynamic(None, 100) is None

    def test_reports_have_dynamics_from_second_period(self, healthy_company) -> None:  # type: ignore[no-untyped-def]
        reports = build_ratio_reports(healthy_company)
        assert reports[0].dynamics == {}
        assert reports[-1].dynamics["revenue"] == pytest.approx((80 - 72) / 72)
