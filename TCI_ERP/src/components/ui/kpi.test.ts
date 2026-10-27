import { describe, expect, it } from 'vitest'

import { kpiDelta, runningCountByMonth, sparklinePath } from './kpi'

describe('kpiDelta', () => {
  it('colours by meaning, not by direction', () => {
    expect(kpiDelta(110, 100, 'up')).toMatchObject({ direction: 'up', tone: 'pos' })
    expect(kpiDelta(110, 100, 'down')).toMatchObject({ direction: 'up', tone: 'neg' })
    expect(kpiDelta(90, 100, 'down')).toMatchObject({ direction: 'down', tone: 'pos' })
    expect(kpiDelta(90, 100, 'none')).toMatchObject({ direction: 'down', tone: 'neutral' })
    expect(kpiDelta(110, 100, 'up')?.ratio).toBeCloseTo(0.1)
  })
  it('shows no change without a baseline to compare with', () => {
    expect(kpiDelta(5, 0, 'up')).toBeNull()
    expect(kpiDelta(5, null, 'up')).toBeNull()
    expect(kpiDelta(null, 5, 'up')).toBeNull()
  })
  it('calls a rounding-sized move flat', () => {
    expect(kpiDelta(100.01, 100, 'up')).toMatchObject({ direction: 'flat', tone: 'neutral' })
  })
})

describe('sparklinePath', () => {
  it('draws through the points, low values low', () => {
    const path = sparklinePath([0, 10], 10, 10)
    expect(path).toBe('M1.0 9.0 L9.0 1.0')
  })
  it('needs two points and keeps a flat series in the middle', () => {
    expect(sparklinePath([3])).toBeNull()
    expect(sparklinePath([2, 2, 2], 10, 10)).toBe('M1.0 5.0 L5.0 5.0 L9.0 5.0')
  })
})

describe('runningCountByMonth', () => {
  it('counts what existed at each month start, then now', () => {
    const now = new Date(2026, 9, 26) // 26 Oct 2026, local time
    const dates = [new Date(2026, 6, 15), new Date(2026, 8, 1), new Date(2026, 9, 3)].map((d) => d.toISOString())
    // starts of May … Oct, then now
    expect(runningCountByMonth(dates, now)).toEqual([0, 0, 0, 1, 1, 2, 3])
  })
  it('ignores what cannot be read as a date', () => {
    expect(runningCountByMonth(['nope'], new Date(2026, 0, 5), 1)).toEqual([0, 0])
  })
})
