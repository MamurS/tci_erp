import { describe, expect, it } from 'vitest'

import M85 from '../../../supabase/migrations/0085_sector_country_risk.sql?raw'
import REFUSALS from '../../lib/refusals.ts?raw'
import {
  CLIENT_COVER_KEYS,
  COVER_FRAGMENTS,
  COVER_GRANTING_OUTCOMES,
  STAFF_COVER_KEYS,
  clientCoverRefusal,
  clientRefusalOr,
  concentrationReasons,
  concentrationView,
  countryRiskActive,
  coverBlockOf,
  outcomeBlocked,
  rankShort,
  staffCoverRefusal,
  visibleWarnings,
  warningKey,
} from './integration'
import { DEFAULT_ADJUSTMENTS } from './rules'
import type { BuyerRiskContext, Concentration } from './rules'

const err = (message: string, code = 'P0001') => ({ message, code })

describe('cover refusals (0085 raise_cover_block)', () => {
  it('the two texts are literal in the migration and mapped for staff', () => {
    expect(M85).toContain(`raise exception '${COVER_FRAGMENTS.company}' using errcode = 'P0001'`)
    expect(M85).toContain(`raise exception '${COVER_FRAGMENTS.country}' using errcode = 'P0001'`)
    expect(REFUSALS).toContain(`{ fragment: '${COVER_FRAGMENTS.company}', key: '${STAFF_COVER_KEYS.company}' }`)
    expect(REFUSALS).toContain(`{ fragment: '${COVER_FRAGMENTS.country}', key: '${STAFF_COVER_KEYS.country}' }`)
  })

  it('reads the party from the message', () => {
    expect(coverBlockOf(err('cover_not_available: company'))).toBe('company')
    expect(coverBlockOf(err('Cover_Not_Available: country'))).toBe('country')
    expect(coverBlockOf(err('four_eyes_own_request: …'))).toBeNull()
    expect(coverBlockOf(null)).toBeNull()
    expect(coverBlockOf(new Error('cover_not_available: company'))).toBe('company')
  })

  it('staff get the sanctions wording, clients their own', () => {
    expect(staffCoverRefusal(err('cover_not_available: company'))).toBe('risk.errors.coverCompany')
    expect(staffCoverRefusal(err('something else'))).toBeNull()
    expect(clientCoverRefusal(err('cover_not_available: country'))).toBe('portal.errors.coverCountry')
    expect(clientRefusalOr(err('cover_not_available: company'), 'x.fallback')).toBe(CLIENT_COVER_KEYS.company)
    expect(clientRefusalOr(err('cover_not_available: country'), 'x.fallback')).toBe(CLIENT_COVER_KEYS.country)
    // anything else goes through the shared mapping, unchanged
    expect(clientRefusalOr(err('limit_request_in_review'), 'x.fallback')).toBe('portal.limits.change.errors.inReview')
    expect(clientRefusalOr(err('???'), 'x.fallback')).toBe('x.fallback')
  })

  it('the client keys never reuse the staff keys', () => {
    for (const key of Object.values(CLIENT_COVER_KEYS)) {
      expect(key.startsWith('portal.')).toBe(true)
      expect(Object.values(STAFF_COVER_KEYS)).not.toContain(key)
    }
  })
})

describe('decision screens', () => {
  const ctx = (patch: Partial<BuyerRiskContext> = {}): BuyerRiskContext => ({
    sector_id: 's',
    industry_code: 'C10',
    sector_grade: 'B',
    sector_outlook: 'stable',
    sector_reviewed_at: '2026-10-01',
    sector_stale: false,
    country_code: 'UZ',
    country_category: 5,
    country_source: 'oecd',
    oecd_category: 5,
    internal_category: null,
    cover_block: null,
    sanctions: [],
    required_rank: 3,
    my_rank: 1,
    ...patch,
  })

  it('only what grants cover is blocked — the guard of 0085', () => {
    expect(M85).toContain(`if new.outcome not in (${COVER_GRANTING_OUTCOMES.map((o) => `'${o}'`).join(', ')}) then`)
    const blocked = ctx({ cover_block: 'country' })
    expect(outcomeBlocked('approved', blocked)).toBe(true)
    expect(outcomeBlocked('partial', blocked)).toBe(true)
    expect(outcomeBlocked('declined', blocked)).toBe(false)
    expect(outcomeBlocked('approved', ctx())).toBe(false)
    expect(outcomeBlocked('approved', null)).toBe(false)
  })

  it('the cover matrix rank is the other half of decide_limit_request', () => {
    expect(M85).toContain(
      "and tci.user_rank((select auth.uid()), 'credit') < tci.cover_required_rank(v_request.entity_id)) then",
    )
    expect(rankShort(ctx())).toBe(true)
    expect(rankShort(ctx({ my_rank: 3 }))).toBe(false)
    expect(rankShort(ctx({ required_rank: 0, my_rank: null }))).toBe(false)
    expect(rankShort(ctx({ required_rank: 1, my_rank: null }))).toBe(true)
    expect(rankShort(undefined)).toBe(false)
  })

  it('the country part is in force with a list or an internal category', () => {
    expect(countryRiskActive(ctx(), false)).toBe(false)
    expect(countryRiskActive(ctx(), true)).toBe(true)
    expect(countryRiskActive(ctx({ internal_category: 4 }), false)).toBe(true)
  })

  it('the rank warning is the credit decider’s alone', () => {
    const all = visibleWarnings(ctx({ sector_grade: 'D', sector_outlook: 'negative' }), true, { showRank: true })
    expect(all.map((w) => w.kind)).toEqual(['sector_grade', 'sector_outlook', 'country_category', 'rank'])
    const others = visibleWarnings(ctx({ sector_grade: 'D' }), true, { showRank: false })
    expect(others.map((w) => w.kind)).not.toContain('rank')
  })

  it('every warning has its words', () => {
    expect(warningKey({ kind: 'sector_grade', grade: 'C' })).toEqual({
      key: 'risk.decision.warnings.sectorGrade',
      params: { grade: 'C' },
    })
    expect(warningKey({ kind: 'rank', required: 4, mine: 1 }).params).toEqual({ required: 4, mine: 1 })
    expect(warningKey({ kind: 'country_unclassified' }).key).toBe('risk.decision.warnings.countryUnclassified')
  })
})

describe('concentration (0085 cover_concentration)', () => {
  const base: Concentration = {
    buyers: 3,
    total_uzs: 1000,
    rates_missing: 1,
    by_sector: [
      { grade: 'none', buyers: 1, amount_uzs: 0 },
      { grade: 'D', buyers: 1, amount_uzs: 600 },
      { grade: 'A', buyers: 1, amount_uzs: 400 },
    ],
    by_country: [
      { category: 'unclassified', buyers: 1, amount_uzs: 0 },
      { category: '6', buyers: 1, amount_uzs: 600 },
      { category: '2', buyers: 1, amount_uzs: 400 },
    ],
    share_cd: 60,
    share_cat57: 60,
    warn_pct: 40,
    single_cd_sector: false,
    blocked: [{ entity_id: 'e1', block: 'company' }],
    loading_hint_pct: 33,
    warn: true,
  }

  it('restates the keys and the hint formula of the migration', () => {
    expect(M85).toContain("coalesce(tci.entity_sector_grade(b.entity_id), 'none') as sector_grade")
    expect(M85).toContain(
      "else coalesce((select r.category::text from tci.country_risk(e.country_code) r), 'unclassified')\n           end as country_key,",
    )
    // before any list the database files the country as 'inactive', which has
    // no loading row — the same silence the panel keeps
    expect(M85).toContain("                then 'inactive'")
    expect(M85).toContain('(select sum(r.amount_uzs * (coalesce(s.premium_loading_pct, 0) + coalesce(c.premium_loading_pct, 0)))')
    expect(M85).toContain("'rates_missing', (select count(*) from rows where rate_missing)")
    expect(M85).toContain("'blocked', coalesce((select jsonb_agg(jsonb_build_object('entity_id', entity_id, 'block', block))")
  })

  it('orders the rows and takes shares of the total', () => {
    const v = concentrationView(base, { oecdImported: true, adjustments: DEFAULT_ADJUSTMENTS })
    expect(v.bySector.map((r) => r.key)).toEqual(['A', 'D', 'none'])
    expect(v.bySector[1]).toEqual({ key: 'D', buyers: 1, amountUzs: 600, share: 0.6 })
    expect(v.byCountry?.map((r) => r.key)).toEqual(['2', '6', 'unclassified'])
    expect(v.shareCd).toBeCloseTo(0.6)
    expect(v.warnAt).toBeCloseTo(0.4)
    expect(v.ratesMissing).toBe(1)
    // the database's hint while a list exists
    expect(v.loadingHintPct).toBe(33)
  })

  it('without an OECD list the country part is left out, as the cover matrix does', () => {
    const noList: Concentration = {
      ...base,
      by_country: [{ category: 'unclassified', buyers: 3, amount_uzs: 1000 }],
      share_cat57: 0,
      loading_hint_pct: 45,
    }
    const v = concentrationView(noList, { oecdImported: false, adjustments: DEFAULT_ADJUSTMENTS })
    expect(v.byCountry).toBeNull()
    // sector part only: (600 × 25 + 400 × 0) / 1000 = 15
    expect(v.loadingHintPct).toBe(15)
    // an internal category somewhere means the country part speaks
    const withInternal = concentrationView(base, { oecdImported: false, adjustments: DEFAULT_ADJUSTMENTS })
    expect(withInternal.byCountry).not.toBeNull()
  })

  it('a zero total gives no shares, never zero', () => {
    const empty: Concentration = {
      ...base,
      buyers: 0,
      total_uzs: 0,
      by_sector: [],
      by_country: [],
      share_cd: null,
      share_cat57: null,
      loading_hint_pct: null,
      warn: false,
    }
    const v = concentrationView(empty, { oecdImported: true, adjustments: null })
    expect(v.shareCd).toBeNull()
    expect(v.loadingHintPct).toBeNull()
    expect(v.bySector).toEqual([])
  })

  it('names the reasons of a warning', () => {
    const v = concentrationView(base, { oecdImported: true, adjustments: null })
    expect(concentrationReasons(v)).toEqual(['share_cd', 'share_cat57'])
    expect(concentrationReasons({ shareCd: 0.4, shareCat57: null, warnAt: 0.4, singleCdSector: true })).toEqual([
      'single_cd_sector',
    ])
  })
})
