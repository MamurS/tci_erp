/**
 * Policy status machine — pure module, EXACT mirror of the SQL function
 * tci.change_policy_status (migration 0012). The database is the enforcing
 * side; this module only drives which action buttons the UI offers.
 *
 * draft -> active
 * active -> suspended | cancelled | expired
 * suspended -> active | cancelled
 * expired, cancelled -> terminal
 */

import type { PolicyStatus } from './types'

export const ALLOWED_TRANSITIONS: Record<PolicyStatus, readonly PolicyStatus[]> = {
  draft: ['active'],
  active: ['suspended', 'cancelled', 'expired'],
  suspended: ['active', 'cancelled'],
  expired: [],
  cancelled: [],
}

export function allowedTargets(from: PolicyStatus): readonly PolicyStatus[] {
  return ALLOWED_TRANSITIONS[from]
}

export function canTransition(from: PolicyStatus, to: PolicyStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** Suspend/cancel are consequential — the UI asks for a confirmation comment. */
export function requiresComment(to: PolicyStatus): boolean {
  return to === 'suspended' || to === 'cancelled'
}

/** Badge tone per DESIGN.md semantics (green = good standing, red = terminal loss of cover). */
export function statusTone(
  status: PolicyStatus,
): 'neutral' | 'accent' | 'pos' | 'neg' | 'warn' {
  switch (status) {
    case 'active':
      return 'pos'
    case 'suspended':
      return 'warn'
    case 'cancelled':
      return 'neg'
    case 'draft':
      return 'accent'
    case 'expired':
      return 'neutral'
  }
}

/** An active policy past its expiry date is ELIGIBLE for the explicit
 * active->expired transition (no cron; underwriter confirms). */
export function isExpiryDue(
  policy: { status: PolicyStatus; expiry_date: string },
  todayIso: string,
): boolean {
  return policy.status === 'active' && todayIso > policy.expiry_date
}
