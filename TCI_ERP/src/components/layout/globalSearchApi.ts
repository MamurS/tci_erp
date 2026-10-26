/**
 * The system-wide half of the one search: companies (name or registration
 * number), policies, claims and submissions (by number; a claim by its buyer
 * too), within the sections the ACTING role may open (paletteSources). The
 * database still decides which rows come back.
 */

import { useQuery } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { PaletteSource } from './commandPalette'

export interface RecordHit {
  id: string
  source: Exclude<PaletteSource, 'entities'>
  number: string
  name: string | null
}

/** Policies, claims and submissions whose number (a claim: or buyer)
 * contains the term — five of each at most, in the sources allowed. */
export function useRecordSearch(term: string | null, sources: readonly PaletteSource[]) {
  return useQuery({
    queryKey: ['palette-records', term, sources],
    enabled: term !== null && sources.some((s) => s !== 'entities'),
    staleTime: 30_000,
    queryFn: async (): Promise<RecordHit[]> => {
      const like = `%${term}%`
      const jobs: Promise<RecordHit[]>[] = []
      if (sources.includes('policies'))
        jobs.push(
          (async () => {
            const { data, error } = await tci()
              .from('policies')
              .select('id, policy_number, legal_entities(name)')
              .ilike('policy_number', like)
              .limit(5)
            if (error) throw error
            return ((data ?? []) as unknown as { id: string; policy_number: string; legal_entities: { name: string } | null }[]).map(
              (r) => ({ id: r.id, source: 'policies' as const, number: r.policy_number, name: r.legal_entities?.name ?? null }),
            )
          })(),
        )
      if (sources.includes('claims'))
        jobs.push(
          (async () => {
            const { data, error } = await tci()
              .from('v_claims')
              .select('id, claim_number, buyer_name')
              .or(`claim_number.ilike.${like},buyer_name.ilike.${like}`)
              .limit(5)
            if (error) throw error
            return ((data ?? []) as { id: string; claim_number: string; buyer_name: string | null }[]).map((r) => ({
              id: r.id,
              source: 'claims' as const,
              number: r.claim_number,
              name: r.buyer_name,
            }))
          })(),
        )
      if (sources.includes('requests'))
        jobs.push(
          (async () => {
            const { data, error } = await tci()
              .from('insurance_requests')
              .select('id, request_number, legal_entities(name)')
              .ilike('request_number', like)
              .limit(5)
            if (error) throw error
            return ((data ?? []) as unknown as { id: string; request_number: string; legal_entities: { name: string } | null }[]).map(
              (r) => ({ id: r.id, source: 'requests' as const, number: r.request_number, name: r.legal_entities?.name ?? null }),
            )
          })(),
        )
      return (await Promise.all(jobs)).flat()
    },
  })
}

export function useEntitySearch(term: string | null) {
  return useQuery({
    queryKey: ['palette-entities', term],
    enabled: term !== null,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await tci()
        .from('legal_entities')
        .select('id, name, registration_number, country_code')
        .or(`name.ilike.%${term}%,registration_number.ilike.%${term}%`)
        .order('name')
        .limit(8)
      if (error) throw error
      return (data ?? []) as {
        id: string
        name: string
        registration_number: string
        country_code: string
      }[]
    },
  })
}

