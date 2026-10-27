import { describe, expect, it } from 'vitest'

import M85 from '../../../supabase/migrations/0085_sector_country_risk.sql?raw'
import {
  COUNTRY_KEYS,
  DEFAULT_ADJUSTMENTS,
  FACTOR_SCORES,
  OUTLOOKS,
  REVIEW_KINDS,
  SANCTION_REGIMES,
  SECTOR_FACTORS,
  SECTOR_GRADES,
  concentrationWarns,
  countryKey,
  decisionWarnings,
  engineRiskContext,
  factorsComplete,
  importStale,
  isStale,
  quarterStart,
  requiredRank,
} from './rules'
import type { BuyerRiskContext } from './rules'

const quoted = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ')

describe('vocabularies (0085)', () => {
  it('the sector grades, outlooks and kinds are the table checks', () => {
    expect(M85).toContain(`grade          char(1) not null check (grade in (${quoted(SECTOR_GRADES)})),`)
    expect(M85).toContain(`outlook        text not null check (outlook in (${quoted(OUTLOOKS)})),`)
    expect(M85).toContain(`kind           text not null check (kind in (${quoted(REVIEW_KINDS)})),`)
  })

  it('the seven factors and their scores are tci.sector_factor_keys and sector_factors_valid', () => {
    expect(M85).toContain(`  select array[${quoted(SECTOR_FACTORS)}]`)
    expect(M85).toContain(`(p_factors -> k ->> 'score') in (${quoted(FACTOR_SCORES)})`)
  })

  it('the regimes are the sanction_flags check', () => {
    expect(M85).toContain(`regime         text not null check (regime in (${quoted(SANCTION_REGIMES)})),`)
  })

  it('the country keys are the adjustment table check, not classified apart from 0', () => {
    expect(M85).toContain(`(dimension = 'country' and key in (${quoted(COUNTRY_KEYS)})))`)
    expect(countryKey(null)).toBe('unclassified')
    expect(countryKey(0)).toBe('0')
  })

  it('the defaults are the seed, row for row', () => {
    for (const a of DEFAULT_ADJUSTMENTS) {
      const cap = a.cap_grade === null ? 'null' : `'${a.cap_grade}'`
      expect(M85).toContain(
        `('${a.dimension}', '${a.key}',`,
      )
      const row = new RegExp(
        `\\('${a.dimension}', '${a.key}',\\s+${a.notch}, ${cap}, '${a.cover}', ${a.rank_floor}, ${a.rank_add},\\s+${a.premium_loading_pct}\\)`,
      )
      expect(M85).toMatch(row)
    }
    expect(DEFAULT_ADJUSTMENTS).toHaveLength(13)
  })
})

describe('the cover matrix (tci.cover_required_rank_internal)', () => {
  const base = { adjustments: DEFAULT_ADJUSTMENTS, hasOverride: false, sectorGrade: null }

  it('reads the floor and adds the sector, capped at the committee', () => {
    expect(M85).toContain('  return least(5,')
    expect(requiredRank({ ...base, countryCategory: 2, oecdImported: true })).toBe(0)
    expect(requiredRank({ ...base, countryCategory: 4, oecdImported: true })).toBe(3)
    expect(requiredRank({ ...base, countryCategory: 6, oecdImported: true })).toBe(4)
    expect(requiredRank({ ...base, countryCategory: 7, oecdImported: true })).toBe(5)
    expect(requiredRank({ ...base, countryCategory: null, oecdImported: true })).toBe(5)
    expect(requiredRank({ ...base, countryCategory: 6, oecdImported: true, sectorGrade: 'D' })).toBe(5)
    expect(requiredRank({ ...base, countryCategory: 7, oecdImported: true, sectorGrade: 'D' })).toBe(5)
    expect(requiredRank({ ...base, countryCategory: 1, oecdImported: true, sectorGrade: 'D' })).toBe(1)
  })

  it('is silent on the country until a list is imported or an override approved', () => {
    expect(M85).toContain('when (tci.oecd_latest_import()).id is null')
    expect(requiredRank({ ...base, countryCategory: null, oecdImported: false })).toBe(0)
    expect(requiredRank({ ...base, countryCategory: null, oecdImported: false, sectorGrade: 'D' })).toBe(1)
    expect(requiredRank({ ...base, countryCategory: 6, oecdImported: false, hasOverride: true })).toBe(4)
  })

  it('is what decide_limit_request and the validation routing apply', () => {
    expect(M85).toContain("and tci.user_rank((select auth.uid()), 'credit') < tci.cover_required_rank(v_request.entity_id)) then")
    expect(M85).toContain('greatest(v_rank, tci.cover_required_rank(v_request.entity_id) - 1));')
  })
})

describe('decision warnings', () => {
  const ctx = (patch: Partial<BuyerRiskContext>): BuyerRiskContext => ({
    sector_id: 's',
    industry_code: 'METL',
    sector_grade: 'B',
    sector_outlook: 'stable',
    sector_reviewed_at: null,
    sector_stale: false,
    country_code: 'DE',
    country_category: 0,
    country_source: 'oecd',
    oecd_category: 0,
    internal_category: null,
    cover_block: null,
    sanctions: [],
    required_rank: 0,
    my_rank: 0,
    ...patch,
  })

  it('warns on C/D, a negative outlook, a stale review, categories 5–7, not classified and the rank', () => {
    expect(decisionWarnings(ctx({}), true)).toEqual([])
    expect(decisionWarnings(ctx({ sector_grade: 'D', sector_outlook: 'negative' }), true).map((w) => w.kind)).toEqual([
      'sector_grade',
      'sector_outlook',
    ])
    expect(decisionWarnings(ctx({ country_category: 4 }), true)).toEqual([])
    expect(decisionWarnings(ctx({ country_category: 5 }), true).map((w) => w.kind)).toEqual(['country_category'])
    expect(decisionWarnings(ctx({ country_category: null }), true).map((w) => w.kind)).toEqual(['country_unclassified'])
    expect(decisionWarnings(ctx({ country_category: null }), false)).toEqual([])
    expect(decisionWarnings(ctx({ required_rank: 4, my_rank: 1 }), true)).toEqual([{ kind: 'rank', required: 4, mine: 1 }])
    expect(decisionWarnings(ctx({ required_rank: 4, my_rank: 4 }), true)).toEqual([])
  })
})

describe('concentration (tci.cover_concentration)', () => {
  it('warns above the threshold or on one C/D sector', () => {
    expect(M85).toContain(
      "coalesce((v_out ->> 'share_cd')::numeric > v_warn or (v_out ->> 'share_cat57')::numeric > v_warn, false)\n    or (v_out ->> 'single_cd_sector')::boolean);",
    )
    expect(concentrationWarns({ share_cd: 40, share_cat57: 0, warn_pct: 40, single_cd_sector: false })).toBe(false)
    expect(concentrationWarns({ share_cd: 40.1, share_cat57: 0, warn_pct: 40, single_cd_sector: false })).toBe(true)
    expect(concentrationWarns({ share_cd: null, share_cat57: 41, warn_pct: 40, single_cd_sector: false })).toBe(true)
    expect(concentrationWarns({ share_cd: 10, share_cat57: 0, warn_pct: 40, single_cd_sector: true })).toBe(true)
  })
})

describe('staleness', () => {
  it('a review is stale once its quarter has passed', () => {
    expect(M85).toContain('cur.id is not null and cur.quarter_start < tci.quarter_start(current_date) as stale,')
    const today = new Date(Date.UTC(2026, 9, 27))
    expect(quarterStart(today)).toBe('2026-10-01')
    expect(isStale('2026-10-01', today)).toBe(false)
    expect(isStale('2026-07-01', today)).toBe(true)
    expect(isStale(null, today)).toBe(false)
  })

  it('an OECD list is stale past the setting, or when there is none', () => {
    expect(M85).toContain('or imp.effective_date < current_date - make_interval(months => (select w.oecd_stale_months')
    const today = new Date(Date.UTC(2026, 9, 27))
    expect(importStale('2026-05-01', 6, today)).toBe(false)
    expect(importStale('2026-04-26', 6, today)).toBe(true)
    expect(importStale(null, 6, today)).toBe(true)
  })

  it('every factor must be scored', () => {
    const all = Object.fromEntries(SECTOR_FACTORS.map((k) => [k, { score: 'neutral' }]))
    expect(factorsComplete(all)).toBe(true)
    expect(factorsComplete({ ...all, demand: { score: null } })).toBe(false)
  })
})

describe('the engine risk context', () => {
  const ctx = { sector_grade: 'D' as const, country_category: 6, country_source: 'oecd' as const, internal_category: null }

  it('sends the sector and, once a list exists, the country with the admin table', () => {
    const out = engineRiskContext(ctx, DEFAULT_ADJUSTMENTS, true)
    expect(out.sector_grade).toBe('D')
    expect(out.adjustments.sector.D).toEqual({ notch: -2, cap_grade: null })
    expect(out.country_classified).toBe(true)
    expect(out.adjustments.country['6']).toEqual({ notch: 0, cap_grade: 'C1' })
  })

  it('keeps the country silent before any list, as the cover matrix does', () => {
    const out = engineRiskContext({ ...ctx, country_category: null, country_source: null }, DEFAULT_ADJUSTMENTS, false)
    expect(out.country_classified).toBe(false)
    expect(out.country_category).toBeNull()
    expect(out.adjustments.country).toEqual({})
  })

  it('a not classified country is not category 0', () => {
    const out = engineRiskContext({ ...ctx, country_category: null, country_source: null }, DEFAULT_ADJUSTMENTS, true)
    expect(out.country_classified).toBe(false)
    expect(out.adjustments.country.unclassified).toBeDefined()
  })
})
