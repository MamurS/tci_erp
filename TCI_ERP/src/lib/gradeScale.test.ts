import { describe, expect, it } from 'vitest'

import { bandForScore, gradeChange, scorePosition, zoneSegments } from './gradeScale'
import type { GradeBand } from './gradeScale'

const BANDS: GradeBand[] = [
  { code: 'A1', label_key: 'grade.excellent', lower: 0, upper: 10, risk_coefficient: 1.5 },
  { code: 'A2', label_key: 'grade.very_good', lower: 10, upper: 25, risk_coefficient: 1.2 },
  { code: 'B1', label_key: 'grade.good', lower: 25, upper: 40, risk_coefficient: 1.0 },
  { code: 'B2', label_key: 'grade.acceptable', lower: 40, upper: 55, risk_coefficient: 0.7 },
  { code: 'C1', label_key: 'grade.weak', lower: 55, upper: 65, risk_coefficient: 0.4 },
  { code: 'C2', label_key: 'grade.very_weak', lower: 65, upper: 75, risk_coefficient: 0.15 },
  { code: 'D', label_key: 'grade.unacceptable', lower: 75, upper: 100, risk_coefficient: 0 },
]

describe('zoneSegments', () => {
  it('segments cover the full scale without gaps', () => {
    const segments = zoneSegments(BANDS)
    expect(segments.reduce((a, s) => a + s.widthPct, 0)).toBeCloseTo(100)
    expect(segments[0]).toMatchObject({ leftPct: 0, widthPct: 10 })
    expect(segments[6]).toMatchObject({ leftPct: 75, widthPct: 25 })
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].leftPct).toBeCloseTo(
        segments[i - 1].leftPct + segments[i - 1].widthPct,
      )
    }
  })
})

describe('scorePosition', () => {
  it('clamps to the scale', () => {
    expect(scorePosition(52.2)).toBe(52.2)
    expect(scorePosition(-5)).toBe(0)
    expect(scorePosition(140)).toBe(100)
  })
})

describe('bandForScore', () => {
  it('upper bound is inclusive, like the engine', () => {
    expect(bandForScore(BANDS, 10)?.code).toBe('A1')
    expect(bandForScore(BANDS, 10.1)?.code).toBe('A2')
    expect(bandForScore(BANDS, 55)?.code).toBe('B2')
    expect(bandForScore(BANDS, 99)?.code).toBe('D')
  })
})

describe('gradeChange', () => {
  it('lower score is an improvement', () => {
    const change = gradeChange(
      BANDS,
      { score: 42, grade: 'B2' },
      { score: 52, grade: 'B2' },
    )
    expect(change).toMatchObject({ scoreDelta: -10, gradeSteps: 0, improved: true })
  })

  it('grade steps count band moves', () => {
    const change = gradeChange(
      BANDS,
      { score: 60, grade: 'C1' },
      { score: 42, grade: 'B2' },
    )
    expect(change).toMatchObject({ gradeSteps: 1, improved: false })
  })

  it('null when nothing changed', () => {
    expect(
      gradeChange(BANDS, { score: 42, grade: 'B2' }, { score: 42, grade: 'B2' }),
    ).toBeNull()
  })
})
