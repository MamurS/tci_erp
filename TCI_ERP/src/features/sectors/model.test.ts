import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0085_sector_country_risk.sql?raw'
import {
  COUNTRY_FILTERS,
  DISTRIBUTION_KEYS,
  countryFilterCounts,
  oecdListState,
  parseCountryFilter,
  SECTOR_FILTERS,
  analystCandidates,
  buyersWithLimits,
  completeFactors,
  defaultReviewKind,
  effectiveMonth,
  emptyFactors,
  exposureByMonth,
  factorTone,
  filterCounts,
  filterSectors,
  gradeDistribution,
  gradeHistory,
  industryName,
  isWeakGrade,
  mayAssignAnalyst,
  mayEndOverride,
  mayProposeOverride,
  mayWriteReview,
  overrideDecisionState,
  parseSectorFilter,
  parseSectorView,
  parseSources,
  quarterEnd,
  reviewDecisionState,
  sourceHref,
  uiLang,
} from './model'
import type { SectorFlags } from './model'

/** The body of one function of 0085, up to the next top-level `create`. */
function fn(name: string): string {
  const start = MIGRATION.indexOf(`create function tci.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const end = MIGRATION.indexOf('\ncreate ', start + 10)
  return MIGRATION.slice(start, end < 0 ? undefined : end)
}

function view(name: string): string {
  const start = MIGRATION.indexOf(`create view tci.${name}`)
  expect(start, name).toBeGreaterThan(-1)
  return MIGRATION.slice(start, MIGRATION.indexOf('\ncomment on view', start))
}

const row = (over: Partial<SectorFlags>): SectorFlags => ({ grade: 'B', stale: false, overdue: false, pending: false, ...over })

describe('views and filters', () => {
  it('falls back to the sector list and to «all»', () => {
    expect(parseSectorView('countries')).toBe('countries')
    expect(parseSectorView('nope')).toBe('sectors')
    expect(parseSectorView(null)).toBe('sectors')
    expect(parseSectorFilter('cd')).toBe('cd')
    expect(parseSectorFilter('x')).toBe('all')
  })

  it('every filter is a column of v_sector_grades', () => {
    const v = view('v_sector_grades')
    for (const column of ['as stale', 'as overdue', 'as pending', 'cur.grade']) expect(v).toContain(column)
  })

  it('filters and counts', () => {
    const rows = [
      row({ grade: null }),
      row({ grade: 'A', stale: true }),
      row({ grade: 'C', overdue: true }),
      row({ grade: 'D', pending: true }),
      row({ grade: 'B' }),
    ]
    expect(filterSectors(rows, 'ungraded')).toHaveLength(1)
    expect(filterSectors(rows, 'cd').map((r) => r.grade)).toEqual(['C', 'D'])
    expect(filterCounts(rows)).toEqual({ all: 5, ungraded: 1, stale: 1, overdue: 1, pending: 1, cd: 2 })
    expect(Object.keys(filterCounts([]))).toEqual([...SECTOR_FILTERS])
  })

  it('C and D are the weak grades, as the downgrade task says', () => {
    expect(fn('sector_review_in_force')).toContain("if p_review.grade in ('C', 'D')")
    expect(['A', 'B', 'C', 'D', null].map(isWeakGrade)).toEqual([false, false, true, true, false])
  })
})

describe('names', () => {
  it('names an industry in the UI language, English when missing', () => {
    const r = { name_en: 'Retail', name_ru: 'Розничная торговля', name_uz: '', industry_code: 'G47' }
    expect(industryName(r, 'ru')).toBe('Розничная торговля')
    expect(industryName(r, 'uz')).toBe('Retail')
    expect(industryName(null, 'en')).toBe('—')
    expect(uiLang('ru-RU')).toBe('ru')
    expect(uiLang('de')).toBe('en')
  })
})

describe('who may do what — the mirror of 0085', () => {
  it('admin alone assigns the responsible analyst, and only to a credit analyst', () => {
    const body = fn('assign_sector_analyst')
    expect(body).toContain("perform tci.require_role('admin');")
    expect(body).toContain("r.role = 'credit_analyst'")
    expect(mayAssignAnalyst('admin')).toBe(true)
    expect(mayAssignAnalyst('credit_analyst')).toBe(false)
    expect(mayAssignAnalyst('credit_underwriter')).toBe(false)
    const people = [
      { user_id: '1', full_name: 'Zed', email: 'z@x', roles: ['credit_analyst'] },
      { user_id: '2', full_name: null, email: 'a@x', roles: ['credit_analyst', 'credit_underwriter'] },
      { user_id: '3', full_name: 'Bob', email: 'b@x', roles: ['credit_underwriter'] },
    ]
    expect(analystCandidates(people).map((p) => p.user_id)).toEqual(['2', '1'])
  })

  it('a credit analyst writes a review', () => {
    expect(fn('submit_sector_review')).toContain("perform tci.require_role('credit_analyst');")
    expect(mayWriteReview('credit_analyst')).toBe(true)
    expect(mayWriteReview('credit_underwriter')).toBe(false)
    expect(mayWriteReview('admin')).toBe(false)
  })

  it('another credit analyst decides a pending review, never its author', () => {
    const body = fn('decide_sector_review')
    expect(body).toContain("perform tci.require_role('credit_analyst');")
    expect(body).toContain('if v_row.created_by = (select auth.uid()) then')
    expect(body).toContain("if not p_approve and coalesce(btrim(p_comment), '') = '' then")
    const review = { status: 'pending', created_by: 'me' }
    expect(reviewDecisionState({ actingRole: 'credit_analyst', userId: 'other', review })).toBe('decide')
    expect(reviewDecisionState({ actingRole: 'credit_analyst', userId: 'me', review })).toBe('own')
    expect(reviewDecisionState({ actingRole: 'credit_underwriter', userId: 'other', review })).toBe('readonly')
    expect(reviewDecisionState({ actingRole: 'admin', userId: 'other', review })).toBe('readonly')
    expect(reviewDecisionState({ actingRole: 'credit_analyst', userId: 'x', review: { ...review, status: 'approved' } })).toBe('none')
    expect(reviewDecisionState({ actingRole: 'credit_analyst', userId: 'x', review: null })).toBe('none')
  })

  it('a credit analyst proposes; the head of credit analysis — not the proposer — decides and ends', () => {
    expect(fn('propose_country_override')).toContain("perform tci.require_role('credit_analyst');")
    const decide = fn('decide_country_override')
    expect(decide).toContain('if not tci.is_senior_credit_analyst() then')
    expect(decide).toContain('if v_row.proposed_by = (select auth.uid()) then')
    const end = fn('end_country_override')
    expect(end).toContain('if not tci.is_senior_credit_analyst() then')
    expect(end).toContain("where id = p_override and status = 'approved'")

    expect(mayProposeOverride('credit_analyst')).toBe(true)
    expect(mayProposeOverride('credit_underwriter')).toBe(false)
    expect(mayProposeOverride('admin')).toBe(false)

    const override = { status: 'pending', proposed_by: 'me' }
    expect(overrideDecisionState({ actingRole: 'credit_analyst', senior: true, userId: 'head', override })).toBe('decide')
    expect(overrideDecisionState({ actingRole: 'credit_analyst', senior: true, userId: 'me', override })).toBe('own')
    expect(overrideDecisionState({ actingRole: 'credit_analyst', senior: false, userId: 'head', override })).toBe('notHead')
    expect(overrideDecisionState({ actingRole: 'admin', senior: true, userId: 'head', override })).toBe('readonly')
    expect(overrideDecisionState({ actingRole: 'credit_analyst', senior: true, userId: 'head', override: { ...override, status: 'approved' } })).toBe('none')

    expect(mayEndOverride({ actingRole: 'credit_analyst', senior: true, override: { status: 'approved' } })).toBe(true)
    expect(mayEndOverride({ actingRole: 'credit_analyst', senior: false, override: { status: 'approved' } })).toBe(false)
    expect(mayEndOverride({ actingRole: 'credit_analyst', senior: true, override: { status: 'pending' } })).toBe(false)
    expect(mayEndOverride({ actingRole: 'admin', senior: true, override: { status: 'approved' } })).toBe(false)
  })
})

describe('the review form', () => {
  it('needs every factor scored, as sector_factors_valid', () => {
    expect(fn('sector_factors_valid')).toContain("in ('favourable', 'neutral', 'adverse')")
    const draft = emptyFactors()
    expect(completeFactors(draft)).toBeNull()
    for (const k of Object.keys(draft) as (keyof typeof draft)[]) draft[k] = { score: 'neutral', note: ' n ' }
    const done = completeFactors(draft)
    expect(done?.demand).toEqual({ score: 'neutral', note: 'n' })
    expect(Object.keys(done ?? {})).toHaveLength(7)
  })

  it('prefills from the review in force, dropping an unknown score', () => {
    const draft = emptyFactors({ demand: { score: 'adverse', note: 'weak' }, financing: { score: 'bogus' as never, note: '' } })
    expect(draft.demand).toEqual({ score: 'adverse', note: 'weak' })
    expect(draft.financing.score).toBeNull()
    expect(draft.technology).toEqual({ score: null, note: '' })
  })

  it('a second review in one quarter is ad hoc', () => {
    const today = new Date('2026-10-27T10:00:00Z')
    expect(defaultReviewKind(null, today)).toBe('quarterly')
    expect(defaultReviewKind('2026-07-01', today)).toBe('quarterly')
    expect(defaultReviewKind('2026-10-01', today)).toBe('ad_hoc')
  })

  it('names the quarter a review belongs to', () => {
    expect(quarterEnd('2026-07-01')).toBe('2026-09-30')
    expect(quarterEnd('2026-10-01')).toBe('2026-12-31')
    expect(quarterEnd('2027-01-01')).toBe('2027-03-31')
  })

  it('reads sources one per line and links only web addresses', () => {
    expect(parseSources(' CBU bulletin \n\nhttps://stat.uz/x\r\n ')).toEqual(['CBU bulletin', 'https://stat.uz/x'])
    expect(sourceHref('https://stat.uz/a?b=1')).toBe('https://stat.uz/a?b=1')
    expect(sourceHref('www.cbu.uz/ru')).toBe('https://www.cbu.uz/ru')
    expect(sourceHref('javascript:alert(1)')).toBeNull()
    expect(sourceHref('Statistics agency, Q3 report')).toBeNull()
    expect(sourceHref('ftp://x.y/z')).toBeNull()
  })

  it('colours a factor by its score', () => {
    expect(['favourable', 'neutral', 'adverse'].map(factorTone)).toEqual(['pos', 'neutral', 'neg'])
  })
})

describe('the grade over time', () => {
  const r = (grade: 'A' | 'B' | 'C' | 'D', decided: string | null, status = 'approved') => ({
    grade,
    outlook: 'stable' as const,
    kind: 'quarterly' as const,
    status,
    decided_at: decided,
    created_at: decided ?? '2026-01-01T00:00:00Z',
  })

  it('plots the approved grades in order and carries the last to today', () => {
    const today = new Date('2026-10-27T00:00:00Z')
    const points = gradeHistory(
      [r('C', '2026-07-05T00:00:00Z'), r('B', '2026-04-03T00:00:00Z'), r('D', null, 'pending'), r('A', '2026-08-01T00:00:00Z', 'rejected')],
      today,
    )
    expect(points.map((p) => [p.grade, p.value, Boolean(p.carried)])).toEqual([
      ['B', 2, false],
      ['C', 3, false],
      ['C', 3, true],
    ])
    expect(points[2].at).toBe(today.getTime())
    expect(gradeHistory([], today)).toEqual([])
  })
})

describe('the book in the sector', () => {
  it('reads the month a limit took effect (valid_from, else decided in Tashkent)', () => {
    expect(effectiveMonth({ amount_uzs: 1, valid_from: '2026-03-31', decided_at: null })).toBe('2026-03')
    // 31 March 21:00 UTC is 1 April in Tashkent
    expect(effectiveMonth({ amount_uzs: 1, valid_from: null, decided_at: '2026-03-31T21:00:00Z' })).toBe('2026-04')
    expect(effectiveMonth({ amount_uzs: 1, valid_from: null, decided_at: null })).toBeNull()
  })

  it('adds today’s active limits up by month, keeping empty months and counting missing rates apart', () => {
    const out = exposureByMonth(
      [
        { amount_uzs: 100, valid_from: '2026-07-10', decided_at: null },
        { amount_uzs: 50, valid_from: '2026-09-01', decided_at: null },
        { amount_uzs: null, valid_from: '2026-09-01', decided_at: null },
        { amount_uzs: 25, valid_from: '2026-07-20', decided_at: null },
        { amount_uzs: 10, valid_from: null, decided_at: null },
      ],
      new Date('2026-10-27T00:00:00Z'),
    )
    expect(out.points).toEqual([
      { month: '2026-07', added: 125, cumulative: 125 },
      { month: '2026-08', added: 0, cumulative: 125 },
      { month: '2026-09', added: 50, cumulative: 175 },
      { month: '2026-10', added: 0, cumulative: 175 },
    ])
    expect(out.missingRates).toBe(1)
    expect(out.undated).toBe(1)
    expect(out.total).toBe(175)
    expect(exposureByMonth([], new Date()).points).toEqual([])
  })

  it('crosses a year end', () => {
    const out = exposureByMonth([{ amount_uzs: 1, valid_from: '2025-12-01', decided_at: null }], new Date('2026-01-15T00:00:00Z'))
    expect(out.points.map((p) => p.month)).toEqual(['2025-12', '2026-01'])
  })

  it('missing rates are counted, never zero — as v_sector_grades', () => {
    expect(view('v_sector_grades')).toContain(
      'count(*) filter (where tci.to_uzs(v.approved_amount, v.currency_code) is null) as exposure_missing_rates',
    )
  })

  it('distributes buyers by rating grade, best first, unrated last', () => {
    const dist = gradeDistribution([{ rating_grade: 'B1' }, { rating_grade: 'B1' }, { rating_grade: null }, { rating_grade: 'D' }, { rating_grade: 'zz' }])
    expect(dist.map((d) => d.key)).toEqual([...DISTRIBUTION_KEYS])
    expect(Object.fromEntries(dist.map((d) => [d.key, d.count]))).toMatchObject({ B1: 2, D: 1, unrated: 2, A1: 0 })
  })

  it('lists the buyers with limits, largest exposure first, unknown last', () => {
    const list = buyersWithLimits([
      { name: 'B', limits: 1, exposure_uzs: 10 },
      { name: 'A', limits: 0, exposure_uzs: 0 },
      { name: 'C', limits: 2, exposure_uzs: null },
      { name: 'D', limits: 1, exposure_uzs: 90 },
    ])
    expect(list.map((b) => b.name)).toEqual(['D', 'B', 'C'])
  })
})

describe('the country risk table', () => {
  it('filters by the category in use, its source, sanctions and not classified', () => {
    const rows = [
      { category: 2, source: 'oecd' as const, sanctioned: false },
      { category: 6, source: 'internal' as const, sanctioned: false },
      { category: 5, source: 'oecd' as const, sanctioned: true },
      { category: null, source: null, sanctioned: false },
    ]
    expect(countryFilterCounts(rows)).toEqual({ all: 4, high: 2, internal: 1, sanctioned: 1, unclassified: 1 })
    expect(parseCountryFilter('high')).toBe('high')
    expect(parseCountryFilter('?')).toBe('all')
    expect(Object.keys(countryFilterCounts([]))).toEqual([...COUNTRY_FILTERS])
  })

  it('a country absent from the list is not classified, never 0 — as v_country_risk', () => {
    const v = MIGRATION.slice(MIGRATION.indexOf('create view tci.v_country_risk'))
    expect(v).toContain('coalesce(o.category, cl.category) as category')
    expect(v).toContain("case when o.id is not null then 'internal' when cl.category is not null then 'oecd' end as source")
  })

  it('says whether an OECD list exists and whether it is stale', () => {
    const v = MIGRATION.slice(MIGRATION.indexOf('create view tci.v_country_risk'))
    expect(v).toContain('imp.id is null')
    expect(oecdListState([])).toEqual({ state: 'none', effective: null, importedAt: null })
    expect(oecdListState([{ latest_import_effective: null, latest_import_at: null, import_stale: true }]).state).toBe('none')
    expect(oecdListState([{ latest_import_effective: '2026-01-30', latest_import_at: '2026-02-01T10:00:00Z', import_stale: true }])).toEqual({
      state: 'stale',
      effective: '2026-01-30',
      importedAt: '2026-02-01T10:00:00Z',
    })
    expect(oecdListState([{ latest_import_effective: '2026-09-30', latest_import_at: 'x', import_stale: false }]).state).toBe('current')
  })
})
