import { describe, expect, it } from 'vitest'

import { formatCompact } from './format'

describe('formatCompact', () => {
  it('abbreviates like the reference report in English', () => {
    expect(formatCompact(261_369_829_000, 'en')).toBe('261.37B')
    expect(formatCompact(-48_695_018_000, 'en')).toBe('-48.70B')
    expect(formatCompact(36_830_000, 'en')).toBe('36.83M')
    expect(formatCompact(1_600_000_000_000, 'en', 2)).toBe('1.60T')
  })

  it('uses words and a decimal comma in ru and uz', () => {
    expect(formatCompact(261_369_829_000, 'ru')).toBe('261,37 млрд')
    expect(formatCompact(799_276_000, 'ru', 0)).toBe('799 млн')
    expect(formatCompact(45_560_000, 'uz', 1)).toBe('45,6 mln')
  })

  it('leaves small amounts whole and never turns null into 0', () => {
    expect(formatCompact(950, 'en')).toBe('950')
    expect(formatCompact(null, 'en')).toBe('—')
    expect(formatCompact(Number.NaN, 'ru')).toBe('—')
  })
})
