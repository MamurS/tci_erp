/**
 * Policy status machine — pure module, EXACT mirror of the SQL function
 * tci.change_policy_status (migrations 0012 + 0014). The database is the
 * enforcing side; this module only drives which action buttons the UI offers.
 *
 * draft -> active
 * active -> suspended | cancelled | expired | annulled
 * suspended -> active | cancelled | annulled
 * expired, cancelled, annulled -> terminal
 *
 * annulled = voided as if never concluded (premium returned), distinct from
 * cancelled (terminated from a date). Annulment REQUIRES a comment — the SQL
 * function rejects an empty one.
 */

import type { PolicyStatus } from './types'

export const ALLOWED_TRANSITIONS: Record<PolicyStatus, readonly PolicyStatus[]> = {
  draft: ['active'],
  active: ['suspended', 'cancelled', 'expired', 'annulled'],
  suspended: ['active', 'cancelled', 'annulled'],
  expired: [],
  cancelled: [],
  annulled: [],
}

export function allowedTargets(from: PolicyStatus): readonly PolicyStatus[] {
  return ALLOWED_TRANSITIONS[from]
}

export function canTransition(from: PolicyStatus, to: PolicyStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** Suspend/cancel/annul are consequential — the UI asks for a confirmation
 * comment (for annulment the comment is mandatory, see commentMandatory). */
export function requiresComment(to: PolicyStatus): boolean {
  return to === 'suspended' || to === 'cancelled' || to === 'annulled'
}

/** Transitions the SQL function refuses without a non-empty comment. */
export function commentMandatory(to: PolicyStatus): boolean {
  return to === 'annulled'
}

/** Badge tone per DESIGN.md semantics (green = good standing, red = terminal
 * loss of cover; solid red = annulment, visually distinct from cancellation). */
export function statusTone(
  status: PolicyStatus,
): 'neutral' | 'accent' | 'pos' | 'neg' | 'negStrong' | 'warn' {
  switch (status) {
    case 'active':
      return 'pos'
    case 'suspended':
      return 'warn'
    case 'cancelled':
      return 'neg'
    case 'annulled':
      return 'negStrong'
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
