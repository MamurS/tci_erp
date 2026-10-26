/** Data access for turnover declarations (migrations 0026-0030).
 *
 * Every transition goes through its SQL function — tci.submit_declaration,
 * tci.accept_declaration, tci.dispute_declaration, tci.correct_declaration —
 * because that is where the guards, the coverage freeze, the premium entry
 * and the workflow event live. Nothing here writes a status by hand.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { optimistic, rowAt, rowInLists } from '../../lib/optimistic'
import { tci } from '../../lib/supabase'
import type { FxRateRow } from '../limits/authority'
import { transitioned } from './optimistic'
import type { Declaration, DeclarationFrequency, DeclarationLine, DeclarationTotals } from './types'

const KEYS = {
  list: (policyId?: string) => ['declarations', 'list', policyId ?? 'all'] as const,
  one: (id: string) => ['declarations', 'one', id] as const,
  lines: (id: string) => ['declarations', 'lines', id] as const,
  totals: (id: string) => ['declarations', 'totals', id] as const,
}

export interface DeclarationRow extends Declaration {
  policies?: { policy_number: string; legal_entities?: { name: string } | null } | null
}

/** The stored rates for the given currencies, for the dashboard's premium
 * total. The rule that picks one (latest on or before today, CBU over manual)
 * is `latestUzsRate` in limits/authority.ts, the mirror of
 * tci.latest_uzs_rate; this only fetches the candidates. */
export function useUzsRates(currencies: readonly string[]) {
  const needed = [...new Set(currencies)].filter((c) => c !== 'UZS').sort()
  return useQuery({
    queryKey: ['fx-latest', 'many', needed] as const,
    enabled: needed.length > 0,
    // Per currency, newest first: one currency's daily CBU rates must not
    // crowd out another's older manual one.
    queryFn: async (): Promise<FxRateRow[]> => {
      const results = await Promise.all(
        needed.map((ccy) =>
          tci()
            .from('fx_rates')
            .select('currency_code, rate_to_uzs, rate_date, source')
            .eq('currency_code', ccy)
            .order('rate_date', { ascending: false })
            .limit(20),
        ),
      )
      return results.flatMap(({ data, error }) => {
        if (error) throw error
        return (data ?? []) as unknown as FxRateRow[]
      })
    },
  })
}

export function useDeclarations(policyId?: string) {
  return useQuery({
    queryKey: KEYS.list(policyId),
    queryFn: async (): Promise<DeclarationRow[]> => {
      let q = tci()
        .from('declarations')
        .select('*, policies(policy_number, legal_entities(name))')
        .order('period_start', { ascending: false })
      if (policyId) q = q.eq('policy_id', policyId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as DeclarationRow[]
    },
  })
}

/** How often a policy declares — what turns a period's first day into the
 * period itself (period.ts). Only fetched when a link names a period. */
export function usePolicyDeclarationFrequency(policyId: string | undefined) {
  return useQuery({
    queryKey: ['declarations', 'frequency', policyId ?? ''] as const,
    enabled: Boolean(policyId),
    queryFn: async (): Promise<DeclarationFrequency | null> => {
      const { data, error } = await tci()
        .from('policies')
        .select('declaration_frequency')
        .eq('id', policyId!)
        .maybeSingle()
      if (error) throw error
      return ((data as { declaration_frequency: DeclarationFrequency } | null) ?? null)?.declaration_frequency ?? null
    },
  })
}

export function useDeclaration(id: string | undefined) {
  return useQuery({
    queryKey: KEYS.one(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<DeclarationRow | null> => {
      const { data, error } = await tci()
        .from('declarations')
        .select('*, policies(policy_number, legal_entities(name))')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as DeclarationRow | null
    },
  })
}

/** Lines with the coverage split already resolved by the view — the screen
 * never classifies anything itself, so it cannot drift from the database. */
export function useDeclarationLines(declarationId: string | undefined) {
  return useQuery({
    queryKey: KEYS.lines(declarationId ?? ''),
    enabled: Boolean(declarationId),
    queryFn: async (): Promise<DeclarationLine[]> => {
      const { data, error } = await tci()
        .from('v_declaration_lines')
        .select('*')
        .eq('declaration_id', declarationId!)
        .order('entity_name')
      if (error) throw error
      return (data ?? []) as unknown as DeclarationLine[]
    },
  })
}

export function useDeclarationTotals(declarationId: string | undefined) {
  return useQuery({
    queryKey: KEYS.totals(declarationId ?? ''),
    enabled: Boolean(declarationId),
    queryFn: async (): Promise<DeclarationTotals | null> => {
      const { data, error } = await tci()
        .from('v_declaration_totals')
        .select('*')
        .eq('declaration_id', declarationId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as DeclarationTotals | null
    },
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return (declarationId?: string) => {
    void qc.invalidateQueries({ queryKey: ['declarations'] })
    void qc.invalidateQueries({ queryKey: ['agenda', 'tasks'] })
    void qc.invalidateQueries({ queryKey: ['premium'] })
    if (declarationId) void qc.invalidateQueries({ queryKey: KEYS.one(declarationId) })
  }
}

export function useCreateDeclaration() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: {
      policy_id: string
      period_start: string
      period_end: string
      currency_code: string
      note?: string | null
    }): Promise<string> => {
      const { data, error } = await tci()
        .from('declarations')
        .insert(input)
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => invalidate(),
  })
}

export function useSaveLine() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: {
      declaration_id: string
      entity_id: string
      insurable_turnover: number
      overdue_amount?: number | null
      line_note?: string | null
    }) => {
      const { error } = await tci()
        .from('declaration_lines')
        .upsert(input, { onConflict: 'declaration_id,entity_id' })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.declaration_id),
  })
}

export function useDeleteLine() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: { id: string; declaration_id: string }) => {
      const { error } = await tci().from('declaration_lines').delete().eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.declaration_id),
  })
}

/** The four transitions, each through its own SQL function. */
function transition(fn: string) {
  return async (args: Record<string, unknown>) => {
    const { data, error } = await tci().rpc(fn, args)
    if (error) throw error
    return data as Record<string, unknown>
  }
}

/** What a transition touches besides the declaration itself: its lines and
 * totals (the split freezes on acceptance), the premium of its policy (an
 * accepted declaration earns premium), and the Agenda's review tasks. */
function useTransitionKeys() {
  const qc = useQueryClient()
  return (id: string) => {
    const policyId = qc.getQueryData<DeclarationRow | null>(KEYS.one(id))?.policy_id
    return [
      KEYS.one(id),
      KEYS.lines(id),
      KEYS.totals(id),
      ['declarations', 'list'],
      ['agenda', 'tasks'],
      ...(policyId ? [['premium', 'policy', policyId], ['premium', 'entries', policyId], ['premium', 'all']] : [['premium']]),
    ] as const
  }
}

type Target = 'submitted' | 'accepted' | 'disputed'

/** A transition through its SQL function, painted at once: the declaration
 * shows its new status (and moment) in the list, on its page and on its
 * totals row the frame after the click; a refusal puts the old one back. */
function useTransition<V>(spec: {
  fn: string
  idOf: (v: V) => string
  args: (v: V) => Record<string, unknown>
  status: Target
  noteOf?: (v: V) => string
}) {
  const qc = useQueryClient()
  const keys = useTransitionKeys()
  const change = (row: DeclarationRow, v: V) => transitioned(row, spec.status, new Date().toISOString(), spec.noteOf?.(v))
  return useMutation({
    mutationKey: ['declarations', spec.fn],
    mutationFn: (v: V) => transition(spec.fn)(spec.args(v)),
    ...optimistic<V, Record<string, unknown>>(qc, {
      patches: (v) => [
        rowAt<DeclarationRow, V>(KEYS.one(spec.idOf(v)), change),
        rowAt<DeclarationTotals, V>(KEYS.totals(spec.idOf(v)), (row) => ({ ...row, status: spec.status })),
        rowInLists<DeclarationRow, V>(['declarations', 'list'], spec.idOf, change),
      ],
      invalidate: (v) => keys(spec.idOf(v)),
    }),
  })
}

export function useSubmitDeclaration() {
  return useTransition<string>({
    fn: 'submit_declaration',
    idOf: (id) => id,
    args: (id) => ({ p_declaration_id: id }),
    status: 'submitted',
  })
}

export function useAcceptDeclaration() {
  return useTransition<string>({
    fn: 'accept_declaration',
    idOf: (id) => id,
    args: (id) => ({ p_declaration_id: id }),
    status: 'accepted',
  })
}

export function useDisputeDeclaration() {
  return useTransition<{ id: string; note: string }>({
    fn: 'dispute_declaration',
    idOf: (v) => v.id,
    args: (v) => ({ p_declaration_id: v.id, p_note: v.note }),
    status: 'disputed',
    noteOf: (v) => v.note,
  })
}

export function useCorrectDeclaration() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { id: string; note?: string | null }) =>
      transition('correct_declaration')({
        p_declaration_id: input.id,
        p_note: input.note ?? null,
      }),
    onSuccess: (_d, v) => invalidate(v.id),
  })
}
