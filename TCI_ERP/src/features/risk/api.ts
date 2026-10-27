/** Data access for sector grades, country risk and sanctions (migration 0085).
 *
 * Reads go through the staff-only tables and views (a client reads nothing
 * of it — RLS answers empty, and the hooks are not even enabled for one);
 * every write is a gated SQL function, because the rules — who may grade a
 * sector, four eyes, the head of credit analysis, admin's sanctions — live
 * there.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../../auth/AuthContext'
import { tci } from '../../lib/supabase'
import type {
  BuyerRiskContext,
  Concentration,
  Outlook,
  ReviewKind,
  RiskAdjustment,
  SanctionRegime,
  SanctionScope,
  SectorFactors,
  SectorGrade,
} from './rules'

export const RISK_KEYS = {
  all: ['risk'] as const,
  sectors: ['risk', 'sectors'] as const,
  sector: (id: string) => ['risk', 'sector', id] as const,
  reviews: (sectorId: string) => ['risk', 'reviews', sectorId] as const,
  sectorBook: (sectorId: string) => ['risk', 'sector-book', sectorId] as const,
  countries: ['risk', 'countries'] as const,
  imports: ['risk', 'imports'] as const,
  overrides: ['risk', 'overrides'] as const,
  sanctions: ['risk', 'sanctions'] as const,
  settings: ['risk', 'settings'] as const,
  context: (entityId: string) => ['risk', 'context', entityId] as const,
  concentration: (scope: string, id: string) => ['risk', 'concentration', scope, id] as const,
}

/** Staff only: a client never asks (the tables answer nothing to them anyway). */
export function useIsStaffReader(): boolean {
  const { actingRole } = useAuth()
  return actingRole !== null && actingRole !== 'client'
}

function invalidateRisk(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: RISK_KEYS.all })
  // A grade or a flag changes what a decision may do and what the Agenda holds.
  void queryClient.invalidateQueries({ queryKey: ['limits'] })
  void queryClient.invalidateQueries({ queryKey: ['agenda', 'tasks'] })
}

// ---------------------------------------------------------------------------
// Sectors
// ---------------------------------------------------------------------------

/** One row of tci.v_sector_grades. */
export interface SectorRow {
  sector_id: string
  industry_code: string
  name_en: string
  name_ru: string
  name_uz: string
  analyst_id: string | null
  review_id: string | null
  grade: SectorGrade | null
  outlook: Outlook | null
  kind: ReviewKind | null
  reviewed_at: string | null
  quarter_start: string | null
  stale: boolean
  overdue: boolean
  pending: boolean
  companies: number
  buyers_with_limits: number
  exposure_uzs: number | null
  exposure_missing_rates: number
}

export function useSectorGrades() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: RISK_KEYS.sectors,
    enabled: staff,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SectorRow[]> => {
      const { data, error } = await tci().from('v_sector_grades').select('*').order('name_en')
      if (error) throw error
      return (data ?? []) as SectorRow[]
    },
  })
}

/** industry code → its sector row, for the badges beside every industry. */
export function useSectorByIndustry(): Map<string, SectorRow> {
  const { data } = useSectorGrades()
  const map = new Map<string, SectorRow>()
  for (const row of data ?? []) map.set(row.industry_code, row)
  return map
}

/** One row of tci.sector_reviews. */
export interface SectorReview {
  id: string
  sector_id: string
  quarter_start: string
  kind: ReviewKind
  grade: SectorGrade
  outlook: Outlook
  factors: SectorFactors
  narrative: string
  sources: string[]
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  created_at: string
  decided_by: string | null
  decided_at: string | null
  decision_comment: string | null
}

/** Every version, newest first: the history is the chart and the list. */
export function useSectorReviews(sectorId: string | undefined) {
  return useQuery({
    queryKey: RISK_KEYS.reviews(sectorId ?? ''),
    enabled: Boolean(sectorId),
    queryFn: async (): Promise<SectorReview[]> => {
      const { data, error } = await tci()
        .from('sector_reviews')
        .select('*')
        .eq('sector_id', sectorId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SectorReview[]
    },
  })
}

/** A buyer of the sector: its grade in force and its in-force limits. */
export interface SectorBuyer {
  entity_id: string
  name: string
  country_code: string | null
  rating_grade: string | null
  limits: number
  exposure_uzs: number | null
}

/** The sector's companies with their grade and in-force limits (UZS). */
export function useSectorBuyers(industryCode: string | undefined) {
  return useQuery({
    queryKey: RISK_KEYS.sectorBook(industryCode ?? ''),
    enabled: Boolean(industryCode),
    queryFn: async (): Promise<SectorBuyer[]> => {
      const { data: entities, error } = await tci()
        .from('legal_entities')
        .select('id, name, country_code')
        .eq('industry_id', industryCode!)
        .order('name')
        .limit(500)
      if (error) throw error
      const ids = (entities ?? []).map((e: { id: string }) => e.id)
      if (!ids.length) return []
      const [ratings, limits] = await Promise.all([
        tci()
          .from('credit_assessments')
          .select('entity_id, rating_grade, created_at')
          .in('entity_id', ids)
          .order('created_at', { ascending: false }),
        tci()
          .from('v_credit_portfolio')
          .select('buyer_entity_id, amount_uzs')
          .in('buyer_entity_id', ids),
      ])
      const latest = new Map<string, string | null>()
      for (const r of (ratings.data ?? []) as { entity_id: string; rating_grade: string | null }[]) {
        if (!latest.has(r.entity_id)) latest.set(r.entity_id, r.rating_grade)
      }
      const book = new Map<string, { n: number; uzs: number | null }>()
      for (const l of (limits.error ? [] : (limits.data ?? [])) as { buyer_entity_id: string; amount_uzs: number | null }[]) {
        const cur = book.get(l.buyer_entity_id) ?? { n: 0, uzs: 0 }
        book.set(l.buyer_entity_id, {
          n: cur.n + 1,
          uzs: cur.uzs === null || l.amount_uzs === null ? null : cur.uzs + Number(l.amount_uzs),
        })
      }
      return (entities ?? []).map((e: { id: string; name: string; country_code: string | null }) => ({
        entity_id: e.id,
        name: e.name,
        country_code: e.country_code,
        rating_grade: latest.get(e.id) ?? null,
        limits: book.get(e.id)?.n ?? 0,
        exposure_uzs: book.has(e.id) ? (book.get(e.id)!.uzs ?? null) : 0,
      }))
    },
  })
}

export function useAssignSectorAnalyst() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { sectorId: string; analystId: string | null }) => {
      const { error } = await tci().rpc('assign_sector_analyst', { p_sector: input.sectorId, p_analyst: input.analystId })
      if (error) throw error
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

export interface SectorReviewInput {
  sectorId: string
  grade: SectorGrade
  outlook: Outlook
  factors: SectorFactors
  narrative: string
  sources: string[]
  kind: ReviewKind
}

export function useSubmitSectorReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SectorReviewInput): Promise<SectorReview> => {
      const { data, error } = await tci().rpc('submit_sector_review', {
        p_sector: input.sectorId,
        p_grade: input.grade,
        p_outlook: input.outlook,
        p_factors: input.factors,
        p_narrative: input.narrative,
        p_sources: input.sources,
        p_kind: input.kind,
      })
      if (error) throw error
      return data as SectorReview
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

export function useDecideSectorReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { reviewId: string; approve: boolean; comment?: string | null }) => {
      const { error } = await tci().rpc('decide_sector_review', {
        p_review: input.reviewId,
        p_approve: input.approve,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

/** One row of tci.v_country_risk. */
export interface CountryRiskRow {
  country_code: string
  name_en: string
  name_ru: string
  name_uz: string
  oecd_category: number | null
  oecd_effective: string | null
  internal_category: number | null
  override_id: string | null
  override_pending: boolean
  category: number | null
  source: 'oecd' | 'internal' | null
  sanctioned: boolean
  latest_import_effective: string | null
  latest_import_at: string | null
  import_stale: boolean
}

export function useCountryRisk() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: RISK_KEYS.countries,
    enabled: staff,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CountryRiskRow[]> => {
      const { data, error } = await tci().from('v_country_risk').select('*').order('name_en')
      if (error) throw error
      return (data ?? []) as CountryRiskRow[]
    },
  })
}

/** country code → its risk row, for the badges beside every country. */
export function useCountryRiskByCode(): Map<string, CountryRiskRow> {
  const { data } = useCountryRisk()
  const map = new Map<string, CountryRiskRow>()
  for (const row of data ?? []) map.set(row.country_code, row)
  return map
}

export interface CountryImport {
  id: string
  effective_date: string
  file_name: string
  row_count: number
  note: string | null
  imported_by: string
  imported_at: string
}

export function useCountryImports() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: RISK_KEYS.imports,
    enabled: staff,
    queryFn: async (): Promise<CountryImport[]> => {
      const { data, error } = await tci()
        .from('country_risk_imports')
        .select('*')
        .order('effective_date', { ascending: false })
        .order('imported_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CountryImport[]
    },
  })
}

export function useImportCountryRisk() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      effectiveDate: string
      fileName: string
      rows: { country_code: string; category: number }[]
      note?: string | null
    }): Promise<CountryImportResult> => {
      const { data, error } = await tci().rpc('import_country_risk', {
        p_effective: input.effectiveDate,
        p_file_name: input.fileName,
        p_rows: input.rows,
        p_note: input.note ?? null,
      })
      if (error) throw error
      return data as CountryImportResult
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

/** What tci.import_country_risk answers (0087: whether the list is now in
 * use, and how many countries it made worse for buyers with limits). */
export interface CountryImportResult {
  import_id: string
  rows: number
  takes_effect?: boolean
  downgrades?: number
}

/** One row of tci.country_risk_changes (0087). */
export interface CountryRiskChange {
  country_code: string
  oecd_before: number | null
  oecd_after: number | null
  /** The approved internal category: decisions keep using it. */
  internal_category: number | null
  direction: 'worse' | 'better'
  buyers: number
  exposure_uzs: number | null
  rates_missing: number
}

/** tci.country_risk_import_preview (0087): a list against the one in use. */
export interface CountryRiskPreview {
  first_import: boolean
  previous_effective: string | null
  previous_file: string | null
  /** The file is older than the list in use: it would be stored, not used. */
  superseded: boolean
  changes: CountryRiskChange[]
}

/** The preview of a list about to be imported (admin only). */
export function useCountryRiskPreview(
  effectiveDate: string,
  rows: readonly { country_code: string; category: number }[],
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...RISK_KEYS.all, 'import-preview', effectiveDate, rows],
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<CountryRiskPreview> => {
      const { data, error } = await tci().rpc('country_risk_import_preview', {
        p_effective: effectiveDate,
        p_rows: rows,
      })
      if (error) throw error
      return data as CountryRiskPreview
    },
  })
}

export interface CountryOverride {
  id: string
  country_code: string
  category: number
  justification: string
  status: 'pending' | 'approved' | 'rejected' | 'ended'
  proposed_by: string
  proposed_at: string
  decided_by: string | null
  decided_at: string | null
  decision_comment: string | null
  ended_by: string | null
  ended_at: string | null
  end_reason: string | null
}

export function useCountryOverrides() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: RISK_KEYS.overrides,
    enabled: staff,
    queryFn: async (): Promise<CountryOverride[]> => {
      const { data, error } = await tci()
        .from('country_risk_overrides')
        .select('*')
        .order('proposed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CountryOverride[]
    },
  })
}

export function useProposeCountryOverride() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { countryCode: string; category: number; justification: string }) => {
      const { error } = await tci().rpc('propose_country_override', {
        p_country: input.countryCode,
        p_category: input.category,
        p_justification: input.justification,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

export function useDecideCountryOverride() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { overrideId: string; approve: boolean; comment?: string | null }) => {
      const { error } = await tci().rpc('decide_country_override', {
        p_override: input.overrideId,
        p_approve: input.approve,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

export function useEndCountryOverride() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { overrideId: string; reason: string }) => {
      const { error } = await tci().rpc('end_country_override', { p_override: input.overrideId, p_reason: input.reason })
      if (error) throw error
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Sanctions
// ---------------------------------------------------------------------------

export interface SanctionFlag {
  id: string
  scope: SanctionScope
  country_code: string | null
  entity_id: string | null
  regime: SanctionRegime
  source: string
  reference: string | null
  effective_from: string
  note: string | null
  set_by: string
  set_at: string
  lifted_by: string | null
  lifted_at: string | null
  lift_reason: string | null
  legal_entities?: { name: string } | null
}

export function useSanctionFlags() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: RISK_KEYS.sanctions,
    enabled: staff,
    staleTime: 60_000,
    queryFn: async (): Promise<SanctionFlag[]> => {
      const { data, error } = await tci()
        .from('sanction_flags')
        .select('*, legal_entities(name)')
        .order('set_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as SanctionFlag[]
    },
  })
}

/** The live flags (effective, not lifted), by country and by company. */
export function useLiveSanctions(): { countries: Set<string>; entities: Set<string> } {
  const { data } = useSanctionFlags()
  const today = new Date().toISOString().slice(0, 10)
  const countries = new Set<string>()
  const entities = new Set<string>()
  for (const f of data ?? []) {
    if (f.lifted_at || f.effective_from > today) continue
    if (f.scope === 'country' && f.country_code) countries.add(f.country_code)
    if (f.scope === 'entity' && f.entity_id) entities.add(f.entity_id)
  }
  return { countries, entities }
}

export function useSetSanctionFlag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      scope: SanctionScope
      countryCode?: string | null
      entityId?: string | null
      regime: SanctionRegime
      source: string
      reference?: string | null
      effectiveFrom?: string | null
      note?: string | null
    }): Promise<{ flag_id: string; limits_to_review: number }> => {
      const { data, error } = await tci().rpc('set_sanction_flag', {
        p_scope: input.scope,
        p_country: input.countryCode ?? null,
        p_entity: input.entityId ?? null,
        p_regime: input.regime,
        p_source: input.source,
        p_reference: input.reference ?? null,
        p_effective_from: input.effectiveFrom ?? null,
        p_note: input.note ?? null,
      })
      if (error) throw error
      return data as { flag_id: string; limits_to_review: number }
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

export function useLiftSanctionFlag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { flagId: string; reason: string }) => {
      const { error } = await tci().rpc('lift_sanction_flag', { p_flag: input.flagId, p_reason: input.reason })
      if (error) throw error
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface RiskSettings {
  adjustments: RiskAdjustment[]
  sector_review_due_day: number
  sector_review_four_eyes: boolean
  oecd_stale_months: number
  concentration_warn_pct: number
  client_show_oecd: boolean
}

export function useRiskSettings() {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: RISK_KEYS.settings,
    enabled: staff,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RiskSettings> => {
      const [adj, ws] = await Promise.all([
        tci().from('risk_adjustment_settings').select('*').order('dimension').order('key'),
        tci()
          .from('workflow_settings')
          .select('sector_review_due_day, sector_review_four_eyes, oecd_stale_months, concentration_warn_pct, client_show_oecd')
          .maybeSingle(),
      ])
      if (adj.error) throw adj.error
      if (ws.error) throw ws.error
      const w = (ws.data ?? {}) as Partial<RiskSettings>
      return {
        adjustments: ((adj.data ?? []) as RiskAdjustment[]).map((a) => ({
          ...a,
          premium_loading_pct: Number(a.premium_loading_pct),
        })),
        sector_review_due_day: w.sector_review_due_day ?? 15,
        sector_review_four_eyes: w.sector_review_four_eyes ?? false,
        oecd_stale_months: w.oecd_stale_months ?? 6,
        concentration_warn_pct: Number(w.concentration_warn_pct ?? 40),
        client_show_oecd: w.client_show_oecd ?? false,
      }
    },
  })
}

export function useSaveRiskAdjustment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (a: RiskAdjustment) => {
      const { error } = await tci().rpc('save_risk_adjustment', {
        p_dimension: a.dimension,
        p_key: a.key,
        p_notch: a.notch,
        p_cap_grade: a.cap_grade ?? '',
        p_cover: a.cover,
        p_rank_floor: a.rank_floor,
        p_rank_add: a.rank_add,
        p_premium_loading_pct: a.premium_loading_pct,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

export function useSetRiskSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (s: Omit<RiskSettings, 'adjustments'>) => {
      const { error } = await tci().rpc('set_risk_settings', {
        p_sector_review_due_day: s.sector_review_due_day,
        p_sector_review_four_eyes: s.sector_review_four_eyes,
        p_oecd_stale_months: s.oecd_stale_months,
        p_concentration_warn_pct: s.concentration_warn_pct,
        p_client_show_oecd: s.client_show_oecd,
      })
      if (error) throw error
    },
    onSuccess: () => invalidateRisk(queryClient),
  })
}

// ---------------------------------------------------------------------------
// A buyer, a policy, a submission
// ---------------------------------------------------------------------------

/** Everything a decision screen shows about a buyer's sector, country and
 * cover (tci.buyer_risk_context). */
export function useBuyerRiskContext(entityId: string | null | undefined) {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: RISK_KEYS.context(entityId ?? ''),
    enabled: staff && Boolean(entityId),
    queryFn: async (): Promise<BuyerRiskContext> => {
      const { data, error } = await tci().rpc('buyer_risk_context', { p_entity: entityId! })
      if (error) throw error
      return data as BuyerRiskContext
    },
  })
}

/** The concentration of a policy's book or a submission's package. */
export function useCoverConcentration(scope: 'policy' | 'submission', id: string | null | undefined) {
  const staff = useIsStaffReader()
  return useQuery({
    queryKey: RISK_KEYS.concentration(scope, id ?? ''),
    enabled: staff && Boolean(id),
    queryFn: async (): Promise<Concentration> => {
      const { data, error } = await tci().rpc('cover_concentration', {
        p_policy: scope === 'policy' ? id! : null,
        p_submission: scope === 'submission' ? id! : null,
      })
      if (error) throw error
      return data as Concentration
    },
  })
}
