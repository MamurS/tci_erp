/**
 * Financial ratio computation — pure module, no I/O, no React.
 *
 * This logic will later be mirrored in the Python analytics service, so it
 * must stay framework-free and fully unit-tested (ratios.test.ts).
 *
 * Conventions:
 * - Expenses (cost_of_sales, finance_costs, ...) are entered as POSITIVE.
 * - Division by zero or missing inputs yields null (rendered as "—").
 * - For quarterly statements, flow figures are annualized (x4) in mixed
 *   stock/flow ratios; such values carry `annualized: true` and are marked
 *   with an asterisk in the UI.
 */

import type {
  BalanceSheetValues,
  IncomeStatementValues,
  StatementKind,
} from '../types'

export type RatioGroup = 'profitability' | 'solvency' | 'efficiency'

export const RATIO_DEFS = [
  { key: 'gross_margin', group: 'profitability', format: 'percent' },
  { key: 'operating_margin', group: 'profitability', format: 'percent' },
  { key: 'net_margin', group: 'profitability', format: 'percent' },
  { key: 'ebitda_margin', group: 'profitability', format: 'percent' },
  { key: 'roa', group: 'profitability', format: 'percent' },
  { key: 'roe', group: 'profitability', format: 'percent' },
  { key: 'current_ratio', group: 'solvency', format: 'ratio' },
  { key: 'quick_ratio', group: 'solvency', format: 'ratio' },
  { key: 'cash_ratio', group: 'solvency', format: 'ratio' },
  { key: 'debt_to_equity', group: 'solvency', format: 'ratio' },
  { key: 'liabilities_to_assets', group: 'solvency', format: 'ratio' },
  { key: 'interest_coverage', group: 'solvency', format: 'ratio' },
  { key: 'net_debt_to_ebitda', group: 'solvency', format: 'ratio' },
  { key: 'asset_turnover', group: 'efficiency', format: 'ratio' },
  { key: 'receivables_days', group: 'efficiency', format: 'days' },
  { key: 'inventory_days', group: 'efficiency', format: 'days' },
  { key: 'payables_days', group: 'efficiency', format: 'days' },
  { key: 'working_capital_cycle', group: 'efficiency', format: 'days' },
] as const satisfies readonly { key: string; group: RatioGroup; format: 'percent' | 'ratio' | 'days' }[]

export type RatioKey = (typeof RATIO_DEFS)[number]['key']

export interface RatioValue {
  value: number | null
  /** True when a flow figure was annualized (quarterly statement, x4). */
  annualized: boolean
}

export type RatioSet = Record<RatioKey, RatioValue>

function div(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null
  const result = numerator / denominator
  return Number.isFinite(result) ? result : null
}

function add(...values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  return present.length ? present.reduce((a, b) => a + b, 0) : null
}

function sub(a: number | null, b: number | null): number | null {
  if (a === null) return null
  return a - (b ?? 0)
}

const plain = (value: number | null): RatioValue => ({ value, annualized: false })

export function computeRatios(
  kind: StatementKind,
  bs: Partial<BalanceSheetValues> | null,
  is: Partial<IncomeStatementValues> | null,
): RatioSet {
  const b = <K extends keyof BalanceSheetValues>(k: K): number | null => bs?.[k] ?? null
  const i = <K extends keyof IncomeStatementValues>(k: K): number | null => is?.[k] ?? null

  const quarterly = kind === 'quarterly'
  /** Annualize a flow figure for mixed stock/flow ratios. */
  const flow = (value: number | null): number | null =>
    value === null ? null : quarterly ? value * 4 : value

  const annualized = (value: number | null): RatioValue => ({ value, annualized: quarterly })

  const revenue = i('revenue')
  const ebitda = add(i('operating_profit'), i('depreciation_amortization'))
  const borrowings = add(b('long_term_borrowings'), b('short_term_borrowings'))
  const netDebt = borrowings === null ? null : sub(borrowings, b('cash_and_equivalents'))

  return {
    // --- Profitability (flow/flow: no annualization needed) ---
    gross_margin: plain(div(i('gross_profit'), revenue)),
    operating_margin: plain(div(i('operating_profit'), revenue)),
    net_margin: plain(div(i('net_profit'), revenue)),
    ebitda_margin: plain(div(ebitda, revenue)),
    // flow/stock -> annualize the flow
    roa: annualized(div(flow(i('net_profit')), b('total_assets'))),
    roe: annualized(div(flow(i('net_profit')), b('total_equity'))),

    // --- Creditworthiness / solvency ---
    current_ratio: plain(div(b('total_current_assets'), b('total_current_liabilities'))),
    quick_ratio: plain(
      div(sub(b('total_current_assets'), b('inventories')), b('total_current_liabilities')),
    ),
    cash_ratio: plain(div(b('cash_and_equivalents'), b('total_current_liabilities'))),
    debt_to_equity: plain(div(borrowings, b('total_equity'))),
    liabilities_to_assets: plain(div(b('total_liabilities'), b('total_assets'))),
    interest_coverage: plain(div(i('operating_profit'), i('finance_costs'))),
    net_debt_to_ebitda: annualized(div(netDebt, flow(ebitda))),

    // --- Efficiency ---
    asset_turnover: annualized(div(flow(revenue), b('total_assets'))),
    receivables_days: annualized(daysOf(b('trade_receivables'), flow(revenue))),
    inventory_days: annualized(daysOf(b('inventories'), flow(i('cost_of_sales')))),
    payables_days: annualized(daysOf(b('trade_payables'), flow(i('cost_of_sales')))),
    working_capital_cycle: annualized(
      workingCapitalCycle(
        daysOf(b('trade_receivables'), flow(revenue)),
        daysOf(b('inventories'), flow(i('cost_of_sales'))),
        daysOf(b('trade_payables'), flow(i('cost_of_sales'))),
      ),
    ),
  }
}

function daysOf(stock: number | null, annualFlow: number | null): number | null {
  const ratio = div(stock, annualFlow)
  return ratio === null ? null : ratio * 365
}

/** DSO + DIO - DPO; null if any component is null. */
function workingCapitalCycle(
  dso: number | null,
  dio: number | null,
  dpo: number | null,
): number | null {
  if (dso === null || dio === null || dpo === null) return null
  return dso + dio - dpo
}

/** Relative change vs a base value: (cur - base) / |base|. */
export function relativeChange(current: number | null, base: number | null): number | null {
  if (current === null || base === null || base === 0) return null
  return (current - base) / Math.abs(base)
}
