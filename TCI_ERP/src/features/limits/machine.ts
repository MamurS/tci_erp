/**
 * Limit request status machine — pure module, EXACT mirror of the SQL
 * functions in migration 0013 (submit_limit_request, start_limit_review,
 * withdraw_limit_request, decide_limit_request). The database enforces;
 * this module only drives which actions the UI offers.
 */

import { hasRole } from '../../lib/roles'
import type { LimitRequestStatus } from './types'
import type { UserRole } from '../../lib/roles'

/** Statuses covered by the one-open-request partial unique index. */
export const OPEN_STATUSES: readonly LimitRequestStatus[] = [
  'draft', 'submitted', 'under_review', 'escalated',
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
 * more - an escalated request is decidable by any credit underwriter whose
 * BAND authority covers the amount (the SQL function enforces the amount;
 * this only gates who may open the form) or by an admin. */
export function canDecideAs(status: LimitRequestStatus, roles: readonly UserRole[]): boolean {
  if (!canDecide(status)) return false
  return hasRole(roles, 'admin', 'credit_underwriter')
}

/** Sales, commercial and credit underwriting may raise limit requests. */
export function canCreateRequest(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'admin', 'sales', 'commercial_underwriter', 'credit_underwriter')
}

/** Requester, or anyone who may decide, on any open request. */
export function canWithdraw(
  status: LimitRequestStatus,
  roles: readonly UserRole[],
  isRequester: boolean,
): boolean {
  if (!isOpen(status)) return false
  return isRequester || hasRole(roles, 'admin', 'credit_underwriter')
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

/** Whole days since submission (queue "age" column); null before submit. */
export function requestAgeDays(submittedAt: string | null, nowIso: string): number | null {
  if (!submittedAt) return null
  const ms = new Date(nowIso).getTime() - new Date(submittedAt).getTime()
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000)
}
