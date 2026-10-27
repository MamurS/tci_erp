/**
 * Data access for sanctions screening (migration 0091). Staff only: the
 * tables answer nothing to a client, and the hooks are not enabled for one.
 * Every write is a gated SQL function.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import { useIsStaffReader } from '../risk/api'
import { batches } from './lists/parse'
import type { ParsedEntry, SanctionsList } from './lists/parse'
import type { MatchStatus, OwnerRole, SanctionsStatus, ScreeningReason, SubjectKind } from './model'

export const SANCTIONS_KEYS = {
  all: ['sanctions'] as const,
  status: ['sanctions', 'status'] as const,
  lists: ['sanctions', 'lists'] as const,
  pending: ['sanctions', 'pending'] as const,
  matches: (entityId: string) => ['sanctions', 'matches', entityId] as const,
  screenings: (entityId: string) => ['sanctions', 'screenings', entityId] as const,
  subjects: (entityId: string) => ['sanctions', 'subjects', entityId] as const,
  owners: (entityId: string) => ['sanctions', 'owners', entityId] as const,
  search: (name: string, person: boolean | null) => ['sanctions', 'search', name, person] as const,
  settings: ['sanctions', 'settings'] as const,
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: SANCTIONS_KEYS.all })
  // A confirmed match is a flag (0085's risk views), and tasks move.
  void queryClient.invalidateQueries({ queryKey: ['risk'] })
  void queryClient.invalidateQueries({ queryKey: ['limits'] })
  void queryClient.invalidateQueries({ queryKey: ['agenda', 'tasks'] })
}

// ---------------------------------------------------------------------------
// Status (the registry and limit tables' column)
// ---------------------------------------------------------------------------

export interface EntitySanctionsStatus {
  entity_id: string
  company_flagged: boolean
  country_flagged: boolean
  pending_matches: number
  last_screened_at: string | null
  last_outcome: 'clear' | 'possible_match' | null
  lists_activated_at: string | null
  status: SanctionsStatus
}

/** Every company's status, by id (one query shared by every table). */
export function useSanctionsStatusMap() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: SANCTIONS_KEYS.status,
    enabled: staff,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, EntitySanctionsStatus>> => {
      const { data, error } = await tci().from('v_entity_sanctions_status').select('*')
      if (error) throw error
      return new Map(((data ?? []) as EntitySanctionsStatus[]).map((r) => [r.entity_id, r]))
    },
  })
}

export function useEntitySanctionsStatus(entityId: string | null | undefined): EntitySanctionsStatus | null {
  const map = useSanctionsStatusMap()
  return entityId ? (map.data?.get(entityId) ?? null) : null
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export interface SanctionsListRow {
  list_key: string
  required: boolean
  import_id: string | null
  list_name: string | null
  published_at: string | null
  file_name: string | null
  entry_count: number | null
  name_count: number | null
  delisted_count: number | null
  imported_by: string | null
  activated_at: string | null
  stale: boolean
}

export function useSanctionsLists() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: SANCTIONS_KEYS.lists,
    enabled: staff,
    queryFn: async (): Promise<SanctionsListRow[]> => {
      const { data, error } = await tci().from('v_sanctions_lists').select('*').order('list_key')
      if (error) throw error
      return (data ?? []) as SanctionsListRow[]
    },
  })
}

export interface ImportProgress {
  phase: 'loading' | 'finishing' | 'screening'
  done: number
  total: number
}

export interface ImportInput {
  list: SanctionsList
  listName: string | null
  publishedAt: string
  fileName: string
  sha256: string | null
  entries: ParsedEntry[]
  confirmShrink: boolean
}

/** Begin, load in batches, finish, then screen the companies due — the
 * whole import as one mutation, reporting its progress. */
export function useImportSanctionsList(onProgress: (p: ImportProgress) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ImportInput) => {
      const { data: importId, error: beginError } = await tci().rpc('begin_sanctions_list_import', {
        p_list: input.list,
        p_list_name: input.list === 'other' ? input.listName : null,
        p_published_at: input.publishedAt,
        p_file_name: input.fileName,
        p_sha256: input.sha256,
      })
      if (beginError) throw beginError
      const parts = batches(input.entries)
      let done = 0
      onProgress({ phase: 'loading', done, total: input.entries.length })
      for (const part of parts) {
        const { error } = await tci().rpc('add_sanctions_list_entries', { p_import: importId, p_rows: part })
        if (error) throw error
        done += part.length
        onProgress({ phase: 'loading', done, total: input.entries.length })
      }
      onProgress({ phase: 'finishing', done, total: input.entries.length })
      const { data: finished, error: finishError } = await tci().rpc('finish_sanctions_list_import', {
        p_import: importId,
        p_confirm_shrink: input.confirmShrink,
      })
      if (finishError) throw finishError
      const result = finished as { entries: number; names: number; delisted: number; due: number }
      // Screen the companies kept screened against the new list, in batches.
      let remaining = result.due
      let screened = 0
      const total = result.due
      while (remaining > 0) {
        onProgress({ phase: 'screening', done: screened, total })
        const { data, error } = await tci().rpc('rescreen_sanctions_due', { p_limit: 50 })
        if (error) throw error
        const r = data as { screened: number; remaining: number }
        screened += r.screened
        if (r.screened === 0) break
        remaining = r.remaining
      }
      return { ...result, screened }
    },
    onSettled: () => invalidate(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Matches and screenings
// ---------------------------------------------------------------------------

export interface SanctionsMatch {
  id: string
  entity_id: string
  subject_kind: SubjectKind
  subject_entity_id: string | null
  subject_owner_id: string | null
  subject_name: string
  list_key: string
  list_ref: string
  matched_name: string
  score: number
  entry_snapshot: {
    kind: string
    primary_name: string
    programmes: string[]
    countries: string[]
    birth_dates: string[]
    listed_on: string | null
    published_at: string
    role: OwnerRole | null
    depth: number
  }
  status: MatchStatus
  resolved_by: string | null
  resolved_at: string | null
  resolution_note: string | null
  retired_reason: 'subject_gone' | 'delisted' | null
  flag_id: string | null
  created_at: string
  legal_entities?: { name: string; country_code: string } | null
}

export function useEntityMatches(entityId: string) {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: SANCTIONS_KEYS.matches(entityId),
    enabled: staff,
    queryFn: async (): Promise<SanctionsMatch[]> => {
      const { data, error } = await tci()
        .from('sanctions_matches')
        .select('*')
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SanctionsMatch[]
    },
  })
}

/** Every pending match, the review queue of the sanctions section. */
export function usePendingMatches() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: SANCTIONS_KEYS.pending,
    enabled: staff,
    queryFn: async (): Promise<SanctionsMatch[]> => {
      const { data, error } = await tci()
        .from('sanctions_matches')
        .select('*, legal_entities!sanctions_matches_entity_id_fkey(name, country_code)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as SanctionsMatch[]
    },
  })
}

export interface SanctionsScreening {
  id: string
  entity_id: string
  reason: ScreeningReason
  lists: { import_id: string; list: string; published_at: string }[]
  subjects: number
  candidates: number
  new_matches: number
  pending: number
  outcome: 'clear' | 'possible_match' | 'no_lists'
  screened_by: string | null
  screened_at: string
}

export function useScreenings(entityId: string) {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: SANCTIONS_KEYS.screenings(entityId),
    enabled: staff,
    queryFn: async (): Promise<SanctionsScreening[]> => {
      const { data, error } = await tci()
        .from('sanctions_screenings')
        .select('*')
        .eq('entity_id', entityId)
        .order('screened_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as SanctionsScreening[]
    },
  })
}

export interface SanctionsSubject {
  subject_kind: SubjectKind
  subject_key: string
  subject_entity_id: string | null
  subject_owner_id: string | null
  name: string
  person: boolean
  depth: number
  via_entity_id: string
  role: OwnerRole | null
  ownership_pct: number | null
}

export function useSubjects(entityId: string) {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: SANCTIONS_KEYS.subjects(entityId),
    enabled: staff,
    queryFn: async (): Promise<SanctionsSubject[]> => {
      const { data, error } = await tci().rpc('sanctions_subjects', { p_entity: entityId })
      if (error) throw error
      return (data ?? []) as SanctionsSubject[]
    },
  })
}

export function useScreenNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (entityId: string) => {
      const { data, error } = await tci().rpc('screen_entity_now', { p_entity: entityId })
      if (error) throw error
      return data as { outcome: 'clear' | 'possible_match' | 'no_lists'; new_matches: number; pending: number }
    },
    onSettled: () => invalidate(queryClient),
  })
}

export function useResolveMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { matchId: string; outcome: 'confirmed' | 'cleared'; note: string }) => {
      const { data, error } = await tci().rpc('resolve_sanctions_match', {
        p_match: input.matchId,
        p_outcome: input.outcome,
        p_note: input.note,
      })
      if (error) throw error
      return data as { status: MatchStatus; flag_id: string | null; pending: number }
    },
    onSettled: () => invalidate(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Beneficial owners
// ---------------------------------------------------------------------------

export interface BeneficialOwner {
  id: string
  entity_id: string
  full_name: string
  role: OwnerRole
  ownership_pct: number | null
  birth_date: string | null
  nationality: string | null
  source: string
  added_by: string
  added_at: string
  ended_by: string | null
  ended_at: string | null
  end_reason: string | null
}

export function useBeneficialOwners(entityId: string) {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: SANCTIONS_KEYS.owners(entityId),
    enabled: staff,
    queryFn: async (): Promise<BeneficialOwner[]> => {
      const { data, error } = await tci()
        .from('entity_beneficial_owners')
        .select('*')
        .eq('entity_id', entityId)
        .order('added_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BeneficialOwner[]
    },
  })
}

export interface OwnerInput {
  entityId: string
  fullName: string
  role: OwnerRole
  ownershipPct: number | null
  birthDate: string | null
  nationality: string | null
  source: string
}

export function useAddOwner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: OwnerInput) => {
      const { error } = await tci().rpc('add_beneficial_owner', {
        p_entity: input.entityId,
        p_full_name: input.fullName,
        p_role: input.role,
        p_ownership_pct: input.ownershipPct,
        p_birth_date: input.birthDate,
        p_nationality: input.nationality,
        p_source: input.source,
      })
      if (error) throw error
    },
    onSettled: () => invalidate(queryClient),
  })
}

export function useEndOwner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { ownerId: string; reason: string }) => {
      const { error } = await tci().rpc('end_beneficial_owner', { p_owner: input.ownerId, p_reason: input.reason })
      if (error) throw error
    },
    onSettled: () => invalidate(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Search and settings
// ---------------------------------------------------------------------------

export interface SearchHit {
  entry_id: string
  list_key: string
  list_ref: string
  kind: string
  primary_name: string
  matched_name: string
  score: number
  programmes: string[]
  countries: string[]
  birth_dates: string[]
  listed_on: string | null
  published_at: string
}

export function useSanctionsSearch(name: string, person: boolean | null) {
  const staff = useIsStaffReader()
  const q = name.trim()
  return useQuery({
    queryKey: SANCTIONS_KEYS.search(q, person),
    enabled: staff && q.length >= 3,
    staleTime: 60_000,
    queryFn: async (): Promise<SearchHit[]> => {
      const { data, error } = await tci().rpc('sanctions_search', { p_name: q, p_person: person, p_limit: 50 })
      if (error) throw error
      return (data ?? []) as SearchHit[]
    },
  })
}

export interface SanctionsSettings {
  sanctions_match_threshold: number
  sanctions_list_stale_days: number
  sanctions_required_lists: string[]
}

export function useSanctionsSettings() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: SANCTIONS_KEYS.settings,
    enabled: staff,
    queryFn: async (): Promise<SanctionsSettings> => {
      const { data, error } = await tci()
        .from('workflow_settings')
        .select('sanctions_match_threshold, sanctions_list_stale_days, sanctions_required_lists')
        .single()
      if (error) throw error
      return data as SanctionsSettings
    },
  })
}

export function useSaveSanctionsSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SanctionsSettings) => {
      const { error } = await tci().rpc('set_sanctions_settings', {
        p_threshold: input.sanctions_match_threshold,
        p_stale_days: input.sanctions_list_stale_days,
        p_required: input.sanctions_required_lists,
      })
      if (error) throw error
    },
    onSettled: () => invalidate(queryClient),
  })
}
