/**
 * Local statement -> IFRS mapping algorithm. Pure module, no I/O.
 *
 * Input: values entered on a local (statutory) form + the template's line ->
 * IFRS column mappings. Output: a full IFRS row for balance_sheets /
 * income_statements plus cross-check warnings.
 *
 * Rules:
 * - Each mapped local line contributes SUM(amount x sign) to its target
 *   column. Unmapped lines (memo/breakdown) contribute nothing.
 * - IFRS SUBTOTALS are computed from mapped components, never taken from
 *   local subtotal lines.
 * - Computed IFRS totals are cross-checked against the corresponding local
 *   subtotal lines; discrepancies surface as non-blocking amber warnings.
 * - Which lines are cross-checked, and each form's own subtotal arithmetic,
 *   are template DATA (statement_template_lines.crosscheck_column / formula),
 *   never constants here.
 */

import type { BalanceSheetValues, IncomeStatementValues } from '../types'
import { emptyBalanceSheet, emptyIncomeStatement } from '../types'

export interface MappingRule {
  line_code: string
  target_table: 'balance_sheet' | 'income_statement'
  target_column: string
  sign: number
}

export interface MappedStatement {
  balanceSheet: BalanceSheetValues
  incomeStatement: IncomeStatementValues
  warnings: CrossCheckWarning[]
}

export interface CrossCheckWarning {
  /** Local subtotal line code (e.g. '400'). */
  lineCode: string
  /** Computed IFRS column the local subtotal corresponds to. */
  ifrsColumn: string
  localValue: number
  computedValue: number
}

const TOLERANCE = 1

/** The form's own arithmetic for one line (codes of the same template). */
export interface LocalFormula {
  plus: string[]
  minus: string[]
}

/** Per-template rules, read from the template lines (migration 0049): the
 *  local form's subtotal arithmetic and which local totals must agree with
 *  which computed IFRS totals. A new country is data, not code. */
export interface TemplateRules {
  /** Local total line code -> computed IFRS column it must agree with. */
  crosschecks: Record<string, string>
  /** Line code -> the form's own formula for it. */
  formulas: Record<string, LocalFormula>
}

export interface RuleLine {
  line_code: string
  formula: LocalFormula | null
  crosscheck_column: string | null
}

export function templateRules(lines: readonly RuleLine[]): TemplateRules {
  const rules: TemplateRules = { crosschecks: {}, formulas: {} }
  for (const line of lines) {
    if (line.formula) rules.formulas[line.line_code] = line.formula
    if (line.crosscheck_column) rules.crosschecks[line.line_code] = line.crosscheck_column
  }
  return rules
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  return present.length ? present.reduce((a, b) => a + b, 0) : null
}

/** Fill computed IFRS subtotal columns from mapped components. */
function computeBalanceSubtotals(bs: BalanceSheetValues): void {
  bs.total_non_current_assets = sumOrNull([
    bs.property_plant_equipment, bs.intangible_assets, bs.goodwill, bs.investment_property,
    bs.long_term_investments, bs.deferred_tax_assets, bs.other_non_current_assets,
  ])
  bs.total_current_assets = sumOrNull([
    bs.inventories, bs.trade_receivables, bs.other_receivables,
    bs.short_term_investments, bs.cash_and_equivalents, bs.other_current_assets,
  ])
  bs.total_assets = sumOrNull([bs.total_non_current_assets, bs.total_current_assets])
  bs.total_equity = sumOrNull([
    bs.share_capital, bs.retained_earnings, bs.other_reserves, bs.non_controlling_interests,
  ])
  bs.total_non_current_liabilities = sumOrNull([
    bs.long_term_borrowings, bs.deferred_tax_liabilities,
    bs.long_term_provisions, bs.other_non_current_liabilities,
  ])
  bs.total_current_liabilities = sumOrNull([
    bs.short_term_borrowings, bs.trade_payables, bs.other_payables,
    bs.current_tax_liabilities, bs.short_term_provisions, bs.other_current_liabilities,
  ])
  bs.total_liabilities = sumOrNull([
    bs.total_non_current_liabilities, bs.total_current_liabilities,
  ])
  bs.total_equity_and_liabilities = sumOrNull([bs.total_equity, bs.total_liabilities])
}

/** Expenses are stored positive; profit lines subtract them. */
function computeIncomeSubtotals(is: IncomeStatementValues): void {
  const minus = (v: number | null): number | null => (v === null ? null : -v)
  is.gross_profit = sumOrNull([is.revenue, minus(is.cost_of_sales)])
  is.operating_profit = sumOrNull([
    is.gross_profit, minus(is.distribution_expenses), minus(is.administrative_expenses),
    is.other_operating_income, minus(is.other_operating_expenses),
  ])
  is.profit_before_tax = sumOrNull([
    is.operating_profit, is.finance_income, minus(is.finance_costs), is.other_non_operating,
  ])
  is.net_profit = sumOrNull([is.profit_before_tax, minus(is.income_tax)])
}

export function mapLocalStatement(
  rules: TemplateRules,
  /** line_code -> entered amount (as reported on the local form). */
  localValues: Record<string, number | null>,
  mappings: MappingRule[],
): MappedStatement {
  const balanceSheet = emptyBalanceSheet()
  const incomeStatement = emptyIncomeStatement()

  for (const rule of mappings) {
    const amount = localValues[rule.line_code]
    if (amount === null || amount === undefined) continue
    const contribution = amount * rule.sign
    if (rule.target_table === 'balance_sheet') {
      const key = rule.target_column as keyof BalanceSheetValues
      balanceSheet[key] = (balanceSheet[key] ?? 0) + contribution
    } else {
      const key = rule.target_column as keyof IncomeStatementValues
      incomeStatement[key] = (incomeStatement[key] ?? 0) + contribution
    }
  }

  computeBalanceSubtotals(balanceSheet)
  computeIncomeSubtotals(incomeStatement)

  const warnings = crossCheck(rules, localValues, balanceSheet, incomeStatement)
  return { balanceSheet, incomeStatement, warnings }
}

function crossCheck(
  rules: TemplateRules,
  localValues: Record<string, number | null>,
  bs: BalanceSheetValues,
  is: IncomeStatementValues,
): CrossCheckWarning[] {
  const warnings: CrossCheckWarning[] = []
  for (const [lineCode, ifrsColumn] of Object.entries(rules.crosschecks)) {
    const localValue = localValues[lineCode]
    if (localValue === null || localValue === undefined) continue
    const computed =
      ifrsColumn in bs
        ? bs[ifrsColumn as keyof BalanceSheetValues]
        : is[ifrsColumn as keyof IncomeStatementValues]
    if (computed === null) continue
    if (Math.abs(localValue - computed) > TOLERANCE) {
      warnings.push({ lineCode, ifrsColumn, localValue, computedValue: computed })
    }
  }
  return warnings
}

// ---------------------------------------------------------------------------
// Local-form subtotal validation (amber checks on the local form itself)
// ---------------------------------------------------------------------------

export interface LocalSubtotalWarning {
  lineCode: string
  entered: number
  expected: number
}

/** Non-blocking amber checks: entered subtotal vs sum of its components. */
export function validateLocalStatement(
  rules: TemplateRules,
  localValues: Record<string, number | null>,
): LocalSubtotalWarning[] {
  const warnings: LocalSubtotalWarning[] = []
  for (const [lineCode, formula] of Object.entries(rules.formulas)) {
    const entered = localValues[lineCode]
    if (entered === null || entered === undefined) continue
    const components = [
      ...formula.plus.map((c) => localValues[c] ?? null),
      ...formula.minus.map((c) => {
        const v = localValues[c]
        return v === null || v === undefined ? null : -v
      }),
    ]
    const present = components.filter((v): v is number => v !== null)
    if (!present.length) continue
    const expected = present.reduce((a, b) => a + b, 0)
    if (Math.abs(entered - expected) > TOLERANCE) {
      warnings.push({ lineCode, entered, expected })
    }
  }
  return warnings
}
