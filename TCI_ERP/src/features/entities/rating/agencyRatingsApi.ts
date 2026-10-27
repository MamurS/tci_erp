/** A company's agency ratings (migration 0088): the ones in use, every
 * entry, and entering a rating action. Staff read (RLS); the hooks stay off
 * for a client. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../../lib/supabase'
import { useIsStaffReader } from '../../risk/api'
import { agencyName } from './agencyRatings'
import type { Agency, AgencyOutlook, AgencyScale, AgencyTerm } from './agencyRatings'

export interface AgencyRating {
  id: string
  entity_id: string
  agency: Agency
  agency_name: string | null
  scale: AgencyScale
  term: AgencyTerm
  /** null = withdrawn */
  rating: string | null
  outlook: AgencyOutlook | null
  as_of: string
  reference: string
  note: string | null
  entered_by: string
  entered_at: string
}

export const agencyRatingKeys = {
  live: (entityId: string) => ['entities', entityId, 'agency-ratings'] as const,
  history: (entityId: string) => ['entities', entityId, 'agency-ratings', 'history'] as const,
}

/** The rating in use per agency, scale and term. */
export function useAgencyRatings(entityId: string) {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: agencyRatingKeys.live(entityId),
    enabled: staff,
    queryFn: async (): Promise<AgencyRating[]> => {
      const { data, error } = await tci()
        .from('v_entity_agency_ratings')
        .select('*')
        .eq('entity_id', entityId)
        .order('as_of', { ascending: false })
      if (error) throw error
      return (data ?? []) as AgencyRating[]
    },
  })
}

/** Every entry, newest first — read only when someone opens the history. */
export function useAgencyRatingHistory(entityId: string, open: boolean) {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: agencyRatingKeys.history(entityId),
    enabled: staff && open,
    queryFn: async (): Promise<AgencyRating[]> => {
      const { data, error } = await tci()
        .from('entity_agency_ratings')
        .select('*')
        .eq('entity_id', entityId)
        .order('as_of', { ascending: false })
        .order('entered_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AgencyRating[]
    },
  })
}

export interface AgencyRatingInput {
  entityId: string
  agency: Agency
  agencyName: string | null
  scale: AgencyScale
  term: AgencyTerm
  rating: string | null
  outlook: AgencyOutlook | null
  asOf: string
  reference: string
  note: string | null
}

export function useSetAgencyRating() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: AgencyRatingInput) => {
      const { error } = await tci().rpc('set_entity_agency_rating', {
        p_entity: input.entityId,
        p_agency: input.agency,
        p_agency_name: input.agencyName,
        p_scale: input.scale,
        p_term: input.term,
        p_rating: input.rating,
        p_outlook: input.outlook,
        p_as_of: input.asOf,
        p_reference: input.reference,
        p_note: input.note,
      })
      if (error) throw error
    },
    onSuccess: (_d, input) => queryClient.invalidateQueries({ queryKey: agencyRatingKeys.live(input.entityId) }),
  })
}

/** One line for the quick facts: «S&P BB- · Fitch AA(uzb)», or null. */
export function useAgencyRatingsLine(entityId: string): string | null {
  const live = useAgencyRatings(entityId)
  const rated = (live.data ?? []).filter((r) => r.rating && r.term === 'long')
  if (!rated.length) return null
  return rated.map((r) => `${agencyName(r.agency, r.agency_name, true)} ${r.rating}`).join(' · ')
}
