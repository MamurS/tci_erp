/**
 * Limit-decision VALIDATION — pure module, mirror of migrations 0060 and 0071
 * (tci.limit_validations, submit_limit_for_validation,
 * submit_adjustment_for_validation, resolve_limit_validation, the committee
 * functions).
 *
 * A decision beyond the author's authority in the buyer's rating band is not
 * recorded: the author sends the proposal up the AUTHORITY LEVELS of the
 * stream (0071) — directly to the lowest rank that covers it (the ranks in
 * between told), or rank by rank — and any eligible member of that level
 * answers; above every rank sits the committee, which decides by vote.
 * Within authority the author may still ask for a second opinion, with a
 * comment, from the next rank up. While a step is pending the decision does
 * not exist. The database enforces all of it; this module only decides what
 * the screens offer and say, and validation.test.ts locks the rules to the
 * migration text.
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
 * authority in the band (in UZS) makes it REQUIRED; a decline (no amount) is
 * always voluntary. Since 0063 nobody is exempt (admin decides nothing).
 * `authorityUzs === null` means the screen cannot tell (no rate) — the
 * database will answer. */
export function validationKind(input: {
  amountUzs: number | null
  authorityUzs: number | null
}): ValidationKind | null {
  if (input.amountUzs === null) return 'voluntary'
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

/** tci.limit_request_validation_state(): what any colleague may know. */
export interface ValidationState {
  request_id: string
  validation_id: string
  stream: AuthorityScope
  kind: ValidationKind
  /** Null for a step that sits with an authority level (0071). */
  validator_id: string | null
  validator_name: string | null
  since: string
}

/** tci.limit_request_validation_levels() / limit_validation_levels(): the
 * level a step sits with. */
export interface StepLevel {
  validation_id: string
  rank: number
  is_committee: boolean
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
  validator_id: string | null
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
  validator_id: string | null
  level_id: string | null
  status: ValidationStatus
  created_at: string
}

/** A 0060 step named to the caller (a level step is answered through
 * tci.validation_step_state's `can_answer`). */
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

// ---------------------------------------------------------------------------
// Authority levels and the committee (0071)
// ---------------------------------------------------------------------------

/** workflow_settings.authority_routing. */
export const AUTHORITY_ROUTINGS = ['direct', 'sequential'] as const
export type AuthorityRouting = (typeof AUTHORITY_ROUTINGS)[number]

/** The committee is rank 5 of each stream. */
export const COMMITTEE_RANK = 5
export const LEVEL_RANKS = [1, 2, 3, 4, 5] as const

export interface PersonRef {
  user_id: string
  name: string | null
}

/** tci.validation_route_preview(): where a proposal would go now. */
export type RoutePreview =
  | { available: false; kind: ValidationKind; routing: AuthorityRouting; my_rank: number }
  | {
      available: true
      kind: ValidationKind
      routing: AuthorityRouting
      my_rank: number
      level_id: string
      rank: number
      is_committee: boolean
      members: PersonRef[]
      fyi: PersonRef[]
    }

export const COMMITTEE_VOTES = ['approve', 'reject', 'abstain'] as const
export type CommitteeVote = (typeof COMMITTEE_VOTES)[number]

export interface CommitteeState {
  chair_id: string | null
  chair_name: string | null
  electorate: number
  votes: { voter: string; name: string | null; vote: CommitteeVote; comment: string | null; voted_at: string }[]
  conflicts: { member: string; name: string | null; reason: string; declared_at: string }[]
  cast: number
  approve: number
  reject: number
  abstain: number
  quorum_met: boolean
  my_vote: CommitteeVote | null
  i_may_vote: boolean
  i_am_conflicted: boolean
  i_may_close: boolean
}

/** tci.validation_step_state(). */
export interface StepState {
  id: string
  status: ValidationStatus
  stream: AuthorityScope
  level_id: string | null
  rank: number | null
  is_committee: boolean
  can_answer: boolean
  answerers: PersonRef[]
  committee?: CommitteeState
}

/** Quorum: at least half of the electorate has voted (close_committee_vote). */
export function quorumMet(cast: number, electorate: number): boolean {
  return electorate > 0 && cast * 2 >= electorate
}

/** What closing the vote records: more approvals approve, more rejections
 * reject, a tie goes the chair's way, and without the chair's vote the
 * proposal goes back to its author. */
export function committeeOutcome(input: {
  approve: number
  reject: number
  chairVote: CommitteeVote | null
}): 'approve' | 'reject' | 'return' {
  if (input.approve > input.reject) return 'approve'
  if (input.reject > input.approve) return 'reject'
  if (input.chairVote === 'approve') return 'approve'
  if (input.chairVote === 'reject') return 'reject'
  return 'return'
}

/** The minutes must say why when the committee does not approve. */
export function closeNeedsComment(outcome: 'approve' | 'reject' | 'return'): boolean {
  return outcome !== 'approve'
}

/** A vote to reject must say why; approve and abstain may. */
export function voteNeedsComment(vote: CommitteeVote): boolean {
  return vote === 'reject'
}
