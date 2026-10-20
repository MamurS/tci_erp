import { describe, expect, it } from 'vitest'

import { formatAmount, formatCompact, formatLongDate, formatSignedPercent } from './format'

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

  it('never prints a negative zero', () => {
    expect(formatAmount(-0.0003, 'en', 2)).toBe('0.00')
    expect(formatAmount(-0.004, 'ru', 2)).toBe('0,00')
    expect(formatAmount(-0.006, 'en', 2)).toBe('-0.01')
  })
})

describe('formatLongDate', () => {
  it('spells the month and reads the date in Tashkent', () => {
    expect(formatLongDate('2026-10-04T20:30:00Z', 'en')).toBe('05 October 2026')
    expect(formatLongDate('2026-10-05T00:00:00Z', 'ru')).toMatch(/^05 октября 2026/)
    expect(formatLongDate('2026-10-04T20:30:00Z', 'uz')).toBe('2026-yil 05-oktabr')
    expect(formatLongDate('not a date', 'en')).toBe('—')
  })
})

describe('formatSignedPercent', () => {
  it('signs the change and keeps a decimal for small moves', () => {
    expect(formatSignedPercent(0.4698, 'en')).toBe('+47%')
    expect(formatSignedPercent(-0.0096, 'en')).toBe('−1.0%')
    expect(formatSignedPercent(0, 'ru')).toBe('0,0%')
  })
})
