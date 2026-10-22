/** Data access for limit-decision validation (migration 0060).
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
  ValidationAction,
  ValidationCandidate,
  ValidationKind,
  ValidationProposal,
  ValidationState,
  ValidationStatus,
  ValidationStep,
} from './validation'

export const VALIDATION_KEYS = {
  all: ['limit-validations'] as const,
  state: (ids: readonly string[]) => ['limit-validations', 'state', [...ids].sort()] as const,
  history: (requestId: string) => ['limit-validations', 'history', requestId] as const,
  proposal: (id: string) => ['limit-validations', 'proposal', id] as const,
  candidates: (input: CandidateQuery) =>
    ['limit-validations', 'candidates', input.stream, input.band, input.amount, input.currency, input.chainId ?? ''] as const,
}

export interface CandidateQuery {
  stream: AuthorityScope
  band: GradeBand
  /** Null for a decline: any colleague of the department qualifies. */
  amount: number | null
  currency: string
  /** When forwarding: everyone already in the chain is left out. */
  chainId?: string | null
}

/** Colleagues of the stream's department whose authority covers the amount
 * in that band — the caller's manager first; never the caller or anyone
 * already in the chain. */
export function useValidationCandidates(input: CandidateQuery, enabled = true) {
  return useQuery({
    queryKey: VALIDATION_KEYS.candidates(input),
    enabled: enabled && Boolean(input.currency),
    queryFn: async (): Promise<ValidationCandidate[]> => {
      const { data, error } = await tci().rpc('validation_candidates', {
        p_stream: input.stream,
        p_band: input.band,
        p_amount: input.amount,
        p_currency: input.currency,
        p_chain_id: input.chainId ?? null,
      })
      if (error) throw error
      return (data ?? []) as ValidationCandidate[]
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
  validatorId: string
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
 * with a named validator, and nothing exists until it is validated. */
export function useSubmitLimitForValidation() {
  const invalidate = useInvalidateValidation()
  return useMutation({
    mutationKey: ['limits', 'validation', 'submit-credit'],
    mutationFn: async (input: SubmitCreditInput): Promise<SubmitResult> => {
      const { data, error } = await tci().rpc('submit_limit_for_validation', {
        p_request_id: input.requestId,
        p_validator_id: input.validatorId,
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
  validatorId: string
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
        p_validator_id: input.validatorId,
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
  forwardTo?: string | null
}

export type ResolveResult =
  | { result: Exclude<ValidationStatus, 'pending' | 'forwarded'>; decision_id: string | null }
  | { result: 'forwarded'; validation_id: string }

/** The validator's answer: approve (as is, or modified within THEIR
 * authority), return to the author, reject, or forward to someone senior. */
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
        p_forward_to: input.forwardTo ?? null,
      })
      if (error) throw error
      return data as ResolveResult
    },
    onSuccess: invalidate,
  })
}
