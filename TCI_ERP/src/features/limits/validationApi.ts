/** Data access for limit-decision validation (migrations 0060 and 0071).
 *
 * Every write is a SECURITY DEFINER function that decides on its own: who may
 * validate, whether the step is required or voluntary, whether the validator's
 * authority covers the amount. None of them is optimistic — what the step
 * becomes (on validation, approved into a decision, returned, forwarded) is
 * the database's answer, so the screens show their pending state in place,
 * as the decision form does. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { AuthorityScope, GradeBand } from '../../lib/roles'
import { invalidateLimitWorkflow } from './api'
import type { ConditionInput } from './types'
import type {
  CommitteeVote,
  RoutePreview,
  StepLevel,
  StepState,
  ValidationAction,
  ValidationKind,
  ValidationProposal,
  ValidationState,
  ValidationStatus,
  ValidationStep,
} from './validation'

export const VALIDATION_KEYS = {
  all: ['limit-validations'] as const,
  state: (ids: readonly string[]) => ['limit-validations', 'state', [...ids].sort()] as const,
  levels: (ids: readonly string[]) => ['limit-validations', 'levels', [...ids].sort()] as const,
  history: (requestId: string) => ['limit-validations', 'history', requestId] as const,
  stepLevels: (requestId: string) => ['limit-validations', 'step-levels', requestId] as const,
  step: (id: string) => ['limit-validations', 'step', id] as const,
  proposal: (id: string) => ['limit-validations', 'proposal', id] as const,
  route: (input: RouteQuery) =>
    ['limit-validations', 'route', input.requestId, input.stream, input.band, input.amount, input.currency] as const,
}

export interface RouteQuery {
  requestId: string
  stream: AuthorityScope
  band: GradeBand
  /** Null for a decline: a second opinion from the next rank up. */
  amount: number | null
  currency: string
}

/** Where a proposal would go now — the level, its members, who is told —
 * by the same rules the submit functions apply (0071). */
export function useRoutePreview(input: RouteQuery, enabled = true) {
  return useQuery({
    queryKey: VALIDATION_KEYS.route(input),
    enabled: enabled && Boolean(input.requestId) && Boolean(input.currency),
    queryFn: async (): Promise<RoutePreview> => {
      const { data, error } = await tci().rpc('validation_route_preview', {
        p_request_id: input.requestId,
        p_stream: input.stream,
        p_band: input.band,
        p_amount: input.amount,
        p_currency: input.currency,
      })
      if (error) throw error
      return data as RoutePreview
    },
  })
}

/** The level each pending step of these requests sits with (any staff). */
export function useValidationLevels(requestIds: readonly string[]) {
  const ids = [...new Set(requestIds.filter(Boolean))]
  return useQuery({
    queryKey: VALIDATION_KEYS.levels(ids),
    enabled: ids.length > 0,
    queryFn: async (): Promise<(StepLevel & { request_id: string })[]> => {
      const { data, error } = await tci().rpc('limit_request_validation_levels', { p_request_ids: ids })
      if (error) throw error
      return (data ?? []) as (StepLevel & { request_id: string })[]
    },
  })
}

/** The level of every step of a request's chains (same visibility as the
 * history). */
export function useStepLevels(requestId: string) {
  return useQuery({
    queryKey: VALIDATION_KEYS.stepLevels(requestId),
    enabled: Boolean(requestId),
    queryFn: async (): Promise<StepLevel[]> => {
      const { data, error } = await tci().rpc('limit_validation_levels', { p_request_id: requestId })
      if (error) throw error
      return (data ?? []) as StepLevel[]
    },
  })
}

/** One step as the caller sees it: may they answer, and the committee's
 * tally. Refused (42501) to anyone outside the chain and its levels — the
 * screen then simply shows nothing. */
export function useStepState(validationId: string | null) {
  return useQuery({
    queryKey: VALIDATION_KEYS.step(validationId ?? ''),
    enabled: Boolean(validationId),
    retry: false,
    queryFn: async (): Promise<StepState | null> => {
      const { data, error } = await tci().rpc('validation_step_state', { p_validation_id: validationId })
      if (error) {
        if ((error as { code?: string }).code === '42501') return null
        throw error
      }
      return data as StepState
    },
  })
}

/** Whether these requests are on validation, with whom and since when —
 * never the proposal. Any staff member may ask. */
export function useValidationState(requestIds: readonly string[]) {
  const ids = [...new Set(requestIds.filter(Boolean))]
  return useQuery({
    queryKey: VALIDATION_KEYS.state(ids),
    enabled: ids.length > 0,
    queryFn: async (): Promise<ValidationState[]> => {
      const { data, error } = await tci().rpc('limit_request_validation_state', { p_request_ids: ids })
      if (error) throw error
      return (data ?? []) as ValidationState[]
    },
  })
}

/** The validation chains of a request, with names. Admin and the people of a
 * chain see it; everyone else gets no rows. */
export function useValidationHistory(requestId: string) {
  return useQuery({
    queryKey: VALIDATION_KEYS.history(requestId),
    enabled: Boolean(requestId),
    queryFn: async (): Promise<ValidationStep[]> => {
      const { data, error } = await tci().rpc('limit_validation_history', { p_request_id: requestId })
      if (error) throw error
      return ((data ?? []) as ValidationStep[]).map((row) => ({
        ...row,
        amount: row.amount === null ? null : Number(row.amount),
      }))
    },
  })
}

/** The whole proposal of one step — conditions, validity, the assessment —
 * read from the table (RLS: admin and the chain). */
export function useValidationProposal(validationId: string | null) {
  return useQuery({
    queryKey: VALIDATION_KEYS.proposal(validationId ?? ''),
    enabled: Boolean(validationId),
    queryFn: async (): Promise<ValidationProposal | null> => {
      const { data, error } = await tci()
        .from('limit_validations')
        .select(
          'id, chain_id, request_id, stream, kind, outcome, amount, currency_code, payment_terms_days, valid_from, valid_until, conditions, assessment_id, adjusts_decision_id, grade_band, amount_uzs, comment, proposed_by, forwarded_by, validator_id, status, created_at',
        )
        .eq('id', validationId as string)
        .maybeSingle()
      if (error) throw error
      return data as ValidationProposal | null
    },
  })
}

export interface SubmitResult {
  result: 'on_validation'
  validation_id: string
  kind: ValidationKind
  grade_band: GradeBand
  rank: number
}

function useInvalidateValidation() {
  const queryClient = useQueryClient()
  return () => {
    invalidateLimitWorkflow(queryClient)
    void queryClient.invalidateQueries({ queryKey: VALIDATION_KEYS.all })
  }
}

export interface SubmitCreditInput {
  requestId: string
  outcome: 'approved' | 'partial' | 'declined'
  amount: number | null
  currency: string
  validFrom: string
  validUntil: string | null
  conditions: ConditionInput[]
  comment: string | null
  assessmentId: string | null
}

/** Credit stream: the proposal is stored, the request parks as `escalated`
 * with the authority level that may decide it, and nothing exists until it
 * is validated. Nobody is named (0071). */
export function useSubmitLimitForValidation() {
  const invalidate = useInvalidateValidation()
  return useMutation({
    mutationKey: ['limits', 'validation', 'submit-credit'],
    mutationFn: async (input: SubmitCreditInput): Promise<SubmitResult> => {
      const { data, error } = await tci().rpc('submit_limit_for_validation', {
        p_request_id: input.requestId,
        p_validator_id: null,
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
      return data as SubmitResult
    },
    onSuccess: invalidate,
  })
}

export interface SubmitAdjustmentInput {
  decisionId: string
  amount: number
  paymentTermsDays: number | null
  comment: string | null
}

/** Commercial stream: the proposal is stored and the credit decision HELD,
 * so neither reaches the client while it is weighed. */
export function useSubmitAdjustmentForValidation() {
  const invalidate = useInvalidateValidation()
  return useMutation({
    mutationKey: ['limits', 'validation', 'submit-commercial'],
    mutationFn: async (input: SubmitAdjustmentInput): Promise<SubmitResult> => {
      const { data, error } = await tci().rpc('submit_adjustment_for_validation', {
        p_decision_id: input.decisionId,
        p_validator_id: null,
        p_new_amount: input.amount,
        p_new_payment_terms: input.paymentTermsDays,
        p_comment: input.comment,
      })
      if (error) throw error
      return data as SubmitResult
    },
    onSuccess: invalidate,
  })
}

export interface ResolveInput {
  validationId: string
  action: ValidationAction
  amount?: number | null
  paymentTermsDays?: number | null
  comment?: string | null
}

export type ResolveResult =
  | { result: Exclude<ValidationStatus, 'pending' | 'forwarded'>; decision_id: string | null }
  | { result: 'forwarded'; validation_id: string; rank: number | null }

/** A level member's answer: approve (as is, or modified within THEIR
 * authority — an approval as is beyond it goes on to the next rank), return
 * to the author, reject, or forward to the next rank. */
export function useResolveLimitValidation() {
  const invalidate = useInvalidateValidation()
  return useMutation({
    mutationKey: ['limits', 'validation', 'resolve'],
    mutationFn: async (input: ResolveInput): Promise<ResolveResult> => {
      const { data, error } = await tci().rpc('resolve_limit_validation', {
        p_validation_id: input.validationId,
        p_action: input.action,
        p_amount: input.amount ?? null,
        p_payment_terms: input.paymentTermsDays ?? null,
        p_comment: input.comment ?? null,
        p_forward_to: null,
      })
      if (error) throw error
      return data as ResolveResult
    },
    onSuccess: invalidate,
  })
}

export type CloseResult = ResolveResult & {
  committee: { approve: number; reject: number; cast: number; electorate: number; action: 'approve' | 'reject' | 'return' }
}

/** The committee: a member's vote, a declared conflict, and the chair's
 * close (quorum, majority, the casting vote — decided in SQL). */
export function useCommitteeActions(validationId: string) {
  const invalidate = useInvalidateValidation()
  const queryClient = useQueryClient()
  const settle = () => {
    invalidate()
    void queryClient.invalidateQueries({ queryKey: VALIDATION_KEYS.step(validationId) })
  }
  const vote = useMutation({
    mutationKey: ['limits', 'committee', 'vote'],
    mutationFn: async (input: { vote: CommitteeVote; comment: string | null }): Promise<StepState> => {
      const { data, error } = await tci().rpc('cast_committee_vote', {
        p_validation_id: validationId,
        p_vote: input.vote,
        p_comment: input.comment,
      })
      if (error) throw error
      return data as StepState
    },
    onSuccess: (state) => {
      queryClient.setQueryData(VALIDATION_KEYS.step(validationId), state)
      settle()
    },
  })
  const conflict = useMutation({
    mutationKey: ['limits', 'committee', 'conflict'],
    mutationFn: async (reason: string): Promise<StepState> => {
      const { data, error } = await tci().rpc('declare_committee_conflict', {
        p_validation_id: validationId,
        p_reason: reason,
      })
      if (error) throw error
      return data as StepState
    },
    onSuccess: (state) => {
      queryClient.setQueryData(VALIDATION_KEYS.step(validationId), state)
      settle()
    },
  })
  const close = useMutation({
    mutationKey: ['limits', 'committee', 'close'],
    mutationFn: async (comment: string | null): Promise<CloseResult> => {
      const { data, error } = await tci().rpc('close_committee_vote', {
        p_validation_id: validationId,
        p_comment: comment,
      })
      if (error) throw error
      return data as CloseResult
    },
    onSuccess: settle,
  })
  return { vote, conflict, close }
}
