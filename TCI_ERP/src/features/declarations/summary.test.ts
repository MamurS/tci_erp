import { describe, expect, it } from 'vitest'

import { declarationCompliance, premiumAccrual, premiumAccrualUzs } from './summary'

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

describe('premium across currencies', () => {
  const rates: Record<string, number> = { USD: 12_000 }
  const rateFor = (ccy: string) => rates[ccy] ?? null

  it('converts each currency by its own rate instead of adding them raw', () => {
    const total = premiumAccrualUzs(
      [
        { currency_code: 'UZS', earned_premium: 60_000_000, minimum_premium: 100_000_000 },
        { currency_code: 'USD', earned_premium: 1_000, minimum_premium: 5_000 },
        { currency_code: 'UZS', earned_premium: 2_000_000, minimum_premium: 0 },
      ],
      rateFor,
    )
    expect(total.earnedUzs).toBe(62_000_000 + 12_000_000)
    expect(total.minimumUzs).toBe(100_000_000 + 60_000_000)
    expect(total.byCurrency).toEqual([
      { currency: 'UZS', earned: 62_000_000, minimum: 100_000_000 },
      { currency: 'USD', earned: 1_000, minimum: 5_000 },
    ])
    expect(total.missingRates).toEqual([])
  })

  it('leaves a currency without a rate out of the total and names it', () => {
    const total = premiumAccrualUzs(
      [
        { currency_code: 'UZS', earned_premium: 100, minimum_premium: 200 },
        { currency_code: 'EUR', earned_premium: 50, minimum_premium: 80 },
      ],
      rateFor,
    )
    expect(total.earnedUzs).toBe(100)
    expect(total.minimumUzs).toBe(200)
    expect(total.missingRates).toEqual(['EUR'])
    // Still listed as booked, so the screen can show it on its own.
    expect(total.byCurrency.map((r) => r.currency)).toEqual(['UZS', 'EUR'])
  })

  it('does not call an empty currency incomplete', () => {
    const total = premiumAccrualUzs([{ currency_code: 'EUR', earned_premium: 0, minimum_premium: 0 }], rateFor)
    expect(total.missingRates).toEqual([])
  })

  it('never asks for a rate for UZS', () => {
    const total = premiumAccrualUzs([{ currency_code: 'UZS', earned_premium: 7, minimum_premium: 9 }], () => {
      throw new Error('no lookup expected')
    })
    expect(total.earnedUzs).toBe(7)
  })
})
