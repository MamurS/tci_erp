/**
 * Pure rules of the credit workbench. Everything the database decides
 * (authority, the rating reasons, group utilisation) arrives in the rows of
 * migration 0053's views; these only filter, order and label them.
 */

import type { CreditPortfolioRow } from '../../portfolio/aggregate'
import { num } from '../../portfolio/aggregate'
import type { GroupLimitRow, QueueRow, RatingReason, RatingWorkRow } from './types'
import { RATING_REASONS } from './types'

/** Best first. 'unrated' is not on the scale: it has no rank. */
const BAND_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }

/**
 * Limits whose buyer is now rated in a WORSE band than the decision was taken
 * in — the limit was granted on a better risk than the one we hold today.
 * Only rated bands compare; worst current band first.
 */
export function ratingDeteriorated(rows: readonly CreditPortfolioRow[]): CreditPortfolioRow[] {
  return rows
    .filter((r) => {
      const was = BAND_RANK[r.decision_band]
      const now = BAND_RANK[r.current_band]
      return was !== undefined && now !== undefined && now > was
    })
    .sort((a, b) => BAND_RANK[b.current_band] - BAND_RANK[a.current_band] || a.buyer_name.localeCompare(b.buyer_name))
}

/** How far ahead monitoring looks for limits coming up for review. */
export const REVIEW_WINDOW_DAYS = 30

/** Limits due for review within `days`, overdue reviews included (negative
 * days left), soonest first. A limit with no review date never comes due. */
export function reviewsDueOrOverdue(rows: readonly CreditPortfolioRow[], days: number): CreditPortfolioRow[] {
  return rows
    .filter((r) => r.days_to_review !== null && r.days_to_review <= days)
    .sort((a, b) => (a.days_to_review ?? 0) - (b.days_to_review ?? 0))
}

export type GroupState = 'over' | 'near' | 'within' | 'uncapped'

/** At or above this share of the cap a group is flagged before it breaches. */
export const GROUP_NEAR_PCT = 90

/** over is the database's own over_limit; near and within read its
 * utilisation; a group with no live limit (or no rate for it) is uncapped. */
export function groupState(row: GroupLimitRow): GroupState {
  if (row.over_limit) return 'over'
  const pct = num(row.utilisation_pct)
  if (pct === null) return 'uncapped'
  return pct >= GROUP_NEAR_PCT ? 'near' : 'within'
}

const GROUP_ORDER: Record<GroupState, number> = { over: 0, near: 1, within: 2, uncapped: 3 }

/** Breaches first, then by utilisation, then by exposure. */
export function sortGroups(rows: readonly GroupLimitRow[]): GroupLimitRow[] {
  return [...rows].sort(
    (a, b) =>
      GROUP_ORDER[groupState(a)] - GROUP_ORDER[groupState(b)] ||
      (num(b.utilisation_pct) ?? -1) - (num(a.utilisation_pct) ?? -1) ||
      (num(b.exposure_uzs) ?? 0) - (num(a.exposure_uzs) ?? 0),
  )
}

/** Groups that need attention: over the cap or near it. */
export function groupsAtRisk(rows: readonly GroupLimitRow[]): GroupLimitRow[] {
  return sortGroups(rows).filter((r) => {
    const s = groupState(r)
    return s === 'over' || s === 'near'
  })
}

/** Rating worklist rows in the order of the reasons (blockers first), then by
 * live business (open requests, then limits in force). */
export function sortRatingWork(rows: readonly RatingWorkRow[]): RatingWorkRow[] {
  const order = (reason: RatingReason) => RATING_REASONS.indexOf(reason)
  return [...rows].sort(
    (a, b) =>
      order(a.reason) - order(b.reason) ||
      b.open_requests - a.open_requests ||
      b.limits_in_force - a.limits_in_force ||
      a.buyer_name.localeCompare(b.buyer_name),
  )
}

export function countByReason(rows: readonly RatingWorkRow[]): Record<RatingReason, number> {
  const out = Object.fromEntries(RATING_REASONS.map((r) => [r, 0])) as Record<RatingReason, number>
  for (const r of rows) out[r.reason] += 1
  return out
}

export interface InForceFilter {
  query: string
  band: string
  country: string
  currency: string
}

/** The in-force register's filters: free text over buyer / policy /
 * policyholder, and exact band (the buyer's CURRENT band), country, currency. */
export function filterInForce(rows: readonly CreditPortfolioRow[], f: InForceFilter): CreditPortfolioRow[] {
  const q = f.query.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (!f.band || r.current_band === f.band) &&
      (!f.country || r.buyer_country === f.country) &&
      (!f.currency || r.currency_code === f.currency) &&
      (!q ||
        r.buyer_name.toLowerCase().includes(q) ||
        r.policy_number.toLowerCase().includes(q) ||
        r.policyholder_name.toLowerCase().includes(q)),
  )
}

/** Total in UZS of the rows that have a rate, and how many have none
 * (counted, never added as zero). */
export function uzsTotal(rows: readonly { amount_uzs: number | string | null }[]): { uzs: number; missing: number } {
  let uzs = 0
  let missing = 0
  for (const r of rows) {
    const v = num(r.amount_uzs)
    if (v === null) missing += 1
    else uzs += v
  }
  return { uzs, missing }
}

/** Index of the queue rows by request, for annotating the request list. */
export function queueIndex(rows: readonly QueueRow[]): Map<string, QueueRow> {
  return new Map(rows.map((r) => [r.request_id, r]))
}
