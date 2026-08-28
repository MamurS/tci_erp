/** The claim status machine, mirrored from tci.change_claim_status (0032).
 *
 * The database is what enforces this; the UI mirrors it only so it can grey out
 * a button instead of offering a move the server will refuse. A contract test
 * locks both halves to the migration text.
 */

import type { UserRole } from '../../lib/roles'
import type { ClaimStatus } from './types'

/** from -> the states it may move to. */
export const CLAIM_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['under_assessment', 'info_requested', 'declined', 'withdrawn'],
  under_assessment: ['info_requested', 'approved', 'partially_approved', 'declined'],
  info_requested: ['under_assessment', 'declined', 'withdrawn'],
  approved: ['paid', 'closed'],
  partially_approved: ['paid', 'closed'],
  declined: ['closed'],
  paid: ['closed'],
  withdrawn: ['closed'],
  closed: [],
}

/**
 * Transitions the UI must never offer as a plain button, even though the
 * database accepts them.
 *
 *   approved | partially_approved -> paid   goes through tci.record_claim_payment,
 *     which is what makes `paid` agree with the payments behind it. Offering
 *     the bare transition would let a claim read as settled with nothing paid.
 *   under_assessment -> approved | partially_approved  goes through
 *     tci.approve_claim, which freezes the indemnity and its trace. The bare
 *     transition would approve a claim with no figure attached.
 */
export const NOT_OFFERED_DIRECTLY: readonly `${ClaimStatus}->${ClaimStatus}`[] = [
  'approved->paid',
  'partially_approved->paid',
  'under_assessment->approved',
  'under_assessment->partially_approved',
]

export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from].includes(to)
}

/** Terminal states: nothing follows, or only the archival `closed`. */
export function isFinal(status: ClaimStatus): boolean {
  return status === 'closed'
}

/** The claim is still being worked: it can change, and it counts as open. */
export function isOpen(status: ClaimStatus): boolean {
  return !['paid', 'closed', 'declined', 'withdrawn'].includes(status)
}

/** Who may drive a transition, mirroring the role gates in the SQL. */
export function mayTransition(
  roles: readonly UserRole[],
  from: ClaimStatus,
  to: ClaimStatus,
  isOwningPolicyholder = false,
): boolean {
  if (!canTransition(from, to)) return false
  const isClaims = roles.includes('claims') || roles.includes('admin')
  if (to === 'submitted' || to === 'withdrawn') {
    return isClaims || roles.includes('sales') || isOwningPolicyholder
  }
  if (to === 'under_assessment' && from === 'info_requested') {
    return isClaims || isOwningPolicyholder
  }
  return isClaims
}

/** The moves to render as buttons for this viewer. */
export function offeredTransitions(
  roles: readonly UserRole[],
  from: ClaimStatus,
  isOwningPolicyholder = false,
): readonly ClaimStatus[] {
  return CLAIM_TRANSITIONS[from].filter(
    (to) =>
      !NOT_OFFERED_DIRECTLY.includes(`${from}->${to}` as `${ClaimStatus}->${ClaimStatus}`) &&
      mayTransition(roles, from, to, isOwningPolicyholder),
  )
}

/** Only a decline needs a typed reason; a partial approval is justified by its
 * verdicts and trace (0032). */
export function requiresReason(to: ClaimStatus): boolean {
  return to === 'declined'
}
