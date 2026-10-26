import { describe, expect, it } from 'vitest'

import { buildSignals, dayPart, gradeMix } from './dashboard'

describe('buildSignals', () => {
  it('keeps only non-zero signals, worst first', () => {
    const signals = buildSignals({
      overduesLate: 0,
      escalatedLimits: 2,
      declarationsDisputed: null,
      claimsAwaitingInfo: 1,
      declarationsAwaiting: 4,
    })
    expect(signals.map((s) => s.key)).toEqual(['escalatedLimits', 'claimsAwaitingInfo', 'declarationsAwaiting'])
    expect(signals[0]).toMatchObject({ tone: 'neg', count: 2, to: '/limits?tab=escalated' })
  })

  it('is empty when nothing needs attention', () => {
    expect(
      buildSignals({
        overduesLate: 0,
        escalatedLimits: null,
        declarationsDisputed: 0,
        claimsAwaitingInfo: null,
        declarationsAwaiting: 0,
      }),
    ).toEqual([])
  })
})

describe('dayPart', () => {
  it('reads the hour in Tashkent (UTC+5)', () => {
    expect(dayPart(new Date('2026-10-19T03:00:00Z'))).toBe('morning') // 08:00
    expect(dayPart(new Date('2026-10-19T09:00:00Z'))).toBe('day') // 14:00
    expect(dayPart(new Date('2026-10-19T15:00:00Z'))).toBe('evening') // 20:00
  })
})

describe('gradeMix', () => {
  it('counts each grade of the scale, zero included, best first', () => {
    expect(gradeMix(['B1', 'b1', 'D', 'A1', 'X9'])).toEqual([
      { grade: 'A1', count: 1 },
      { grade: 'A2', count: 0 },
      { grade: 'B1', count: 2 },
      { grade: 'B2', count: 0 },
      { grade: 'C1', count: 0 },
      { grade: 'C2', count: 0 },
      { grade: 'D', count: 1 },
    ])
  })
})
