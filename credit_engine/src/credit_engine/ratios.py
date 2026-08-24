"""Financial ratio and dynamics calculation.

Replaces the legacy `ratios_calculator.py` (416 lines of 4-level nested
ternaries emitting float('inf') sentinels). Division by zero or missing
inputs yields ``None``, never infinity; downstream layers must handle
``None`` explicitly.
"""

from __future__ import annotations

from collections.abc import Callable

from credit_engine.models import PERIOD_DAYS, CompanyFinancials, FinancialPeriod, RatioReport


def _div(numerator: float | None, denominator: float | None) -> float | None:
    """Safe division: None on missing input or zero denominator."""
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def _add(*values: float | None) -> float | None:
    """Sum of values, ignoring None; None if all are None."""
    present = [v for v in values if v is not None]
    return sum(present) if present else None


def _sub(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return a - b


def _abs(v: float | None) -> float | None:
    return abs(v) if v is not None else None


def compute_period_ratios(p: FinancialPeriod) -> dict[str, float | None]:
    """All ratios derivable from a single period."""
    days = PERIOD_DAYS[p.period_type]

    gross_debt = _add(_abs(p.long_term_debt), _abs(p.short_term_debt))

    gross_profit = (
        p.gross_profit if p.gross_profit is not None else _sub(p.revenue, _abs(p.cost_of_sales))
    )

    # EBIT: profit before tax + interest expense - interest income,
    # falling back to operating profit when PBT is unavailable.
    # Missing interest lines are treated as zero, not as unknown EBIT.
    ebit: float | None
    if p.profit_before_tax is not None:
        ebit = (
            p.profit_before_tax
            + abs(p.interest_expenses or 0.0)
            - abs(p.interest_income or 0.0)
        )
    else:
        ebit = p.operating_profit

    # Days-outstanding metrics: prefer cost of sales, fall back to revenue
    # (legacy behaviour, kept — statements in the region often omit COGS).
    cogs_or_revenue = _abs(p.cost_of_sales) if p.cost_of_sales else _abs(p.revenue)

    dio = _div(_mul(p.inventories, days), cogs_or_revenue)
    dso = _div(_mul(p.accounts_receivable, days), _abs(p.revenue))
    dpo = _div(_mul(p.accounts_payable, days), cogs_or_revenue)

    ccc = None
    if dio is not None and dso is not None and dpo is not None:
        ccc = dio + dso - dpo

    interest_coverage = _div(ebit, _abs(p.interest_expenses))

    free_cash_flow = _sub(p.operating_cash_flow, _abs(p.capital_expenditures))

    operating_costs = _add(_abs(p.commercial_expenses), _abs(p.administrative_expenses))

    return {
        "gross_debt": gross_debt,
        "gross_profit": gross_profit,
        "ebit": ebit,
        "equity_ratio": _div(p.equity, p.total_assets),
        "net_working_capital": _sub(p.current_assets, p.current_liabilities),
        "current_ratio": _div(p.current_assets, p.current_liabilities),
        "quick_ratio": _div(_sub(p.current_assets, p.inventories), p.current_liabilities),
        "cash_ratio": _div(p.cash, p.current_liabilities),
        "debt_to_equity": _div(gross_debt, p.equity),
        "debt_to_assets": _div(gross_debt, p.total_assets),
        "debt_to_ebit": _div(gross_debt, ebit),
        "gross_margin": _div(gross_profit, p.revenue),
        "operating_margin": _div(p.operating_profit, p.revenue),
        "ebit_margin": _div(ebit, p.revenue),
        "net_profitability": _div(p.net_profit, p.revenue),
        "return_on_assets": _div(p.net_profit, p.total_assets),
        "return_on_equity": _div(p.net_profit, p.equity),
        "days_inventory_outstanding": dio,
        "days_sales_outstanding": dso,
        "days_payable_outstanding": dpo,
        "cash_conversion_cycle": ccc,
        "interest_coverage": interest_coverage,
        "free_cash_flow": free_cash_flow,
        "total_operating_costs": operating_costs,
        "operating_costs_to_revenue": _div(operating_costs, p.revenue),
        # pass-through absolutes used by scoring and commentary
        "revenue": p.revenue,
        "net_profit": p.net_profit,
        "total_assets": p.total_assets,
        "equity": p.equity,
        "interest_expenses": p.interest_expenses,
        "accounts_payable": p.accounts_payable,
        "non_current_assets": p.non_current_assets,
        "intangible_assets": p.intangible_assets,
        "current_assets": p.current_assets,
        "inventories": p.inventories,
        "accounts_receivable": p.accounts_receivable,
        "cash": p.cash,
        "operating_cash_flow": p.operating_cash_flow,
        "capital_expenditures": p.capital_expenditures,
    }


def _mul(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return a * b


def compute_dynamic(current: float | None, previous: float | None) -> float | None:
    """Relative change (cur - prev) / |prev|; None when not computable."""
    if current is None or previous is None or previous == 0:
        return None
    return (current - previous) / abs(previous)


#: Fields for which year-over-year dynamics are reported.
DYNAMIC_FIELDS: tuple[str, ...] = (
    "revenue",
    "net_profit",
    "total_assets",
    "equity",
    "gross_debt",
    "gross_profit",
    "ebit",
    "net_working_capital",
    "current_ratio",
    "equity_ratio",
    "debt_to_equity",
    "net_profitability",
    "interest_coverage",
    "cash_conversion_cycle",
    "free_cash_flow",
)


def build_ratio_reports(
    company: CompanyFinancials,
    ratio_fn: Callable[[FinancialPeriod], dict[str, float | None]] = compute_period_ratios,
) -> list[RatioReport]:
    """Ratio set per period, with dynamics vs the previous period."""
    periods = company.sorted_periods()
    all_ratios = [ratio_fn(p) for p in periods]

    reports: list[RatioReport] = []
    for idx, (period, ratios) in enumerate(zip(periods, all_ratios, strict=True)):
        dynamics: dict[str, float | None] = {}
        if idx > 0:
            prev = all_ratios[idx - 1]
            for field in DYNAMIC_FIELDS:
                dynamics[field] = compute_dynamic(ratios.get(field), prev.get(field))
        reports.append(RatioReport(year=period.year, ratios=ratios, dynamics=dynamics))
    return reports
