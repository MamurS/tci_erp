/**
 * Limit request status machine — pure module, EXACT mirror of the SQL
 * functions in migration 0013 (submit_limit_request, start_limit_review,
 * withdraw_limit_request, decide_limit_request). The database enforces;
 * this module only drives which actions the UI offers.
 */

import { hasRole } from '../../lib/roles'
import type { LimitRequestStatus } from './types'
import type { UserRole } from '../../lib/roles'

/** Statuses covered by the one-open-request partial unique index (0067 adds
 * information gathering: the request is open, only nobody may decide it yet). */
export const OPEN_STATUSES: readonly LimitRequestStatus[] = [
  'draft', 'submitted', 'information_gathering', 'under_review', 'escalated',
]

export function isOpen(status: LimitRequestStatus): boolean {
  return OPEN_STATUSES.includes(status)
}

/** draft -> submitted (policy must be active — the function checks). */
export function canSubmit(status: LimitRequestStatus): boolean {
  return status === 'draft'
}

/** submitted -> under_review. */
export function canStartReview(status: LimitRequestStatus): boolean {
  return status === 'submitted'
}

/** Statuses tci.decide_limit_request accepts. */
export function canDecide(status: LimitRequestStatus): boolean {
  return status === 'submitted' || status === 'under_review' || status === 'escalated'
}

/** Credit underwriting decides (Phase 3b): there is no 'senior' role any
 * more, and since 0063 an administrator makes no limit decisions at all — the
 * role is technical. Since 0060 an amount beyond the decider's band authority
 * is sent to a named validator rather than escalated; `escalated` then means
 * either «on validation» (decided only by that validator, from the validation
 * panel — the page hides this form while a step is pending) or a group-limit
 * breach (0040), which any credit underwriter whose authority covers it may
 * decide. The SQL functions enforce the amount and the four-eyes rule
 * (`fourEyes.ts`); this only gates the form by role. */
export function canDecideAs(status: LimitRequestStatus, roles: readonly UserRole[]): boolean {
  if (!canDecide(status)) return false
  return hasRole(roles, 'credit_underwriter')
}

/** Sales, commercial and credit underwriting may raise limit requests. */
export function canCreateRequest(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'sales', 'commercial_underwriter', 'credit_underwriter')
}

/** Requester, or anyone who may decide, on any open request. */
export function canWithdraw(
  status: LimitRequestStatus,
  roles: readonly UserRole[],
  isRequester: boolean,
): boolean {
  if (!isOpen(status)) return false
  return isRequester || hasRole(roles, 'credit_underwriter')
}

export function statusTone(
  status: LimitRequestStatus,
): 'neutral' | 'accent' | 'pos' | 'neg' | 'warn' {
  switch (status) {
    case 'draft':
      return 'neutral'
    case 'submitted':
    case 'under_review':
      return 'accent'
    // waiting on the information desk, not on a decision (0067)
    case 'information_gathering':
      return 'warn'
    case 'escalated':
      return 'warn'
    case 'decided':
      return 'pos'
    case 'withdrawn':
      return 'neutral'
  }
}

export function outcomeTone(
  outcome: 'approved' | 'partial' | 'declined' | 'revoked',
): 'neutral' | 'accent' | 'pos' | 'neg' | 'warn' {
  switch (outcome) {
    case 'approved':
      return 'pos'
    case 'partial':
      return 'warn'
    case 'declined':
    case 'revoked':
      return 'neg'
  }
}

/** A request waiting longer than this many days since submission is
 * highlighted in the queue: it has sat longer than a decision usually takes. */
export const REQUEST_AGE_WARN_DAYS = 5

/** Whole days since submission (queue "age" column); null before submit. */
export function requestAgeDays(submittedAt: string | null, nowIso: string): number | null {
  if (!submittedAt) return null
  const ms = new Date(nowIso).getTime() - new Date(submittedAt).getTime()
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000)
}
