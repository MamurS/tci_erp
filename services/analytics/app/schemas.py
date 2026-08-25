"""Request/response models. Field names mirror the tci IFRS tables so the
frontend can POST Supabase rows with minimal reshaping."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TciBalanceSheet(BaseModel):
    property_plant_equipment: float | None = None
    intangible_assets: float | None = None
    goodwill: float | None = None
    investment_property: float | None = None
    long_term_investments: float | None = None
    deferred_tax_assets: float | None = None
    other_non_current_assets: float | None = None
    total_non_current_assets: float | None = None
    inventories: float | None = None
    trade_receivables: float | None = None
    other_receivables: float | None = None
    short_term_investments: float | None = None
    cash_and_equivalents: float | None = None
    other_current_assets: float | None = None
    total_current_assets: float | None = None
    total_assets: float | None = None
    share_capital: float | None = None
    retained_earnings: float | None = None
    other_reserves: float | None = None
    non_controlling_interests: float | None = None
    total_equity: float | None = None
    long_term_borrowings: float | None = None
    deferred_tax_liabilities: float | None = None
    long_term_provisions: float | None = None
    other_non_current_liabilities: float | None = None
    total_non_current_liabilities: float | None = None
    short_term_borrowings: float | None = None
    trade_payables: float | None = None
    other_payables: float | None = None
    current_tax_liabilities: float | None = None
    short_term_provisions: float | None = None
    other_current_liabilities: float | None = None
    total_current_liabilities: float | None = None
    total_liabilities: float | None = None
    total_equity_and_liabilities: float | None = None


class TciIncomeStatement(BaseModel):
    revenue: float | None = None
    cost_of_sales: float | None = None
    gross_profit: float | None = None
    distribution_expenses: float | None = None
    administrative_expenses: float | None = None
    other_operating_income: float | None = None
    other_operating_expenses: float | None = None
    operating_profit: float | None = None
    finance_income: float | None = None
    finance_costs: float | None = None
    other_non_operating: float | None = None
    profit_before_tax: float | None = None
    income_tax: float | None = None
    net_profit: float | None = None
    depreciation_amortization: float | None = None


class TciPeriod(BaseModel):
    fiscal_year: int
    statement_kind: Literal["annual", "quarterly"] = "annual"
    balance_sheet: TciBalanceSheet = Field(default_factory=TciBalanceSheet)
    income_statement: TciIncomeStatement = Field(default_factory=TciIncomeStatement)


class BuyerMeta(BaseModel):
    name: str | None = None
    country_code: str | None = None
    age_years: float | None = None


class StatementPayload(BaseModel):
    """Shared financial payload for both endpoints."""

    buyer: BuyerMeta = Field(default_factory=BuyerMeta)
    currency: str = "UZS"
    unit: Literal["units", "thousands", "millions"] = "units"
    exchange_rate_usd: float | None = Field(
        default=None,
        gt=0,
        description="Units of statement currency per 1 USD; default per currency.",
    )
    periods: list[TciPeriod] = Field(min_length=1)


class RatingComponent(BaseModel):
    factor: str
    value: float | None
    score: float | None
    weight: float
    status: str
    band: str | None


class RatingAdjustment(BaseModel):
    code: str
    detail: str
    rating_before: float
    rating_after: float


class RatingResponse(BaseModel):
    score: float | None
    grade: str | None
    grade_label_key: str | None
    data_coverage: float
    components: list[RatingComponent]
    adjustments: list[RatingAdjustment]
    warnings: list[str]
    engine_version: str


class CreditLimitRequest(StatementPayload):
    rating_score: float


class LimitModelTrace(BaseModel):
    model: str
    limit: float
    components: dict[str, float]
    reasons: list[str]


class CreditLimitResponse(BaseModel):
    suggested_limit: float
    currency: str
    model_used: str
    trace: list[LimitModelTrace]
    reasons: list[str]
    engine_version: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    engine_version: str


class GradeBandOut(BaseModel):
    code: str
    label_key: str
    lower: float
    upper: float
    risk_coefficient: float
