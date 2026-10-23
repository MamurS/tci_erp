/**
 * Credit analysis mode and capabilities (migration 0069) — a pure mirror of
 * tci.has_capability. The database decides; the UI asks this only to offer
 * «Рассчитать рейтинг», «Подтвердить рейтинг» and the decision form.
 *
 *   combined (default)  credit underwriting rates, confirms and decides; a
 *                       credit analyst rates and confirms
 *   separate            only credit analysts rate and confirm; credit
 *                       underwriting decides
 */

import { useQuery } from '@tanstack/react-query'

import { hasRole } from './roles'
import type { UserRole } from './roles'
import { tci } from './supabase'

export const CREDIT_ANALYSIS_MODES = ['combined', 'separate'] as const
export type CreditAnalysisMode = (typeof CREDIT_ANALYSIS_MODES)[number]

export const CREDIT_CAPABILITIES = ['rate', 'confirm_rating', 'decide'] as const
export type CreditCapability = (typeof CREDIT_CAPABILITIES)[number]

export function isCreditAnalysisMode(value: unknown): value is CreditAnalysisMode {
  return typeof value === 'string' && (CREDIT_ANALYSIS_MODES as readonly string[]).includes(value)
}

export function hasCapability(
  roles: readonly UserRole[],
  mode: CreditAnalysisMode,
  capability: CreditCapability,
): boolean {
  switch (capability) {
    case 'rate':
    case 'confirm_rating':
      return mode === 'separate'
        ? hasRole(roles, 'credit_analyst')
        : hasRole(roles, 'credit_analyst', 'credit_underwriter')
    case 'decide':
      return hasRole(roles, 'credit_underwriter')
  }
}

/** The role the rating tasks go to under a mode (tci.rating_task_role). */
export function ratingTaskRole(mode: CreditAnalysisMode): UserRole {
  return mode === 'separate' ? 'credit_analyst' : 'credit_underwriter'
}

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
