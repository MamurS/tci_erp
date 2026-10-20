import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0052_portfolio_views.sql?raw'
import type { CreditPortfolioRow, PolicyPortfolioRow } from './aggregate'
import {
  countBy,
  creditTotals,
  expiringWithin,
  exposureByBand,
  exposureByCountry,
  limitsByCurrency,
  policyTotalsByCurrency,
  reviewsDue,
  staleRatings,
  topBuyers,
  worstLossRatios,
} from './aggregate'

const policy = (over: Partial<PolicyPortfolioRow>): PolicyPortfolioRow => ({
  policy_id: 'p',
  policy_number: 'P',
  status: 'active',
  product_structure: 'whole_turnover',
  policyholder_entity_id: 'h',
  policyholder_name: 'H',
  policyholder_country: 'UZ',
  currency_code: 'USD',
  inception_date: '2026-01-01',
  expiry_date: '2026-12-31',
  days_to_expiry: 100,
  max_liability_amount: 1000,
  minimum_premium: 100,
  earned_premium: 0,
  premium_paid: 0,
  premium_overdue: 0,
  premium_base: 100,
  claims_count: 0,
  open_claims: 0,
  claimed_total: 0,
  indemnity_paid: 0,
  indemnity_outstanding: 0,
  recoveries_insurer: 0,
  incurred: 0,
  loss_ratio_pct: 0,
  limits_count: 0,
  limits_uzs: 0,
  limits_missing_rates: 0,
  ...over,
})

const limit = (over: Partial<CreditPortfolioRow>): CreditPortfolioRow => ({
  decision_id: 'd',
  request_id: 'r',
  policy_id: 'p1',
  policy_number: 'P1',
  policyholder_entity_id: 'h',
  policyholder_name: 'H',
  buyer_entity_id: 'b1',
  buyer_name: 'Buyer',
  buyer_country: 'DE',
  outcome: 'approved',
  approved_amount: 100,
  currency_code: 'USD',
  amount_uzs: 1_200_000,
  valid_until: null,
  days_to_review: null,
  decision_band: 'unrated',
  current_grade: null,
  current_band: 'unrated',
  rated_at: null,
  ...over,
})

describe('the definitions stay in SQL', () => {
  it('the migration defines premium base, incurred and the loss ratio this module adds up', () => {
    expect(MIGRATION).toContain('greatest(coalesce(pr.earned_premium, 0), coalesce(p.minimum_premium, 0)) as premium_base')
    expect(MIGRATION).toContain(
      'coalesce(c.paid, 0) + coalesce(c.outstanding, 0) - coalesce(c.recovered, 0) as incurred',
    )
    expect(MIGRATION).toContain("v.outcome in ('approved', 'partial')")
    expect(MIGRATION).toContain('v.approved_amount * tci.latest_uzs_rate(v.currency_code) as amount_uzs')
  })
})

describe('policy portfolio', () => {
  it('totals per currency and never across currencies; the loss ratio is incurred over the base', () => {
    const totals = policyTotalsByCurrency([
      policy({ currency_code: 'USD', premium_base: '100', incurred: '30', claims_count: 1 }),
      policy({ currency_code: 'USD', premium_base: 300, incurred: 50, open_claims: 1 }),
      policy({ currency_code: 'UZS', premium_base: 5000, incurred: 0 }),
    ])
    expect(totals.map((t) => t.currency)).toEqual(['UZS', 'USD'])
    const usd = totals.find((t) => t.currency === 'USD')!
    expect(usd).toMatchObject({ policies: 2, premiumBase: 400, incurred: 80, claims: 1, openClaims: 1, lossRatioPct: 20 })
  })

  it('has no loss ratio while there is no premium base', () => {
    expect(policyTotalsByCurrency([policy({ premium_base: 0, incurred: 10 })])[0].lossRatioPct).toBeNull()
  })

  it('counts by a column, most first', () => {
    const rows = [policy({ status: 'active' }), policy({ status: 'draft' }), policy({ status: 'active' })]
    expect(countBy(rows, (r) => r.status)).toEqual([
      { key: 'active', count: 2 },
      { key: 'draft', count: 1 },
    ])
  })

  it('lists only in-force policies ending inside the window, soonest first', () => {
    const rows = [
      policy({ policy_number: 'late', days_to_expiry: 80 }),
      policy({ policy_number: 'soon', days_to_expiry: 5 }),
      policy({ policy_number: 'far', days_to_expiry: 200 }),
      policy({ policy_number: 'gone', days_to_expiry: -3 }),
      policy({ policy_number: 'draft', status: 'draft', days_to_expiry: 10 }),
    ]
    expect(expiringWithin(rows, 90).map((r) => r.policy_number)).toEqual(['soon', 'late'])
  })

  it('ranks the worst loss ratios among policies that have incurred something', () => {
    const rows = [
      policy({ policy_number: 'a', loss_ratio_pct: 40, incurred: 40 }),
      policy({ policy_number: 'b', loss_ratio_pct: 120, incurred: 120 }),
      policy({ policy_number: 'c', loss_ratio_pct: 0, incurred: 0 }),
      policy({ policy_number: 'd', loss_ratio_pct: null, incurred: 5 }),
    ]
    expect(worstLossRatios(rows, 5).map((r) => r.policy_number)).toEqual(['b', 'a'])
  })
})

describe('credit portfolio', () => {
  const rows = [
    limit({ decision_id: '1', buyer_entity_id: 'b1', buyer_name: 'One', current_band: 'A', amount_uzs: 3_000_000 }),
    limit({ decision_id: '2', buyer_entity_id: 'b1', buyer_name: 'One', current_band: 'A', policy_id: 'p2', amount_uzs: '1000000' }),
    limit({ decision_id: '3', buyer_entity_id: 'b2', buyer_name: 'Two', buyer_country: 'KZ', current_band: 'C', amount_uzs: null, currency_code: 'KZT' }),
  ]

  it('counts a missing UZS amount instead of adding it as zero', () => {
    expect(creditTotals(rows)).toEqual({ limits: 3, buyers: 2, policies: 2, exposureUzs: 4_000_000, missingRates: 1 })
  })

  it('lists every band in order, with shares of the UZS exposure', () => {
    const bands = exposureByBand(rows)
    expect(bands.map((b) => b.key)).toEqual(['A', 'B', 'C', 'D', 'unrated'])
    expect(bands[0]).toMatchObject({ limits: 2, exposureUzs: 4_000_000, share: 1 })
    expect(bands[2]).toMatchObject({ limits: 1, exposureUzs: 0, missingRates: 1, share: 0 })
    expect(bands[1]).toMatchObject({ limits: 0, share: 0 })
  })

  it('groups by country and by original currency', () => {
    expect(exposureByCountry(rows).map((r) => r.key)).toEqual(['DE', 'KZ'])
    expect(limitsByCurrency(rows)).toEqual([
      { currency: 'USD', limits: 2, amount: 200 },
      { currency: 'KZT', limits: 1, amount: 100 },
    ])
  })

  it('aggregates buyers across policies', () => {
    expect(topBuyers(rows, 10)[0]).toMatchObject({ buyerId: 'b1', limits: 2, policies: 2, exposureUzs: 4_000_000 })
  })

  it('finds reviews due and stale or missing ratings', () => {
    const due = [limit({ decision_id: 'x', days_to_review: 40 }), limit({ decision_id: 'y', days_to_review: 3 })]
    expect(reviewsDue(due, 30).map((r) => r.decision_id)).toEqual(['y'])
    const today = new Date('2026-10-20T00:00:00Z')
    const ratings = [
      limit({ buyer_entity_id: 'fresh', rated_at: '2026-09-01T00:00:00Z' }),
      limit({ buyer_entity_id: 'old', rated_at: '2025-01-01T00:00:00Z' }),
      limit({ buyer_entity_id: 'old', rated_at: '2025-01-01T00:00:00Z' }),
      limit({ buyer_entity_id: 'never', rated_at: null }),
    ]
    expect(staleRatings(ratings, 365, today).map((r) => r.buyer_entity_id)).toEqual(['old', 'never'])
  })
})
