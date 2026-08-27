/** Data access for the insurance-request pipeline (migrations 0019, 0020).
 * Every status transition goes through tci.advance_insurance_request; buyer
 * resolution goes through tci.resolve_request_buyer. Nothing here writes a
 * status column directly. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type {
  InsuranceRequest,
  InsuranceRequestHistoryRow,
  InsuranceRequestStatus,
  InsuranceRequestWithRefs,
  ProposedTerms,
  RequestBuyerInput,
  RequestBuyerWithRefs,
} from './types'

const KEYS = {
  requests: ['insurance-requests'] as const,
  request: (id: string) => ['insurance-requests', id] as const,
  buyers: (id: string) => ['insurance-requests', id, 'buyers'] as const,
  history: (id: string) => ['insurance-requests', id, 'history'] as const,
  forEntity: (id: string) => ['insurance-requests', 'for-entity', id] as const,
}

const REQUEST_SELECT =
  '*, legal_entities(name, country_code), insurance_request_buyers(id)'
const BUYER_SELECT = '*, legal_entities(name, country_code)'

function invalidateRequest(
  queryClient: ReturnType<typeof useQueryClient>,
  requestId?: string,
) {
  void queryClient.invalidateQueries({ queryKey: KEYS.requests })
  if (requestId) {
    void queryClient.invalidateQueries({ queryKey: KEYS.request(requestId) })
    void queryClient.invalidateQueries({ queryKey: KEYS.buyers(requestId) })
    void queryClient.invalidateQueries({ queryKey: KEYS.history(requestId) })
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useInsuranceRequests() {
  return useQuery({
    queryKey: KEYS.requests,
    queryFn: async (): Promise<InsuranceRequestWithRefs[]> => {
      const { data, error } = await tci()
        .from('insurance_requests')
        .select(REQUEST_SELECT)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as InsuranceRequestWithRefs[]
    },
  })
}

export function useInsuranceRequest(id: string) {
  return useQuery({
    queryKey: KEYS.request(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<InsuranceRequestWithRefs | null> => {
      const { data, error } = await tci()
        .from('insurance_requests')
        .select(REQUEST_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as unknown as InsuranceRequestWithRefs | null
    },
  })
}

export function useRequestBuyers(requestId: string) {
  return useQuery({
    queryKey: KEYS.buyers(requestId),
    enabled: Boolean(requestId),
    queryFn: async (): Promise<RequestBuyerWithRefs[]> => {
      const { data, error } = await tci()
        .from('insurance_request_buyers')
        .select(BUYER_SELECT)
        .eq('request_id', requestId)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as RequestBuyerWithRefs[]
    },
  })
}

export function useRequestHistory(requestId: string) {
  return useQuery({
    queryKey: KEYS.history(requestId),
    enabled: Boolean(requestId),
    queryFn: async (): Promise<InsuranceRequestHistoryRow[]> => {
      const { data, error } = await tci()
        .from('insurance_request_history')
        .select('*')
        .eq('request_id', requestId)
        .order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as InsuranceRequestHistoryRow[]
    },
  })
}

/** Submissions touching an entity: as the applicant, or as a package buyer.
 * Two queries because PostgREST cannot OR across an embedded relation. */
export function useRequestsForEntity(entityId: string) {
  return useQuery({
    queryKey: KEYS.forEntity(entityId),
    enabled: Boolean(entityId),
    queryFn: async (): Promise<
      { request: InsuranceRequestWithRefs; asApplicant: boolean; asBuyer: boolean }[]
    > => {
      const [applicant, asBuyer] = await Promise.all([
        tci().from('insurance_requests').select(REQUEST_SELECT).eq('entity_id', entityId),
        tci()
          .from('insurance_request_buyers')
          .select(`request_id, insurance_requests!inner(${REQUEST_SELECT})`)
          .eq('entity_id', entityId),
      ])
      if (applicant.error) throw applicant.error
      if (asBuyer.error) throw asBuyer.error

      const byId = new Map<
        string,
        { request: InsuranceRequestWithRefs; asApplicant: boolean; asBuyer: boolean }
      >()
      for (const r of (applicant.data ?? []) as unknown as InsuranceRequestWithRefs[]) {
        byId.set(r.id, { request: r, asApplicant: true, asBuyer: false })
      }
      for (const row of (asBuyer.data ?? []) as unknown as {
        insurance_requests: InsuranceRequestWithRefs
      }[]) {
        const r = row.insurance_requests
        if (!r) continue
        const existing = byId.get(r.id)
        if (existing) existing.asBuyer = true
        else byId.set(r.id, { request: r, asApplicant: false, asBuyer: true })
      }
      return [...byId.values()].sort((a, b) =>
        b.request.created_at.localeCompare(a.request.created_at),
      )
    },
  })
}

/** Entities that already carry an EFFECTIVE credit-stage decision raised
 * inside this submission — the client-side mirror of
 * tci.request_credit_complete, used to explain why a transition is blocked. */
export function useRequestCreditCoverage(requestId: string) {
  return useQuery({
    queryKey: ['insurance-requests', requestId, 'credit-coverage'],
    enabled: Boolean(requestId),
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await tci()
        .from('credit_limit_requests')
        .select('entity_id, credit_limit_decisions!inner(lifecycle)')
        .eq('insurance_request_id', requestId)
        .eq('credit_limit_decisions.lifecycle', 'effective')
      if (error) throw error
      return new Set(((data ?? []) as { entity_id: string }[]).map((r) => r.entity_id))
    },
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateRequestInput {
  entity_id: string
  notes: string | null
  buyers: RequestBuyerInput[]
}

export function useCreateInsuranceRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateRequestInput): Promise<InsuranceRequest> => {
      const { data, error } = await tci()
        .from('insurance_requests')
        .insert({ entity_id: input.entity_id, notes: input.notes })
        .select()
        .single()
      if (error) throw error
      const request = data as InsuranceRequest

      if (input.buyers.length) {
        const { error: buyersError } = await tci()
          .from('insurance_request_buyers')
          .insert(
            input.buyers.map((b) => ({
              ...b,
              request_id: request.id,
              resolution_status: b.entity_id ? 'ready' : 'pending_entity',
            })),
          )
        if (buyersError) throw buyersError
      }
      return request
    },
    onSuccess: (request) => invalidateRequest(queryClient, request.id),
  })
}

export function useAdvanceInsuranceRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      requestId: string
      to: InsuranceRequestStatus
      comment?: string | null
    }): Promise<InsuranceRequest> => {
      const { data, error } = await tci().rpc('advance_insurance_request', {
        p_request_id: input.requestId,
        p_to_status: input.to,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
      return data as InsuranceRequest
    },
    onSuccess: (_data, input) => invalidateRequest(queryClient, input.requestId),
  })
}

/** Proposed terms are ordinary column updates guarded by RLS — only the
 * status may not be written this way. */
export function useUpdateProposedTerms(requestId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<ProposedTerms> & { notes?: string | null }) => {
      const { error } = await tci()
        .from('insurance_requests')
        .update(patch)
        .eq('id', requestId)
      if (error) throw error
    },
    onSuccess: () => invalidateRequest(queryClient, requestId),
  })
}

export function useAddRequestBuyer(requestId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: RequestBuyerInput) => {
      const { error } = await tci().from('insurance_request_buyers').insert({
        ...input,
        request_id: requestId,
        resolution_status: input.entity_id ? 'ready' : 'pending_entity',
      })
      if (error) throw error
    },
    onSuccess: () => invalidateRequest(queryClient, requestId),
  })
}

export function useRemoveRequestBuyer(requestId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (buyerRowId: string) => {
      const { error } = await tci()
        .from('insurance_request_buyers')
        .delete()
        .eq('id', buyerRowId)
      if (error) throw error
    },
    onSuccess: () => invalidateRequest(queryClient, requestId),
  })
}

export function useResolveRequestBuyer(requestId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { buyerRowId: string; entityId: string }) => {
      const { error } = await tci().rpc('resolve_request_buyer', {
        p_buyer_row_id: input.buyerRowId,
        p_entity_id: input.entityId,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateRequest(queryClient, requestId),
  })
}
