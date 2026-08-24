"""Message catalog for the deterministic English commentary draft.

The draft is the factual anchor for the AI narrative layer
(`credit_engine.narrative`): every figure and conclusion the model is
allowed to state originates here or in the structured fact sheet.
Final user-facing text in any language (including polished English) is
produced by the AI layer; the draft itself is not shown to end users.
"""

from __future__ import annotations

SUPPORTED_LANGUAGES = ("en",)

GRADE_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "grade.excellent": "Excellent",
        "grade.very_good": "Very good",
        "grade.good": "Good",
        "grade.acceptable": "Acceptable",
        "grade.weak": "Weak",
        "grade.very_weak": "Very weak",
        "grade.unacceptable": "Unacceptable",
    },
}

FACTOR_NAMES: dict[str, dict[str, str]] = {
    "en": {
        "net_profitability": "net profitability",
        "equity_ratio": "equity ratio",
        "debt_to_assets": "debt to assets",
        "total_assets_dynamic": "total assets trend",
        "current_ratio": "current liquidity",
        "interest_coverage": "interest coverage",
        "interest_coverage_dynamic": "interest coverage trend",
        "debt_to_equity": "financial leverage",
        "cash_conversion_cycle": "cash conversion cycle",
        "revenue_usd": "business scale (revenue)",
        "age_years": "company age",
        "debt_to_ebit": "debt to EBIT",
        "revenue_dynamic": "revenue trend",
    },
}

#: Phrases describing a year-over-year change, keyed by magnitude band.
DYNAMIC_PHRASES: dict[str, dict[str, str]] = {
    "en": {
        "unchanged": "remained practically unchanged",
        "slight_increase": "increased slightly by {pct}",
        "increase": "increased by {pct}",
        "significant_increase": "increased significantly by {pct}",
        "sharp_increase": "grew sharply by {pct}",
        "slight_decrease": "decreased slightly by {pct}",
        "decrease": "decreased by {pct}",
        "significant_decrease": "decreased significantly by {pct}",
        "sharp_decrease": "fell sharply by {pct}",
    },
}

MESSAGES: dict[str, dict[str, str]] = {
    "en": {
        "income.revenue": "Revenue for {year} amounted to {revenue}",
        "income.revenue_dyn": " and {dyn_phrase} year-over-year",
        "income.margins": (
            "Gross margin was {gross_margin}, operating margin {operating_margin}."
        ),
        "income.net_result_profit": (
            "The company closed the period with a net profit of {net_profit} "
            "({net_margin} of revenue)."
        ),
        "income.net_result_loss": (
            "The company closed the period with a net loss of {net_profit}."
        ),
        "balance.assets": "Total assets stood at {total_assets}",
        "balance.assets_dyn": " and {dyn_phrase} over the year",
        "balance.equity": (
            "Equity amounted to {equity}, financing {equity_ratio} of the balance sheet."
        ),
        "balance.equity_negative": (
            "Equity is negative ({equity}): liabilities exceed assets."
        ),
        "balance.debt": (
            "Total interest-bearing debt was {gross_debt} ({debt_to_assets} of assets)."
        ),
        "balance.nwc_positive": "Net working capital is positive at {nwc}.",
        "balance.nwc_negative": (
            "Net working capital is negative at {nwc}: current liabilities exceed "
            "current assets."
        ),
        "ratios.current_ratio": "Current ratio is {value}",
        "ratios.interest_coverage": "interest coverage is {value}x",
        "ratios.debt_to_ebit": "debt to EBIT is {value}x",
        "ratios.ccc": "the cash conversion cycle is {value} days",
        "ratios.returns": "Return on equity is {roe}, return on assets {roa}.",
        "conclusion.rating": (
            "The credit rating is {score} on a 1-100 scale (lower is better), "
            "grade {grade} - {grade_label}."
        ),
        "conclusion.strengths": "Key strengths: {items}.",
        "conclusion.weaknesses": "Key weaknesses: {items}.",
        "conclusion.limit": "Recommended credit limit: {limit}.",
        "conclusion.limit_zero": "No credit limit is recommended: {reasons}.",
        "conclusion.adjustment": "Rating adjustment applied ({code}): {detail}.",
        "conclusion.coverage": "Assessment is based on {coverage} of the model's factor weight.",
        "adj.negative_equity": "negative equity",
        "adj.negative_equity_with_loss": "negative equity combined with a net loss",
        "adj.new_company": "short operating history",
        "adj.litigation_pressure": "significant litigation exposure",
        "adj.insufficient_data": "insufficient financial data",
        "adj.weak_equity_dominance": "weak capitalization dominates the assessment",
        "common.and_dyn": " and {dyn_phrase}",
        "income.gross_profit": "Gross profit amounted to {value}",
        "income.operating_profit": "Operating profit was {value}",
        "income.opex": (
            "Selling and administrative expenses totaled {value} ({share} of revenue)."
        ),
        "income.interest": "Interest expenses amounted to {value}.",
        "balance.structure": (
            "Non-current assets make up {nca_share} of total assets, "
            "current assets {ca_share}."
        ),
        "balance.current_items": (
            "Current assets include inventories of {inventories}, receivables of "
            "{receivables} and cash of {cash}."
        ),
        "balance.payables": "Accounts payable stood at {value}.",
        "cashflow.cfo_positive": "Operating cash flow was positive at {value}",
        "cashflow.cfo_negative": (
            "Operating cash flow was negative at {value}: operations absorb cash"
        ),
        "cashflow.capex": "Capital expenditures amounted to {value}.",
        "cashflow.fcf_positive": "Free cash flow is positive at {value}.",
        "cashflow.fcf_negative": "Free cash flow is negative at {value}.",
    },
}

#: Qualitative labels for ratio bands, used in the financial_ratios paragraph.
QUALIFIERS: dict[str, dict[str, str]] = {
    "en": {
        "negative": "negative",
        "critical": "critical",
        "insufficient": "insufficient",
        "low": "low",
        "very_low": "very low",
        "moderate": "moderate",
        "adequate": "adequate",
        "acceptable": "acceptable",
        "high": "high",
        "very_high": "very high",
        "extreme": "extreme",
        "negative_or_zero": "minimal",
        "very_short": "very short",
        "short": "short",
        "average": "average",
        "extended": "extended",
        "long": "long",
        "very_long": "very long",
    },
}
