/**
 * Derived cash flow statement (indirect method) — pure module, no I/O.
 *
 * Computed entirely from two consecutive statements of the SAME kind and
 * SAME report_type: annual pairs with the previous annual; quarterly pairs
 * with the chronologically PREVIOUS quarterly period (not same quarter of
 * the prior year) — the balance-sheet delta between consecutive reporting
 * dates is what generates cash movement.
 *
 * Classification (documented; expenses stored positive):
 * - Operating: net_profit + D&A (added back) + Δ operating liabilities
 *   (trade/other payables, current tax, provisions short+long, deferred tax
 *   liabilities, other current liabilities) − Δ operating assets
 *   (trade/other receivables, inventories, other current assets, deferred
 *   tax assets).
 * - Investing: −(ΔPP&E + D&A) as a capex approximation, −Δ intangibles &
 *   goodwill, −Δ investment property, −Δ long/short-term investments,
 *   −Δ other non-current assets.
 * - Financing: +Δ borrowings (long + short), +Δ share capital, +Δ other
 *   reserves, +Δ non-controlling interests, +Δ other non-current
 *   liabilities. Retained earnings are represented by net profit, so
 *   dividends/other retained movements surface in the reconciliation diff.
 *
 * Reconciliation: CFO + CFI + CFF must equal Δ cash_and_equivalents;
 * the difference is reported per column (OK badge / amber mismatch).
 */

import type { BalanceSheetValues, IncomeStatementValues, StatementBundle } from '../types'
import { sortChronological } from './analysis'

export type CashFlowSection = 'operating' | 'investing' | 'financing'

export interface CashFlowLine {
  /** i18n key under fin.cashflow.lines.* */
  key: string
  value: number
  /** False when no underlying data exists for the line (rendered as "—"). */
  hasData: boolean
}

export interface CashFlowColumn {
  /** The period the flow ends at. */
  statement: StatementBundle
  /** The chronologically previous same-kind statement. */
  previous: StatementBundle
  operating: CashFlowLine[]
  investing: CashFlowLine[]
  financing: CashFlowLine[]
  cfo: number
  cfi: number
  cff: number
  netChange: number
  deltaCash: number | null
  /** null when cash is unknown in either period. */
  reconciled: boolean | null
  reconciliationDiff: number | null
}

const TOLERANCE = 1

type Bs = Partial<BalanceSheetValues> | null
type Is = Partial<IncomeStatementValues> | null

interface Term {
  value: number
  hasData: boolean
}

function delta(cur: Bs, prev: Bs, key: keyof BalanceSheetValues): Term {
  const c = cur?.[key] ?? null
  const p = prev?.[key] ?? null
  if (c === null && p === null) return { value: 0, hasData: false }
  return { value: (c ?? 0) - (p ?? 0), hasData: true }
}

function isValue(is: Is, key: keyof IncomeStatementValues): Term {
  const v = is?.[key] ?? null
  return v === null ? { value: 0, hasData: false } : { value: v, hasData: true }
}

const neg = (term: Term): Term => ({ value: -term.value, hasData: term.hasData })

function combine(...terms: Term[]): Term {
  return {
    value: terms.reduce((a, t) => a + t.value, 0),
    hasData: terms.some((t) => t.hasData),
  }
}

function line(key: string, term: Term): CashFlowLine {
  return { key, value: term.value, hasData: term.hasData }
}

export function computeCashFlowColumn(
  statement: StatementBundle,
  previous: StatementBundle,
): CashFlowColumn {
  const bs = statement.balance_sheets
  const prevBs = previous.balance_sheets
  const is = statement.income_statements

  const d = (key: keyof BalanceSheetValues): Term => delta(bs, prevBs, key)

  const netProfit = isValue(is, 'net_profit')
  const da = isValue(is, 'depreciation_amortization')

  const operating: CashFlowLine[] = [
    line('net_profit', netProfit),
    line('depreciation_amortization', da),
    line('delta_receivables', neg(combine(d('trade_receivables'), d('other_receivables')))),
    line('delta_inventories', neg(d('inventories'))),
    line('delta_other_current_assets', neg(d('other_current_assets'))),
    line('delta_deferred_tax_assets', neg(d('deferred_tax_assets'))),
    line('delta_payables', combine(d('trade_payables'), d('other_payables'))),
    line('delta_tax_liabilities', d('current_tax_liabilities')),
    line('delta_provisions', combine(d('short_term_provisions'), d('long_term_provisions'))),
    line('delta_deferred_tax_liabilities', d('deferred_tax_liabilities')),
    line('delta_other_current_liabilities', d('other_current_liabilities')),
  ]

  const investing: CashFlowLine[] = [
    // capex approximation: ΔPP&E plus depreciation added back in operating
    line('ppe_capex', neg(combine(d('property_plant_equipment'), da))),
    line('intangibles', neg(combine(d('intangible_assets'), d('goodwill')))),
    line('investment_property', neg(d('investment_property'))),
    line('long_term_investments', neg(d('long_term_investments'))),
    line('short_term_investments', neg(d('short_term_investments'))),
    line('other_non_current_assets', neg(d('other_non_current_assets'))),
  ]

  const financing: CashFlowLine[] = [
    line('long_term_borrowings', d('long_term_borrowings')),
    line('short_term_borrowings', d('short_term_borrowings')),
    line('other_non_current_liabilities', d('other_non_current_liabilities')),
    line('share_capital', d('share_capital')),
    line('other_reserves', d('other_reserves')),
    line('non_controlling_interests', d('non_controlling_interests')),
  ]

  const sum = (lines: CashFlowLine[]): number => lines.reduce((a, l) => a + l.value, 0)
  const cfo = sum(operating)
  const cfi = sum(investing)
  const cff = sum(financing)
  const netChange = cfo + cfi + cff

  const cashCur = bs?.cash_and_equivalents ?? null
  const cashPrev = prevBs?.cash_and_equivalents ?? null
  const deltaCash = cashCur === null && cashPrev === null ? null : (cashCur ?? 0) - (cashPrev ?? 0)
  const reconciliationDiff = deltaCash === null ? null : netChange - deltaCash

  return {
    statement,
    previous,
    operating,
    investing,
    financing,
    cfo,
    cfi,
    cff,
    netChange,
    deltaCash,
    reconciled: reconciliationDiff === null ? null : Math.abs(reconciliationDiff) <= TOLERANCE,
    reconciliationDiff,
  }
}

/**
 * Build cash flow columns for the displayed statements: each pairs with the
 * chronologically previous statement of the same kind AND report_type from
 * the FULL list (the pair may be off-screen). Statements without a prior
 * period produce no column.
 */
export function buildCashFlowColumns(
  displayed: StatementBundle[],
  all: StatementBundle[],
): CashFlowColumn[] {
  const chronological = sortChronological(all)
  const columns: CashFlowColumn[] = []

  for (const statement of sortChronological(displayed)) {
    const candidates = chronological.filter(
      (s) =>
        s.statement_kind === statement.statement_kind &&
        s.report_type === statement.report_type &&
        s.period_end_date < statement.period_end_date,
    )
    const previous = candidates[candidates.length - 1]
    if (previous) columns.push(computeCashFlowColumn(statement, previous))
  }
  return columns
}

/** True when CFO is negative in 2+ consecutive computed columns. */
export function hasPersistentNegativeCfo(columns: CashFlowColumn[]): boolean {
  let streak = 0
  for (const column of columns) {
    streak = column.cfo < 0 ? streak + 1 : 0
    if (streak >= 2) return true
  }
  return false
}
