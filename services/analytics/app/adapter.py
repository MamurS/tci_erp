"""TCI IFRS payload -> credit_engine canonical input.

Responsibilities:
* scale amounts by the statement unit (thousands/millions -> absolute),
* map tci column names onto engine field names,
* resolve the USD exchange rate (explicit value or per-currency default).
"""

from __future__ import annotations

from credit_engine import CompanyFinancials, FinancialPeriod, PeriodType

from app.schemas import StatementPayload, TciPeriod

UNIT_SCALE: dict[str, float] = {"units": 1.0, "thousands": 1_000.0, "millions": 1_000_000.0}

#: v1 placeholder rates (units of currency per USD) used when the request
#: does not supply exchange_rate_usd. Replace with an FX feed later.
DEFAULT_USD_RATES: dict[str, float] = {
    "USD": 1.0,
    "UZS": 12_500.0,
    "EUR": 0.92,
    "KZT": 495.0,
    "RUB": 95.0,
}


def resolve_exchange_rate(currency: str, explicit: float | None) -> tuple[float, str | None]:
    """Returns (rate, warning). Unknown currency falls back to 1.0 with a warning."""
    if explicit is not None:
        return explicit, None
    rate = DEFAULT_USD_RATES.get(currency.upper())
    if rate is not None:
        return rate, None
    return 1.0, f"no default USD rate for currency '{currency}' - assumed 1.0"


def _scaled(value: float | None, scale: float) -> float | None:
    return None if value is None else value * scale


def to_engine_period(period: TciPeriod, scale: float) -> FinancialPeriod:
    bs, inc = period.balance_sheet, period.income_statement
    s = lambda v: _scaled(v, scale)  # noqa: E731

    intangibles = None
    if bs.intangible_assets is not None or bs.goodwill is not None:
        intangibles = (bs.intangible_assets or 0.0) + (bs.goodwill or 0.0)

    return FinancialPeriod(
        year=period.fiscal_year,
        period_type=(
            PeriodType.ANNUAL if period.statement_kind == "annual" else PeriodType.QUARTERLY
        ),
        total_assets=s(bs.total_assets),
        non_current_assets=s(bs.total_non_current_assets),
        intangible_assets=s(intangibles),
        inventories=s(bs.inventories),
        accounts_receivable=s(bs.trade_receivables),
        cash=s(bs.cash_and_equivalents),
        current_assets=s(bs.total_current_assets),
        equity=s(bs.total_equity),
        long_term_debt=s(bs.long_term_borrowings),
        short_term_debt=s(bs.short_term_borrowings),
        accounts_payable=s(bs.trade_payables),
        current_liabilities=s(bs.total_current_liabilities),
        revenue=s(inc.revenue),
        cost_of_sales=s(inc.cost_of_sales),
        gross_profit=s(inc.gross_profit),
        commercial_expenses=s(inc.distribution_expenses),
        administrative_expenses=s(inc.administrative_expenses),
        operating_profit=s(inc.operating_profit),
        interest_income=s(inc.finance_income),
        interest_expenses=s(inc.finance_costs),
        profit_before_tax=s(inc.profit_before_tax),
        net_profit=s(inc.net_profit),
    )


def build_company(payload: StatementPayload) -> tuple[CompanyFinancials, list[str]]:
    warnings: list[str] = []
    scale = UNIT_SCALE[payload.unit]
    rate, rate_warning = resolve_exchange_rate(payload.currency, payload.exchange_rate_usd)
    if rate_warning:
        warnings.append(rate_warning)

    company = CompanyFinancials(
        name=payload.buyer.name,
        country=payload.buyer.country_code,
        age_years=payload.buyer.age_years,
        currency=payload.currency,
        exchange_rate_usd=rate,
        periods=[to_engine_period(p, scale) for p in payload.periods],
    )
    return company, warnings
