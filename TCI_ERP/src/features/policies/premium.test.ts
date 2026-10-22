import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0027_premium.sql?raw'
import PAYMENTS from '../../../supabase/migrations/0056_premium_payments.sql?raw'
import {
  DERIVED_STATUSES,
  adjustmentAmount,
  allocate,
  deriveStatus,
  earnedPremium,
  instalmentActions,
  isBelowMinimum,
  isInstalmentEditable,
  isReversible,
  netPaid,
  outstandingTotal,
  premiumDueTotal,
  primaryAction,
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

})

const TODAY = '2026-10-22'
const row = (sequence: number, due_date: string, amount: number, extra: Partial<{ status: 'pending' | 'invoiced' | 'cancelled'; invoiced_at: string | null }> = {}) => ({
  sequence,
  due_date,
  amount,
  status: extra.status ?? ('pending' as const),
  invoiced_at: extra.invoiced_at ?? null,
})

describe('payments fill instalments oldest first', () => {
  const schedule = [row(2, '2026-11-23', 11250), row(1, '2026-08-23', 11250, { status: 'invoiced', invoiced_at: '2026-08-01' }), row(3, '2027-02-23', 11250), row(4, '2027-05-23', 11250)]

  it('pays the oldest due date first, whatever the row order', () => {
    const out = allocate(schedule, 13_500, TODAY)
    expect(out.map((r) => [r.sequence, r.paid_amount, r.outstanding])).toEqual([
      [2, 2250, 9000],
      [1, 11250, 0],
      [3, 0, 11250],
      [4, 0, 11250],
    ])
  })

  it('derives the status with the SQL precedence', () => {
    const out = allocate(schedule, 13_500, TODAY)
    expect(out.map((r) => r.derived_status)).toEqual(['partially_paid', 'paid', 'pending', 'pending'])
    // past due with money still owed is overdue, even when partly paid
    expect(allocate([row(1, '2026-09-01', 100)], 40, TODAY)[0].derived_status).toBe('overdue')
    expect(deriveStatus(row(1, '2027-01-01', 100, { status: 'invoiced', invoiced_at: 'x' }), 0, TODAY)).toBe('invoiced')
    expect(deriveStatus(row(1, '2027-01-01', 100, { status: 'cancelled' }), 0, TODAY)).toBe('cancelled')
  })

  it('a cancelled instalment takes nothing', () => {
    const out = allocate([row(1, '2026-01-01', 100, { status: 'cancelled' }), row(2, '2026-02-01', 100)], 100, TODAY)
    expect(out.map((r) => r.paid_amount)).toEqual([0, 100])
  })

  it('reversals reduce the net, in exact cents', () => {
    expect(netPaid([{ kind: 'payment', amount: 0.1 }, { kind: 'payment', amount: 0.2 }, { kind: 'reversal', amount: 0.1 }])).toBe(0.2)
    expect(outstandingTotal([{ outstanding: 0.1 }, { outstanding: 0.2 }])).toBe(0.3)
  })
})

describe('row actions', () => {
  it('a bill comes before its payment', () => {
    expect(primaryAction({ status: 'pending', invoiced_at: null, outstanding: 10 })).toBe('invoice')
    expect(instalmentActions({ status: 'pending', invoiced_at: null, outstanding: 10 })).toEqual(['invoice', 'recordPayment'])
    expect(primaryAction({ status: 'invoiced', invoiced_at: 'x', outstanding: 10 })).toBe('recordPayment')
  })

  it('nothing to do on a settled or cancelled instalment', () => {
    expect(primaryAction({ status: 'invoiced', invoiced_at: 'x', outstanding: 0 })).toBeNull()
    expect(instalmentActions({ status: 'cancelled', invoiced_at: null, outstanding: 0 })).toEqual([])
  })

  it('a payment is reversed once, a reversal never', () => {
    const pay = { id: 'p1', kind: 'payment' as const, reverses_id: null }
    expect(isReversible(pay, [pay])).toBe(true)
    expect(isReversible(pay, [pay, { reverses_id: 'p1' }])).toBe(false)
    expect(isReversible({ id: 'r1', kind: 'reversal' }, [])).toBe(false)
  })
})

describe('contract with migration 0056', () => {
  it('allocation is net payments, oldest first, capped per instalment', () => {
    expect(PAYMENTS).toContain('over (partition by pi.policy_id order by pi.due_date, pi.sequence')
    expect(PAYMENTS).toContain('least(s.amount, greatest(coalesce(n.net_paid, 0) - s.owed_before, 0))')
  })

  it('the status precedence is the one DERIVED_STATUSES lists', () => {
    const start = PAYMENTS.indexOf("when a.status = 'cancelled'            then 'cancelled'")
    const block = PAYMENTS.slice(start, PAYMENTS.indexOf('end as derived_status', start))
    const order = DERIVED_STATUSES.map((st) => block.search(new RegExp(`(then|else) '${st}'`)))
    expect(start).toBeGreaterThan(0)
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('overpayment is refused, and paid is no longer stored', () => {
    expect(PAYMENTS).toContain("raise exception 'payment_exceeds_outstanding:")
    expect(PAYMENTS).toContain("add constraint premium_instalments_paid_is_derived check (status <> 'paid')")
  })

  it('invoicing and payments are offered where the database accepts them', () => {
    expect(PAYMENTS).toContain("raise exception 'instalment_already_invoiced:")
    expect(PAYMENTS).toContain("raise exception 'instalment_already_paid:")
    expect(PAYMENTS).toContain("raise exception 'payment_already_reversed:")
    expect(PAYMENTS).toContain("raise exception 'payment_is_reversal:")
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

  it('the schedule counts periods that start before the expiry (0056 replaced age())', () => {
    // 0027's age(expiry + 1, inception) billed an anniversary-to-anniversary
    // year as 13 months (bug D); 0056 counts period starts instead.
    expect(MIGRATION).toContain('select age(p_expiry + 1, p_inception) as a')
    expect(PAYMENTS).toContain('< p_expiry - 1')
  })
})
