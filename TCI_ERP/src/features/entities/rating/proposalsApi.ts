/** Rating proposals (migration 0073): the buyer's pending proposal and its
 * history, and every answer to it. Each write returns the new state, which
 * replaces the cached one; the assessments and the grade badges are
 * refetched, since an approval puts a grade into force. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../../lib/supabase'
import type { CommitteeVote } from '../../limits/validation'
import type { ProposalAction, ProposalState, SendOptions, SubmitRoute } from './proposals'
import { DEFAULT_WEIGHTS } from './scorecard'
import type { ScorecardOf, StoredScorecard, Weights } from './scorecard'

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
  /** The scorecard the grade is built from (0079): its `grade` is the grade
   * proposed. */
  scorecard: { grade: string; reason: string; pillars: unknown[] }
  /** The free-text justification. */
  reason: string
  /** The engine rating the grade is for; null = a manual rating. */
  assessmentId: string | null
  statementId: string | null
  route: SubmitRoute
  /** A named colleague (route `colleague`); null = any colleague. */
  colleague: string | null
}

/** Whom each route reaches (tci.rating_send_options, 0078). */
export function useRatingSendOptions(entityId: string, assessmentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['buyers', entityId, 'rating-send-options', assessmentId],
    enabled,
    queryFn: async (): Promise<SendOptions> => {
      const { data, error } = await tci().rpc('rating_send_options', {
        p_entity_id: entityId,
        p_assessment_id: assessmentId,
      })
      if (error) throw error
      return data as SendOptions
    },
  })
}

/** The default pillar weights (admin's, 0079). */
export const SCORECARD_SETTINGS_KEY = ['rating', 'scorecard-settings'] as const

export function useScorecardSettings(enabled = true) {
  return useQuery({
    queryKey: SCORECARD_SETTINGS_KEY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Weights> => {
      const { data, error } = await tci().rpc('rating_scorecard_settings')
      if (error) throw error
      return ((data as { weights?: Weights } | null)?.weights ?? DEFAULT_WEIGHTS) as Weights
    },
  })
}

/** The scorecards of the buyer's proposals, by proposal id (the credit
 * desk's RLS decides who reads them). */
export function useProposalScorecards(entityId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['buyers', entityId, 'rating-scorecards'],
    enabled,
    queryFn: async (): Promise<Record<string, StoredScorecard>> => {
      const { data, error } = await tci()
        .from('rating_proposals')
        .select('id, scorecard')
        .eq('entity_id', entityId)
        .not('scorecard', 'is', null)
      if (error) throw error
      return Object.fromEntries(
        ((data ?? []) as { id: string; scorecard: StoredScorecard }[]).map((r) => [r.id, r.scorecard]),
      )
    },
  })
}

/** The scorecard behind a grade in force (tci.rating_scorecard_of). */
export function useScorecardOf(entityId: string, assessmentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['buyers', entityId, 'rating-scorecard-of', assessmentId],
    enabled: enabled && assessmentId !== null,
    queryFn: async (): Promise<ScorecardOf | null> => {
      const { data, error } = await tci().rpc('rating_scorecard_of', { p_assessment_id: assessmentId })
      if (error) throw error
      return (data as ScorecardOf | null) ?? null
    },
  })
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
    void queryClient.invalidateQueries({ queryKey: ['buyers', entityId, 'rating-scorecards'] })
    void queryClient.invalidateQueries({ queryKey: ['buyers', entityId, 'rating-scorecard-of'] })
  }
  const call = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await tci().rpc(fn, args)
    if (error) throw error
    return data as T
  }

  const propose = useMutation({
    mutationKey: ['rating', 'propose'],
    mutationFn: (input: ProposeInput) =>
      call<ProposalState>('submit_rating_scorecard', {
        p_entity_id: entityId,
        p_scorecard: input.scorecard,
        p_reason: input.reason,
        p_route: input.route,
        p_colleague: input.route === 'colleague' ? input.colleague : null,
        p_assessment_id: input.assessmentId,
        p_statement_id: input.statementId,
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
