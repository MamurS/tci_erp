/** Shared credit-assessment history query (Rating tab, Risk Report, dashboard). */

import { useQuery } from '@tanstack/react-query'

import type { CreditLimitResponse, RatingResponse } from '../../../lib/analytics'
import { tci } from '../../../lib/supabase'

export interface AssessmentRow {
  id: string
  statement_id: string
  rating_score: number
  rating_grade: string
  suggested_limit: number
  limit_currency: string
  engine_version: string
  created_at: string
  calculation_trace: { rating: RatingResponse; limit: CreditLimitResponse } | null
}

/** Assessment history, newest first (decisions are never updated in place). */
export function useAssessments(buyerId: string) {
  return useQuery({
    queryKey: ['buyers', buyerId, 'assessments'],
    queryFn: async (): Promise<AssessmentRow[]> => {
      const { data, error } = await tci()
        .from('credit_assessments')
        .select(
          'id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency, engine_version, created_at, calculation_trace',
        )
        .eq('buyer_id', buyerId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as AssessmentRow[]
    },
  })
}
