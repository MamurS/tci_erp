/** Contract test: authority.ts must mirror the SQL conversion rule in
 * migration 0013 (tci.latest_uzs_rate / tci.to_uzs / tci.my_authority_uzs
 * and the underwriter branch of tci.decide_limit_request) exactly. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0013_credit_limit_workflow.sql?raw'
import { authorityUzs, latestUzsRate, preflight, toUzs } from './authority'
import type { FxRateRow } from './authority'
import type { UnderwritingAuthority } from './types'

const TODAY = '2026-08-26'

const rate = (over: Partial<FxRateRow>): FxRateRow => ({
  currency_code: 'USD',
  rate_to_uzs: 12000,
  rate_date: '2026-08-20',
  source: 'cbu',
  ...over,
})

const auth = (over: Partial<UnderwritingAuthority>): UnderwritingAuthority => ({
  id: 'a1',
  user_id: 'u1',
  max_amount: 100_000_000,
  currency_code: 'UZS',
  valid_from: '2026-01-01',
  valid_to: null,
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

  it('authority = MAX over currently valid rows, converted to UZS; 0 when none', () => {
    expect(authorityUzs([], [], TODAY)).toBe(0)
    const rows = [
      auth({ max_amount: 100_000_000, currency_code: 'UZS' }),
      auth({ id: 'a2', max_amount: 10_000, currency_code: 'USD' }), // 120M UZS
    ]
    expect(authorityUzs(rows, [rate({})], TODAY)).toBe(120_000_000)
  })

  it('skips rows outside their validity window', () => {
    const rows = [
      auth({ valid_from: '2026-09-01' }), // not yet valid
      auth({ id: 'a2', valid_to: '2026-08-25' }), // expired
      auth({ id: 'a3', max_amount: 50_000_000, valid_to: TODAY }), // valid_to inclusive
    ]
    expect(authorityUzs(rows, [], TODAY)).toBe(50_000_000)
  })

  it('skips rows whose currency has no rate rather than failing', () => {
    const rows = [
      auth({ max_amount: 5_000, currency_code: 'EUR' }),
      auth({ id: 'a2', max_amount: 30_000_000, currency_code: 'UZS' }),
    ]
    expect(authorityUzs(rows, [], TODAY)).toBe(30_000_000)
  })
})

describe('preflight (mirror of the underwriter branch of tci.decide_limit_request)', () => {
  it('admin and senior_underwriter decide regardless of amount', () => {
    for (const role of ['admin', 'senior_underwriter'] as const) {
      expect(preflight(1e15, 'USD', role, null, [], TODAY).withinAuthority).toBe(true)
    }
  })

  it('underwriter within authority', () => {
    const r = preflight(5_000, 'USD', 'underwriter', 100_000_000, [rate({})], TODAY)
    expect(r).toEqual({
      amountUzs: 60_000_000,
      authorityUzs: 100_000_000,
      withinAuthority: true,
    })
  })

  it('underwriter over authority escalates (strict >, boundary passes)', () => {
    const at = preflight(100_000_000, 'UZS', 'underwriter', 100_000_000, [], TODAY)
    expect(at.withinAuthority).toBe(true)
    const over = preflight(100_000_001, 'UZS', 'underwriter', 100_000_000, [], TODAY)
    expect(over.withinAuthority).toBe(false)
  })

  it('missing rate -> unknown (SQL raises P0003 before deciding)', () => {
    const r = preflight(1_000, 'EUR', 'underwriter', 100_000_000, [], TODAY)
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

  it('authority = coalesce(max(converted), 0) over currently valid rows', () => {
    expect(MIGRATION).toContain(
      'select coalesce(max(tci.to_uzs(a.max_amount, a.currency_code)), 0)',
    )
    expect(MIGRATION).toContain('a.valid_from <= current_date')
    expect(MIGRATION).toContain('(a.valid_to is null or a.valid_to >= current_date)')
  })

  it('only the underwriter role is authority-constrained; over-authority escalates', () => {
    expect(MIGRATION).toContain("if v_role = 'underwriter' then")
    expect(MIGRATION).toContain('if v_amount_uzs > v_authority_uzs then')
    expect(MIGRATION).toContain(
      "update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;",
    )
  })
})
