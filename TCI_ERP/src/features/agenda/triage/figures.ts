/**
 * What the triage bodies read off existing data (pure, tested). Nothing here
 * decides or recalculates: the authority verdict is the database's
 * (`decide_alone` of tci.v_limit_request_queue), the UZS sums follow the app's
 * fx rule (`rateFor` is latestUzsRate), and «what moved» is the risk report's
 * own commentary (report/commentary.ts) run on the two statements in question.
 */

import type { TFunction } from 'i18next'

import { formatCompact, formatDays, formatPercent, formatRatio, formatSignedPercent } from '../../../lib/format'
import { buildCashFlowColumns } from '../../entities/financials/cashflow'
import { buildCommentary } from '../../entities/report/commentary'
import type { CommentaryMetric, CommentarySection, CommentarySentence } from '../../entities/report/commentary'
import { normalizeBundle } from '../../entities/report/model'
import type { StatementBundle } from '../../entities/types'

/** A numeric (numerics may arrive as strings); null for anything else. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// «Your authority» — the database's answer, shown
// ---------------------------------------------------------------------------

/** The columns of tci.v_limit_request_queue the authority card reads. */
export interface QueueAuthority {
  amount_uzs: number | string | null
  rate_missing: boolean
  my_authority_uzs: number | string
  decide_alone: boolean
  own_request: boolean
}

export type AuthorityState =
  /** The caller raised it: four eyes (0063), a colleague decides. */
  | { kind: 'ownRequest' }
  /** The request's currency has no rate: nobody can tell, the SQL raises. */
  | { kind: 'noRate' }
  | { kind: 'within'; authorityUzs: number }
  | { kind: 'short'; authorityUzs: number; shortfallUzs: number }

/**
 * Within or short is `decide_alone`, computed by the view with the rule of
 * decide_limit_request; the shortfall is only the difference it implies.
 */
export function authorityState(row: QueueAuthority): AuthorityState {
  if (row.own_request) return { kind: 'ownRequest' }
  const amount = num(row.amount_uzs)
  if (row.rate_missing || amount === null) return { kind: 'noRate' }
  const authority = num(row.my_authority_uzs) ?? 0
  if (row.decide_alone) return { kind: 'within', authorityUzs: authority }
  return { kind: 'short', authorityUzs: authority, shortfallUzs: Math.max(amount - authority, 0) }
}

// ---------------------------------------------------------------------------
// The buyer's other limits in force
// ---------------------------------------------------------------------------

/** The columns of tci.v_effective_limits this reads. */
export interface LimitLike {
  policy_id: string | null
  insurance_request_id: string | null
  outcome: string
  approved_amount: number | string | null
  currency_code: string
}

export interface LimitsSum {
  count: number
  /** Sum of the limits that could be converted; null when none could. */
  uzs: number | null
  /** Limits whose currency has no rate: left out and counted, never 0. */
  missingRates: number
}

/** tci.limit_scope(policy_id, insurance_request_id). */
export function scopeOf(row: Pick<LimitLike, 'policy_id' | 'insurance_request_id'>): string | null {
  return row.policy_id ?? row.insurance_request_id
}

/**
 * The buyer's limits in force OUTSIDE the given scope, in UZS. In force is
 * the v_buyer_exposure rule: an approved or partial effective decision on a
 * policy (a pre-bind limit is not exposure).
 */
export function otherLimitsInForce(
  limits: readonly LimitLike[],
  excludeScope: string | null,
  rateFor: (currency: string) => number | null,
): LimitsSum {
  let count = 0
  let uzs: number | null = null
  let missingRates = 0
  for (const limit of limits) {
    if (limit.outcome !== 'approved' && limit.outcome !== 'partial') continue
    if (limit.policy_id === null) continue
    if (excludeScope !== null && scopeOf(limit) === excludeScope) continue
    count += 1
    const amount = num(limit.approved_amount)
    const rate = rateFor(limit.currency_code)
    if (amount === null) continue
    if (rate === null) {
      missingRates += 1
      continue
    }
    uzs = (uzs ?? 0) + amount * rate
  }
  return { count, uzs, missingRates }
}

// ---------------------------------------------------------------------------
// «What moved» between the rated statement and the new one
// ---------------------------------------------------------------------------

/** The figures a rating review looks at first, in the order shown. */
export const MOVED_METRICS: readonly CommentaryMetric[] = [
  'revenue',
  'netProfit',
  'ebitMargin',
  'equityRatio',
  'debtToEquity',
  'currentRatio',
  'dso',
]

const SECTIONS: readonly CommentarySection[] = ['pnl', 'balanceSheet', 'ratios']

export type NotComparable = 'kind' | 'reportType' | 'currency'

export type Moved =
  | { comparable: true; currency: string; chips: CommentarySentence[] }
  | { comparable: false; reason: NotComparable }

/**
 * The risk report's commentary on a two-statement series [rated, latest]:
 * one sentence per metric, its move and its direction-aware tone. Only real
 * moves are kept (a flat figure is not news). Two statements of different
 * kinds (a quarter against a year), report types or currencies are not
 * compared at all — the report never compares them either.
 */
export function whatMoved(rated: StatementBundle, latest: StatementBundle): Moved {
  if (rated.statement_kind !== latest.statement_kind) return { comparable: false, reason: 'kind' }
  if (rated.report_type !== latest.report_type) return { comparable: false, reason: 'reportType' }
  if (rated.currency_code !== latest.currency_code) return { comparable: false, reason: 'currency' }
  const series = [normalizeBundle(rated), normalizeBundle(latest)]
  const sentences = SECTIONS.flatMap((section) => buildCommentary(section, { company: series }))
    .flatMap((p) => p.sentences)
    .filter((s) => MOVED_METRICS.includes(s.metric))
    .filter((s) => s.commentary.kind === 'change' || s.commentary.kind === 'changeNm')
  sentences.sort((a, b) => MOVED_METRICS.indexOf(a.metric) - MOVED_METRICS.indexOf(b.metric))
  return { comparable: true, currency: latest.currency_code, chips: sentences }
}

/**
 * How many consecutive periods, ending at `latest`, show a NEGATIVE operating
 * cash flow (derived, indirect method — the cash-flow tab's own rule, see
 * hasPersistentNegativeCfo). Only periods of the same kind and report type
 * count, each needing the one before it; 0 when the latest CFO is not
 * negative or cannot be derived. The chip shows it from two periods up.
 */
export function negativeCfoStreak(latest: StatementBundle, all: StatementBundle[]): number {
  const columns = buildCashFlowColumns(
    all.filter(
      (s) =>
        s.statement_kind === latest.statement_kind &&
        s.report_type === latest.report_type &&
        s.period_end_date <= latest.period_end_date,
    ),
    all,
  )
  let streak = 0
  for (let i = columns.length - 1; i >= 0 && columns[i]!.cfo < 0; i--) streak++
  return columns.length > 0 && columns[columns.length - 1]!.statement.id === latest.id ? streak : 0
}

/** The existing label of each metric (report / fin namespaces). */
export const METRIC_LABEL_KEY: Readonly<Partial<Record<CommentaryMetric, string>>> = {
  revenue: 'report.keyFigureLabels.revenue',
  netProfit: 'report.keyFigureLabels.netProfit',
  ebitMargin: 'report.ratioRows.ebitMargin',
  equityRatio: 'report.keyFigureLabels.equityRatio',
  debtToEquity: 'report.keyFigureLabels.debtToEquity',
  currentRatio: 'fin.ratios.current_ratio',
  dso: 'report.ratioRows.dso',
}

/**
 * A chip as read: «Revenue +13.6%» for an amount that moved, «Equity ratio
 * 27.0% → 31.0%» for a ratio, «DSO 94 → 121 days»; an amount whose move is
 * not a percentage (a loss turning to profit) shows both values.
 */
export function movedChipText(s: CommentarySentence, currency: string, t: TFunction, locale: string): string {
  const label = t(METRIC_LABEL_KEY[s.metric] ?? s.metric)
  const value = (v: number | null): string => {
    switch (s.format) {
      case 'amount':
        return formatCompact(v, locale, 1)
      case 'percent':
        return formatPercent(v, locale, 1)
      case 'ratio':
        return v === null ? formatRatio(v, locale) : `${formatRatio(v, locale)}x`
      case 'days':
        return formatDays(v, locale)
    }
  }
  const c = s.commentary
  if (s.format === 'amount' && c.kind === 'change' && (c.move === 'up' || c.move === 'down')) {
    return `${label} ${formatSignedPercent(c.move === 'up' ? c.pct : -c.pct, locale, 1)}`
  }
  const range = `${value(s.from)} → ${value(s.to)}`
  if (s.format === 'amount') return `${label} ${range} ${currency}`
  if (s.format === 'days') return `${label} ${range} ${t('report.tables.days')}`
  return `${label} ${range}`
}
