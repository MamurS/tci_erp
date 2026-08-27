/** Contract test: authority.ts must mirror the SQL conversion rule in
 * migration 0013 (tci.latest_uzs_rate / tci.to_uzs / tci.my_authority_uzs
 * and the underwriter branch of tci.decide_limit_request) exactly. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0013_credit_limit_workflow.sql?raw'
import MIGRATION_0017 from '../../../supabase/migrations/0017_authority_matrix.sql?raw'
import MIGRATION_0020 from '../../../supabase/migrations/0020_two_stage_decisions.sql?raw'
import {
  authorityUzs,
  commercialPreflight,
  latestUzsRate,
  preflight,
  scopedAuthorityUzs,
  toUzs,
} from './authority'
import type { FxRateRow } from './authority'
import type { AuthorityGrant } from './types'

const TODAY = '2026-08-26'

const rate = (over: Partial<FxRateRow>): FxRateRow => ({
  currency_code: 'USD',
  rate_to_uzs: 12000,
  rate_date: '2026-08-20',
  source: 'cbu',
  ...over,
})

const auth = (over: Partial<AuthorityGrant>): AuthorityGrant => ({
  id: 'a1',
  user_id: 'u1',
  applies_to: 'credit',
  grade_band: 'B',
  max_amount: 100_000_000,
  currency_code: 'UZS',
  valid_from: '2026-01-01',
  valid_to: null,
  created_by: 'u0',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

describe('latestUzsRate (mirror of tci.latest_uzs_rate)', () => {
  it('UZS is always 1, even with no rates loaded', () => {
    expect(latestUzsRate([], 'UZS', TODAY)).toBe(1)
  })

  it('returns null when no usable rate exists', () => {
    expect(latestUzsRate([], 'USD', TODAY)).toBeNull()
    // future-dated rates are not usable
    expect(latestUzsRate([rate({ rate_date: '2026-09-01' })], 'USD', TODAY)).toBeNull()
    // other currencies do not leak
    expect(latestUzsRate([rate({ currency_code: 'EUR' })], 'USD', TODAY)).toBeNull()
  })

  it('picks the latest rate_date <= today', () => {
    const rates = [
      rate({ rate_date: '2026-08-01', rate_to_uzs: 11000 }),
      rate({ rate_date: '2026-08-25', rate_to_uzs: 12500 }),
      rate({ rate_date: '2026-09-01', rate_to_uzs: 13000 }), // future - ignored
    ]
    expect(latestUzsRate(rates, 'USD', TODAY)).toBe(12500)
  })

  it("prefers source 'cbu' over 'manual' on the same date", () => {
    const rates = [
      rate({ rate_date: '2026-08-25', rate_to_uzs: 99999, source: 'manual' }),
      rate({ rate_date: '2026-08-25', rate_to_uzs: 12500, source: 'cbu' }),
    ]
    expect(latestUzsRate(rates, 'USD', TODAY)).toBe(12500)
    // ...but a newer manual rate beats an older cbu rate
    const newerManual = [
      rate({ rate_date: '2026-08-20', rate_to_uzs: 12000, source: 'cbu' }),
      rate({ rate_date: '2026-08-25', rate_to_uzs: 12600, source: 'manual' }),
    ]
    expect(latestUzsRate(newerManual, 'USD', TODAY)).toBe(12600)
  })
})

describe('toUzs / authorityUzs (mirror of tci.to_uzs / tci.my_authority_uzs)', () => {
  it('converts with the selected rate; null on missing rate (SQL raises P0003)', () => {
    expect(toUzs(1000, 'USD', [rate({})], TODAY)).toBe(12_000_000)
    expect(toUzs(1000, 'EUR', [rate({})], TODAY)).toBeNull()
  })

  it('authority = MAX over currently valid rows of THAT band, in UZS; 0 when none', () => {
    expect(authorityUzs([], 'B', [], TODAY)).toBe(0)
    const rows = [
      auth({ max_amount: 100_000_000, currency_code: 'UZS' }),
      auth({ id: 'a2', max_amount: 10_000, currency_code: 'USD' }), // 120M UZS
    ]
    expect(authorityUzs(rows, 'B', [rate({})], TODAY)).toBe(120_000_000)
  })

  it('bands are independent and the commercial stream is ignored', () => {
    const rows = [
      auth({ id: 'b', grade_band: 'B', max_amount: 600_000_000 }),
      auth({ id: 'c', grade_band: 'C', max_amount: 100_000_000 }),
      auth({ id: 'x', grade_band: 'A', max_amount: 999_000_000, applies_to: 'commercial' }),
    ]
    expect(authorityUzs(rows, 'B', [], TODAY)).toBe(600_000_000)
    expect(authorityUzs(rows, 'C', [], TODAY)).toBe(100_000_000)
    expect(authorityUzs(rows, 'A', [], TODAY)).toBe(0) // commercial does not count
    expect(authorityUzs(rows, 'unrated', [], TODAY)).toBe(0)
  })

  it('skips rows outside their validity window', () => {
    const rows = [
      auth({ valid_from: '2026-09-01' }), // not yet valid
      auth({ id: 'a2', valid_to: '2026-08-25' }), // expired
      auth({ id: 'a3', max_amount: 50_000_000, valid_to: TODAY }), // valid_to inclusive
    ]
    expect(authorityUzs(rows, 'B', [], TODAY)).toBe(50_000_000)
  })

  it('skips rows whose currency has no rate rather than failing', () => {
    const rows = [
      auth({ max_amount: 5_000, currency_code: 'EUR' }),
      auth({ id: 'a2', max_amount: 30_000_000, currency_code: 'UZS' }),
    ]
    expect(authorityUzs(rows, 'B', [], TODAY)).toBe(30_000_000)
  })
})

describe('preflight (mirror of the underwriter branch of tci.decide_limit_request)', () => {
  it('admin decides regardless of amount and band', () => {
    expect(preflight(1e15, 'USD', ['admin'], 'D', null, [], TODAY).withinAuthority).toBe(true)
    expect(preflight(1e15, 'USD', ['admin', 'sales'], 'unrated', null, [], TODAY).withinAuthority)
      .toBe(true)
  })

  it('credit underwriter within band authority', () => {
    const r = preflight(5_000, 'USD', ['credit_underwriter'], 'B', 100_000_000, [rate({})], TODAY)
    expect(r).toEqual({
      band: 'B',
      amountUzs: 60_000_000,
      authorityUzs: 100_000_000,
      withinAuthority: true,
    })
  })

  it('over band authority escalates (strict >, boundary passes)', () => {
    const at = preflight(100_000_000, 'UZS', ['credit_underwriter'], 'B', 100_000_000, [], TODAY)
    expect(at.withinAuthority).toBe(true)
    const over = preflight(100_000_001, 'UZS', ['credit_underwriter'], 'B', 100_000_000, [], TODAY)
    expect(over.withinAuthority).toBe(false)
  })

  it('unrated decisions carry the band through the verdict', () => {
    const r = preflight(1_000, 'UZS', ['credit_underwriter'], 'unrated', 0, [], TODAY)
    expect(r.band).toBe('unrated')
    expect(r.withinAuthority).toBe(false)
  })

  it('missing rate -> unknown (SQL raises P0003 before deciding)', () => {
    const r = preflight(1_000, 'EUR', ['credit_underwriter'], 'B', 100_000_000, [], TODAY)
    expect(r.withinAuthority).toBeNull()
    expect(r.amountUzs).toBeNull()
  })
})

describe('migration 0013 defines the same rule (contract lock)', () => {
  it('rate selection: latest rate_date <= today, cbu preferred on ties', () => {
    expect(MIGRATION).toContain("order by rate_date desc, (source = 'cbu') desc")
    expect(MIGRATION).toContain('rate_date <= current_date')
  })

  it('missing rate is an explicit P0003 failure', () => {
    expect(MIGRATION).toContain("using errcode = 'P0003'")
  })

  it('0017: authority = coalesce(max(converted), 0) over valid rows of the band', () => {
    expect(MIGRATION_0017).toContain(
      'select coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0)',
    )
    expect(MIGRATION_0017).toContain("and g.applies_to = 'credit'")
    expect(MIGRATION_0017).toContain('and g.grade_band = p_band')
    expect(MIGRATION_0017).toContain('g.valid_from <= current_date')
    expect(MIGRATION_0017).toContain('(g.valid_to is null or g.valid_to >= current_date)')
  })

  it('0017: admin is unlimited; over-band-authority escalates with the band', () => {
    expect(MIGRATION_0017).toContain("if not tci.has_role('admin') then")
    expect(MIGRATION_0017).toContain('v_authority_uzs := tci.my_authority_uzs(v_band);')
    expect(MIGRATION_0017).toContain('if v_amount_uzs > v_authority_uzs then')
    expect(MIGRATION_0017).toContain(
      "update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;",
    )
    expect(MIGRATION_0017).toContain("'grade_band', v_band")
  })

  it('0017: the band is the FAMILY of the assessment grade, unrated by default', () => {
    expect(MIGRATION_0017).toContain('v_band := tci.grade_band_for_assessment(p_assessment_id);')
    expect(MIGRATION_0017).toContain('upper(left(a.rating_grade, 1))')
    expect(MIGRATION_0017).toContain("'unrated'::tci.grade_band")
  })
})

describe('commercial authority (mirror of tci.adjust_limit_commercial, 0020)', () => {
  it('the two streams are read off the same table but never mix', () => {
    const rows = [
      auth({ id: 'cr', applies_to: 'credit', grade_band: 'B', max_amount: 900_000_000 }),
      auth({ id: 'cm', applies_to: 'commercial', grade_band: 'B', max_amount: 200_000_000 }),
    ]
    expect(scopedAuthorityUzs(rows, 'credit', 'B', [], TODAY)).toBe(900_000_000)
    expect(scopedAuthorityUzs(rows, 'commercial', 'B', [], TODAY)).toBe(200_000_000)
    // the legacy credit helper is exactly the credit stream
    expect(authorityUzs(rows, 'B', [], TODAY)).toBe(
      scopedAuthorityUzs(rows, 'credit', 'B', [], TODAY),
    )
  })

  it('the commercial stream obeys the same band and validity rules', () => {
    const rows = [
      auth({ id: 'a', applies_to: 'commercial', grade_band: 'B', max_amount: 100_000_000 }),
      auth({ id: 'b', applies_to: 'commercial', grade_band: 'C', max_amount: 500_000_000 }),
      auth({ id: 'c', applies_to: 'commercial', grade_band: 'B', max_amount: 999_000_000, valid_to: '2026-08-25' }),
      auth({ id: 'd', applies_to: 'commercial', grade_band: 'B', max_amount: 888_000_000, valid_from: '2026-09-01' }),
    ]
    expect(scopedAuthorityUzs(rows, 'commercial', 'B', [], TODAY)).toBe(100_000_000)
    expect(scopedAuthorityUzs(rows, 'commercial', 'C', [], TODAY)).toBe(500_000_000)
    expect(scopedAuthorityUzs(rows, 'commercial', 'unrated', [], TODAY)).toBe(0)
  })

  it('admin adjusts any amount without consulting the matrix', () => {
    const r = commercialPreflight(1e15, 'USD', ['admin'], 'D', [], [], TODAY)
    expect(r.withinAuthority).toBe(true)
    expect(MIGRATION_0020).toContain("if not tci.has_role('admin') then")
  })

  it('a commercial underwriter is bound by the band of the CREDIT decision', () => {
    const grants = [
      auth({ applies_to: 'commercial', grade_band: 'B', max_amount: 300_000_000 }),
    ]
    const within = commercialPreflight(
      300_000_000, 'UZS', ['commercial_underwriter'], 'B', grants, [], TODAY,
    )
    expect(within).toEqual({
      band: 'B',
      amountUzs: 300_000_000,
      authorityUzs: 300_000_000,
      withinAuthority: true, // boundary passes: SQL raises on strict >
    })
    const over = commercialPreflight(
      300_000_001, 'UZS', ['commercial_underwriter'], 'B', grants, [], TODAY,
    )
    expect(over.withinAuthority).toBe(false)
    // a grant in a DIFFERENT band does not help
    const wrongBand = commercialPreflight(
      1_000, 'UZS', ['commercial_underwriter'], 'C', grants, [], TODAY,
    )
    expect(wrongBand.authorityUzs).toBe(0)
    expect(wrongBand.withinAuthority).toBe(false)
  })

  it('a credit grant never funds a commercial adjustment', () => {
    const creditOnly = [auth({ applies_to: 'credit', grade_band: 'B', max_amount: 1e12 })]
    const r = commercialPreflight(
      1_000, 'UZS', ['commercial_underwriter'], 'B', creditOnly, [], TODAY,
    )
    expect(r.authorityUzs).toBe(0)
    expect(r.withinAuthority).toBe(false)
  })

  it('conversion uses the same fx rule; a missing rate is unknown', () => {
    const grants = [auth({ applies_to: 'commercial', grade_band: 'B', max_amount: 100_000_000 })]
    const usd = commercialPreflight(
      5_000, 'USD', ['commercial_underwriter'], 'B', grants, [rate({})], TODAY,
    )
    expect(usd.amountUzs).toBe(60_000_000)
    expect(usd.withinAuthority).toBe(true)
    const noRate = commercialPreflight(
      5_000, 'EUR', ['commercial_underwriter'], 'B', grants, [rate({})], TODAY,
    )
    expect(noRate.withinAuthority).toBeNull()
  })

  it('0020 defines the same aggregate as 0017, on the commercial stream', () => {
    expect(MIGRATION_0020).toContain(
      'select coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0)',
    )
    expect(MIGRATION_0020).toContain("and g.applies_to = 'commercial'")
    expect(MIGRATION_0020).toContain('and g.grade_band = v_band')
    expect(MIGRATION_0020).toContain('g.valid_from <= current_date')
    expect(MIGRATION_0020).toContain('(g.valid_to is null or g.valid_to >= current_date)')
    expect(MIGRATION_0020).toContain('if v_amount_uzs > v_authority_uzs then')
  })

  it('0020: the band comes from the credit decision being adjusted', () => {
    expect(MIGRATION_0020).toContain(
      'v_band := tci.grade_band_for_assessment(v_credit.based_on_assessment_id);',
    )
  })

  it('0020: only commercial underwriting may adjust, and only a credit row', () => {
    expect(MIGRATION_0020).toContain("if not tci.has_role('admin', 'commercial_underwriter') then")
    expect(MIGRATION_0020).toContain('only a credit-stage decision can be adjusted commercially')
    expect(MIGRATION_0020).toContain('only an approved or partial limit can be adjusted')
  })
})
