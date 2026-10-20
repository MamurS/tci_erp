import { describe, expect, it } from 'vitest'

import {
  SCALE_POINTS,
  colorForPoint,
  colorForScore,
  gaugeAngle,
  placeScore,
  scoreChange,
} from './ratingScale'

describe('ratingScale', () => {
  it('has ten legend points from 10 to 100', () => {
    expect(SCALE_POINTS).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  })

  it('colours the legend in pairs, green to red', () => {
    expect(colorForPoint(10)).toBe(colorForPoint(20))
    expect(colorForPoint(30)).toBe(colorForPoint(40))
    expect(colorForPoint(90)).toBe(colorForPoint(100))
    expect(colorForPoint(10)).toBe('#17b81a')
    expect(colorForPoint(100)).toBe('#ee1c1c')
  })

  it('colours a score by the band it falls in', () => {
    expect(colorForScore(5)).toBe('#17b81a')
    expect(colorForScore(72)).toBe(colorForPoint(80))
    expect(colorForScore(100)).toBe('#ee1c1c')
  })

  it('places a score in the first half of a decade inside that band', () => {
    // The reference: "Rating 72 (Weak band)".
    expect(placeScore(72)).toEqual({ kind: 'in', point: 70 })
    expect(placeScore(70)).toEqual({ kind: 'in', point: 70 })
    expect(placeScore(54.5)).toEqual({ kind: 'in', point: 50 })
    expect(placeScore(4)).toEqual({ kind: 'in', point: 10 })
    expect(placeScore(100)).toEqual({ kind: 'in', point: 100 })
  })

  it('places a score in the second half between its neighbours', () => {
    // The reference: "Rating 78 (between Weak (70) and Distressed (80))".
    expect(placeScore(78)).toEqual({ kind: 'between', lower: 70, upper: 80 })
    expect(placeScore(75)).toEqual({ kind: 'between', lower: 70, upper: 80 })
    expect(placeScore(95)).toEqual({ kind: 'between', lower: 90, upper: 100 })
  })

  it('reads a higher score as a worse rating', () => {
    expect(scoreChange(78, 65)).toEqual({ delta: 13, direction: 'worse' })
    expect(scoreChange(60, 72)).toEqual({ delta: -12, direction: 'better' })
    expect(scoreChange(72, 72)).toEqual({ delta: 0, direction: 'same' })
    expect(scoreChange(72, null)).toBeNull()
  })

  it('maps 0 to the left end of the gauge and 100 to the right', () => {
    expect(gaugeAngle(0)).toBe(180)
    expect(gaugeAngle(50)).toBe(90)
    expect(gaugeAngle(100)).toBe(0)
    expect(gaugeAngle(140)).toBe(0)
  })
})
