/** Shared credit-assessment history query (Rating tab, Risk Report, dashboard). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { CreditLimitResponse, RatingResponse } from '../../../lib/analytics'
import { tci } from '../../../lib/supabase'

export interface AssessmentRow {
  id: string
  statement_id: string
  rating_score: number
  /** The grade IN FORCE: the engine's until confirmed, then the confirmed
   * one (0069). */
  rating_grade: string
  /** What the engine calculated, frozen on insert (0069). */
  engine_grade: string | null
  created_by: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  confirmation_comment: string | null
  suggested_limit: number
  limit_currency: string
  engine_version: string
  created_at: string
  calculation_trace: { rating: RatingResponse; limit: CreditLimitResponse } | null
}

/** Assessment history, newest first (decisions are never updated in place). */
export function useAssessments(entityId: string) {
  return useQuery({
    queryKey: ['buyers', entityId, 'assessments'],
    queryFn: async (): Promise<AssessmentRow[]> => {
      const { data, error } = await tci()
        .from('credit_assessments')
        .select(
          'id, statement_id, rating_score, rating_grade, engine_grade, created_by, confirmed_by, confirmed_at, confirmation_comment, suggested_limit, limit_currency, engine_version, created_at, calculation_trace',
        )
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as AssessmentRow[]
    },
  })
}

export interface ConfirmRatingInput {
  entityId: string
  assessmentId: string
  /** null = the engine's grade */
  grade: string | null
  comment: string
}

/** tci.confirm_rating (0069): the one-time confirmation of the current rating. */
export function useConfirmRating() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ConfirmRatingInput): Promise<void> => {
      const { error } = await tci().rpc('confirm_rating', {
        p_assessment_id: input.assessmentId,
        p_grade: input.grade,
        p_comment: input.comment.trim() || null,
      })
      if (error) throw error
    },
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: ['buyers', input.entityId, 'assessments'] })
      void queryClient.invalidateQueries({ queryKey: ['buyers', input.entityId, 'latest-grade'] })
      void queryClient.invalidateQueries({ queryKey: ['entities', 'latest-grades'] })
      void queryClient.invalidateQueries({ queryKey: ['limits'] })
    },
  })
}
