/** Data access for buyers and financial statements (TanStack Query + Supabase). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type {
  BalanceSheetValues,
  Buyer,
  BuyerWithRefs,
  IncomeStatementValues,
  StatementBundle,
} from './types'

const KEYS = {
  buyers: ['buyers'] as const,
  buyer: (id: string) => ['buyers', id] as const,
  statements: (buyerId: string) => ['buyers', buyerId, 'statements'] as const,
}

// ---------------------------------------------------------------------------
// Buyers
// ---------------------------------------------------------------------------

const BUYER_SELECT =
  '*, countries(name_en, name_ru, name_uz), industries(name_en, name_ru, name_uz), financial_statements(period_end_date)'

export function useBuyers() {
  return useQuery({
    queryKey: KEYS.buyers,
    queryFn: async (): Promise<BuyerWithRefs[]> => {
      const { data, error } = await tci()
        .from('buyers')
        .select(BUYER_SELECT)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as BuyerWithRefs[]
    },
  })
}

export function useBuyer(id: string) {
  return useQuery({
    queryKey: KEYS.buyer(id),
    queryFn: async (): Promise<BuyerWithRefs | null> => {
      const { data, error } = await tci()
        .from('buyers')
        .select(BUYER_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as unknown as BuyerWithRefs | null
    },
  })
}

export interface BuyerInput {
  name: string
  country_code: string
  industry_id: string | null
  registration_number: string
  website: string | null
  notes: string | null
}

export function useCreateBuyer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: BuyerInput): Promise<Buyer> => {
      const { data, error } = await tci().from('buyers').insert(input).select().single()
      if (error) throw error
      return data as Buyer
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.buyers }),
  })
}

export function useUpdateBuyer(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<BuyerInput>): Promise<void> => {
      const { error } = await tci().from('buyers').update(input).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.buyers }),
  })
}

// ---------------------------------------------------------------------------
// Financial statements
// ---------------------------------------------------------------------------

export function useStatements(buyerId: string) {
  return useQuery({
    queryKey: KEYS.statements(buyerId),
    queryFn: async (): Promise<StatementBundle[]> => {
      const { data, error } = await tci()
        .from('financial_statements')
        .select('*, balance_sheets(*), income_statements(*)')
        .eq('buyer_id', buyerId)
        .order('period_end_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as StatementBundle[]
    },
  })
}

export interface StatementHeaderInput {
  buyer_id: string
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

export function useCreateStatement(buyerId: string) {
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
      void queryClient.invalidateQueries({ queryKey: KEYS.statements(buyerId) })
      void queryClient.invalidateQueries({ queryKey: KEYS.buyers })
    },
  })
}

export function useUpdateStatement(buyerId: string, statementId: string) {
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
      void queryClient.invalidateQueries({ queryKey: KEYS.statements(buyerId) })
    },
  })
}

export function useDeleteStatement(buyerId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (statementId: string) => {
      // balance_sheets / income_statements cascade on delete
      const { error } = await tci().from('financial_statements').delete().eq('id', statementId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.statements(buyerId) })
      void queryClient.invalidateQueries({ queryKey: KEYS.buyers })
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
