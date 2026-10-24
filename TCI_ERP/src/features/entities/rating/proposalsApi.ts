/** Rating proposals (migration 0073): the buyer's pending proposal and its
 * history, and every answer to it. Each write returns the new state, which
 * replaces the cached one; the assessments and the grade badges are
 * refetched, since an approval puts a grade into force. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../../lib/supabase'
import type { CommitteeVote } from '../../limits/validation'
import type { ProposalAction, ProposalState } from './proposals'

export const proposalKey = (entityId: string) => ['buyers', entityId, 'rating-proposals'] as const

/** Only the credit desk (and admin's read oversight) may read proposals; for
 * anyone else the query stays off rather than ask for a refusal. */
export function useRatingProposals(entityId: string, enabled: boolean) {
  return useQuery({
    queryKey: proposalKey(entityId),
    enabled,
    queryFn: async (): Promise<ProposalState> => {
      const { data, error } = await tci().rpc('rating_proposal_state', { p_entity_id: entityId })
      if (error) throw error
      return data as ProposalState
    },
  })
}

export interface ProposeInput {
  grade: string
  reason: string
  /** The engine rating the grade is for; null = a manual rating. */
  assessmentId: string | null
  statementId: string | null
  escalate: boolean
}

type CloseResult = ProposalState & { committee: { action: 'approve' | 'reject' | 'return' } }

export function useProposalActions(entityId: string) {
  const queryClient = useQueryClient()
  const settle = (state: ProposalState) => {
    queryClient.setQueryData(proposalKey(entityId), state)
    void queryClient.invalidateQueries({ queryKey: ['buyers', entityId, 'assessments'] })
    void queryClient.invalidateQueries({ queryKey: ['buyers', entityId, 'latest-grade'] })
    void queryClient.invalidateQueries({ queryKey: ['entities', entityId, 'latest-grade'] })
    void queryClient.invalidateQueries({ queryKey: ['entities', 'latest-grades'] })
    void queryClient.invalidateQueries({ queryKey: ['agenda'] })
  }
  const call = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await tci().rpc(fn, args)
    if (error) throw error
    return data as T
  }

  const propose = useMutation({
    mutationKey: ['rating', 'propose'],
    mutationFn: (input: ProposeInput) =>
      call<ProposalState>('propose_rating', {
        p_entity_id: entityId,
        p_grade: input.grade,
        p_reason: input.reason,
        p_assessment_id: input.assessmentId,
        p_statement_id: input.statementId,
        p_escalate: input.escalate,
      }),
    onSuccess: settle,
  })
  const resolve = useMutation({
    mutationKey: ['rating', 'resolve'],
    mutationFn: (input: { stepId: string; action: ProposalAction; grade: string | null; comment: string | null }) =>
      call<ProposalState>('resolve_rating_proposal', {
        p_step_id: input.stepId,
        p_action: input.action,
        p_grade: input.grade,
        p_comment: input.comment,
      }),
    onSuccess: settle,
  })
  const withdraw = useMutation({
    mutationKey: ['rating', 'withdraw'],
    mutationFn: (input: { stepId: string; comment: string | null }) =>
      call<ProposalState>('withdraw_rating_proposal', { p_step_id: input.stepId, p_comment: input.comment }),
    onSuccess: settle,
  })
  const vote = useMutation({
    mutationKey: ['rating', 'vote'],
    mutationFn: (input: { stepId: string; vote: CommitteeVote; comment: string | null }) =>
      call<ProposalState>('cast_rating_vote', { p_step_id: input.stepId, p_vote: input.vote, p_comment: input.comment }),
    onSuccess: settle,
  })
  const conflict = useMutation({
    mutationKey: ['rating', 'conflict'],
    mutationFn: (input: { stepId: string; reason: string }) =>
      call<ProposalState>('declare_rating_conflict', { p_step_id: input.stepId, p_reason: input.reason }),
    onSuccess: settle,
  })
  const close = useMutation({
    mutationKey: ['rating', 'close'],
    mutationFn: (input: { stepId: string; comment: string | null }) =>
      call<CloseResult>('close_rating_vote', { p_step_id: input.stepId, p_comment: input.comment }),
    onSuccess: settle,
  })
  return { propose, resolve, withdraw, vote, conflict, close }
}
