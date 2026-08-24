"""Input and output data models of the credit engine.

The engine is a pure domain library: callers construct `CompanyFinancials`
from any source (TCI ERP database, manual input, external APIs) and receive
a fully structured `CreditAssessment`. No I/O happens inside the engine.

Conventions
-----------
* All monetary inputs are in the statement currency of the period.
* ``exchange_rate_usd`` is "units of statement currency per 1 USD".
* The rating scale is 1..100 where LOWER IS BETTER (kept from the legacy
  Fineye model so that all calibrated threshold tables remain valid).
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class PeriodType(StrEnum):
    ANNUAL = "annual"
    SEMI_ANNUAL = "semi_annual"
    NINE_MONTH = "nine_month"
    QUARTERLY = "quarterly"


PERIOD_DAYS: dict[PeriodType, int] = {
    PeriodType.ANNUAL: 365,
    PeriodType.SEMI_ANNUAL: 182,
    PeriodType.NINE_MONTH: 273,
    PeriodType.QUARTERLY: 90,
}


class FinancialPeriod(BaseModel):
    """One reporting period of canonical financial data.

    Any field may be ``None`` — the engine has an explicit missing-data
    policy instead of silently guessing.
    """

    model_config = ConfigDict(frozen=True)

    year: int
    period_type: PeriodType = PeriodType.ANNUAL

    # --- balance sheet ---
    total_assets: float | None = None
    non_current_assets: float | None = None
    intangible_assets: float | None = None
    inventories: float | None = None
    accounts_receivable: float | None = None
    cash: float | None = None
    current_assets: float | None = None
    equity: float | None = None
    long_term_debt: float | None = None
    short_term_debt: float | None = None
    accounts_payable: float | None = None
    current_liabilities: float | None = None

    # --- income statement ---
    revenue: float | None = None
    cost_of_sales: float | None = None
    gross_profit: float | None = None
    commercial_expenses: float | None = None
    administrative_expenses: float | None = None
    operating_profit: float | None = None
    interest_income: float | None = None
    interest_expenses: float | None = None
    profit_before_tax: float | None = None
    net_profit: float | None = None

    # --- cash flow (optional) ---
    operating_cash_flow: float | None = None
    capital_expenditures: float | None = None


class CourtCasesSummary(BaseModel):
    """Aggregated litigation exposure for the assessed company."""

    model_config = ConfigDict(frozen=True)

    defendant_count: int = 0
    defendant_amount: float = 0.0
    plaintiff_count: int = 0
    plaintiff_amount: float = 0.0


class CompanyFinancials(BaseModel):
    """Everything the engine needs to assess one company."""

    model_config = ConfigDict(frozen=True)

    name: str | None = None
    country: str | None = None
    industry: str | None = None
    age_years: float | None = None
    currency: str = "USD"
    exchange_rate_usd: float = Field(default=1.0, gt=0)
    periods: list[FinancialPeriod] = Field(min_length=1)
    court_cases: CourtCasesSummary | None = None

    def sorted_periods(self) -> list[FinancialPeriod]:
        return sorted(self.periods, key=lambda p: p.year)


# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------


class FactorStatus(StrEnum):
    SCORED = "scored"
    MISSING_PENALIZED = "missing_penalized"
    EXCLUDED = "excluded"


class FactorScore(BaseModel):
    """Score of a single rating factor with full explainability."""

    factor: str
    value: float | None
    score: float | None
    weight: float
    status: FactorStatus
    band_label: str | None = None
    note: str | None = None

    @property
    def is_scored(self) -> bool:
        return self.status != FactorStatus.EXCLUDED and self.score is not None


class Adjustment(BaseModel):
    """A named post-processing rule that changed the rating."""

    code: str
    rating_before: float
    rating_after: float
    detail: str


class GradeBand(BaseModel):
    code: str
    label_key: str
    lower: float  # exclusive
    upper: float  # inclusive
    risk_coefficient: float


class RatingResult(BaseModel):
    score: float | None
    grade: str | None
    grade_label_key: str | None
    factors: list[FactorScore]
    adjustments: list[Adjustment]
    data_coverage: float
    warnings: list[str]


class LimitModelResult(BaseModel):
    model: str
    limit: float
    currency: str
    components: dict[str, float]
    reasons: list[str]


class LimitResult(BaseModel):
    recommended_limit: float
    currency: str
    model_used: str
    models: list[LimitModelResult]
    reasons: list[str]


class Severity(StrEnum):
    STRENGTH = "strength"
    NEUTRAL = "neutral"
    WEAKNESS = "weakness"
    CRITICAL = "critical"
    INFO = "info"


class Finding(BaseModel):
    """A structured, language-independent analytical observation."""

    code: str
    section: str
    severity: Severity
    params: dict[str, str | float | int | None] = Field(default_factory=dict)


class RatioReport(BaseModel):
    """All computed ratios for one period plus dynamics vs previous period."""

    year: int
    ratios: dict[str, float | None]
    dynamics: dict[str, float | None]


class CreditAssessment(BaseModel):
    """Final result of the engine."""

    company_name: str | None
    assessed_year: int
    currency: str
    rating: RatingResult
    limit: LimitResult
    ratio_reports: list[RatioReport]
    findings: list[Finding]
    commentary: dict[str, str]
    language: str
