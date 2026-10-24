/** Shared credit-assessment history query (Rating tab, Risk Report, dashboard). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { CreditLimitResponse, RatingResponse } from '../../../lib/analytics'
import { tci } from '../../../lib/supabase'

export interface AssessmentRow {
  id: string
  /** Null for a manual rating entered without a statement (0073). */
  statement_id: string | null
  /** Null for a manual rating (0073): no engine score. */
  rating_score: number | null
  /** The grade IN FORCE: the engine's until confirmed, then the confirmed
   * one (0069). */
  rating_grade: string
  /** What the engine calculated, frozen on insert (0069). */
  engine_grade: string | null
  /** engine | manual (0073): a manual grade came into force through a
   * rating proposal a second person confirmed. */
  source: 'engine' | 'manual'
  manual_reason: string | null
  created_by: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  confirmation_comment: string | null
  /** Null for a manual rating: no recommended limit (0073). */
  suggested_limit: number | null
  limit_currency: string | null
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
          'id, statement_id, rating_score, rating_grade, engine_grade, source, manual_reason, created_by, confirmed_by, confirmed_at, confirmation_comment, suggested_limit, limit_currency, engine_version, created_at, calculation_trace',
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
