"""Calibrated scoring tables and weights of the rating model.

These values are the domain knowledge inherited from the legacy Fineye
grade calculator (grade_calculator.py:40-253) and preserved verbatim.
Scale: 1..100, LOWER IS BETTER.

Each table is an ordered sequence of (inclusive_upper_bound, score, band_key)
rows; the score of a value is the first row whose bound >= value. The last
row bound is +inf, so every value maps to something.
"""

from __future__ import annotations

from dataclasses import dataclass, field

INF = float("inf")

Row = tuple[float, float, str]


@dataclass(frozen=True)
class ScoreTable:
    factor: str
    rows: tuple[Row, ...]

    def score(self, value: float) -> tuple[float, str]:
        for bound, score, band in self.rows:
            if value <= bound:
                return score, band
        last = self.rows[-1]
        return last[1], last[2]


NET_PROFITABILITY = ScoreTable(
    "net_profitability",
    (
        (-0.1, 99, "deep_loss"),
        (-0.05, 90, "significant_loss"),
        (-0.01, 79, "loss"),
        (0.0, 69, "breakeven"),
        (0.025, 59, "very_low"),
        (0.05, 49, "low"),
        (0.1, 44, "moderate"),
        (0.15, 39, "good"),
        (0.3, 29, "high"),
        (INF, 19, "very_high"),
    ),
)

EQUITY_RATIO = ScoreTable(
    "equity_ratio",
    (
        (0.0, 97, "negative"),
        (0.02, 89, "critical"),
        (0.1, 84, "very_low"),
        (0.15, 79, "low"),
        (0.30, 74, "below_average"),
        (0.40, 64, "moderate"),
        (0.55, 54, "acceptable"),
        (0.65, 44, "good"),
        (0.75, 34, "high"),
        (0.80, 24, "very_high"),
        (INF, 14, "excellent"),
    ),
)

CURRENT_RATIO = ScoreTable(
    "current_ratio",
    (
        (0.0, 84, "negative"),
        (0.5, 74, "critical"),
        (1.0, 64, "low"),
        (2.0, 54, "adequate"),
        (INF, 40, "high"),
    ),
)

INTEREST_COVERAGE = ScoreTable(
    "interest_coverage",
    (
        (0.0, 99, "negative"),
        (0.5, 89, "critical"),
        (1.0, 79, "insufficient"),
        (2.0, 69, "low"),
        (3.0, 59, "moderate"),
        (4.0, 49, "adequate"),
        (6.0, 30, "high"),
        (INF, 17, "very_high"),
    ),
)

INTEREST_COVERAGE_DYNAMIC = ScoreTable(
    "interest_coverage_dynamic",
    (
        (-1e-9, 60, "deteriorating"),
        (1e-9, 50, "stable"),
        (INF, 40, "improving"),
    ),
)

TOTAL_ASSETS_DYNAMIC = ScoreTable(
    "total_assets_dynamic",
    (
        (-0.99, 99, "collapse"),
        (-0.50, 90, "severe_decline"),
        (-0.30, 80, "strong_decline"),
        (0.0, 70, "decline"),
        (INF, 50, "growth"),
    ),
)

DEBT_TO_ASSETS = ScoreTable(
    "debt_to_assets",
    (
        (0.0, 25, "no_debt"),
        (0.1, 29, "very_low"),
        (0.3, 39, "low"),
        (0.4, 49, "moderate"),
        (0.5, 58, "elevated"),
        (0.6, 69, "high"),
        (0.7, 78, "very_high"),
        (0.9, 87, "critical"),
        (INF, 95, "extreme"),
    ),
)

# Legacy override: when total assets have collapsed by more than 50%,
# low leverage is no longer reassuring - all low-leverage bands score 74.
DEBT_TO_ASSETS_ASSET_COLLAPSE = ScoreTable(
    "debt_to_assets",
    (
        (0.0, 74, "no_debt"),
        (0.1, 74, "very_low"),
        (0.3, 74, "low"),
        (0.4, 74, "moderate"),
        (0.5, 74, "elevated"),
        (0.6, 74, "high"),
        (0.7, 78, "very_high"),
        (0.9, 87, "critical"),
        (INF, 95, "extreme"),
    ),
)

DEBT_TO_EQUITY = ScoreTable(
    "debt_to_equity",
    (
        (0.0, 24, "negative_or_zero"),
        (1e-6, 27, "minimal"),
        (0.25, 29, "very_low"),
        (0.5, 39, "low"),
        (1.0, 49, "moderate"),
        (2.0, 59, "elevated"),
        (2.4, 69, "high"),
        (3.0, 79, "very_high"),
        (4.0, 89, "critical"),
        (5.0, 94, "extreme"),
        (INF, 99, "extreme"),
    ),
)

# Legacy conditional: strong interest coverage (>6x) softens leverage bands.
DEBT_TO_EQUITY_STRONG_ICR = ScoreTable(
    "debt_to_equity",
    (
        (0.0, 24, "negative_or_zero"),
        (1e-6, 27, "minimal"),
        (0.25, 29, "very_low"),
        (0.5, 39, "low"),
        (1.0, 49, "moderate"),
        (2.0, 47, "elevated"),
        (2.4, 57, "high"),
        (3.0, 67, "very_high"),
        (4.0, 77, "critical"),
        (5.0, 87, "extreme"),
        (INF, 99, "extreme"),
    ),
)

CASH_CONVERSION_CYCLE = ScoreTable(
    "cash_conversion_cycle",
    (
        (0.0, 19, "negative"),
        (10.0, 29, "very_short"),
        (30.0, 39, "short"),
        (60.0, 49, "average"),
        (90.0, 59, "extended"),
        (120.0, 69, "long"),
        (150.0, 79, "very_long"),
        (INF, 88, "extreme"),
    ),
)

#: Revenue is assessed in USD.
REVENUE_USD = ScoreTable(
    "revenue_usd",
    (
        (0.0, 90, "none"),
        (100_000.0, 84, "micro"),
        (1_000_000.0, 80, "very_small"),
        (10_000_000.0, 74, "small"),
        (30_000_000.0, 64, "lower_mid"),
        (70_000_000.0, 54, "mid"),
        (100_000_000.0, 44, "upper_mid"),
        (250_000_000.0, 39, "large"),
        (500_000_000.0, 34, "very_large"),
        (1_000_000_000.0, 24, "major"),
        (10_000_000_000.0, 14, "corporation"),
        (INF, 10, "global"),
    ),
)

REVENUE_DYNAMIC = ScoreTable(
    "revenue_dynamic",
    (
        (-0.50, 96, "collapse"),
        (-0.3, 90, "severe_drop"),
        (-0.1, 79, "drop"),
        (-0.02, 69, "mild_drop"),
        (0.02, 59, "stagnation"),
        (0.1, 49, "modest_growth"),
        (0.2, 39, "growth"),
        (0.4, 27, "strong_growth"),
        (0.5, 17, "very_strong_growth"),
        (INF, 10, "exceptional_growth"),
    ),
)

DEBT_TO_EBIT = ScoreTable(
    "debt_to_ebit",
    (
        (0.0, 24, "negative_or_zero"),
        (0.5, 39, "very_low"),
        (2.0, 49, "low"),
        (3.0, 59, "moderate"),
        (4.0, 69, "acceptable"),
        (6.0, 79, "high"),
        (7.0, 89, "very_high"),
        (INF, 95, "extreme"),
    ),
)

AGE_YEARS = ScoreTable(
    "age_years",
    (
        (0.0, 69, "not_started"),
        (1.0, 60, "startup"),
        (3.0, 49, "young"),
        (8.0, 39, "established"),
        (20.0, 29, "mature"),
        (INF, 19, "veteran"),
    ),
)


#: Base weights, inherited from the legacy `ml` vector [7,8,1,3,3,6,2,2,2,3,1,4,5].
#: Unlike the legacy list-duplication trick, these are honest weights in a
#: weighted average. `total_assets_dynamic` (weight 3) was scored but silently
#: dropped from the legacy sum - here it participates as designed.
BASE_WEIGHTS: dict[str, float] = {
    "net_profitability": 7,
    "equity_ratio": 8,
    "debt_to_assets": 1,
    "total_assets_dynamic": 3,
    "current_ratio": 3,
    "interest_coverage": 6,
    "interest_coverage_dynamic": 2,
    "debt_to_equity": 2,
    "cash_conversion_cycle": 2,
    "revenue_usd": 3,
    "age_years": 1,
    "debt_to_ebit": 4,
    "revenue_dynamic": 5,
}

#: Factors whose absence is penalized instead of ignored: without these a
#: credit view is fundamentally incomplete.
CORE_FACTORS: frozenset[str] = frozenset(
    {"net_profitability", "equity_ratio", "debt_to_assets", "current_ratio", "revenue_usd"}
)


@dataclass(frozen=True)
class RatingConfig:
    """Tunable parameters of the rating model."""

    weights: dict[str, float] = field(default_factory=lambda: dict(BASE_WEIGHTS))
    missing_core_score: float = 90.0
    insufficient_coverage_threshold: float = 0.5
    insufficient_coverage_floor: float = 70.0
    new_company_age_years: float = 1.5
    new_company_floor: float = 74.0
    negative_equity_ceiling: float = 74.0
    negative_equity_loss_ceiling: float = 84.0
    court_defendant_amount_revenue_share: float = 0.5
    court_defendant_count_threshold: int = 50
    court_floor: float = 74.0
    low_interest_rate_threshold: float = 0.01
    revenue_collapse_extra_weight: float = 50.0


@dataclass(frozen=True)
class GradeBandDef:
    code: str
    label_key: str
    upper: float  # inclusive
    risk_coefficient: float


#: Grade bands aligned with the Basel-style risk-coefficient table of the
#: legacy credit limit calculator.
GRADE_BANDS: tuple[GradeBandDef, ...] = (
    GradeBandDef("A1", "grade.excellent", 10, 1.5),
    GradeBandDef("A2", "grade.very_good", 25, 1.2),
    GradeBandDef("B1", "grade.good", 40, 1.0),
    GradeBandDef("B2", "grade.acceptable", 55, 0.7),
    GradeBandDef("C1", "grade.weak", 65, 0.4),
    GradeBandDef("C2", "grade.very_weak", 75, 0.15),
    GradeBandDef("D", "grade.unacceptable", 100, 0.0),
)


def grade_for(score: float) -> GradeBandDef:
    for band in GRADE_BANDS:
        if score <= band.upper:
            return band
    return GRADE_BANDS[-1]
