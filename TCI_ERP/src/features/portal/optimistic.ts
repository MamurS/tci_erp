/** What a policyholder's own write is certain to change, painted before the
 * answer. Each target status is the one the client_* function hands to the
 * state machine (0025 for submissions, 0036 for claims). */

import type { SubmissionAction } from './api'

/** tci.client_respond_to_submission: accept → accepted, decline → declined,
 * request changes → back to sales confirmation. */
export const SUBMISSION_RESPONSE_STATUS: Record<SubmissionAction, string> = {
  accept: 'accepted',
  decline: 'declined',
  request_changes: 'sales_confirmation',
}

/** The portal's claim actions and the status each leaves the claim in. */
export const CLIENT_CLAIM_STATUS = {
  submit: 'submitted',
  withdraw: 'withdrawn',
  respond: 'under_assessment',
} as const

/** The portal queries a claim write affects: the claims, the claim's own
 * tabs, what can still be claimed and the policyholder's tasks — not their
 * policies, limits or declarations. */
export function portalClaimQueryAffected(key: readonly unknown[]): boolean {
  if (key[0] !== 'portal') return false
  const kind = String(key[1] ?? '')
  return kind === 'claims' || kind.startsWith('claim-') || kind === 'claimable' || kind === 'tasks'
}
