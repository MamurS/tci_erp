"""Credit engine: rating, credit limit and financial analysis for TCI ERP.

Pure domain library - no I/O, no database, no HTTP. See README.md for the
model methodology.
"""

from credit_engine.assessment import assess
from credit_engine.limits import LimitConfig, round_limit
from credit_engine.models import (
    CompanyFinancials,
    CourtCasesSummary,
    CreditAssessment,
    FinancialPeriod,
    PeriodType,
)
from credit_engine.ratios import build_ratio_reports, compute_period_ratios
from credit_engine.scoring.tables import GRADE_BANDS, RatingConfig, grade_for

__all__ = [
    "GRADE_BANDS",
    "CompanyFinancials",
    "CourtCasesSummary",
    "CreditAssessment",
    "FinancialPeriod",
    "LimitConfig",
    "PeriodType",
    "RatingConfig",
    "assess",
    "build_ratio_reports",
    "compute_period_ratios",
    "grade_for",
    "round_limit",
]

__version__ = "0.1.0"
