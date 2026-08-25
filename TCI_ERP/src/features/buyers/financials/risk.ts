/**
 * Risk analysis — pure module, no I/O. Modeled on the legacy risk tab.
 *
 * Bankruptcy model: credit_engine has no PD/bankruptcy model (audited), so
 * this implements the Altman Z''-score, emerging-markets version for
 * non-public companies:
 *
 *   Z'' = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4 + 3.25
 *   X1 = working capital / total assets
 *   X2 = retained earnings / total assets
 *   X3 = EBIT / total assets
 *   X4 = book equity / total liabilities
 *
 * Zones (classic thresholds shifted by the +3.25 constant):
 *   safe  Z'' > 5.85   |  grey  4.35–5.85  |  distress  < 4.35
 */

import type { StatementBundle } from '../types'
import { sortChronological } from './analysis'
import { buildCashFlowColumns } from './cashflow'
import { computeRatios } from './ratios'

export type RiskBand = 'safe' | 'grey' | 'distress'

export interface NormRule {
  min?: number
  max?: number
}

/** Norm thresholds; displayed as "(норма > X)" and drive red/green tint. */
export const RISK_NORMS: Record<string, NormRule> = {
  current_ratio: { min: 1 },
  quick_ratio: { min: 0.5 },
  interest_coverage: { min: 2 },
  cfo_to_current_liabilities: { min: 0 },
  leverage: { max: 1 },
  borrowed_concentration: { max: 0.8 },
}

export type RiskRowFormat = 'amount' | 'ratio' | 'percent' | 'days' | 'score'

export interface RiskRowDef {
  key: string
  /** i18n group under fin.risk.groups.* ; null = top block. */
  group: string | null
  format: RiskRowFormat
  norm?: NormRule
}

export const RISK_ROWS: RiskRowDef[] = [
  { key: 'z_score', group: null, format: 'score' },
  { key: 'net_working_capital', group: null, format: 'amount' },
  { key: 'equity', group: null, format: 'amount' },
  { key: 'current_ratio', group: 'liquidity', format: 'ratio', norm: RISK_NORMS.current_ratio },
  { key: 'quick_ratio', group: 'liquidity', format: 'ratio', norm: RISK_NORMS.quick_ratio },
  { key: 'cash_ratio', group: 'liquidity', format: 'ratio' },
  {
    key: 'cfo_to_current_liabilities',
    group: 'liquidity',
    format: 'percent',
    norm: RISK_NORMS.cfo_to_current_liabilities,
  },
  { key: 'receivables_days', group: 'activity', format: 'days' },
  { key: 'inventory_days', group: 'activity', format: 'days' },
  { key: 'payables_days', group: 'activity', format: 'days' },
  { key: 'additional_credit_need', group: 'activity', format: 'days' },
  { key: 'long_term_debt_ratio', group: 'stability', format: 'percent' },
  { key: 'leverage', group: 'stability', format: 'ratio', norm: RISK_NORMS.leverage },
  {
    key: 'borrowed_concentration',
    group: 'stability',
    format: 'percent',
    norm: RISK_NORMS.borrowed_concentration,
  },
  { key: 'interest_coverage', group: 'stability', format: 'ratio', norm: RISK_NORMS.interest_coverage },
  { key: 'cfo_interest_coverage', group: 'stability', format: 'ratio' },
]

export interface RiskPeriod {
  statement: StatementBundle
  values: Record<string, number | null>
  zBand: RiskBand | null
  /** value key -> norm breached (true = red). */
  breaches: Record<string, boolean>
}

function div(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null
  const r = a / b
  return Number.isFinite(r) ? r : null
}

export function altmanZ(inputs: {
  workingCapital: number | null
  retainedEarnings: number | null
  ebit: number | null
  equity: number | null
  totalAssets: number | null
  totalLiabilities: number | null
}): number | null {
  const x1 = div(inputs.workingCapital, inputs.totalAssets)
  const x2 = div(inputs.retainedEarnings, inputs.totalAssets)
  const x3 = div(inputs.ebit, inputs.totalAssets)
  const x4 = div(inputs.equity, inputs.totalLiabilities)
  if (x1 === null || x2 === null || x3 === null || x4 === null) return null
  return 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4 + 3.25
}

export function zBand(z: number | null): RiskBand | null {
  if (z === null) return null
  if (z > 5.85) return 'safe'
  if (z >= 4.35) return 'grey'
  return 'distress'
}

export function normBreached(value: number | null, norm: NormRule | undefined): boolean {
  if (value === null || !norm) return false
  if (norm.min !== undefined && value < norm.min) return true
  if (norm.max !== undefined && value > norm.max) return true
  return false
}

/**
 * Compute risk rows for every displayed statement (chronological order).
 * CFO-based rows use the derived cash flow when a prior same-kind
 * statement exists in the full list.
 */
export function buildRiskPeriods(
  displayed: StatementBundle[],
  all: StatementBundle[],
): RiskPeriod[] {
  const cashFlows = buildCashFlowColumns(displayed, all)
  const cfoByStatement = new Map(cashFlows.map((c) => [c.statement.id, c.cfo]))

  return sortChronological(displayed).map((statement) => {
    const bs = statement.balance_sheets
    const is = statement.income_statements
    const ratios = computeRatios(statement.statement_kind, bs, is)

    const totalAssets = bs?.total_assets ?? null
    const totalLiabilities = bs?.total_liabilities ?? null
    const equity = bs?.total_equity ?? null
    const nwc =
      bs?.total_current_assets !== null &&
      bs?.total_current_assets !== undefined &&
      bs?.total_current_liabilities !== null &&
      bs?.total_current_liabilities !== undefined
        ? bs.total_current_assets - bs.total_current_liabilities
        : null

    const ebitFallback =
      is?.operating_profit ??
      (is?.profit_before_tax !== null && is?.profit_before_tax !== undefined
        ? is.profit_before_tax + (is.finance_costs ?? 0) - (is.finance_income ?? 0)
        : null)

    const z = altmanZ({
      workingCapital: nwc,
      retainedEarnings: bs?.retained_earnings ?? null,
      ebit: ebitFallback,
      equity,
      totalAssets,
      totalLiabilities,
    })

    const cfo = cfoByStatement.get(statement.id) ?? null
    const ltd = bs?.long_term_borrowings ?? null
    const borrowings =
      ltd !== null || (bs?.short_term_borrowings ?? null) !== null
        ? (ltd ?? 0) + (bs?.short_term_borrowings ?? 0)
        : null
    const interest = is?.finance_costs ?? null

    const dso = ratios.receivables_days.value
    const dio = ratios.inventory_days.value
    const dpo = ratios.payables_days.value

    const values: Record<string, number | null> = {
      z_score: z,
      net_working_capital: nwc,
      equity,
      current_ratio: ratios.current_ratio.value,
      quick_ratio: ratios.quick_ratio.value,
      cash_ratio: ratios.cash_ratio.value,
      cfo_to_current_liabilities: div(cfo, bs?.total_current_liabilities ?? null),
      receivables_days: dso,
      inventory_days: dio,
      payables_days: dpo,
      additional_credit_need:
        dso !== null && dio !== null && dpo !== null ? dso + dio - dpo : null,
      long_term_debt_ratio:
        equity !== null && ltd !== null ? div(ltd, equity + ltd) : null,
      leverage: div(borrowings, equity),
      borrowed_concentration: div(totalLiabilities, totalAssets),
      interest_coverage: ratios.interest_coverage.value,
      cfo_interest_coverage: interest === null || interest === 0 ? null : div(cfo, Math.abs(interest)),
    }

    const breaches: Record<string, boolean> = {}
    for (const row of RISK_ROWS) {
      breaches[row.key] = normBreached(values[row.key], row.norm)
    }

    return { statement, values, zBand: zBand(z), breaches }
  })
}
