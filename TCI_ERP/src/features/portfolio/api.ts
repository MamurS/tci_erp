/** Reads for the portfolio pages (migration 0052, plus the group view of 0040). */

import { useQuery } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { GroupExposure } from '../groups/types'
import type { CreditPortfolioRow, PolicyPortfolioRow } from './aggregate'

export function usePolicyPortfolio() {
  return useQuery({
    queryKey: ['portfolio', 'policies'],
    queryFn: async (): Promise<PolicyPortfolioRow[]> => {
      const { data, error } = await tci().from('v_policy_portfolio').select('*').order('policy_number')
      if (error) throw error
      return (data ?? []) as unknown as PolicyPortfolioRow[]
    },
  })
}

export function useCreditPortfolio() {
  return useQuery({
    queryKey: ['portfolio', 'credit'],
    queryFn: async (): Promise<CreditPortfolioRow[]> => {
      const { data, error } = await tci().from('v_credit_portfolio').select('*').order('buyer_name')
      if (error) throw error
      return (data ?? []) as unknown as CreditPortfolioRow[]
    },
  })
}

/** The corporate groups carrying the most in-force exposure. */
export function useTopGroups(limit: number) {
  return useQuery({
    queryKey: ['portfolio', 'groups', limit],
    queryFn: async (): Promise<GroupExposure[]> => {
      const { data, error } = await tci()
        .from('v_group_exposure')
        .select('*')
        .gt('members_with_limits', 1)
        .order('exposure_uzs', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as unknown as GroupExposure[]
    },
  })
}
