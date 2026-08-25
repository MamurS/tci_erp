/**
 * Vertical / horizontal analysis computation — pure module.
 *
 * Balance sheet Δ%: vs the PREVIOUS DISPLAYED column (stock comparison).
 * P&L Δ%: LIKE-for-LIKE — annual vs previous fiscal year annual, Q(n) vs
 * Q(n) of the previous fiscal year. The base may be a statement that is not
 * among the displayed columns; it is looked up in the full statement list.
 */

import type { StatementBundle, StatementKind } from '../types'
import { statementPeriodLabel } from '../types'
import { relativeChange } from './ratios'

export interface PeriodColumn {
  statement: StatementBundle
  /** Label of what Δ% compares against (e.g. "FY2024"); null = no Δ% column. */
  deltaBaseLabel: string | null
  /** The statement Δ% compares against (may be off-screen for P&L). */
  deltaBase: StatementBundle | null
}

/** Sort by period end ascending (oldest left, newest right). */
export function sortChronological(statements: StatementBundle[]): StatementBundle[] {
  return [...statements].sort((a, b) => a.period_end_date.localeCompare(b.period_end_date))
}

/** Default selection: last 6 statements by period_end_date. */
export function defaultSelection(statements: StatementBundle[]): string[] {
  return sortChronological(statements)
    .slice(-6)
    .map((s) => s.id)
}

/** Balance sheet columns: Δ% vs the previous DISPLAYED column of the SAME
 * report_type (trend computations never mix statutory and management). */
export function balanceSheetColumns(displayed: StatementBundle[]): PeriodColumn[] {
  const ordered = sortChronological(displayed)
  return ordered.map((statement, idx) => {
    const prev =
      [...ordered.slice(0, idx)]
        .reverse()
        .find((s) => s.report_type === statement.report_type) ?? null
    return {
      statement,
      deltaBase: prev,
      deltaBaseLabel: prev ? statementPeriodLabel(prev) : null,
    }
  })
}

/** Find the like-for-like prior-year statement (same kind, same quarter,
 * same report_type) in the FULL list. */
export function findLikeForLikeBase(
  statement: {
    statement_kind: StatementKind
    fiscal_year: number
    fiscal_quarter: number | null
    report_type: string
  },
  all: StatementBundle[],
): StatementBundle | null {
  return (
    all.find(
      (s) =>
        s.statement_kind === statement.statement_kind &&
        s.fiscal_year === statement.fiscal_year - 1 &&
        s.fiscal_quarter === statement.fiscal_quarter &&
        s.report_type === statement.report_type,
    ) ?? null
  )
}

/** P&L columns: Δ% vs like-for-like prior-year period from the full list. */
export function incomeStatementColumns(
  displayed: StatementBundle[],
  all: StatementBundle[],
): PeriodColumn[] {
  return sortChronological(displayed).map((statement) => {
    const base = findLikeForLikeBase(statement, all)
    return {
      statement,
      deltaBase: base,
      deltaBaseLabel: base ? statementPeriodLabel(base) : null,
    }
  })
}

/** Vertical analysis: line / base, null-safe. */
export function verticalShare(value: number | null, base: number | null): number | null {
  if (value === null || base === null || base === 0) return null
  return value / base
}

export { relativeChange }

/** True when displayed statements mix currencies or units (warning banner). */
export function hasMixedCurrencyOrUnit(displayed: StatementBundle[]): boolean {
  if (displayed.length < 2) return false
  const currencies = new Set(displayed.map((s) => s.currency_code))
  const units = new Set(displayed.map((s) => s.unit))
  return currencies.size > 1 || units.size > 1
}
