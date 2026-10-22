/** Data access for auto decisions (migration 0061).
 *
 * Every read here except the decision marks is the credit desk's (admin and
 * credit underwriting): the hooks take `enabled` so that no one else even
 * asks — RLS and the functions' gates would refuse them anyway. Setting an
 * ADT is not optimistic (the band and the authority are the database's
 * answer); disabling it and the ban are, because what they change is
 * certain (adt.ts withoutLive / withBlock). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { optimistic, rowAt } from '../../lib/optimistic'
import { tci } from '../../lib/supabase'
import { parseAdtState, parseSettings, withBlock, withoutLive } from './adt'
import type { AdtState, AutoDecisionAttempt, AutoDecisionRow, AutoDecisionSettings } from './adt'

export const ADT_KEYS = {
  all: ['adt'] as const,
  settings: ['adt', 'settings'] as const,
  state: (entityId: string) => ['adt', 'state', entityId] as const,
  attempts: (requestId: string) => ['adt', 'attempts', requestId] as const,
  report: ['limits', 'workbench', 'auto'] as const,
  /** Under 'limit-decisions', so every decision write refreshes it. */
  marks: ['limit-decisions', 'marks'] as const,
}

/** {enabled, validity_months, financials_max_age_months} — admin and credit. */
export function useAutoDecisionSettings(enabled = true) {
  return useQuery({
    queryKey: ADT_KEYS.settings,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<AutoDecisionSettings | null> => {
      const { data, error } = await tci().rpc('auto_decision_settings')
      if (error) throw error
      return parseSettings(data)
    },
  })
}

export interface SettingsInput {
  enabled: boolean
  validityMonths: number
  financialsMaxAgeMonths: number
}

/** Admin only. The switch is ALWAYS sent: the function reads a missing one
 * as OFF (`coalesce(p_enabled, false)`). */
export function useSetAutoDecisionSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['adt', 'settings', 'set'],
    mutationFn: async (input: SettingsInput): Promise<AutoDecisionSettings | null> => {
      const { data, error } = await tci().rpc('set_auto_decision_settings', {
        p_enabled: input.enabled,
        p_validity_months: input.validityMonths,
        p_financials_max_age_months: input.financialsMaxAgeMonths,
      })
      if (error) throw error
      return parseSettings(data)
    },
    ...optimistic<SettingsInput, AutoDecisionSettings | null>(qc, {
      patches: () => [
        rowAt<AutoDecisionSettings, SettingsInput>(ADT_KEYS.settings, (_old, v) => ({
          enabled: v.enabled,
          validity_months: v.validityMonths,
          financials_max_age_months: v.financialsMaxAgeMonths,
        })),
      ],
      answer: (client, result) => {
        if (result) client.setQueryData(ADT_KEYS.settings, result)
      },
      // the buyer blocks say whether the switch is on
      invalidate: () => [['adt', 'state']],
    }),
  })
}

/** The buyer's ADT block: the switch, the live ADT, the ban, the history. */
export function useBuyerAdtState(entityId: string, enabled: boolean) {
  return useQuery({
    queryKey: ADT_KEYS.state(entityId),
    enabled: enabled && Boolean(entityId),
    queryFn: async (): Promise<AdtState | null> => {
      const { data, error } = await tci().rpc('buyer_adt_state', { p_entity_id: entityId })
      if (error) throw error
      return parseAdtState(data)
    },
  })
}

/** What an ADT write moves besides the block: the review task closes on
 * adt.set / adt.disabled, and the report reads the ADT left now. */
const AROUND_ADT = [['agenda', 'tasks'], ADT_KEYS.report] as const

export interface SetAdtInput {
  entityId: string
  maxAmount: number
  currency: string
  totalCount: number
  comment: string | null
}

/** Sets (or replaces) the buyer's ADT, on the band of the latest rating. */
export function useSetBuyerAdt() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['adt', 'set'],
    mutationFn: async (input: SetAdtInput) => {
      const { data, error } = await tci().rpc('set_buyer_adt', {
        p_entity_id: input.entityId,
        p_max_amount: input.maxAmount,
        p_currency: input.currency,
        p_total_count: input.totalCount,
        p_assessment_id: null,
        p_comment: input.comment,
      })
      if (error) throw error
      return data as unknown
    },
    onSettled: (_data, _error, input) => {
      void qc.invalidateQueries({ queryKey: ADT_KEYS.state(input.entityId) })
      for (const key of AROUND_ADT) void qc.invalidateQueries({ queryKey: key })
    },
  })
}

export interface DisableAdtInput {
  entityId: string
  comment: string | null
}

export function useDisableBuyerAdt() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['adt', 'disable'],
    mutationFn: async (input: DisableAdtInput) => {
      const { error } = await tci().rpc('disable_buyer_adt', {
        p_entity_id: input.entityId,
        p_comment: input.comment,
      })
      if (error) throw error
    },
    ...optimistic<DisableAdtInput, void>(qc, {
      patches: (v) => [rowAt<AdtState, DisableAdtInput>(ADT_KEYS.state(v.entityId), (s) => withoutLive(s, new Date().toISOString()))],
      invalidate: () => AROUND_ADT,
    }),
  })
}

export interface BlockAdtInput {
  entityId: string
  blocked: boolean
  reason: string | null
}

/** The manual ban (a ban suspends the live ADT), or lifting it. */
export function useSetBuyerAdtBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['adt', 'block'],
    mutationFn: async (input: BlockAdtInput) => {
      const { error } = await tci().rpc('set_buyer_adt_block', {
        p_entity_id: input.entityId,
        p_blocked: input.blocked,
        p_reason: input.reason,
      })
      if (error) throw error
    },
    ...optimistic<BlockAdtInput, void>(qc, {
      patches: (v) => [
        rowAt<AdtState, BlockAdtInput>(ADT_KEYS.state(v.entityId), (s) =>
          withBlock(s, v.blocked, v.reason, new Date().toISOString()),
        ),
      ],
      invalidate: () => AROUND_ADT,
    }),
  })
}

/** Every evaluation of one limit request, newest first. */
export function useAutoDecisionAttempts(requestId: string, enabled: boolean) {
  return useQuery({
    queryKey: ADT_KEYS.attempts(requestId),
    enabled: enabled && Boolean(requestId),
    queryFn: async (): Promise<AutoDecisionAttempt[]> => {
      const { data, error } = await tci()
        .from('auto_decision_attempts')
        .select('id, request_id, entity_id, policy_id, adt_id, decided, decision_id, reasons, snapshot, attempted_at')
        .eq('request_id', requestId)
        .order('attempted_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as AutoDecisionAttempt[]
    },
  })
}

/** The report: every auto decision (tci.v_auto_decisions), newest first. */
export function useAutoDecisions(enabled: boolean) {
  return useQuery({
    queryKey: ADT_KEYS.report,
    enabled,
    queryFn: async (): Promise<AutoDecisionRow[]> => {
      const { data, error } = await tci().from('v_auto_decisions').select('*').order('decided_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as AutoDecisionRow[]
    },
  })
}

/** The marks of the effective decisions a system made (an auto decision, an
 * NOA or claim suspension), by decision id. The register and the snapshots
 * read v_effective_limits, which carries no reason; this is the one small
 * read that names them. Staff read decisions (RLS «limit_decisions: staff»). */
export function useSystemDecisionMarks(enabled = true) {
  return useQuery({
    queryKey: ADT_KEYS.marks,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await tci()
        .from('credit_limit_decisions')
        .select('id, system_reason_key')
        .eq('lifecycle', 'effective')
        .not('system_reason_key', 'is', null)
      if (error) throw error
      const rows = Array.isArray(data) ? (data as { id: string; system_reason_key: string | null }[]) : []
      return new Map(rows.filter((r) => r.system_reason_key).map((r) => [r.id, r.system_reason_key as string]))
    },
  })
}
