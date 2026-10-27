import { describe, expect, it } from 'vitest'

import { METER_NEAR, meterState, scaleFigures } from './meter'

describe('meterState', () => {
  it('reads ok below the near threshold', () => {
    expect(meterState(50, 100)).toEqual({ fill: 0.5, ratio: 0.5, tone: 'ok' })
  })
  it('reads near from the threshold on, equal included', () => {
    expect(meterState(METER_NEAR * 100, 100).tone).toBe('near')
    expect(meterState(100, 100)).toEqual({ fill: 1, ratio: 1, tone: 'near' })
  })
  it('reads over above the cap with a full bar', () => {
    expect(meterState(150, 100)).toEqual({ fill: 1, ratio: 1.5, tone: 'over' })
  })
  it('treats a zero cap as over for any positive value', () => {
    expect(meterState(1, 0).tone).toBe('over')
    expect(meterState(0, 0).tone).toBe('ok')
  })
  it('is unknown when either side is missing', () => {
    expect(meterState(null, 100).tone).toBe('unknown')
    expect(meterState(10, null).tone).toBe('unknown')
  })
})

describe('scaleFigures', () => {
  it('scales every figure against the largest', () => {
    const { max, share } = scaleFigures({ requested: 200, decided: 150, recommended: null })
    expect(max).toBe(200)
    expect(share).toEqual({ requested: 1, decided: 0.75, recommended: null })
  })
  it('draws nothing when there is nothing to compare', () => {
    expect(scaleFigures({ a: 0, b: null }).share).toEqual({ a: null, b: null })
  })
})
