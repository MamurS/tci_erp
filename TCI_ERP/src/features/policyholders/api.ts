/** Data access for policyholders (TanStack Query + Supabase). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { Policyholder, PolicyholderWithRefs } from './types'

const KEYS = {
  policyholders: ['policyholders'] as const,
  policyholder: (id: string) => ['policyholders', id] as const,
}

const SELECT =
  '*, countries(name_en, name_ru, name_uz), industries(name_en, name_ru, name_uz), policies(id, status)'

export function usePolicyholders() {
  return useQuery({
    queryKey: KEYS.policyholders,
    queryFn: async (): Promise<PolicyholderWithRefs[]> => {
      const { data, error } = await tci().from('policyholders').select(SELECT).order('name')
      if (error) throw error
      return (data ?? []) as unknown as PolicyholderWithRefs[]
    },
  })
}

export function usePolicyholder(id: string) {
  return useQuery({
    queryKey: KEYS.policyholder(id),
    queryFn: async (): Promise<PolicyholderWithRefs | null> => {
      const { data, error } = await tci()
        .from('policyholders')
        .select(SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as unknown as PolicyholderWithRefs | null
    },
  })
}

export interface PolicyholderInput {
  name: string
  legal_form: string | null
  country_code: string
  industry_id: string | null
  registration_number: string
  address: string | null
  website: string | null
  contact_person: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
}

export function useCreatePolicyholder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: PolicyholderInput): Promise<Policyholder> => {
      const { data, error } = await tci().from('policyholders').insert(input).select().single()
      if (error) throw error
      return data as Policyholder
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.policyholders }),
  })
}

export function useUpdatePolicyholder(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<PolicyholderInput>): Promise<void> => {
      const { error } = await tci().from('policyholders').update(input).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.policyholders }),
  })
}
