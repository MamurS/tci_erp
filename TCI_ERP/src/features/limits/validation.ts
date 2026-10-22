/**
 * Limit-decision VALIDATION — pure module, mirror of migration 0060
 * (tci.limit_validations, submit_limit_for_validation,
 * submit_adjustment_for_validation, resolve_limit_validation).
 *
 * A decision beyond the author's authority in the buyer's rating band is not
 * escalated to a pool any more: nothing is recorded, the author sends the
 * proposal to a NAMED colleague of the same department whose authority covers
 * it (credit → credit, commercial → commercial). Within authority the author
 * may still send it voluntarily — a second opinion, with a comment. While a
 * step is pending the decision does not exist. The database enforces all of
 * it; this module only decides what the screens offer and say, and
 * validation.test.ts locks every rule to the 0060 text.
 */

import type { AuthorityScope, GradeBand } from '../../lib/roles'
import type { DecisionOutcome } from './types'

/** tci.validation_status, in the enum's order. */
export const VALIDATION_STATUSES = [
  'pending',
  'approved',
  'approved_modified',
  'returned',
  'rejected',
  'forwarded',
  'cancelled',
] as const
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number]

/** tci.validation_kind: beyond authority (required) or a second opinion. */
export const VALIDATION_KINDS = ['required', 'voluntary'] as const
export type ValidationKind = (typeof VALIDATION_KINDS)[number]

/** What the validator may answer (resolve_limit_validation's p_action). */
export const VALIDATION_ACTIONS = ['approve', 'approve_modified', 'return', 'reject', 'forward'] as const
export type ValidationAction = (typeof VALIDATION_ACTIONS)[number]

/** Return and reject must say why; the others may. */
export function actionNeedsComment(action: ValidationAction): boolean {
  return action === 'return' || action === 'reject'
}

/** Mirrors v_kind in both submit functions: an amount beyond the author's
 * authority in the band (in UZS) makes it REQUIRED; admin never needs it; a
 * decline (no amount) is always voluntary. `authorityUzs === null` means the
 * screen cannot tell (no rate) — the database will answer. */
export function validationKind(input: {
  amountUzs: number | null
  authorityUzs: number | null
  isAdmin: boolean
}): ValidationKind | null {
  if (input.isAdmin || input.amountUzs === null) return 'voluntary'
  if (input.authorityUzs === null) return null
  return input.amountUzs > input.authorityUzs ? 'required' : 'voluntary'
}

/** A voluntary step must say what the second opinion is about. */
export function submitNeedsComment(kind: ValidationKind | null): boolean {
  return kind !== 'required'
}

/** A commercial REDUCTION works at once (the emergency path) and is never
 * validated: submit_adjustment_for_validation refuses it. */
export function adjustmentCanBeValidated(newAmount: number, creditAmount: number): boolean {
  return newAmount >= creditAmount
}

/** What a credit approval records, as resolve_limit_validation decides it:
 * the outcome follows the amount against the REQUESTED amount, and approving
 * a proposed decline as is records the decline. */
export function creditApprovalOutcome(input: {
  proposed: Exclude<DecisionOutcome, 'revoked'>
  action: 'approve' | 'approve_modified'
  amount: number | null
  requestedAmount: number
}): 'approved' | 'partial' | 'declined' {
  if (input.proposed === 'declined' && input.action === 'approve') return 'declined'
  if (input.amount === null) return 'declined'
  return input.amount < input.requestedAmount ? 'partial' : 'approved'
}

/** The department a stream is validated in (tci.validation_role). */
export const VALIDATION_ROLE: Readonly<Record<AuthorityScope, 'credit_underwriter' | 'commercial_underwriter'>> = {
  credit: 'credit_underwriter',
  commercial: 'commercial_underwriter',
}

/** What approve-modified may change, per stream: credit the amount (the
 * outcome follows it); commercial the amount and the payment terms. The
 * rating, the validity and the conditions never change on validation. */
export const MODIFIABLE: Readonly<Record<AuthorityScope, readonly ('amount' | 'paymentTerms')[]>> = {
  credit: ['amount'],
  commercial: ['amount', 'paymentTerms'],
}

/** Badge tone per status. */
export function validationTone(status: ValidationStatus): 'neutral' | 'accent' | 'pos' | 'neg' | 'warn' {
  switch (status) {
    case 'pending':
      return 'warn'
    case 'approved':
    case 'approved_modified':
      return 'pos'
    case 'returned':
      return 'accent'
    case 'rejected':
      return 'neg'
    case 'forwarded':
    case 'cancelled':
      return 'neutral'
  }
}

// ---------------------------------------------------------------------------
// Row shapes the 0060 functions answer with
// ---------------------------------------------------------------------------

/** tci.validation_candidates(): a colleague who may validate. Admin's
 * authority is unlimited — Postgres 'Infinity', which reaches the browser as
 * the string "Infinity" (or a non-finite number). */
export interface ValidationCandidate {
  user_id: string
  full_name: string | null
  email: string
  is_manager: boolean
  authority_uzs: number | string | null
}

/** The authority of a candidate as a number; Infinity for unlimited. */
export function candidateAuthority(value: number | string | null): number | null {
  if (value === null || value === undefined) return null
  if (value === 'Infinity' || value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  const n = Number(value)
  return Number.isNaN(n) ? null : n
}

/** The one to preselect: the manager when they qualify (the function lists
 * them first), else nobody — the author picks. */
export function defaultCandidate(candidates: readonly ValidationCandidate[]): string | null {
  return candidates.find((c) => c.is_manager)?.user_id ?? null
}

/** tci.limit_request_validation_state(): what any colleague may know. */
export interface ValidationState {
  request_id: string
  validation_id: string
  stream: AuthorityScope
  kind: ValidationKind
  validator_id: string
  validator_name: string | null
  since: string
}

/** tci.limit_validation_history(): one step of a chain, with names. */
export interface ValidationStep {
  id: string
  chain_id: string
  parent_id: string | null
  stream: AuthorityScope
  kind: ValidationKind
  outcome: Exclude<DecisionOutcome, 'revoked'>
  amount: number | null
  currency_code: string
  payment_terms_days: number | null
  grade_band: GradeBand
  comment: string | null
  proposed_by: string
  proposed_by_name: string | null
  forwarded_by: string | null
  forwarded_by_name: string | null
  validator_id: string
  validator_name: string | null
  status: ValidationStatus
  resolution_comment: string | null
  resolved_at: string | null
  resulting_decision_id: string | null
  created_at: string
}

/** The full proposal row (tci.limit_validations, readable by the chain). */
export interface ValidationProposal {
  id: string
  chain_id: string
  request_id: string
  stream: AuthorityScope
  kind: ValidationKind
  outcome: Exclude<DecisionOutcome, 'revoked'>
  amount: number | null
  currency_code: string
  payment_terms_days: number | null
  valid_from: string | null
  valid_until: string | null
  conditions: { condition_type: string; description: string }[]
  assessment_id: string | null
  adjusts_decision_id: string | null
  grade_band: GradeBand
  amount_uzs: number | null
  comment: string | null
  proposed_by: string
  forwarded_by: string | null
  validator_id: string
  status: ValidationStatus
  created_at: string
}

/** The step the caller has to answer, if any: pending and addressed to them. */
export function myPendingStep<T extends Pick<ValidationStep, 'status' | 'validator_id'>>(
  steps: readonly T[],
  userId: string | undefined,
): T | null {
  if (!userId) return null
  return steps.find((s) => s.status === 'pending' && s.validator_id === userId) ?? null
}

/** Chains, newest first, each in step order (oldest step first). */
export function chainsOf<T extends Pick<ValidationStep, 'chain_id' | 'created_at'>>(steps: readonly T[]): T[][] {
  const byChain = new Map<string, T[]>()
  for (const step of [...steps].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const list = byChain.get(step.chain_id) ?? []
    list.push(step)
    byChain.set(step.chain_id, list)
  }
  return [...byChain.values()].sort((a, b) => b[0]!.created_at.localeCompare(a[0]!.created_at))
}

/** What decide_limit_request / adjust_limit_commercial answer beyond the
 * author's authority (0060): nothing recorded, send it for validation. */
export interface NeedsValidation {
  result: 'needs_validation'
  grade_band: GradeBand
  amount_uzs: number
  authority_uzs: number
}
