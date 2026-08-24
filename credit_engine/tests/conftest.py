"""Shared fixtures: realistic company profiles."""

from __future__ import annotations

import pytest

from credit_engine.models import CompanyFinancials, FinancialPeriod


def make_period(year: int, **overrides: float | None) -> FinancialPeriod:
    """A healthy mid-size trading company, statement currency = USD."""
    base: dict[str, float] = {
        "total_assets": 50_000_000,
        "non_current_assets": 20_000_000,
        "intangible_assets": 1_000_000,
        "inventories": 8_000_000,
        "accounts_receivable": 10_000_000,
        "cash": 5_000_000,
        "current_assets": 30_000_000,
        "equity": 25_000_000,
        "long_term_debt": 10_000_000,
        "short_term_debt": 5_000_000,
        "accounts_payable": 6_000_000,
        "current_liabilities": 15_000_000,
        "revenue": 80_000_000,
        "cost_of_sales": -60_000_000,
        "commercial_expenses": -4_000_000,
        "administrative_expenses": -3_000_000,
        "operating_profit": 13_000_000,
        "interest_income": 100_000,
        "interest_expenses": -1_500_000,
        "profit_before_tax": 11_600_000,
        "net_profit": 9_000_000,
    }
    base.update(overrides)
    return FinancialPeriod(year=year, **base)


@pytest.fixture
def healthy_company() -> CompanyFinancials:
    """Growing, profitable, moderately leveraged company."""
    return CompanyFinancials(
        name="Healthy Trade LLC",
        country="UZ",
        age_years=12.0,
        currency="USD",
        exchange_rate_usd=1.0,
        periods=[
            make_period(2023, revenue=65_000_000, net_profit=6_000_000, total_assets=42_000_000),
            make_period(2024, revenue=72_000_000, net_profit=7_500_000, total_assets=46_000_000),
            make_period(2025),
        ],
    )


@pytest.fixture
def distressed_company() -> CompanyFinancials:
    """Negative equity, loss-making, collapsing revenue."""
    return CompanyFinancials(
        name="Distressed JSC",
        country="UZ",
        age_years=9.0,
        currency="USD",
        exchange_rate_usd=1.0,
        periods=[
            make_period(2024),
            make_period(
                2025,
                revenue=30_000_000,  # -62.5% collapse
                net_profit=-5_000_000,
                profit_before_tax=-5_500_000,
                operating_profit=-4_000_000,
                equity=-2_000_000,
                total_assets=35_000_000,
            ),
        ],
    )
