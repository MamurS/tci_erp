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
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
# Risk context: sector grade and country risk category (optional input)
# ---------------------------------------------------------------------------
#
# After Allianz Trade practice the grade the financials earn is moved by the
# buyer's SECTOR GRADE and the COUNTRY RISK CATEGORY it trades from. The
# caller (TCI ERP) owns both facts and the admin-configured adjustment table
# (tci.risk_adjustment_settings) and passes them in; the engine only applies
# them - see credit_engine.risk_context.

SectorGrade = Literal["A", "B", "C", "D"]
SECTOR_GRADES: tuple[str, ...] = ("A", "B", "C", "D")
#: OECD country risk classification, 0 (lowest risk) .. 7 (highest).
COUNTRY_CATEGORIES: tuple[int, ...] = tuple(range(8))
#: Key of the adjustment row for a country nobody has classified. It is NOT
#: category 0 and must never be treated as such.
UNCLASSIFIED_COUNTRY_KEY = "unclassified"
COUNTRY_KEYS: tuple[str, ...] = (*(str(c) for c in COUNTRY_CATEGORIES), UNCLASSIFIED_COUNTRY_KEY)


def _grade_codes() -> tuple[str, ...]:
    # Imported lazily: credit_engine.scoring imports this module.
    from credit_engine.scoring.tables import GRADE_BANDS

    return tuple(band.code for band in GRADE_BANDS)


class RiskAdjustmentRule(BaseModel):
    """One row of the adjustment table: a notch (positive = a BETTER grade,
    in steps of the engine's grade scale) and an optional cap - the best
    grade a buyer under this rule can hold."""

    model_config = ConfigDict(frozen=True)

    notch: int = 0
    cap_grade: str | None = None

    @field_validator("cap_grade")
    @classmethod
    def _known_grade(cls, value: str | None) -> str | None:
        if value is not None and value not in _grade_codes():
            raise ValueError(f"unknown grade {value!r}; expected one of {_grade_codes()}")
        return value


class RiskAdjustmentTable(BaseModel):
    """The adjustment table in force, keyed by sector grade and by country
    category (as a string, "0".."7") or "unclassified". A missing key means
    no notch and no cap."""

    model_config = ConfigDict(frozen=True)

    sector: dict[str, RiskAdjustmentRule] = Field(default_factory=dict)
    country: dict[str, RiskAdjustmentRule] = Field(default_factory=dict)

    @field_validator("sector")
    @classmethod
    def _sector_keys(cls, value: dict[str, RiskAdjustmentRule]) -> dict[str, RiskAdjustmentRule]:
        unknown = sorted(set(value) - set(SECTOR_GRADES))
        if unknown:
            raise ValueError(f"unknown sector grade key(s) {unknown}; expected {SECTOR_GRADES}")
        return value

    @field_validator("country")
    @classmethod
    def _country_keys(cls, value: dict[str, RiskAdjustmentRule]) -> dict[str, RiskAdjustmentRule]:
        unknown = sorted(set(value) - set(COUNTRY_KEYS))
        if unknown:
            raise ValueError(f"unknown country key(s) {unknown}; expected {COUNTRY_KEYS}")
        return value


class RiskContext(BaseModel):
    """What the grade rests on besides the financials.

    ``country_classified = False`` means "not classified", which is distinct
    from category 0: the category must then be null, and the
    ``"unclassified"`` row of the table applies. When ``country_classified``
    is omitted it follows from whether a category is given.
    """

    model_config = ConfigDict(frozen=True)

    sector_grade: SectorGrade | None = None
    country_category: Annotated[int, Field(ge=0, le=7)] | None = None
    country_classified: bool = False
    country_source: Literal["oecd", "internal"] | None = None
    adjustments: RiskAdjustmentTable = Field(default_factory=RiskAdjustmentTable)

    @model_validator(mode="before")
    @classmethod
    def _infer_classified(cls, data: Any) -> Any:
        if isinstance(data, dict) and data.get("country_classified") is None:
            return {**data, "country_classified": data.get("country_category") is not None}
        return data

    @model_validator(mode="after")
    def _classified_matches_category(self) -> RiskContext:
        if self.country_classified and self.country_category is None:
            raise ValueError("country_classified is true but country_category is null")
        if not self.country_classified and self.country_category is not None:
            raise ValueError(
                "country_category is given but country_classified is false - "
                "an unclassified country has no category (it is not category 0)"
            )
        return self

    @property
    def country_key(self) -> str:
        """The table key of the country row: "0".."7" or "unclassified"."""
        if self.country_classified and self.country_category is not None:
            return str(self.country_category)
        return UNCLASSIFIED_COUNTRY_KEY


class SectorAdjustmentLine(BaseModel):
    """Trace line: the sector grade's notch (present whenever a sector grade
    is given - a zero notch reads "sector B, no change")."""

    code: Literal["sector_adjustment"] = "sector_adjustment"
    sector_grade: SectorGrade
    notch: int
    cap_grade: str | None
    from_grade: str
    to_grade: str


class CountryAdjustmentLine(BaseModel):
    """Trace line: the country category's notch (always present with a risk
    context; an unclassified country has ``country_category = null`` and
    ``country_key = "unclassified"``)."""

    code: Literal["country_adjustment"] = "country_adjustment"
    country_category: int | None
    country_key: str
    country_classified: bool
    country_source: Literal["oecd", "internal"] | None
    notch: int
    cap_grade: str | None
    from_grade: str
    to_grade: str


class GradeCapLine(BaseModel):
    """Trace line: a cap that BIT - the notched grade was better than the
    worst applicable cap and was lowered to it."""

    code: Literal["grade_cap"] = "grade_cap"
    cap_grade: str
    cap_sources: list[Literal["sector", "country"]]
    from_grade: str
    to_grade: str


RiskAdjustmentLine = Annotated[
    SectorAdjustmentLine | CountryAdjustmentLine | GradeCapLine,
    Field(discriminator="code"),
]


def _is_none(value: object) -> bool:
    return value is None


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
    """``score`` is always the score the financials earned. ``grade`` is the
    grade IN FORCE: with a risk context it is the grade after the sector and
    country adjustments, and the four risk fields below say how it got there.
    Without a risk context those fields are absent from the serialized output
    (not null), so it is exactly what it was before risk contexts existed."""

    score: float | None
    grade: str | None
    grade_label_key: str | None
    factors: list[FactorScore]
    adjustments: list[Adjustment]
    data_coverage: float
    warnings: list[str]
    #: The grade the score maps to, before the risk context.
    base_grade: str | None = Field(default=None, exclude_if=_is_none)
    #: The score placed inside ``grade``'s band (same relative position the
    #: score held in the base band); the credit limit is computed on it.
    effective_score: float | None = Field(default=None, exclude_if=_is_none)
    #: The risk context the grade rests on, echoed as used.
    risk_context: RiskContext | None = Field(default=None, exclude_if=_is_none)
    risk_adjustments: list[RiskAdjustmentLine] | None = Field(default=None, exclude_if=_is_none)


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
