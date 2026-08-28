/** Data access for turnover declarations (migrations 0026-0030).
 *
 * Every transition goes through its SQL function — tci.submit_declaration,
 * tci.accept_declaration, tci.dispute_declaration, tci.correct_declaration —
 * because that is where the guards, the coverage freeze, the premium entry
 * and the workflow event live. Nothing here writes a status by hand.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { Declaration, DeclarationLine, DeclarationTotals } from './types'

const KEYS = {
  list: (policyId?: string) => ['declarations', 'list', policyId ?? 'all'] as const,
  one: (id: string) => ['declarations', 'one', id] as const,
  lines: (id: string) => ['declarations', 'lines', id] as const,
  totals: (id: string) => ['declarations', 'totals', id] as const,
}

interface DeclarationRow extends Declaration {
  policies?: { policy_number: string; legal_entities?: { name: string } | null } | null
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
    void qc.invalidateQueries({ queryKey: ['agenda'] })
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

export function useSubmitDeclaration() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => transition('submit_declaration')({ p_declaration_id: id }),
    onSuccess: (_d, id) => invalidate(id),
  })
}

export function useAcceptDeclaration() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => transition('accept_declaration')({ p_declaration_id: id }),
    onSuccess: (_d, id) => invalidate(id),
  })
}

export function useDisputeDeclaration() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { id: string; note: string }) =>
      transition('dispute_declaration')({ p_declaration_id: input.id, p_note: input.note }),
    onSuccess: (_d, v) => invalidate(v.id),
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
