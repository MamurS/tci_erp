import { describe, expect, it } from 'vitest'

import { GRADE_CODES } from '../../lib/gradeCatalogue'
import { gradeBadgeTone, gradeKey, gradeSolid } from './gradeTone'

describe('grade colours', () => {
  it('cover every grade of the scale', () => {
    for (const code of GRADE_CODES) {
      expect(gradeBadgeTone(code)).toBe(`bg-grade-${code.toLowerCase()}-tint text-grade-${code.toLowerCase()}-ink`)
      expect(gradeSolid(code)).toBe(`bg-grade-${code.toLowerCase()}`)
    }
  })
  it('read a family letter as its first grade, anything else as neutral', () => {
    expect(gradeKey('b')).toBe('B1')
    expect(gradeKey('D')).toBe('D')
    expect(gradeBadgeTone('unrated')).toBe('bg-slate-100 text-slate-700')
  })
})
