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

/**
 * Local subtotal line -> the computed IFRS total it must agree with.
 * Data per template code; extend when seeding new countries.
 */
export const SUBTOTAL_CROSSCHECKS: Record<string, Record<string, string>> = {
  UZ_NAS_F1: {
    '120': 'total_non_current_assets',
    '390': 'total_current_assets',
    '400': 'total_assets',
    // 480 intentionally NOT cross-checked against total_equity: line 470
    // (provisions) is reclassified to liabilities under IFRS, so the local
    // section I total differs from IFRS equity by design.
    '770': 'total_liabilities',
    '780': 'total_equity_and_liabilities',
  },
  UZ_NAS_F2: {
    '030': 'gross_profit',
    '100': 'operating_profit',
    '240': 'profit_before_tax',
    '270': 'net_profit',
  },
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
  templateCode: string,
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

  const warnings = crossCheck(templateCode, localValues, balanceSheet, incomeStatement)
  return { balanceSheet, incomeStatement, warnings }
}

function crossCheck(
  templateCode: string,
  localValues: Record<string, number | null>,
  bs: BalanceSheetValues,
  is: IncomeStatementValues,
): CrossCheckWarning[] {
  const checks = SUBTOTAL_CROSSCHECKS[templateCode]
  if (!checks) return []

  const warnings: CrossCheckWarning[] = []
  for (const [lineCode, ifrsColumn] of Object.entries(checks)) {
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

export interface LocalFormula {
  plus: string[]
  minus: string[]
}

/** Official arithmetic of local subtotal lines, per template code. */
export const LOCAL_SUBTOTAL_FORMULAS: Record<string, Record<string, LocalFormula>> = {
  UZ_NAS_F1: {
    '012': { plus: ['010'], minus: ['011'] },
    '022': { plus: ['020'], minus: ['021'] },
    '030': { plus: ['040', '050', '060', '070'], minus: [] },
    '120': { plus: ['012', '022', '030', '080', '090', '100', '110'], minus: [] },
    '140': { plus: ['150', '160', '170', '180'], minus: [] },
    '210': { plus: ['230', '270', '280', '310'], minus: [] },
    '390': { plus: ['140', '190', '200', '210', '320', '370', '380'], minus: [] },
    '400': { plus: ['120', '390'], minus: [] },
    '480': { plus: ['410', '420', '430', '450', '460', '470'], minus: ['440'] },
    '490': { plus: ['500', '510', '520', '530'], minus: [] },
    '600': { plus: ['610', '620', '630', '640', '650', '730', '740', '750', '760'], minus: [] },
    '770': { plus: ['490', '600'], minus: [] },
    '780': { plus: ['480', '770'], minus: [] },
  },
  UZ_NAS_F2: {
    '030': { plus: ['010'], minus: ['020'] },
    '040': { plus: ['050', '060', '070'], minus: [] },
    '100': { plus: ['030', '090'], minus: ['040'] },
    '110': { plus: ['120', '130', '140', '160'], minus: [] },
    '170': { plus: ['180', '190', '200'], minus: [] },
    '220': { plus: ['100', '110'], minus: ['170'] },
    '240': { plus: ['220', '230'], minus: [] },
    '270': { plus: ['240'], minus: ['250', '260'] },
  },
}

export interface LocalSubtotalWarning {
  lineCode: string
  entered: number
  expected: number
}

/** Non-blocking amber checks: entered subtotal vs sum of its components. */
export function validateLocalStatement(
  templateCode: string,
  localValues: Record<string, number | null>,
): LocalSubtotalWarning[] {
  const formulas = LOCAL_SUBTOTAL_FORMULAS[templateCode]
  if (!formulas) return []

  const warnings: LocalSubtotalWarning[] = []
  for (const [lineCode, formula] of Object.entries(formulas)) {
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
