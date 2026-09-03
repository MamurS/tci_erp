/** Data access for corporate groups and group exposure (migrations 0038-0041).
 *
 * Reads go through the views; every write goes through a SQL function, because
 * the write rules — who may record an edge, the self-reference refusal, the
 * band authority on a group limit, the "a suggestion never becomes an edge by
 * itself" rule — live there and a raw insert would walk past all of them.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type {
  EntityRelationship,
  GroupExposure,
  GroupExposureLine,
  GroupFinancials,
  GroupLimit,
  GroupMemberFinancials,
  GroupMembership,
  GroupPreflight,
  RelationshipSuggestion,
  RelationshipType,
} from './types'

const KEYS = {
  group: (entityId: string) => ['groups', 'group', entityId] as const,
  relationships: (entityId: string) => ['groups', 'relationships', entityId] as const,
  exposure: (parentId: string) => ['groups', 'exposure', parentId] as const,
  lines: (parentId: string) => ['groups', 'lines', parentId] as const,
  limit: (parentId: string) => ['groups', 'limit', parentId] as const,
  preflight: (key: string) => ['groups', 'preflight', key] as const,
  suggestions: (entityId: string) => ['groups', 'suggestions', entityId] as const,
  financials: (parentId: string) => ['groups', 'financials', parentId] as const,
  memberFinancials: (parentId: string) => ['groups', 'memberFinancials', parentId] as const,
}

/** Everything a group screen shows changes together: an accepted suggestion
 * moves the members, which moves the exposure, which moves the preflight. */
function invalidateGroups(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['groups'] })
  // A new edge can change a limit's group, so the limits screens follow.
  void queryClient.invalidateQueries({ queryKey: ['limits'] })
  void queryClient.invalidateQueries({ queryKey: ['agenda'] })
}

// ---------------------------------------------------------------------------
// The group itself
// ---------------------------------------------------------------------------

/** The members of this company's group, nearest first. A company with no
 * relationships is a group of one, of which it is the parent. */
export function useEntityGroup(entityId: string | undefined) {
  return useQuery({
    queryKey: KEYS.group(entityId ?? ''),
    enabled: Boolean(entityId),
    queryFn: async (): Promise<GroupMembership[]> => {
      const { data, error } = await tci()
        .from('v_entity_group')
        .select('*')
        .eq('entity_id', entityId!)
        .order('depth', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as GroupMembership[]
    },
  })
}

/** Every relationship touching any member of the group — both directions, so
 * the tree can be hung off the ultimate parent rather than off this company. */
export function useGroupRelationships(
  entityId: string | undefined,
  memberIds: readonly string[],
) {
  return useQuery({
    queryKey: KEYS.relationships(entityId ?? ''),
    enabled: Boolean(entityId) && memberIds.length > 0,
    queryFn: async (): Promise<EntityRelationship[]> => {
      const ids = [...memberIds]
      const { data, error } = await tci()
        .from('v_entity_relationships')
        .select('*')
        .or(`parent_entity_id.in.(${ids.join(',')}),child_entity_id.in.(${ids.join(',')})`)
        .order('valid_from', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as EntityRelationship[]
    },
  })
}

export function useGroupExposure(parentId: string | undefined) {
  return useQuery({
    queryKey: KEYS.exposure(parentId ?? ''),
    enabled: Boolean(parentId),
    queryFn: async (): Promise<GroupExposure | null> => {
      const { data, error } = await tci()
        .from('v_group_exposure')
        .select('*')
        .eq('ultimate_parent_id', parentId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as GroupExposure | null
    },
  })
}

export function useGroupExposureLines(parentId: string | undefined) {
  return useQuery({
    queryKey: KEYS.lines(parentId ?? ''),
    enabled: Boolean(parentId),
    queryFn: async (): Promise<GroupExposureLine[]> => {
      const { data, error } = await tci()
        .from('v_group_exposure_lines')
        .select('*')
        .eq('ultimate_parent_id', parentId!)
      if (error) throw error
      return (data ?? []) as unknown as GroupExposureLine[]
    },
  })
}

export function useCurrentGroupLimit(parentId: string | undefined) {
  return useQuery({
    queryKey: KEYS.limit(parentId ?? ''),
    enabled: Boolean(parentId),
    queryFn: async (): Promise<GroupLimit | null> => {
      const { data, error } = await tci().rpc('current_group_limit', {
        p_ultimate_parent_id: parentId!,
      })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as GroupLimit | null
      // The function returns a row of NULLs when the group has no limit.
      return row && row.id ? row : null
    },
  })
}

// ---------------------------------------------------------------------------
// The preflight
// ---------------------------------------------------------------------------

export interface PreflightArgs {
  entityId: string | undefined
  /** The amount about to be decided, in `currency`. Null asks only where the
   * group stands today. */
  amount?: number | null
  currency?: string | null
  /** tci.limit_scope(policy_id, insurance_request_id) of the decision being
   * superseded — what this buyer already contributes and will not contribute
   * twice. */
  excludeScope?: string | null
}

/** Where a decision would leave the group. This calls the SAME SQL function
 * the enforcement calls (tci.group_exposure_preflight), so the banner and the
 * refusal can never disagree — there is no second implementation here. */
export function useGroupPreflight({ entityId, amount, currency, excludeScope }: PreflightArgs) {
  const key = `${entityId ?? ''}|${amount ?? ''}|${currency ?? ''}|${excludeScope ?? ''}`
  return useQuery({
    queryKey: KEYS.preflight(key),
    enabled: Boolean(entityId),
    queryFn: async (): Promise<GroupPreflight> => {
      const { data, error } = await tci().rpc('group_exposure_preflight', {
        p_entity_id: entityId!,
        p_new_amount: amount ?? null,
        p_currency: currency ?? null,
        p_exclude_scope: excludeScope ?? null,
      })
      if (error) throw error
      return data as GroupPreflight
    },
  })
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/** Open suggestions for this company. Generation is LAZY: the screen asks the
 * database to refresh them on read, exactly as the Agenda does — no cron. */
export function useEntitySuggestions(entityId: string | undefined) {
  return useQuery({
    queryKey: KEYS.suggestions(entityId ?? ''),
    enabled: Boolean(entityId),
    // Refreshing on every focus would re-run the trigram scan for nothing.
    staleTime: 60_000,
    queryFn: async (): Promise<RelationshipSuggestion[]> => {
      const { error: refreshError } = await tci().rpc('refresh_entity_suggestions', {
        p_entity_id: entityId!,
      })
      if (refreshError) throw refreshError
      const { data, error } = await tci()
        .from('v_entity_suggestions')
        .select('*')
        .or(`entity_a.eq.${entityId!},entity_b.eq.${entityId!}`)
        .eq('status', 'open')
        .order('score', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as RelationshipSuggestion[]
    },
  })
}

// ---------------------------------------------------------------------------
// The combined financial picture
// ---------------------------------------------------------------------------

export function useGroupFinancials(parentId: string | undefined) {
  return useQuery({
    queryKey: KEYS.financials(parentId ?? ''),
    enabled: Boolean(parentId),
    queryFn: async (): Promise<GroupFinancials | null> => {
      const { data, error } = await tci()
        .from('v_group_financials')
        .select('*')
        .eq('ultimate_parent_id', parentId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as GroupFinancials | null
    },
  })
}

export function useGroupMemberFinancials(
  parentId: string | undefined,
  memberIds: readonly string[],
) {
  return useQuery({
    queryKey: KEYS.memberFinancials(parentId ?? ''),
    enabled: Boolean(parentId) && memberIds.length > 0,
    queryFn: async (): Promise<GroupMemberFinancials[]> => {
      const { data, error } = await tci()
        .from('v_group_member_financials')
        .select('*')
        .in('member_id', [...memberIds])
      if (error) throw error
      return (data ?? []) as unknown as GroupMemberFinancials[]
    },
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface SaveRelationshipInput {
  relationshipId?: string | null
  parentEntityId: string
  childEntityId: string
  relationshipType: RelationshipType
  ownershipPct?: number | null
  validFrom?: string | null
  validTo?: string | null
  sourceNote?: string | null
}

export function useSaveRelationship() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveRelationshipInput): Promise<void> => {
      const { error } = await tci().rpc('save_entity_relationship', {
        p_parent_entity_id: input.parentEntityId,
        p_child_entity_id: input.childEntityId,
        p_relationship_type: input.relationshipType,
        p_ownership_pct: input.ownershipPct ?? null,
        p_valid_from: input.validFrom ?? null,
        p_valid_to: input.validTo ?? null,
        p_source: 'manual',
        p_source_note: input.sourceNote ?? null,
        p_relationship_id: input.relationshipId ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateGroups(queryClient),
  })
}

/** Ending an edge CLOSES it — the group as it stood when a limit was decided
 * has to stay readable, so nothing is ever deleted. */
export function useEndRelationship() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { relationshipId: string; validTo?: string | null }) => {
      const { error } = await tci().rpc('end_entity_relationship', {
        p_relationship_id: input.relationshipId,
        p_valid_to: input.validTo ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateGroups(queryClient),
  })
}

export function useSetGroupLimit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      ultimateParentId: string
      maxAmount: number
      currency: string
      validFrom?: string | null
      comment?: string | null
    }) => {
      const { error } = await tci().rpc('set_group_limit', {
        p_ultimate_parent_id: input.ultimateParentId,
        p_max_amount: input.maxAmount,
        p_currency: input.currency,
        p_valid_from: input.validFrom ?? null,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateGroups(queryClient),
  })
}

export function useEndGroupLimit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { ultimateParentId: string; validTo?: string | null }) => {
      const { error } = await tci().rpc('end_group_limit', {
        p_ultimate_parent_id: input.ultimateParentId,
        p_valid_to: input.validTo ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateGroups(queryClient),
  })
}

export function useAcceptSuggestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      suggestionId: string
      parentEntityId: string
      relationshipType: RelationshipType
      ownershipPct?: number | null
    }) => {
      const { error } = await tci().rpc('accept_relationship_suggestion', {
        p_suggestion_id: input.suggestionId,
        p_parent_entity_id: input.parentEntityId,
        p_relationship_type: input.relationshipType,
        p_ownership_pct: input.ownershipPct ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateGroups(queryClient),
  })
}

export function useRejectSuggestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { suggestionId: string }) => {
      const { error } = await tci().rpc('reject_relationship_suggestion', {
        p_suggestion_id: input.suggestionId,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateGroups(queryClient),
  })
}
