/** Data access for the information manager's desk (migration 0054) and the
 * official registries (analytics service). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { getRegistrySources, searchRegistry } from '../../lib/analytics'
import type { RegistrySource } from '../../lib/analytics'
import { useAuth } from '../../auth/AuthContext'
import { optimistic, rowAt, rowInList, updateRow } from '../../lib/optimistic'
import { tci } from '../../lib/supabase'
import { assigned, resolved, taken } from './optimistic'
import type { EntityRequest, FreshnessRow, RequestResult, StaffMember } from './types'

const KEYS = {
  all: ['data'] as const,
  requests: ['data', 'requests'] as const,
  request: (id: string) => ['data', 'requests', id] as const,
  freshness: ['data', 'freshness'] as const,
  staff: ['data', 'staff'] as const,
}

/** Every request the caller may see: their own, or all of them for an
 * information manager (RLS decides). Newest first. */
export function useEntityRequests(enabled = true) {
  return useQuery({
    queryKey: KEYS.requests,
    enabled,
    queryFn: async (): Promise<EntityRequest[]> => {
      const { data, error } = await tci()
        .from('entity_requests')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as EntityRequest[]
    },
  })
}

export function useEntityRequest(id: string | undefined) {
  return useQuery({
    queryKey: KEYS.request(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<EntityRequest | null> => {
      const { data, error } = await tci().from('entity_requests').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return (data ?? null) as EntityRequest | null
    },
  })
}

export function useDataFreshness(enabled = true) {
  return useQuery({
    queryKey: KEYS.freshness,
    enabled,
    queryFn: async (): Promise<FreshnessRow[]> => {
      const { data, error } = await tci().from('v_data_freshness').select('*').order('name')
      if (error) throw error
      return (data ?? []) as FreshnessRow[]
    },
  })
}

/** Names of colleagues (tci.staff_directory), keyed by user id. */
export function useStaffDirectory() {
  return useQuery({
    queryKey: KEYS.staff,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, StaffMember>> => {
      const { data, error } = await tci().rpc('staff_directory')
      if (error) throw error
      return new Map(((data ?? []) as StaffMember[]).map((m) => [m.user_id, m]))
    },
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: KEYS.all })
    // the Agenda badge and board move with every request
    void queryClient.invalidateQueries({ queryKey: ['agenda', 'tasks'] })
  }
}

/** The request's row, in the list and on its own key. */
function requestPatches<V>(idOf: (v: V) => string, change: (row: EntityRequest, v: V) => EntityRequest) {
  return (v: V) => [
    rowInList<EntityRequest, V>(KEYS.requests, idOf, change),
    rowAt<EntityRequest, V>(KEYS.request(idOf(v)), change),
  ]
}

/** The stored row (the RPC's answer) in the list and on its own key. */
function answerRow(qc: QueryClient, row: EntityRequest) {
  qc.setQueryData<EntityRequest>(KEYS.request(row.id), (old) => (old ? { ...old, ...row } : old))
  qc.setQueryData<EntityRequest[]>(KEYS.requests, (rows) => rows && updateRow(rows, row.id, (old) => ({ ...old, ...row })))
}

/** After a request moves: the freshness worklist and the Agenda tasks it
 * opens and closes. */
const AFTER_MOVE = [KEYS.freshness, ['agenda', 'tasks']] as const

export function useRequestEntity() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: {
      name: string
      country: string
      registrationNumber?: string
      note?: string
    }): Promise<RequestResult> => {
      const { data, error } = await tci().rpc('request_entity', {
        p_name: input.name,
        p_country_code: input.country,
        p_registration_number: input.registrationNumber || null,
        p_note: input.note || null,
      })
      if (error) throw error
      return data as RequestResult
    },
    onSuccess: invalidate,
  })
}

export function useRequestStatementsUpdate() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: { entityId: string; note?: string }): Promise<RequestResult> => {
      const { data, error } = await tci().rpc('request_statements_update', {
        p_entity_id: input.entityId,
        p_note: input.note || null,
      })
      if (error) throw error
      return data as RequestResult
    },
    onSuccess: invalidate,
  })
}

/** Optimistic, like every move below: the row changes at once. */
export function useTakeRequest() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  return useMutation({
    mutationKey: ['data', 'take'],
    mutationFn: async (id: string): Promise<EntityRequest> => {
      const { data, error } = await tci().rpc('take_entity_request', { p_request_id: id })
      if (error) throw error
      return data as EntityRequest
    },
    ...optimistic<string, EntityRequest>(qc, {
      patches: requestPatches<string>((id) => id, (row) => taken(row, me, new Date().toISOString())),
      answer: answerRow,
      invalidate: () => AFTER_MOVE,
    }),
  })
}

export function useAssignRequest() {
  const qc = useQueryClient()
  type Vars = { id: string; userId: string }
  return useMutation({
    mutationKey: ['data', 'assign'],
    mutationFn: async (input: Vars): Promise<EntityRequest> => {
      const { data, error } = await tci().rpc('assign_entity_request', { p_request_id: input.id, p_user_id: input.userId })
      if (error) throw error
      return data as EntityRequest
    },
    ...optimistic<Vars, EntityRequest>(qc, {
      patches: requestPatches<Vars>((v) => v.id, (row, v) => assigned(row, v.userId, new Date().toISOString())),
      answer: answerRow,
      invalidate: () => AFTER_MOVE,
    }),
  })
}

type ResolveVars = {
  id: string
  outcome: 'created' | 'linked' | 'updated' | 'rejected'
  entityId?: string | null
  note?: string | null
}

export function useResolveRequest() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const me = session?.user.id ?? null
  return useMutation({
    mutationKey: ['data', 'resolve'],
    ...optimistic<ResolveVars, void>(qc, {
      patches: requestPatches<ResolveVars>(
        (v) => v.id,
        (row, v) => resolved(row, v.outcome, v.entityId ?? null, v.note ?? null, me, new Date().toISOString()),
      ),
      invalidate: () => AFTER_MOVE,
    }),
    mutationFn: async (input: ResolveVars) => {
      const { error } = await tci().rpc('resolve_entity_request', {
        p_request_id: input.id,
        p_outcome: input.outcome,
        p_entity_id: input.entityId ?? null,
        p_note: input.note ?? null,
      })
      if (error) throw error
    },
  })
}

/** Which registries the analytics service offers; fails (and the screen
 * says so) while the service is not running. */
export function useRegistrySources() {
  return useQuery({
    queryKey: ['registry', 'sources'],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: getRegistrySources,
  })
}

export function useRegistrySearch(source: RegistrySource, query: string, country: string | null) {
  return useQuery({
    queryKey: ['registry', 'search', source, query, country],
    enabled: query.trim().length >= 3,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => searchRegistry(source, query.trim(), country),
  })
}

/** Buyers proposed by clients from the portal, waiting for a company. Shares
 * BuyerProposalsSection's query key, so resolving one updates the count. */
export function usePendingProposalCount() {
  return useQuery({
    queryKey: ['buyer-proposals'],
    queryFn: async (): Promise<{ id: string }[]> => {
      const { data, error } = await tci()
        .from('client_buyer_proposals')
        .select('*, policies(policy_number, legal_entities(name))')
        .eq('status', 'pending_entity')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as { id: string }[]
    },
  })
}
