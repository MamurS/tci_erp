"""Runnable demo: assess a sample Uzbek company and print the result.

    uv run python examples/demo.py
"""

from __future__ import annotations

from credit_engine import CompanyFinancials, FinancialPeriod, assess

BLN = 1_000_000_000

company = CompanyFinancials(
    name="Namuna Savdo MChJ",
    country="UZ",
    industry="WHTR",
    age_years=7.0,
    currency="UZS",
    exchange_rate_usd=12_500.0,
    periods=[
        FinancialPeriod(
            year=2024,
            total_assets=180 * BLN,
            non_current_assets=60 * BLN,
            intangible_assets=2 * BLN,
            inventories=45 * BLN,
            accounts_receivable=38 * BLN,
            cash=12 * BLN,
            current_assets=120 * BLN,
            equity=70 * BLN,
            long_term_debt=30 * BLN,
            short_term_debt=25 * BLN,
            accounts_payable=40 * BLN,
            current_liabilities=80 * BLN,
            revenue=420 * BLN,
            cost_of_sales=-340 * BLN,
            commercial_expenses=-20 * BLN,
            administrative_expenses=-15 * BLN,
            operating_profit=45 * BLN,
            interest_expenses=-8 * BLN,
            profit_before_tax=38 * BLN,
            net_profit=29 * BLN,
        ),
        FinancialPeriod(
            year=2025,
            total_assets=210 * BLN,
            non_current_assets=65 * BLN,
            intangible_assets=2 * BLN,
            inventories=52 * BLN,
            accounts_receivable=45 * BLN,
            cash=18 * BLN,
            current_assets=145 * BLN,
            equity=88 * BLN,
            long_term_debt=28 * BLN,
            short_term_debt=30 * BLN,
            accounts_payable=48 * BLN,
            current_liabilities=90 * BLN,
            revenue=510 * BLN,
            cost_of_sales=-410 * BLN,
            commercial_expenses=-25 * BLN,
            administrative_expenses=-18 * BLN,
            operating_profit=57 * BLN,
            interest_expenses=-9 * BLN,
            profit_before_tax=49 * BLN,
            net_profit=37 * BLN,
        ),
    ],
)


def main() -> None:
    result = assess(company, language="ru")

    print(f"=== {result.company_name} — {result.assessed_year} ===\n")
    print(f"Рейтинг: {result.rating.score} (класс {result.rating.grade}), "
          f"покрытие данными {result.rating.data_coverage:.0%}")
    print(f"Лимит:   {result.limit.recommended_limit:,.0f} {result.limit.currency} "
          f"(модель: {result.limit.model_used})\n")

    print("--- Факторы (score: меньше = лучше) ---")
    for f in result.rating.factors:
        value = f"{f.value:.3f}" if f.value is not None else "n/a"
        score = f"{f.score:.0f}" if f.score is not None else "-"
        print(f"  {f.factor:28s} value={value:>14s} score={score:>3s} "
              f"weight={f.weight:>4.1f} [{f.status}]")

    if result.rating.adjustments:
        print("\n--- Корректировки ---")
        for a in result.rating.adjustments:
            print(f"  {a.code}: {a.rating_before:.1f} -> {a.rating_after:.1f} ({a.detail})")

    print("\n--- Комментарии ---")
    for section, text in result.commentary.items():
        print(f"\n[{section}]\n{text}")


if __name__ == "__main__":
    main()
