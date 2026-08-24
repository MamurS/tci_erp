/**
 * Live accounting-equation checks for the statement entry form.
 * Non-blocking (amber warnings): the analyst's entered figure is the source
 * of truth. Tolerance: 1 unit (rounding). Expenses are entered as positive.
 */

import type { BalanceSheetValues, IncomeStatementValues } from '../types'

export interface ValidationWarning {
  /** i18n key under fin.lines.* of the total being checked */
  totalKey: string
  entered: number
  expected: number
}

const TOLERANCE = 1

function sum(values: (number | null)[]): { total: number; hasAny: boolean } {
  const present = values.filter((v): v is number => v !== null)
  return { total: present.reduce((a, b) => a + b, 0), hasAny: present.length > 0 }
}

function check(
  warnings: ValidationWarning[],
  totalKey: string,
  entered: number | null,
  components: (number | null)[],
): void {
  const { total: expected, hasAny } = sum(components)
  if (entered === null || !hasAny) return
  if (Math.abs(entered - expected) > TOLERANCE) {
    warnings.push({ totalKey, entered, expected })
  }
}

export function validateBalanceSheet(bs: BalanceSheetValues): ValidationWarning[] {
  const w: ValidationWarning[] = []

  check(w, 'total_non_current_assets', bs.total_non_current_assets, [
    bs.property_plant_equipment, bs.intangible_assets, bs.goodwill, bs.investment_property,
    bs.long_term_investments, bs.deferred_tax_assets, bs.other_non_current_assets,
  ])
  check(w, 'total_current_assets', bs.total_current_assets, [
    bs.inventories, bs.trade_receivables, bs.other_receivables,
    bs.short_term_investments, bs.cash_and_equivalents, bs.other_current_assets,
  ])
  check(w, 'total_assets', bs.total_assets, [
    bs.total_non_current_assets, bs.total_current_assets,
  ])
  check(w, 'total_equity', bs.total_equity, [
    bs.share_capital, bs.retained_earnings, bs.other_reserves, bs.non_controlling_interests,
  ])
  check(w, 'total_non_current_liabilities', bs.total_non_current_liabilities, [
    bs.long_term_borrowings, bs.deferred_tax_liabilities,
    bs.long_term_provisions, bs.other_non_current_liabilities,
  ])
  check(w, 'total_current_liabilities', bs.total_current_liabilities, [
    bs.short_term_borrowings, bs.trade_payables, bs.other_payables,
    bs.current_tax_liabilities, bs.short_term_provisions, bs.other_current_liabilities,
  ])
  check(w, 'total_liabilities', bs.total_liabilities, [
    bs.total_non_current_liabilities, bs.total_current_liabilities,
  ])
  check(w, 'total_equity_and_liabilities', bs.total_equity_and_liabilities, [
    bs.total_equity, bs.total_liabilities,
  ])

  // Balance equation: total assets = total equity and liabilities.
  if (
    bs.total_assets !== null &&
    bs.total_equity_and_liabilities !== null &&
    Math.abs(bs.total_assets - bs.total_equity_and_liabilities) > TOLERANCE
  ) {
    w.push({
      totalKey: 'balance_equation',
      entered: bs.total_assets,
      expected: bs.total_equity_and_liabilities,
    })
  }
  return w
}

export function validateIncomeStatement(is: IncomeStatementValues): ValidationWarning[] {
  const w: ValidationWarning[] = []
  const neg = (v: number | null): number | null => (v === null ? null : -v)

  // gross_profit = revenue - cost_of_sales
  check(w, 'gross_profit', is.gross_profit, [is.revenue, neg(is.cost_of_sales)])
  // operating_profit = gross - distribution - admin + other income - other expenses
  check(w, 'operating_profit', is.operating_profit, [
    is.gross_profit, neg(is.distribution_expenses), neg(is.administrative_expenses),
    is.other_operating_income, neg(is.other_operating_expenses),
  ])
  // profit_before_tax = operating + finance income - finance costs + other non-operating
  check(w, 'profit_before_tax', is.profit_before_tax, [
    is.operating_profit, is.finance_income, neg(is.finance_costs), is.other_non_operating,
  ])
  // net_profit = pbt - income tax
  check(w, 'net_profit', is.net_profit, [is.profit_before_tax, neg(is.income_tax)])
  return w
}
