/**
 * Reads the risk report needs beyond the entity card's own: the group's
 * members, their statements (for the COMBINED tables and the key-companies
 * rankings), and who owns or controls the company. All through the same
 * RLS-protected tables and views the screens use.
 */

import { useQuery } from '@tanstack/react-query'

import { tci } from '../../../lib/supabase'
import type { EntityRelationship } from '../../groups/types'
import type { StatementBundle } from '../types'

export interface ReportMember {
  id: string
  name: string
  registration_number: string | null
  industries: { name_en: string; name_ru: string; name_uz: string } | null
}

const sortedKey = (ids: readonly string[]) => [...ids].sort().join(',')

export function useMemberEntities(memberIds: readonly string[]) {
  return useQuery({
    queryKey: ['report', 'members', sortedKey(memberIds)],
    enabled: memberIds.length > 1,
    queryFn: async (): Promise<ReportMember[]> => {
      const { data, error } = await tci()
        .from('legal_entities')
        .select('id, name, registration_number, industries(name_en, name_ru, name_uz)')
        .in('id', [...memberIds])
      if (error) throw error
      return (data ?? []) as unknown as ReportMember[]
    },
  })
}

/** Annual statements of every member (the combined tables sum them). */
export function useMemberStatements(memberIds: readonly string[]) {
  return useQuery({
    queryKey: ['report', 'memberStatements', sortedKey(memberIds)],
    enabled: memberIds.length > 1,
    queryFn: async (): Promise<StatementBundle[]> => {
      const { data, error } = await tci()
        .from('financial_statements')
        .select('*, balance_sheets(*), income_statements(*)')
        .in('entity_id', [...memberIds])
        .eq('statement_kind', 'annual')
      if (error) throw error
      return (data ?? []) as unknown as StatementBundle[]
    },
  })
}

/** Live edges in which this company is the child: its owners / controllers. */
export function useOwners(entityId: string) {
  return useQuery({
    queryKey: ['report', 'owners', entityId],
    enabled: Boolean(entityId),
    queryFn: async (): Promise<EntityRelationship[]> => {
      const { data, error } = await tci()
        .from('v_entity_relationships')
        .select('*')
        .eq('child_entity_id', entityId)
        .eq('is_live', true)
        .in('relationship_type', ['ownership', 'control'])
        .order('ownership_pct', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as unknown as EntityRelationship[]
    },
  })
}
