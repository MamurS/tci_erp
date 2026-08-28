import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0027_premium.sql?raw'
import {
  adjustmentAmount,
  earnedPremium,
  isBelowMinimum,
  isInstalmentEditable,
  isInstalmentOverdue,
  premiumDueTotal,
} from './premium'

describe('the end-of-period adjustment', () => {
  it('charges the excess when turnover earns more than the minimum', () => {
    expect(adjustmentAmount(13_500, 12_000)).toBe(1_500)
  })

  it('NEVER refunds below the minimum', () => {
    // The rule the owner fixed: a quiet year still costs the minimum premium.
    expect(adjustmentAmount(9_000, 12_000)).toBe(0)
    expect(adjustmentAmount(0, 12_000)).toBe(0)
  })

  it('is zero exactly at the minimum', () => {
    expect(adjustmentAmount(12_000, 12_000)).toBe(0)
  })

  it('bills at least the minimum under the default regime', () => {
    expect(premiumDueTotal('minimum_with_adjustment', 9_000, 12_000)).toBe(12_000)
    expect(premiumDueTotal('minimum_with_adjustment', 13_500, 12_000)).toBe(13_500)
  })

  it('bills what was declared under as_declared', () => {
    expect(premiumDueTotal('as_declared', 9_000, 12_000)).toBe(9_000)
  })

  it('says when the minimum is carrying the policy', () => {
    expect(isBelowMinimum(9_000, 12_000)).toBe(true)
    expect(isBelowMinimum(12_000, 12_000)).toBe(false)
  })
})

describe('earned premium', () => {
  it('is covered turnover times the rate', () => {
    expect(earnedPremium(900_000, 1.5)).toBe(13_500)
  })

  it('rounds to the tiyin', () => {
    expect(earnedPremium(1_234_567, 0.35)).toBeCloseTo(4320.98, 2)
  })
})

describe('instalments', () => {
  it('can only be re-priced while pending', () => {
    expect(isInstalmentEditable('pending')).toBe(true)
    expect(isInstalmentEditable('invoiced')).toBe(false)
    expect(isInstalmentEditable('paid')).toBe(false)
  })

  it('is overdue only while it is still payable', () => {
    const due = { due_date: '2026-01-01' }
    expect(isInstalmentOverdue({ ...due, status: 'pending' }, '2026-02-01')).toBe(true)
    expect(isInstalmentOverdue({ ...due, status: 'invoiced' }, '2026-02-01')).toBe(true)
    expect(isInstalmentOverdue({ ...due, status: 'paid' }, '2026-02-01')).toBe(false)
    expect(isInstalmentOverdue({ ...due, status: 'cancelled' }, '2026-02-01')).toBe(false)
    expect(isInstalmentOverdue({ ...due, status: 'pending' }, '2025-12-01')).toBe(false)
  })
})

describe('contract with migration 0027', () => {
  it('the SQL adjustment is still greatest(earned - minimum, 0)', () => {
    expect(MIGRATION).toContain(
      'greatest(coalesce(e.earned_premium, 0) - p.minimum_premium, 0) as adjustment_amount',
    )
  })

  it('the no-refund rule is still stated where the money is computed', () => {
    expect(MIGRATION).toContain('There is NO refund below the minimum')
  })

  it('premium is still earned on covered turnover only', () => {
    expect(MIGRATION).toContain('select coalesce(sum(covered_amount), 0) into v_covered')
    expect(MIGRATION).toContain('v_policy.premium_rate_pct / 100.0')
  })

  it('the rate used is recorded rather than re-derived', () => {
    expect(MIGRATION).toContain('rate_used      numeric(6,4) not null')
  })

  it('an invoiced instalment can no longer be re-priced', () => {
    expect(MIGRATION).toContain(
      'an instalment can only be re-dated or re-priced while it is pending',
    )
  })

  it('the period is measured inclusively, so a full year bills twelve times', () => {
    // The live smoke caught this: age() to the expiry itself gives 11 months
    // 30 days for a 1 Jan - 31 Dec policy.
    expect(MIGRATION).toContain('select age(p_expiry + 1, p_inception) as a')
  })
})
