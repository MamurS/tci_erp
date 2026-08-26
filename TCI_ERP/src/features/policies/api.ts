/** Data access for policies and the status machine (TanStack Query + Supabase). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { Policy, PolicyStatus, PolicyStatusHistoryRow, PolicyWithRefs } from './types'

const KEYS = {
  policies: ['policies'] as const,
  policy: (id: string) => ['policies', id] as const,
  history: (id: string) => ['policies', id, 'history'] as const,
}

const SELECT = '*, legal_entities(name)'

export function usePolicies() {
  return useQuery({
    queryKey: KEYS.policies,
    queryFn: async (): Promise<PolicyWithRefs[]> => {
      const { data, error } = await tci()
        .from('policies')
        .select(SELECT)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as PolicyWithRefs[]
    },
  })
}

export function usePolicy(id: string) {
  return useQuery({
    queryKey: KEYS.policy(id),
    queryFn: async (): Promise<PolicyWithRefs | null> => {
      const { data, error } = await tci().from('policies').select(SELECT).eq('id', id).maybeSingle()
      if (error) throw error
      return data as unknown as PolicyWithRefs | null
    },
  })
}

export function usePolicyStatusHistory(policyId: string) {
  return useQuery({
    queryKey: KEYS.history(policyId),
    queryFn: async (): Promise<PolicyStatusHistoryRow[]> => {
      const { data, error } = await tci()
        .from('policy_status_history')
        .select('*')
        .eq('policy_id', policyId)
        .order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as PolicyStatusHistoryRow[]
    },
  })
}

/** Insert/update payload: everything except server-managed columns. */
export type PolicyInput = Omit<Policy, 'id' | 'status' | 'created_by' | 'created_at' | 'updated_at'>

export function useCreatePolicy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: PolicyInput): Promise<Policy> => {
      const { data, error } = await tci().from('policies').insert(input).select().single()
      if (error) throw error
      return data as Policy
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.policies })
      void queryClient.invalidateQueries({ queryKey: ['entities'] })
    },
  })
}

export function useUpdatePolicy(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<PolicyInput>): Promise<void> => {
      const { error } = await tci().from('policies').update(input).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.policies }),
  })
}

/** All status changes go through tci.change_policy_status — the SQL
 * function is the single enforcing state machine (statusMachine.ts only
 * mirrors it for the UI). */
export function useChangePolicyStatus(policyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { to: PolicyStatus; comment?: string }): Promise<void> => {
      const { error } = await tci().rpc('change_policy_status', {
        p_policy_id: policyId,
        p_to_status: input.to,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.policies })
      void queryClient.invalidateQueries({ queryKey: ['entities'] })
    },
  })
}
