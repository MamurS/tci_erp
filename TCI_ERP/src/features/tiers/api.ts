/** Policyholder tiers (migration 0094): the view, the manual tier and the
 * thresholds. One query of every policyholder's tier is shared by the
 * registries and the card. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import { useIsStaffReader } from '../risk/api'
import type { Tier, TierThresholds, TurnoverBasis } from './model'

export const TIER_KEYS = {
  all: ['tiers'] as const,
  map: ['tiers', 'map'] as const,
  settings: ['tiers', 'settings'] as const,
  history: (entityId: string) => ['tiers', 'history', entityId] as const,
}

export interface PolicyholderTier {
  entity_id: string
  entity_name: string
  current_policies: number
  turnover_basis: TurnoverBasis
  turnover_uzs: number | null
  declarations_counted: number
  premium_uzs: number | null
  missing_rates: number
  turnover_tier: Tier
  premium_tier: Tier
  automatic_tier: Tier
  override_id: string | null
  override_tier: Tier | null
  override_reason: string | null
  override_until: string | null
  override_set_by: string | null
  override_set_at: string | null
  tier: Tier
  is_manual: boolean
}

export interface TierOverride {
  id: string
  entity_id: string
  tier: Tier
  reason: string
  valid_until: string | null
  set_by: string
  set_at: string
  ended_at: string | null
  ended_by: string | null
  end_reason: string | null
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** Every policyholder's tier, by company id. */
export function useTierMap() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: TIER_KEYS.map,
    enabled: staff,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, PolicyholderTier>> => {
      const { data, error } = await tci().from('v_policyholder_tiers').select('*')
      if (error) throw error
      return new Map(
        ((data ?? []) as PolicyholderTier[]).map((r) => [
          r.entity_id,
          { ...r, turnover_uzs: num(r.turnover_uzs), premium_uzs: num(r.premium_uzs) },
        ]),
      )
    },
  })
}

export function usePolicyholderTier(entityId: string | null | undefined): PolicyholderTier | null {
  const map = useTierMap()
  return entityId ? (map.data?.get(entityId) ?? null) : null
}

export function useTierThresholds() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: TIER_KEYS.settings,
    enabled: staff,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TierThresholds> => {
      const { data, error } = await tci().rpc('policyholder_tier_settings')
      if (error) throw error
      return data as TierThresholds
    },
  })
}

export function useTierHistory(entityId: string) {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: TIER_KEYS.history(entityId),
    enabled: staff,
    queryFn: async (): Promise<TierOverride[]> => {
      const { data, error } = await tci()
        .from('policyholder_tier_overrides')
        .select('*')
        .eq('entity_id', entityId)
        .order('set_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as TierOverride[]
    },
  })
}

function useInvalidateTiers() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: TIER_KEYS.all })
}

export function useSetTier() {
  const invalidate = useInvalidateTiers()
  return useMutation({
    mutationFn: async (input: { entityId: string; tier: Tier; reason: string; until: string | null }) => {
      const { error } = await tci().rpc('set_policyholder_tier', {
        p_entity: input.entityId,
        p_tier: input.tier,
        p_reason: input.reason,
        p_valid_until: input.until,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useEndTierOverride() {
  const invalidate = useInvalidateTiers()
  return useMutation({
    mutationFn: async (input: { entityId: string; reason: string }) => {
      const { error } = await tci().rpc('end_policyholder_tier_override', { p_entity: input.entityId, p_reason: input.reason })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useSetTierThresholds() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (next: TierThresholds): Promise<TierThresholds> => {
      const { data, error } = await tci().rpc('set_policyholder_tier_thresholds', { p_thresholds: next })
      if (error) throw error
      return data as TierThresholds
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(TIER_KEYS.settings, saved)
      void queryClient.invalidateQueries({ queryKey: TIER_KEYS.map })
    },
  })
}
