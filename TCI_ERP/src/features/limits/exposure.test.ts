/** Contract test: exposure.ts must mirror tci.v_buyer_exposure (migration
 * 0013) — approved/partial only, UZS conversion via the latest-rate rule,
 * missing-rate rows excluded from the sum and counted. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0013_credit_limit_workflow.sql?raw'
import type { FxRateRow } from './authority'
import { aggregateExposure, buildLimitChains } from './exposure'
import type { CreditLimitDecision, EffectiveLimit } from './types'

const TODAY = '2026-08-26'

const USD: FxRateRow = {
  currency_code: 'USD',
  rate_to_uzs: 12000,
  rate_date: '2026-08-20',
  source: 'cbu',
}

type Row = Pick<EffectiveLimit, 'policy_id' | 'outcome' | 'approved_amount' | 'currency_code'>

const row = (over: Partial<Row>): Row => ({
  policy_id: 'p1',
  outcome: 'approved',
  approved_amount: 100_000_000,
  currency_code: 'UZS',
  ...over,
})

describe('aggregateExposure (mirror of tci.v_buyer_exposure)', () => {
  it('sums approved and partial limits in UZS across policies', () => {
    const result = aggregateExposure(
      [
        row({}),
        row({ policy_id: 'p2', outcome: 'partial', approved_amount: 5_000, currency_code: 'USD' }),
      ],
      [USD],
      TODAY,
    )
    expect(result).toEqual({
      policiesCount: 2,
      exposureUzs: 160_000_000,
      missingRates: 0,
    })
  })

  it('declined effective rows count toward neither the sum nor policies_count', () => {
    const result = aggregateExposure(
      [row({}), row({ policy_id: 'p2', outcome: 'declined', approved_amount: null })],
      [],
      TODAY,
    )
    expect(result.policiesCount).toBe(1)
    expect(result.exposureUzs).toBe(100_000_000)
  })

  it('missing-rate rows are excluded from the sum and counted', () => {
    const result = aggregateExposure(
      [row({}), row({ policy_id: 'p2', approved_amount: 1_000, currency_code: 'EUR' })],
      [],
      TODAY,
    )
    expect(result).toEqual({
      policiesCount: 2,
      exposureUzs: 100_000_000,
      missingRates: 1,
    })
  })

  it('all rates missing -> null total (SQL sum over empty filter is null)', () => {
    const result = aggregateExposure(
      [row({ currency_code: 'EUR' })],
      [],
      TODAY,
    )
    expect(result.exposureUzs).toBeNull()
    expect(result.missingRates).toBe(1)
  })

  it('no limits -> empty aggregate', () => {
    expect(aggregateExposure([], [], TODAY)).toEqual({
      policiesCount: 0,
      exposureUzs: null,
      missingRates: 0,
    })
  })
})

describe('buildLimitChains (supersede chains per policy)', () => {
  const dec = (over: Partial<CreditLimitDecision> & { policy_id: string }) =>
    ({
      id: 'd1',
      request_id: 'r1',
      outcome: 'approved',
      approved_amount: 1,
      currency_code: 'UZS',
      valid_from: '2026-01-01',
      valid_until: null,
      based_on_assessment_id: null,
      comment: null,
      decided_by: 'u1',
      decided_at: '2026-01-01T00:00:00Z',
      lifecycle: 'effective',
      ...over,
    }) as CreditLimitDecision & { policy_id: string }

  it('groups by policy, newest decision first', () => {
    const chains = buildLimitChains([
      dec({ id: 'old', policy_id: 'p1', decided_at: '2026-01-01T00:00:00Z', lifecycle: 'superseded' }),
      dec({ id: 'new', policy_id: 'p1', decided_at: '2026-06-01T00:00:00Z' }),
      dec({ id: 'other', policy_id: 'p2', decided_at: '2026-03-01T00:00:00Z' }),
    ])
    expect(chains).toHaveLength(2)
    const p1 = chains.find((c) => c.policyId === 'p1')
    expect(p1?.decisions.map((d) => d.id)).toEqual(['new', 'old'])
  })
})

describe('migration 0013 exposure view (contract lock)', () => {
  it('filters to approved/partial before grouping and counts missing rates', () => {
    expect(MIGRATION).toContain("where v.outcome in ('approved', 'partial')")
    expect(MIGRATION).toContain(
      'filter (where tci.latest_uzs_rate(v.currency_code) is not null)',
    )
    expect(MIGRATION).toContain(
      "count(*) filter (where tci.latest_uzs_rate(v.currency_code) is null)::int",
    )
  })

  it('supersede happens on decide for the same (policy, buyer)', () => {
    expect(MIGRATION).toContain("set lifecycle = 'superseded'")
    expect(MIGRATION).toContain('and r.policy_id = v_request.policy_id')
    expect(MIGRATION).toContain('and r.buyer_id = v_request.buyer_id')
  })
})
