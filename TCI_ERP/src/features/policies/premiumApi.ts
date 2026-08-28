/** Data access for policy premium (migration 0027). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { PolicyPremium, PremiumInstalment } from './premium'

const KEYS = {
  premium: (policyId: string) => ['premium', 'policy', policyId] as const,
  instalments: (policyId: string) => ['premium', 'instalments', policyId] as const,
  entries: (policyId: string) => ['premium', 'entries', policyId] as const,
}

export interface PremiumEntry {
  id: string
  declaration_id: string
  policy_id: string
  covered_turnover: number
  rate_used: number
  amount: number
  currency_code: string
  computed_at: string
}

export function usePolicyPremium(policyId: string | undefined) {
  return useQuery({
    queryKey: KEYS.premium(policyId ?? ''),
    enabled: Boolean(policyId),
    queryFn: async (): Promise<PolicyPremium | null> => {
      const { data, error } = await tci()
        .from('v_policy_premium')
        .select('*')
        .eq('policy_id', policyId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as PolicyPremium | null
    },
  })
}

export function usePremiumInstalments(policyId: string | undefined) {
  return useQuery({
    queryKey: KEYS.instalments(policyId ?? ''),
    enabled: Boolean(policyId),
    queryFn: async (): Promise<PremiumInstalment[]> => {
      const { data, error } = await tci()
        .from('premium_instalments')
        .select('*')
        .eq('policy_id', policyId!)
        .order('sequence')
      if (error) throw error
      return (data ?? []) as unknown as PremiumInstalment[]
    },
  })
}

/** Earned premium, one row per accepted declaration, each with the rate it
 * was written at. */
export function usePremiumEntries(policyId: string | undefined) {
  return useQuery({
    queryKey: KEYS.entries(policyId ?? ''),
    enabled: Boolean(policyId),
    queryFn: async (): Promise<PremiumEntry[]> => {
      const { data, error } = await tci()
        .from('premium_entries')
        .select('*')
        .eq('policy_id', policyId!)
        .order('computed_at')
      if (error) throw error
      return (data ?? []) as unknown as PremiumEntry[]
    },
  })
}

function useInvalidatePremium(policyId: string | undefined) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['premium'] })
    void qc.invalidateQueries({ queryKey: ['agenda'] })
    if (policyId) void qc.invalidateQueries({ queryKey: KEYS.instalments(policyId) })
  }
}

export function useUpdateInstalment(policyId: string | undefined) {
  const invalidate = useInvalidatePremium(policyId)
  return useMutation({
    mutationFn: async (input: {
      id: string
      amount?: number
      due_date?: string
      status?: PremiumInstalment['status']
      note?: string | null
    }) => {
      const { id, ...patch } = input
      const { error } = await tci().from('premium_instalments').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Regenerate the schedule. Refuses when anything has been invoiced or paid,
 * which is the point: an instalment that has been billed is a fact. Also the
 * way a policy created BEFORE migration 0027 gets its first schedule. */
export function useGenerateInstalments(policyId: string | undefined) {
  const invalidate = useInvalidatePremium(policyId)
  return useMutation({
    mutationFn: async (replace: boolean): Promise<number> => {
      const { data, error } = await tci().rpc('generate_premium_instalments', {
        p_policy_id: policyId,
        p_replace: replace,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    onSuccess: invalidate,
  })
}

/** Every policy's premium picture, for the dashboard roll-up. RLS decides
 * which policies come back; nothing here filters. */
export function useAllPolicyPremium() {
  return useQuery({
    queryKey: ['premium', 'all'] as const,
    queryFn: async (): Promise<PolicyPremium[]> => {
      const { data, error } = await tci().from('v_policy_premium').select('*')
      if (error) throw error
      return (data ?? []) as unknown as PolicyPremium[]
    },
  })
}
