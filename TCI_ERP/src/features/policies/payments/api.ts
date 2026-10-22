/**
 * Data access for bank-statement import (migration 0056): the saved bank
 * layouts, the imports, their lines, and the four writes — save a layout,
 * import, confirm, assign, set aside. Every write is a SECURITY DEFINER
 * function for commercial underwriting and admin; the tables are read-only.
 *
 * Mutations put the function's answer into the cache and invalidate only
 * what it moved: the import's lines, the imports list (its counts), the
 * Agenda board (the «unmatched payments» task follows the lines) and the
 * premium of the policies a payment was recorded on.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { tci } from '../../../lib/supabase'
import type { BankMapping, StatementLine } from './bankStatement'
import { countStatuses, emptyCounts } from './lines'
import type { BankImport, BankLine, BankLineStatus, BankProfile, ImportResult, StatusCounts } from './lines'

export const BANK_KEYS = {
  all: ['bank'] as const,
  profiles: ['bank', 'profiles'] as const,
  imports: ['bank', 'imports'] as const,
  lines: (importId: string) => ['bank', 'lines', importId] as const,
  policies: ['bank', 'policies'] as const,
}

/** The Agenda board's key (features/agenda/api.ts). */
const AGENDA_TASKS = ['agenda', 'tasks'] as const

/** PostgREST returns at most 1000 rows a request: page through. */
const PAGE = 1000

async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useBankProfiles() {
  return useQuery({
    queryKey: BANK_KEYS.profiles,
    queryFn: async (): Promise<BankProfile[]> => {
      const { data, error } = await tci().from('bank_statement_profiles').select('*').order('name')
      if (error) throw error
      return (data ?? []) as BankProfile[]
    },
  })
}

export interface ImportSummary extends BankImport {
  counts: StatusCounts
}

/** The latest imports, newest first, each with its lines counted by status. */
export const IMPORTS_SHOWN = 50

export function useBankImports() {
  return useQuery({
    queryKey: BANK_KEYS.imports,
    queryFn: async (): Promise<ImportSummary[]> => {
      const { data, error } = await tci()
        .from('bank_statement_imports')
        .select('*')
        .order('imported_at', { ascending: false })
        .limit(IMPORTS_SHOWN)
      if (error) throw error
      const imports = (data ?? []) as BankImport[]
      if (!imports.length) return []
      const ids = imports.map((i) => i.id)
      const statuses = await fetchAll<{ import_id: string; status: BankLineStatus }>((from, to) =>
        tci()
          .from('bank_statement_lines')
          .select('import_id, status')
          .in('import_id', ids)
          .order('import_id')
          .order('line_no')
          .range(from, to),
      )
      const counts = new Map<string, StatusCounts>()
      for (const row of statuses) {
        const c = counts.get(row.import_id) ?? emptyCounts()
        c[row.status] += 1
        counts.set(row.import_id, c)
      }
      return imports.map((i) => ({ ...i, counts: counts.get(i.id) ?? emptyCounts() }))
    },
  })
}

export function useBankLines(importId: string | null) {
  return useQuery({
    queryKey: BANK_KEYS.lines(importId ?? ''),
    enabled: Boolean(importId),
    queryFn: async (): Promise<BankLine[]> =>
      fetchAll<BankLine>((from, to) =>
        tci()
          .from('bank_statement_lines')
          .select('*')
          .eq('import_id', importId!)
          .order('line_no')
          .range(from, to),
      ),
  })
}

/** A policy a payment can be recorded on, with what is still owed on it. */
export interface PaymentPolicy {
  id: string
  policy_number: string
  currency_code: string
  status: string
  entity_id: string
  policyholder: string | null
  /** v_policy_premium.instalments_outstanding; null when not known. */
  outstanding: number | null
}

/** Every policy that takes payments (not a draft, not annulled), for the
 * assignment picker and for naming the policy a line matched. */
export function usePaymentPolicies() {
  return useQuery({
    queryKey: BANK_KEYS.policies,
    staleTime: 60_000,
    queryFn: async (): Promise<PaymentPolicy[]> => {
      const policies = await fetchAll<{
        id: string
        policy_number: string
        currency_code: string
        status: string
        entity_id: string
        legal_entities: { name: string } | null
      }>((from, to) =>
        tci()
          .from('policies')
          .select('id, policy_number, currency_code, status, entity_id, legal_entities(name)')
          .not('status', 'in', '(draft,annulled)')
          .order('policy_number')
          .range(from, to),
      )
      const owed = await fetchAll<{ policy_id: string; instalments_outstanding: number | null }>((from, to) =>
        tci().from('v_policy_premium').select('policy_id, instalments_outstanding').order('policy_id').range(from, to),
      )
      const byPolicy = new Map(owed.map((o) => [o.policy_id, o.instalments_outstanding]))
      return policies.map((p) => ({
        id: p.id,
        policy_number: p.policy_number,
        currency_code: p.currency_code,
        status: p.status,
        entity_id: p.entity_id,
        policyholder: p.legal_entities?.name ?? null,
        outstanding: byPolicy.has(p.id) ? Number(byPolicy.get(p.id)) : null,
      }))
    },
  })
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/** After a payment was recorded: the Agenda, the policies' premium and what
 * the picker shows as owed. */
function invalidateAfterPayments(qc: QueryClient, policyIds: readonly string[]) {
  void qc.invalidateQueries({ queryKey: BANK_KEYS.imports })
  void qc.invalidateQueries({ queryKey: AGENDA_TASKS })
  if (!policyIds.length) return
  void qc.invalidateQueries({ queryKey: BANK_KEYS.policies })
  const ids = new Set(policyIds)
  void qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey[0] === 'premium' && (q.queryKey.some((k) => typeof k === 'string' && ids.has(k)) || q.queryKey[1] === 'all'),
  })
}

/** Lines of one import, patched in place. */
function patchLines(qc: QueryClient, importId: string, patch: (line: BankLine) => BankLine) {
  qc.setQueryData<BankLine[]>(BANK_KEYS.lines(importId), (old) => old?.map(patch))
}

/** The imports list's counts follow the lines without a refetch. */
function recountImport(qc: QueryClient, importId: string) {
  const lines = qc.getQueryData<BankLine[]>(BANK_KEYS.lines(importId))
  if (!lines) return
  qc.setQueryData<ImportSummary[]>(BANK_KEYS.imports, (old) =>
    old?.map((i) => (i.id === importId ? { ...i, counts: countStatuses(lines) } : i)),
  )
}

interface Snapshot {
  lines: BankLine[] | undefined
  imports: ImportSummary[] | undefined
}

async function snapshot(qc: QueryClient, importId: string): Promise<Snapshot> {
  await qc.cancelQueries({ queryKey: BANK_KEYS.lines(importId) })
  await qc.cancelQueries({ queryKey: BANK_KEYS.imports })
  return {
    lines: qc.getQueryData<BankLine[]>(BANK_KEYS.lines(importId)),
    imports: qc.getQueryData<ImportSummary[]>(BANK_KEYS.imports),
  }
}

function restore(qc: QueryClient, importId: string, snap: Snapshot | undefined) {
  if (!snap) return
  qc.setQueryData(BANK_KEYS.lines(importId), snap.lines)
  qc.setQueryData(BANK_KEYS.imports, snap.imports)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function useSaveBankProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; mapping: BankMapping }): Promise<BankProfile> => {
      const { data, error } = await tci().rpc('save_bank_statement_profile', {
        p_name: input.name,
        p_mapping: input.mapping,
      })
      if (error) throw error
      return data as BankProfile
    },
    onSuccess: (saved) => {
      qc.setQueryData<BankProfile[]>(BANK_KEYS.profiles, (old) =>
        [...(old ?? []).filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)),
      )
    },
  })
}

export function useImportBankStatement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      profileId: string | null
      fileName: string
      lines: readonly StatementLine[]
    }): Promise<ImportResult> => {
      const { data, error } = await tci().rpc('import_bank_statement', {
        p_profile_id: input.profileId,
        p_file_name: input.fileName,
        p_lines: input.lines,
      })
      if (error) throw error
      return data as ImportResult
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: BANK_KEYS.imports })
      void qc.invalidateQueries({ queryKey: AGENDA_TASKS })
    },
  })
}

/** One line's answer from confirm_bank_lines. */
export interface LineResult {
  line_id: string
  result: string
}

/**
 * Record matched (or suggested) lines as payments to the policy they were
 * matched to. The lines read «confirmed» at once; a line the database
 * refuses goes back to what it was and its answer comes back as a refusal.
 */
export function useConfirmBankLines(importId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineIds: readonly string[]): Promise<LineResult[]> => {
      const { data, error } = await tci().rpc('confirm_bank_lines', { p_line_ids: lineIds })
      if (error) throw error
      return (data ?? []) as LineResult[]
    },
    onMutate: async (lineIds) => {
      const snap = await snapshot(qc, importId)
      const ids = new Set(lineIds)
      patchLines(qc, importId, (l) => (ids.has(l.id) ? { ...l, status: 'confirmed' } : l))
      recountImport(qc, importId)
      return snap
    },
    onSuccess: (results, _ids, snap) => {
      const before = new Map((snap?.lines ?? []).map((l) => [l.id, l]))
      const refused = new Set(results.filter((r) => r.result !== 'recorded').map((r) => r.line_id))
      const answered = new Set(results.map((r) => r.line_id))
      // A refused line (or one the function did not answer for) is as it was.
      patchLines(qc, importId, (l) => (refused.has(l.id) || (!answered.has(l.id) && before.has(l.id)) ? (before.get(l.id) ?? l) : l))
      recountImport(qc, importId)
      const policies = results
        .filter((r) => r.result === 'recorded')
        .map((r) => before.get(r.line_id)?.match_policy_id)
        .filter((id): id is string => Boolean(id))
      void qc.invalidateQueries({ queryKey: BANK_KEYS.lines(importId) })
      invalidateAfterPayments(qc, [...new Set(policies)])
    },
    onError: (_error, _ids, snap) => restore(qc, importId, snap),
  })
}

/** Record a line as a payment to the policy a person chose. */
export function useAssignBankLine(importId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { lineId: string; policyId: string }): Promise<BankLine> => {
      const { data, error } = await tci().rpc('assign_bank_line', {
        p_line_id: input.lineId,
        p_policy_id: input.policyId,
      })
      if (error) throw error
      return data as BankLine
    },
    onSuccess: (line, input) => {
      patchLines(qc, importId, (l) => (l.id === line.id ? line : l))
      recountImport(qc, importId)
      invalidateAfterPayments(qc, [input.policyId])
    },
  })
}

/** Set a line aside as not a premium payment, with the reason. */
export function useIgnoreBankLine(importId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { lineId: string; reason: string }): Promise<BankLine> => {
      const { data, error } = await tci().rpc('ignore_bank_line', {
        p_line_id: input.lineId,
        p_reason: input.reason,
      })
      if (error) throw error
      return data as BankLine
    },
    onMutate: async (input) => {
      const snap = await snapshot(qc, importId)
      patchLines(qc, importId, (l) =>
        l.id === input.lineId ? { ...l, status: 'ignored', ignore_reason: input.reason.trim() } : l,
      )
      recountImport(qc, importId)
      return snap
    },
    onSuccess: (line) => {
      patchLines(qc, importId, (l) => (l.id === line.id ? line : l))
      recountImport(qc, importId)
      void qc.invalidateQueries({ queryKey: AGENDA_TASKS })
    },
    onError: (_error, _input, snap) => restore(qc, importId, snap),
  })
}
