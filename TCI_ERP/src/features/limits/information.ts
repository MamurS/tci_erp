/**
 * Information gathering before a limit decision (migration 0067) — pure.
 *
 * A request whose buyer lacks the minimum information is routed to
 * `information_gathering` by the database (tci.handle_information_routing),
 * never by the screen. This module only names the gaps the way
 * tci.buyer_information_gaps returns them, and says who may waive: credit
 * underwriting, never on its own request (the four-eyes rule).
 */

import { hasRole } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'

/** tci.buyer_information_gaps, in its order. */
export const INFORMATION_GAPS = [
  'registration_number',
  'address',
  'industry',
  'no_statements',
  'stale_statements',
] as const
export type InformationGap = (typeof INFORMATION_GAPS)[number]

export function isInformationGap(value: unknown): value is InformationGap {
  return typeof value === 'string' && (INFORMATION_GAPS as readonly string[]).includes(value)
}

/** The gaps a row or a task carries, keeping only the ones we know. */
export function parseGaps(value: unknown): InformationGap[] {
  return Array.isArray(value) ? value.filter(isInformationGap) : []
}

/** Whether what is missing is a statement (the financials tab) rather than
 * the company card. */
export function missingStatements(gaps: readonly InformationGap[]): boolean {
  return gaps.includes('no_statements') || gaps.includes('stale_statements')
}

/** tci.waive_limit_information: credit underwriting, not the requester. */
export function mayWaiveInformation(roles: readonly UserRole[], isRequester: boolean): boolean {
  return hasRole(roles, 'credit_underwriter') && !isRequester
}
