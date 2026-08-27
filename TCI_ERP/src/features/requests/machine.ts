/**
 * Insurance request status machine — pure module, EXACT mirror of
 * tci.advance_insurance_request (migration 0019). The database enforces;
 * this module only decides which transitions the UI offers and why one is
 * currently unavailable.
 */

import { hasRole } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'
import type { BuyerResolutionStatus, InsuranceRequestStatus } from './types'

/** The transition table of tci.advance_insurance_request, verbatim. */
export const TRANSITIONS: Readonly<
  Record<InsuranceRequestStatus, readonly InsuranceRequestStatus[]>
> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['entity_resolution', 'underwriting', 'withdrawn'],
  entity_resolution: ['underwriting', 'withdrawn'],
  underwriting: ['commercial_review', 'withdrawn'],
  commercial_review: ['sales_confirmation', 'withdrawn'],
  sales_confirmation: ['client_review', 'withdrawn'],
  client_review: ['accepted', 'declined', 'withdrawn'],
  accepted: ['bound'],
  declined: [],
  withdrawn: [],
  bound: [],
}

/** Terminal states: no transition leaves them. */
export const TERMINAL_STATUSES: readonly InsuranceRequestStatus[] = [
  'declined',
  'withdrawn',
  'bound',
]

export function isTerminal(status: InsuranceRequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function isAllowedTransition(
  from: InsuranceRequestStatus,
  to: InsuranceRequestStatus,
): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Which department owns the submission right now — drives the queue
 * grouping and the "waiting on" chip. Mirrors the target_role the SQL
 * function stamps on request.status_changed. */
export function owningRole(status: InsuranceRequestStatus): UserRole | null {
  switch (status) {
    case 'draft':
    case 'submitted':
    case 'entity_resolution':
    case 'sales_confirmation':
      return 'sales'
    case 'underwriting':
      return 'credit_underwriter'
    case 'commercial_review':
      return 'commercial_underwriter'
    case 'client_review':
      return 'client'
    default:
      return null
  }
}

/** Role gate per TARGET state (the `elsif` ladder of the SQL function).
 * `isCreator` covers the withdraw branch. */
export function canTransitionAs(
  to: InsuranceRequestStatus,
  roles: readonly UserRole[],
  isCreator: boolean,
): boolean {
  if (to === 'withdrawn') return isCreator || hasRole(roles, 'admin')
  if (to === 'accepted' || to === 'declined') return hasRole(roles, 'client', 'admin', 'sales')
  if (to === 'client_review') return hasRole(roles, 'admin', 'sales')
  if (to === 'sales_confirmation') return hasRole(roles, 'admin', 'commercial_underwriter')
  // Everything else: any staff role.
  return roles.some((r) => r !== 'client')
}

/** Why a transition the roles allow is still blocked — the content guards
 * of the SQL function. Returns an i18n key under "requests.guards.", or
 * null when nothing blocks it. */
export type GuardKey = 'entitiesUnresolved' | 'creditIncomplete' | 'declineNeedsReason'

export function guardFor(
  to: InsuranceRequestStatus,
  facts: { entitiesResolved: boolean; creditComplete: boolean; hasComment: boolean },
): GuardKey | null {
  if (to === 'underwriting' && !facts.entitiesResolved) return 'entitiesUnresolved'
  if (to === 'commercial_review' && !facts.creditComplete) return 'creditIncomplete'
  if (to === 'declined' && !facts.hasComment) return 'declineNeedsReason'
  return null
}

export interface TransitionOffer {
  to: InsuranceRequestStatus
  /** false when the caller's roles do not permit it (the button is hidden). */
  allowedByRole: boolean
  /** Set when roles permit but a content guard blocks it (button disabled). */
  guard: GuardKey | null
}

/** accepted -> bound is a legal SQL transition, but it is NOT a button:
 * advance_insurance_request only sets the status, it does not create the
 * policy. Binding goes through tci.bind_insurance_request (migration 0023),
 * which drives that same transition itself after issuing the policy. Offering
 * the bare transition here would strand a submission as `bound` with nothing
 * to show for it. */
const NOT_OFFERED_DIRECTLY: readonly InsuranceRequestStatus[] = ['bound']

/** Every transition out of `from` the UI offers, with its role verdict and
 * guard. Not the same set as TRANSITIONS — see NOT_OFFERED_DIRECTLY. */
export function transitionOffers(
  from: InsuranceRequestStatus,
  roles: readonly UserRole[],
  isCreator: boolean,
  facts: { entitiesResolved: boolean; creditComplete: boolean },
): TransitionOffer[] {
  return TRANSITIONS[from]
    .filter((to) => !NOT_OFFERED_DIRECTLY.includes(to))
    .map((to) => ({
      to,
      allowedByRole: canTransitionAs(to, roles, isCreator),
      // A decline always carries its reason from the modal, so the
      // declineNeedsReason guard is enforced at submit time, not here.
      guard: guardFor(to, { ...facts, hasComment: true }),
    }))
}

/** tci.request_entities_resolved: no buyer without an entity, and none
 * still 'pending_entity'. */
export function entitiesResolved(
  buyers: readonly { entity_id: string | null; resolution_status: BuyerResolutionStatus }[],
): boolean {
  return !buyers.some((b) => b.entity_id === null || b.resolution_status === 'pending_entity')
}

/** tci.request_credit_complete: at least one buyer, and every buyer carries
 * an effective credit decision raised inside this submission. */
export function creditComplete(
  buyers: readonly { entity_id: string | null }[],
  decidedEntityIds: ReadonlySet<string>,
): boolean {
  if (!buyers.length) return false
  return buyers.every((b) => b.entity_id !== null && decidedEntityIds.has(b.entity_id))
}

/** Sales, commercial and credit underwriting may raise a submission
 * (the "insurance_requests: workflow write" policy of migration 0019). */
export function canCreateSubmission(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'admin', 'sales', 'commercial_underwriter', 'credit_underwriter')
}

/** Only commercial underwriting shapes the proposed terms, and only while
 * the submission is still being worked (never once terminal). */
export function canEditTerms(
  status: InsuranceRequestStatus,
  roles: readonly UserRole[],
): boolean {
  if (isTerminal(status)) return false
  return hasRole(roles, 'admin', 'commercial_underwriter')
}

/** Resolving a package buyer onto a company: tci.resolve_request_buyer. */
export function canResolveBuyers(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'admin', 'sales', 'information_manager', 'credit_underwriter')
}

/** The package is editable while the submission has not left the sales
 * side of the pipeline. */
export function canEditPackage(
  status: InsuranceRequestStatus,
  roles: readonly UserRole[],
): boolean {
  if (!['draft', 'submitted', 'entity_resolution'].includes(status)) return false
  return hasRole(roles, 'admin', 'sales', 'commercial_underwriter', 'credit_underwriter')
}

export type Tone = 'neutral' | 'accent' | 'pos' | 'neg' | 'warn'

export function statusTone(status: InsuranceRequestStatus): Tone {
  switch (status) {
    case 'draft':
    case 'withdrawn':
      return 'neutral'
    case 'submitted':
    case 'entity_resolution':
    case 'underwriting':
    case 'commercial_review':
      return 'accent'
    case 'sales_confirmation':
    case 'client_review':
      return 'warn'
    case 'accepted':
    case 'bound':
      return 'pos'
    case 'declined':
      return 'neg'
  }
}

export function resolutionTone(status: BuyerResolutionStatus): Tone {
  switch (status) {
    case 'pending_entity':
      return 'warn'
    case 'ready':
      return 'neutral'
    case 'rating_done':
      return 'accent'
    case 'limit_done':
      return 'pos'
  }
}

/** Whole days since submission (queue "age" column); null before submit. */
export function requestAgeDays(submittedAt: string | null, nowIso: string): number | null {
  if (!submittedAt) return null
  const ms = new Date(nowIso).getTime() - new Date(submittedAt).getTime()
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000)
}
