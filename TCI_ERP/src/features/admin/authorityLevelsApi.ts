/** Data access for the authority levels (migration 0071). Admin sets them
 * up through gated functions; staff read the three tables. Nothing here is
 * optimistic: every write answers by refetching the small set it changed. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { GradeBand } from '../../lib/roles'
import { tci } from '../../lib/supabase'
import type { AuthorityRouting } from '../limits/validation'
import type { AuthorityLevel, LevelGrant, LevelMember } from './authorityLevels'

const KEYS = {
  all: ['authority-levels'] as const,
  levels: ['authority-levels', 'levels'] as const,
  grants: ['authority-levels', 'grants'] as const,
  members: ['authority-levels', 'members'] as const,
  routing: ['authority-levels', 'routing'] as const,
}

export function useAuthorityLevels() {
  return useQuery({
    queryKey: KEYS.levels,
    queryFn: async (): Promise<AuthorityLevel[]> => {
      const { data, error } = await tci().from('authority_levels').select('id, stream, rank, is_committee, chair_id').order('rank')
      if (error) throw error
      return (data ?? []) as AuthorityLevel[]
    },
  })
}

/** Grants and memberships not yet ended (the screen shows what is live). */
export function useLevelGrants() {
  return useQuery({
    queryKey: KEYS.grants,
    queryFn: async (): Promise<LevelGrant[]> => {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await tci()
        .from('authority_level_grants')
        .select('id, level_id, grade_band, max_amount, currency_code, valid_from, valid_to')
        .or(`valid_to.is.null,valid_to.gte.${today}`)
      if (error) throw error
      return (data ?? []) as LevelGrant[]
    },
  })
}

export function useLevelMembers() {
  return useQuery({
    queryKey: KEYS.members,
    queryFn: async (): Promise<LevelMember[]> => {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await tci()
        .from('authority_level_members')
        .select('id, level_id, user_id, valid_from, valid_to')
        .or(`valid_to.is.null,valid_to.gte.${today}`)
      if (error) throw error
      return (data ?? []) as LevelMember[]
    },
  })
}

export function useAuthorityRouting() {
  return useQuery({
    queryKey: KEYS.routing,
    queryFn: async (): Promise<AuthorityRouting> => {
      const { data, error } = await tci().rpc('authority_routing')
      if (error) throw error
      return data === 'sequential' ? 'sequential' : 'direct'
    },
  })
}

function useLevelWrite<I>(name: string, call: (input: I) => PromiseLike<{ error: unknown }>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['admin', 'authority-levels', name],
    mutationFn: async (input: I): Promise<void> => {
      const { error } = await call(input)
      if (error) throw error
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: KEYS.all }),
  })
}

export function useLevelWrites() {
  return {
    routing: useLevelWrite('routing', (routing: AuthorityRouting) =>
      tci().rpc('set_authority_routing', { p_routing: routing }),
    ),
    grant: useLevelWrite('grant', (input: { levelId: string; band: GradeBand; amount: number; currency: string }) =>
      tci().rpc('save_authority_level_grant', {
        p_level_id: input.levelId,
        p_band: input.band,
        p_amount: input.amount,
        p_currency: input.currency,
      }),
    ),
    endGrant: useLevelWrite('end-grant', (grantId: string) => tci().rpc('end_authority_level_grant', { p_grant_id: grantId })),
    addMember: useLevelWrite('add-member', (input: { levelId: string; userId: string }) =>
      tci().rpc('add_authority_level_member', { p_level_id: input.levelId, p_user_id: input.userId }),
    ),
    endMember: useLevelWrite('end-member', (memberId: string) =>
      tci().rpc('end_authority_level_member', { p_member_id: memberId }),
    ),
    chair: useLevelWrite('chair', (input: { levelId: string; userId: string | null }) =>
      tci().rpc('set_committee_chair', { p_level_id: input.levelId, p_user_id: input.userId }),
    ),
  }
}
