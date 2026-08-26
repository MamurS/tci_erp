/** Data access for the credit limit workflow (TanStack Query + Supabase).
 * All lifecycle mutations go through the SQL functions of migration 0013. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { FxRateRow } from './authority'
import type {
  BuyerExposure,
  ConditionInput,
  DecisionOutcome,
  DecisionWithConditions,
  EffectiveLimit,
  LimitRequestWithRefs,
} from './types'

const KEYS = {
  requests: ['limit-requests'] as const,
  request: (id: string) => ['limit-requests', id] as const,
  effective: ['effective-limits'] as const,
  exposure: (entityId: string) => ['buyer-exposure', entityId] as const,
  decisions: (entityId: string) => ['limit-decisions', 'buyer', entityId] as const,
  authority: ['my-authority-uzs'] as const,
  escalatedCount: ['limit-requests', 'escalated-count'] as const,
}

const REQUEST_SELECT =
  '*, legal_entities(name), policies(policy_number, currency_code, entity_id, legal_entities(name))'

function invalidateWorkflow(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: KEYS.requests })
  void queryClient.invalidateQueries({ queryKey: KEYS.effective })
  void queryClient.invalidateQueries({ queryKey: ['buyer-exposure'] })
  void queryClient.invalidateQueries({ queryKey: ['limit-decisions'] })
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export function useLimitRequests() {
  return useQuery({
    queryKey: KEYS.requests,
    queryFn: async (): Promise<LimitRequestWithRefs[]> => {
      const { data, error } = await tci()
        .from('credit_limit_requests')
        .select(REQUEST_SELECT)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as LimitRequestWithRefs[]
    },
  })
}

export function useLimitRequest(id: string) {
  return useQuery({
    queryKey: KEYS.request(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<LimitRequestWithRefs | null> => {
      const { data, error } = await tci()
        .from('credit_limit_requests')
        .select(REQUEST_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as unknown as LimitRequestWithRefs | null
    },
  })
}

export interface LimitRequestInput {
  policy_id: string
  entity_id: string
  requested_amount: number
  currency_code: string
  requested_payment_terms_days: number | null
  justification: string | null
}

export function useCreateLimitRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: LimitRequestInput): Promise<{ id: string }> => {
      const { data, error } = await tci()
        .from('credit_limit_requests')
        .insert(input)
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: () => invalidateWorkflow(queryClient),
  })
}

function useRequestRpc(fn: 'submit_limit_request' | 'start_limit_review') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (requestId: string): Promise<void> => {
      const { error } = await tci().rpc(fn, { p_request_id: requestId })
      if (error) throw error
    },
    onSuccess: () => invalidateWorkflow(queryClient),
  })
}

export const useSubmitLimitRequest = () => useRequestRpc('submit_limit_request')
export const useStartLimitReview = () => useRequestRpc('start_limit_review')

export function useWithdrawLimitRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { requestId: string; comment?: string }): Promise<void> => {
      const { error } = await tci().rpc('withdraw_limit_request', {
        p_request_id: input.requestId,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateWorkflow(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface DecideInput {
  requestId: string
  outcome: Exclude<DecisionOutcome, 'revoked'>
  amount: number | null
  currency: string
  validFrom: string
  validUntil: string | null
  conditions: ConditionInput[]
  comment: string | null
  assessmentId: string | null
}

export type DecideResult =
  | { result: 'decided'; decision_id: string }
  | { result: 'escalated'; amount_uzs: number; authority_uzs: number }

export function useDecideLimitRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: DecideInput): Promise<DecideResult> => {
      const { data, error } = await tci().rpc('decide_limit_request', {
        p_request_id: input.requestId,
        p_outcome: input.outcome,
        p_amount: input.amount,
        p_currency: input.currency,
        p_valid_from: input.validFrom,
        p_valid_until: input.validUntil,
        p_conditions: input.conditions,
        p_comment: input.comment,
        p_assessment_id: input.assessmentId,
      })
      if (error) throw error
      return data as DecideResult
    },
    onSuccess: () => invalidateWorkflow(queryClient),
  })
}

export function useRevokeEffectiveLimit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      policyId: string
      entityId: string
      comment?: string
    }): Promise<void> => {
      const { error } = await tci().rpc('revoke_effective_limit', {
        p_policy_id: input.policyId,
        p_entity_id: input.entityId,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateWorkflow(queryClient),
  })
}

/** Full decision history for a buyer (chains built client-side). */
export function useBuyerDecisions(entityId: string) {
  return useQuery({
    queryKey: KEYS.decisions(entityId),
    enabled: Boolean(entityId),
    queryFn: async (): Promise<
      (DecisionWithConditions & { credit_limit_requests: { policy_id: string; entity_id: string } })[]
    > => {
      const { data, error } = await tci()
        .from('credit_limit_decisions')
        .select('*, decision_conditions(*), credit_limit_requests!inner(policy_id, entity_id)')
        .eq('credit_limit_requests.entity_id', entityId)
        .order('decided_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as (DecisionWithConditions & {
        credit_limit_requests: { policy_id: string; entity_id: string }
      })[]
    },
  })
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function useEffectiveLimits(filter: { policyId?: string; entityId?: string } = {}) {
  return useQuery({
    queryKey: [...KEYS.effective, filter.policyId ?? '', filter.entityId ?? ''],
    queryFn: async (): Promise<EffectiveLimit[]> => {
      let query = tci().from('v_effective_limits').select('*')
      if (filter.policyId) query = query.eq('policy_id', filter.policyId)
      if (filter.entityId) query = query.eq('entity_id', filter.entityId)
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as unknown as EffectiveLimit[]
    },
  })
}

export function useBuyerExposure(entityId: string) {
  return useQuery({
    queryKey: KEYS.exposure(entityId),
    enabled: Boolean(entityId),
    queryFn: async (): Promise<BuyerExposure | null> => {
      const { data, error } = await tci()
        .from('v_buyer_exposure')
        .select('*')
        .eq('entity_id', entityId)
        .maybeSingle()
      if (error) throw error
      return data as unknown as BuyerExposure | null
    },
  })
}

// ---------------------------------------------------------------------------
// Authority + fx (decision preflight)
// ---------------------------------------------------------------------------

/** The caller's authority in UZS, computed server-side (same rule as decide). */
export function useMyAuthorityUzs() {
  return useQuery({
    queryKey: KEYS.authority,
    queryFn: async (): Promise<number> => {
      const { data, error } = await tci().rpc('my_authority_uzs')
      if (error) throw error
      return Number(data ?? 0)
    },
  })
}

/** All stored rates for one currency (client mirrors the latest-rate rule). */
export function useLatestRatesFor(currencyCode: string) {
  return useQuery({
    queryKey: ['fx-latest', currencyCode],
    enabled: Boolean(currencyCode) && currencyCode !== 'UZS',
    queryFn: async (): Promise<FxRateRow[]> => {
      const { data, error } = await tci()
        .from('fx_rates')
        .select('currency_code, rate_to_uzs, rate_date, source')
        .eq('currency_code', currencyCode)
        .order('rate_date', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as unknown as FxRateRow[]
    },
  })
}

/** Escalated-queue size for the sidebar badge (senior/admin). */
export function useEscalatedCount(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.escalatedCount,
    enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await tci()
        .from('credit_limit_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'escalated')
      if (error) throw error
      return count ?? 0
    },
  })
}
