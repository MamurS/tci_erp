/**
 * The credit analysis mode as the database answers it
 * (tci.credit_analysis_mode, migration 0069). Kept apart from the pure
 * mirror in creditAnalysis.ts so that its contract tests never load the
 * Supabase client.
 */

import { useQuery } from '@tanstack/react-query'

import { isCreditAnalysisMode } from './creditAnalysis'
import type { CreditAnalysisMode } from './creditAnalysis'
import { tci } from './supabase'

export const CREDIT_ANALYSIS_MODE_KEY = ['settings', 'credit-analysis-mode'] as const

/** The current mode. Until it is known — or when it cannot be read — the
 * default 'combined' is assumed: the database still refuses what it must. */
export function useCreditAnalysisMode(enabled = true): CreditAnalysisMode {
  const { data } = useQuery({
    queryKey: CREDIT_ANALYSIS_MODE_KEY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CreditAnalysisMode> => {
      const { data: mode, error } = await tci().rpc('credit_analysis_mode')
      if (error) throw error
      return isCreditAnalysisMode(mode) ? mode : 'combined'
    },
  })
  return data ?? 'combined'
}
