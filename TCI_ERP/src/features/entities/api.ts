/** Data access for legal entities and financial statements (TanStack Query + Supabase). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import { NAME_MIN_CHARS, REG_MIN_CHARS } from './dedup'
import type {
  BalanceSheetValues,
  EntityRoles,
  EntityWithRefs,
  IncomeStatementValues,
  LegalEntity,
  SimilarEntity,
  StatementBundle,
} from './types'

const KEYS = {
  entities: ['entities'] as const,
  entity: (id: string) => ['entities', id] as const,
  statements: (entityId: string) => ['entities', entityId, 'statements'] as const,
}

// ---------------------------------------------------------------------------
// Legal entities (unified registry - roles are computed via v_entity_roles)
// ---------------------------------------------------------------------------

const ENTITY_SELECT =
  '*, countries(name_en, name_ru, name_uz), industries(name_en, name_ru, name_uz), financial_statements(period_end_date)'

export function useEntities() {
  return useQuery({
    queryKey: KEYS.entities,
    queryFn: async (): Promise<EntityWithRefs[]> => {
      const { data, error } = await tci()
        .from('legal_entities')
        .select(ENTITY_SELECT)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as EntityWithRefs[]
    },
  })
}

export function useEntity(id: string) {
  return useQuery({
    queryKey: KEYS.entity(id),
    queryFn: async (): Promise<EntityWithRefs | null> => {
      const { data, error } = await tci()
        .from('legal_entities')
        .select(ENTITY_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as unknown as EntityWithRefs | null
    },
  })
}

/** Computed roles for every entity (small table; single query). */
export function useEntityRoles() {
  return useQuery({
    queryKey: ['entities', 'roles'],
    queryFn: async (): Promise<Map<string, EntityRoles>> => {
      const { data, error } = await tci().from('v_entity_roles').select('*')
      if (error) throw error
      return new Map(
        ((data ?? []) as EntityRoles[]).map((r) => [r.entity_id, r]),
      )
    },
  })
}

/** Latest assessment grade per entity (single query, newest wins). */
export function useLatestGrades() {
  return useQuery({
    queryKey: ['entities', 'latest-grades'],
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await tci()
        .from('credit_assessments')
        .select('entity_id, rating_grade, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      const map = new Map<string, string>()
      for (const row of (data ?? []) as { entity_id: string; rating_grade: string }[]) {
        if (!map.has(row.entity_id)) map.set(row.entity_id, row.rating_grade)
      }
      return map
    },
  })
}

export interface EntityInput {
  name: string
  legal_form: string | null
  country_code: string
  industry_id: string | null
  registration_number: string | null
  founded_date: string | null
  website: string | null
  address: string | null
  contact_person: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
}

export function useCreateEntity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: EntityInput): Promise<LegalEntity> => {
      const { data, error } = await tci().from('legal_entities').insert(input).select().single()
      if (error) throw error
      return data as LegalEntity
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.entities }),
  })
}

export function useUpdateEntity(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<EntityInput>): Promise<void> => {
      const { error } = await tci().from('legal_entities').update(input).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.entities }),
  })
}

// ---------------------------------------------------------------------------
// Add-entity dedup (blocking exact reg-number match + pg_trgm suggestions)
// ---------------------------------------------------------------------------

/** Exact (country, registration_number) match - a BLOCKING duplicate. */
export function useRegNumberMatch(countryCode: string, regNumber: string, excludeId?: string) {
  const reg = regNumber.trim()
  return useQuery({
    queryKey: ['entities', 'reg-match', countryCode, reg, excludeId ?? ''],
    enabled: reg.length >= REG_MIN_CHARS,
    queryFn: async (): Promise<LegalEntity | null> => {
      let query = tci()
        .from('legal_entities')
        .select('*')
        .eq('country_code', countryCode)
        .eq('registration_number', reg)
      if (excludeId) query = query.neq('id', excludeId)
      const { data, error } = await query.limit(1)
      if (error) throw error
      return ((data ?? [])[0] as LegalEntity | undefined) ?? null
    },
  })
}

/** Fuzzy name suggestions (pg_trgm, threshold 0.4, top 5) - NON-blocking. */
export function useSimilarEntities(name: string, excludeId?: string) {
  const q = name.trim()
  return useQuery({
    queryKey: ['entities', 'similar', q, excludeId ?? ''],
    enabled: q.length >= NAME_MIN_CHARS,
    queryFn: async (): Promise<SimilarEntity[]> => {
      const { data, error } = await tci().rpc('similar_entities', { p_name: q })
      if (error) throw error
      return ((data ?? []) as SimilarEntity[]).filter((e) => e.id !== excludeId)
    },
  })
}

// ---------------------------------------------------------------------------
// Financial statements
// ---------------------------------------------------------------------------

export function useStatements(entityId: string) {
  return useQuery({
    queryKey: KEYS.statements(entityId),
    queryFn: async (): Promise<StatementBundle[]> => {
      const { data, error } = await tci()
        .from('financial_statements')
        .select('*, balance_sheets(*), income_statements(*)')
        .eq('entity_id', entityId)
        .order('period_end_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as StatementBundle[]
    },
  })
}

export interface StatementHeaderInput {
  entity_id: string
  statement_kind: 'annual' | 'quarterly'
  fiscal_year: number
  fiscal_quarter: number | null
  period_end_date: string
  currency_code: string
  unit: 'units' | 'thousands' | 'millions'
  audited: boolean
  source: string | null
  report_type?: 'statutory' | 'management'
  accounting_basis?: 'ifrs' | 'local'
  /** Primary template (the balance-sheet form) when accounting_basis='local'. */
  template_id?: string | null
  mapping_status?: 'n/a' | 'mapped' | 'stale'
}

export interface StatementSaveInput {
  header: StatementHeaderInput
  balanceSheet: BalanceSheetValues
  incomeStatement: IncomeStatementValues
}

async function upsertStatementLines(
  statementId: string,
  balanceSheet: BalanceSheetValues,
  incomeStatement: IncomeStatementValues,
): Promise<void> {
  const { error: bsError } = await tci()
    .from('balance_sheets')
    .upsert({ statement_id: statementId, ...balanceSheet })
  if (bsError) throw bsError
  const { error: isError } = await tci()
    .from('income_statements')
    .upsert({ statement_id: statementId, ...incomeStatement })
  if (isError) throw isError
}

export function useCreateStatement(entityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ header, balanceSheet, incomeStatement }: StatementSaveInput) => {
      const { data, error } = await tci()
        .from('financial_statements')
        .insert(header)
        .select('id')
        .single()
      if (error) throw error
      await upsertStatementLines((data as { id: string }).id, balanceSheet, incomeStatement)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.statements(entityId) })
      void queryClient.invalidateQueries({ queryKey: KEYS.entities })
    },
  })
}

export function useUpdateStatement(entityId: string, statementId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ header, balanceSheet, incomeStatement }: StatementSaveInput) => {
      const { error } = await tci()
        .from('financial_statements')
        .update(header)
        .eq('id', statementId)
      if (error) throw error
      await upsertStatementLines(statementId, balanceSheet, incomeStatement)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.statements(entityId) })
    },
  })
}

export function useDeleteStatement(entityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (statementId: string) => {
      // balance_sheets / income_statements cascade on delete
      const { error } = await tci().from('financial_statements').delete().eq('id', statementId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.statements(entityId) })
      void queryClient.invalidateQueries({ queryKey: KEYS.entities })
    },
  })
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export interface CountryRow {
  code: string
  name_en: string
  name_ru: string
  name_uz: string
}

export interface IndustryRow {
  code: string
  name_en: string
  name_ru: string
  name_uz: string
}

export interface CurrencyRow {
  code: string
  name_en: string
  name_ru: string
  name_uz: string
}

export function useCountries() {
  return useQuery({
    queryKey: ['ref', 'countries'],
    staleTime: Infinity,
    queryFn: async (): Promise<CountryRow[]> => {
      const { data, error } = await tci().from('countries').select('*').order('name_en')
      if (error) throw error
      return (data ?? []) as CountryRow[]
    },
  })
}

export function useIndustries() {
  return useQuery({
    queryKey: ['ref', 'industries'],
    staleTime: Infinity,
    queryFn: async (): Promise<IndustryRow[]> => {
      const { data, error } = await tci().from('industries').select('*').order('name_en')
      if (error) throw error
      return (data ?? []) as IndustryRow[]
    },
  })
}

export function useCurrencies() {
  return useQuery({
    queryKey: ['ref', 'currencies'],
    staleTime: Infinity,
    queryFn: async (): Promise<CurrencyRow[]> => {
      const { data, error } = await tci().from('currencies').select('*').order('code')
      if (error) throw error
      return (data ?? []) as CurrencyRow[]
    },
  })
}

/** Localized reference name ("name_ru" etc.) with en fallback. */
export function refName(
  row: { name_en: string; name_ru: string; name_uz: string } | null | undefined,
  locale: string,
): string {
  if (!row) return ''
  if (locale === 'ru') return row.name_ru || row.name_en
  if (locale === 'uz') return row.name_uz || row.name_en
  return row.name_en
}
