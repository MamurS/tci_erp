/**
 * Rating proposals (migration 0073) — pure module.
 *
 * A grade suggested by a person — manual (no engine rating behind it) or for
 * the buyer's current, unconfirmed engine rating — comes into force only when
 * a second person confirms it: a colleague who confirms ratings under the
 * credit analysis mode, or a member of a credit authority level it was
 * escalated to, rank by rank; the committee (rank 5) decides by vote under
 * the rules of 0071 (`committeeOutcome` / `quorumMet` in limits/validation).
 * The database decides; this module mirrors what the screen needs to offer.
 */

import type { CommitteeState } from '../../limits/validation'

export type ProposalRoute = 'colleague' | 'level'

/** tci.rating_proposal_steps.status. */
export const PROPOSAL_STATUSES = [
  'pending',
  'approved',
  'modified',
  'returned',
  'rejected',
  'forwarded',
  'withdrawn',
] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

/** What an answerer may do (tci.resolve_rating_proposal). */
export const PROPOSAL_ACTIONS = ['approve', 'approve_modified', 'return', 'reject', 'forward'] as const
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number]

export interface PersonRef {
  user_id: string
  name: string | null
}

export interface PendingProposal {
  step_id: string
  proposal_id: string
  route: ProposalRoute
  level_id: string | null
  rank: number | null
  is_committee: boolean
  grade: string
  reason: string
  manual: boolean
  assessment_id: string | null
  statement_id: string | null
  proposed_by: string
  proposed_by_name: string | null
  proposed_at: string
  opened_at: string
  mine: boolean
  can_answer: boolean
  answerers: PersonRef[]
  committee?: CommitteeState
}

export interface ProposalHistoryItem {
  step_id: string
  proposal_id: string
  route: ProposalRoute
  rank: number | null
  is_committee: boolean
  status: Exclude<ProposalStatus, 'pending'>
  grade: string
  resolved_grade: string | null
  reason: string
  manual: boolean
  proposed_by_name: string | null
  opened_by_name: string | null
  opened_at: string
  resolved_by_name: string | null
  resolved_at: string
  comment: string | null
  result_assessment_id: string | null
}

/** tci.rating_proposal_state(entity). */
export interface ProposalState {
  pending: PendingProposal | null
  history: ProposalHistoryItem[]
  can_propose: boolean
}

/** The grade pattern of the scale, as tci.rating_grade_normalised reads it:
 * a letter A–D and up to two digits. Used only when the scale itself (served
 * by the analytics service) is unavailable. */
export const GRADE_PATTERN = /^[A-D][0-9]{0,2}$/

export function normaliseGrade(input: string): string | null {
  const grade = input.trim().toUpperCase()
  return GRADE_PATTERN.test(grade) ? grade : null
}

/** A return, a rejection and another grade must say why; an approval and a
 * forward may. */
export function proposalActionNeedsComment(action: ProposalAction): boolean {
  return action === 'approve_modified' || action === 'return' || action === 'reject'
}

/** Whether the panel offers «forward to the next rank»: not before the
 * committee, which is the top of the chain. */
export function mayForward(pending: Pick<PendingProposal, 'route' | 'is_committee'>): boolean {
  return !(pending.route === 'level' && pending.is_committee)
}

export function proposalTone(status: ProposalStatus): 'neutral' | 'accent' | 'pos' | 'neg' | 'warn' {
  switch (status) {
    case 'pending':
      return 'warn'
    case 'approved':
    case 'modified':
      return 'pos'
    case 'rejected':
      return 'neg'
    case 'forwarded':
      return 'accent'
    default:
      return 'neutral'
  }
}

/** The grade the history shows as the outcome: the answerer's when they set
 * another, the proposed one when approved as is, none otherwise. */
export function outcomeGrade(item: Pick<ProposalHistoryItem, 'status' | 'grade' | 'resolved_grade'>): string | null {
  if (item.status === 'modified') return item.resolved_grade
  if (item.status === 'approved') return item.resolved_grade ?? item.grade
  return null
}
