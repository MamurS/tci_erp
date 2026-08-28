import { describe, expect, it } from 'vitest'

import { declarationCompliance, premiumAccrual } from './summary'

describe('declaration compliance', () => {
  it('counts what is waiting on whom', () => {
    expect(
      declarationCompliance([
        { status: 'submitted' },
        { status: 'submitted' },
        { status: 'disputed' },
        { status: 'accepted' },
        // A corrected row is history, not a live obligation.
        { status: 'corrected' },
        { status: 'draft' },
      ]),
    ).toEqual({ awaitingAcceptance: 2, disputed: 1, accepted: 1 })
  })

  it('is all zeros when there is nothing', () => {
    expect(declarationCompliance([])).toEqual({
      awaitingAcceptance: 0,
      disputed: 0,
      accepted: 0,
    })
  })
})

describe('premium accrual', () => {
  it('sums across policies', () => {
    expect(
      premiumAccrual([
        { earned_premium: 13_500, minimum_premium: 12_000, adjustment_amount: 1_500, instalments_overdue: 0 },
        { earned_premium: 4_000, minimum_premium: 10_000, adjustment_amount: 0, instalments_overdue: 2_000 },
      ]),
    ).toEqual({ earned: 17_500, minimum: 22_000, adjustment: 1_500, instalmentsOverdue: 2_000 })
  })

  it('never produces a negative adjustment, because the view never does', () => {
    // The no-refund rule is enforced in SQL; this just must not undo it.
    const total = premiumAccrual([
      { earned_premium: 1, minimum_premium: 999, adjustment_amount: 0, instalments_overdue: 0 },
    ])
    expect(total.adjustment).toBe(0)
  })
})
