/** Data access for the client portal (migration 0025).
 *
 * Every read here goes through a tci.v_client_* view and every write through
 * a tci.client_* function. Nothing in this file touches a base table, and
 * nothing filters by entity: the views do that, in the database, so a bug in
 * this file cannot widen what a client can see. That is the point of the
 * shape — UI-side filtering would be a security control in the wrong place. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type {
  ClientDeclarableBuyer,
  ClientDeclaration,
  ClientDeclarationLine,
  ClientInstalment,
  ClientLimit,
  ClientLimitCondition,
  ClientLimitHistoryRow,
  ClientLimitRequest,
  ClientOverdueNotification,
  ClientPolicy,
  ClientPremium,
  ClientSubmission,
  ClientSubmissionBuyer,
  ClientSubmissionHistoryRow,
  EntitySearchHit,
} from './types'

const KEYS = {
  policies: ['portal', 'policies'] as const,
  limits: ['portal', 'limits'] as const,
  conditions: ['portal', 'limit-conditions'] as const,
  history: (buyerId: string) => ['portal', 'limit-history', buyerId] as const,
  requests: ['portal', 'limit-requests'] as const,
  submissions: ['portal', 'submissions'] as const,
  submissionBuyers: (id: string) => ['portal', 'submission-buyers', id] as const,
  submissionHistory: (id: string) => ['portal', 'submission-history', id] as const,
}

function invalidatePortal(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['portal'] })
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useMyPolicies() {
  return useQuery({
    queryKey: KEYS.policies,
    queryFn: async (): Promise<ClientPolicy[]> => {
      const { data, error } = await tci()
        .from('v_client_policies')
        .select('*')
        .order('inception_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ClientPolicy[]
    },
  })
}

/** The company the portal user represents. Derived from the policies view so
 * it costs nothing extra; a portal user with no policy yet still has a
 * submission, so this can legitimately be null. */
export function useMyEntity() {
  const { data: policies } = useMyPolicies()
  const { data: submissions } = useMySubmissions()
  const first = policies?.[0]
  if (first) return { data: { id: first.entity_id, name: first.entity_name } }
  const submission = submissions?.[0]
  return {
    data: submission ? { id: submission.entity_id, name: submission.entity_name } : null,
  }
}

export function useMyLimits() {
  return useQuery({
    queryKey: KEYS.limits,
    queryFn: async (): Promise<ClientLimit[]> => {
      const { data, error } = await tci()
        .from('v_client_limits')
        .select('*')
        .order('buyer_name')
      if (error) throw error
      return (data ?? []) as unknown as ClientLimit[]
    },
  })
}

/** All conditions in one read — a policyholder has tens of limits, not
 * thousands, and one query beats one per row. */
export function useMyLimitConditions() {
  return useQuery({
    queryKey: KEYS.conditions,
    queryFn: async (): Promise<ClientLimitCondition[]> => {
      const { data, error } = await tci().from('v_client_limit_conditions').select('*')
      if (error) throw error
      return (data ?? []) as unknown as ClientLimitCondition[]
    },
  })
}

export function useMyLimitHistory(buyerId: string | null) {
  return useQuery({
    queryKey: KEYS.history(buyerId ?? ''),
    enabled: Boolean(buyerId),
    queryFn: async (): Promise<ClientLimitHistoryRow[]> => {
      const { data, error } = await tci()
        .from('v_client_limit_history')
        .select('*')
        .eq('buyer_id', buyerId)
        .order('decided_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ClientLimitHistoryRow[]
    },
  })
}

export function useMyLimitRequests() {
  return useQuery({
    queryKey: KEYS.requests,
    queryFn: async (): Promise<ClientLimitRequest[]> => {
      const { data, error } = await tci()
        .from('v_client_limit_requests')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ClientLimitRequest[]
    },
  })
}

export function useMySubmissions() {
  return useQuery({
    queryKey: KEYS.submissions,
    queryFn: async (): Promise<ClientSubmission[]> => {
      const { data, error } = await tci()
        .from('v_client_submissions')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ClientSubmission[]
    },
  })
}

export function useMySubmissionBuyers(requestId: string | null) {
  return useQuery({
    queryKey: KEYS.submissionBuyers(requestId ?? ''),
    enabled: Boolean(requestId),
    queryFn: async (): Promise<ClientSubmissionBuyer[]> => {
      const { data, error } = await tci()
        .from('v_client_submission_buyers')
        .select('*')
        .eq('request_id', requestId)
      if (error) throw error
      return (data ?? []) as unknown as ClientSubmissionBuyer[]
    },
  })
}

export function useMySubmissionHistory(requestId: string | null) {
  return useQuery({
    queryKey: KEYS.submissionHistory(requestId ?? ''),
    enabled: Boolean(requestId),
    queryFn: async (): Promise<ClientSubmissionHistoryRow[]> => {
      const { data, error } = await tci()
        .from('v_client_submission_history')
        .select('*')
        .eq('request_id', requestId)
        .order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ClientSubmissionHistoryRow[]
    },
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** The buyer picker. Below three characters the function returns nothing, so
 * the query is not even sent — that minimum is what stops the picker being
 * used to walk the registry. */
export function useEntitySearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['portal', 'entity-search', trimmed],
    enabled: trimmed.length >= 3,
    queryFn: async (): Promise<EntitySearchHit[]> => {
      const { data, error } = await tci().rpc('client_search_entities', {
        p_query: trimmed,
        p_limit: 10,
      })
      if (error) throw error
      return (data ?? []) as unknown as EntitySearchHit[]
    },
  })
}

export interface RequestLimitInput {
  policyId: string
  /** Set when the buyer was picked from the registry. */
  entityId: string | null
  /** Set when it was not, and has to be identified by an information manager. */
  proposedName: string | null
  registrationNumber: string | null
  countryCode: string | null
  amount: number
  currency: string
  paymentTermsDays: number | null
  justification: string | null
}

export function useRequestLimit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      input: RequestLimitInput,
    ): Promise<{ kind: 'request' | 'proposal'; id: string }> => {
      const { data, error } = await tci().rpc('client_request_limit', {
        p_policy_id: input.policyId,
        p_entity_id: input.entityId,
        p_proposed_name: input.proposedName,
        p_registration_number: input.registrationNumber,
        p_country_code: input.countryCode,
        p_amount: input.amount,
        p_currency: input.currency,
        p_payment_terms_days: input.paymentTermsDays,
        p_justification: input.justification,
      })
      if (error) throw error
      return data as { kind: 'request' | 'proposal'; id: string }
    },
    onSuccess: () => invalidatePortal(queryClient),
  })
}

export type SubmissionAction = 'accept' | 'decline' | 'request_changes'

export function useRespondToSubmission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      requestId: string
      action: SubmissionAction
      comment?: string | null
    }) => {
      const { error } = await tci().rpc('client_respond_to_submission', {
        p_request_id: input.requestId,
        p_action: input.action,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidatePortal(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Phase 4: declarations, premium, overdue notifications
// ---------------------------------------------------------------------------
// Same shape as everything above: v_client_* to read, client_* to write.

const P4_KEYS = {
  declarations: ['portal', 'declarations'] as const,
  lines: (id: string) => ['portal', 'declaration-lines', id] as const,
  premium: ['portal', 'premium'] as const,
  instalments: ['portal', 'instalments'] as const,
  overdues: ['portal', 'overdues'] as const,
  declarable: (policyId: string) => ['portal', 'declarable-buyers', policyId] as const,
}

export function useClientDeclarations() {
  return useQuery({
    queryKey: P4_KEYS.declarations,
    queryFn: async (): Promise<ClientDeclaration[]> => {
      const { data, error } = await tci()
        .from('v_client_declarations')
        .select('*')
        .order('period_start', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ClientDeclaration[]
    },
  })
}

export function useClientDeclarationLines(declarationId: string | undefined) {
  return useQuery({
    queryKey: P4_KEYS.lines(declarationId ?? ''),
    enabled: Boolean(declarationId),
    queryFn: async (): Promise<ClientDeclarationLine[]> => {
      const { data, error } = await tci()
        .from('v_client_declaration_lines')
        .select('*')
        .eq('declaration_id', declarationId!)
        .order('entity_name')
      if (error) throw error
      return (data ?? []) as unknown as ClientDeclarationLine[]
    },
  })
}

export function useClientPremium() {
  return useQuery({
    queryKey: P4_KEYS.premium,
    queryFn: async (): Promise<ClientPremium[]> => {
      const { data, error } = await tci().from('v_client_premium').select('*')
      if (error) throw error
      return (data ?? []) as unknown as ClientPremium[]
    },
  })
}

export function useClientInstalments() {
  return useQuery({
    queryKey: P4_KEYS.instalments,
    queryFn: async (): Promise<ClientInstalment[]> => {
      const { data, error } = await tci()
        .from('v_client_premium_instalments')
        .select('*')
        .order('sequence')
      if (error) throw error
      return (data ?? []) as unknown as ClientInstalment[]
    },
  })
}

export function useClientOverdues() {
  return useQuery({
    queryKey: P4_KEYS.overdues,
    queryFn: async (): Promise<ClientOverdueNotification[]> => {
      const { data, error } = await tci()
        .from('v_client_overdue_notifications')
        .select('*')
        .order('first_due_date')
      if (error) throw error
      return (data ?? []) as unknown as ClientOverdueNotification[]
    },
  })
}

export function useClientDeclarableBuyers(policyId: string | undefined) {
  return useQuery({
    queryKey: P4_KEYS.declarable(policyId ?? ''),
    enabled: Boolean(policyId),
    queryFn: async (): Promise<ClientDeclarableBuyer[]> => {
      const { data, error } = await tci()
        .from('v_client_declarable_buyers')
        .select('*')
        .eq('policy_id', policyId!)
        .order('entity_name')
      if (error) throw error
      return (data ?? []) as unknown as ClientDeclarableBuyer[]
    },
  })
}

function useInvalidatePortalP4() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['portal'] })
  }
}

/** Opens (or reuses) the declaration for a period. The period is normalised
 * in SQL, so a client cannot invent one. */
export function useOpenDeclaration() {
  const invalidate = useInvalidatePortalP4()
  return useMutation({
    mutationFn: async (input: { policy_id: string; period_start: string }): Promise<string> => {
      const { data, error } = await tci().rpc('client_open_declaration', {
        p_policy_id: input.policy_id,
        p_period_start: input.period_start,
      })
      if (error) throw error
      return (data as { declaration_id: string }).declaration_id
    },
    onSuccess: invalidate,
  })
}

export function useSaveClientLine() {
  const invalidate = useInvalidatePortalP4()
  return useMutation({
    mutationFn: async (input: {
      declaration_id: string
      entity_id: string
      turnover: number
      overdue_amount?: number | null
      line_note?: string | null
    }) => {
      const { error } = await tci().rpc('client_save_declaration_line', {
        p_declaration_id: input.declaration_id,
        p_entity_id: input.entity_id,
        p_turnover: input.turnover,
        p_overdue_amount: input.overdue_amount ?? null,
        p_line_note: input.line_note ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteClientLine() {
  const invalidate = useInvalidatePortalP4()
  return useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await tci().rpc('client_delete_declaration_line', { p_line_id: lineId })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useSubmitClientDeclaration() {
  const invalidate = useInvalidatePortalP4()
  return useMutation({
    mutationFn: async (declarationId: string) => {
      const { error } = await tci().rpc('client_submit_declaration', {
        p_declaration_id: declarationId,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useClientFileNoa() {
  const invalidate = useInvalidatePortalP4()
  return useMutation({
    mutationFn: async (input: {
      policy_id: string
      entity_id: string
      first_due_date: string
      overdue_amount: number
    }) => {
      const { data, error } = await tci().rpc('client_file_noa', {
        p_policy_id: input.policy_id,
        p_entity_id: input.entity_id,
        p_first_due_date: input.first_due_date,
        p_overdue_amount: input.overdue_amount,
      })
      if (error) throw error
      return data as { noa_id: string; reported_late: boolean; suspension_decision_id: string | null }
    },
    onSuccess: invalidate,
  })
}
