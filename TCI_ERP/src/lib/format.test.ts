import { describe, expect, it } from 'vitest'

import { formatAmount, formatCompact, formatDocumentAmount, formatDate, formatDue, formatLongDate, formatMoment, formatPeriod, formatRate, formatSignedPercent, isZeroChange } from './format'

describe('formatCompact', () => {
  it('abbreviates like the reference report in English', () => {
    expect(formatCompact(261_369_829_000, 'en')).toBe('261.37B')
    expect(formatCompact(-48_695_018_000, 'en')).toBe('-48.70B')
    expect(formatCompact(36_830_000, 'en')).toBe('36.83M')
    expect(formatCompact(1_600_000_000_000, 'en', 2)).toBe('1.60T')
  })

  it('uses words in ru and uz, with the same decimal point as everywhere', () => {
    expect(formatCompact(261_369_829_000, 'ru')).toBe('261.37 млрд')
    expect(formatCompact(799_276_000, 'ru', 0)).toBe('799 млн')
    expect(formatCompact(45_560_000, 'uz', 1)).toBe('45.6 mln')
  })

  it('leaves small amounts whole and never turns null into 0', () => {
    expect(formatCompact(950, 'en')).toBe('950')
    expect(formatCompact(null, 'en')).toBe('—')
    expect(formatCompact(Number.NaN, 'ru')).toBe('—')
  })

  it('never prints a negative zero', () => {
    expect(formatAmount(-0.0003, 'en', 2)).toBe('0.00')
    expect(formatAmount(-0.004, 'ru', 2)).toBe('0.00')
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
    expect(formatSignedPercent(0, 'ru')).toBe('0.0%')
  })
})

describe('formatDate / formatMoment', () => {
  it('spells the month, in Tashkent time, the same way in every view', () => {
    expect(formatDate('2026-10-04T20:30:00Z', 'en')).toBe('05 Oct 2026')
    expect(formatDate('2026-10-05', 'en')).toBe('05 Oct 2026')
    expect(formatDate('2026-10-05', 'ru')).toBe('05 окт. 2026')
    expect(formatDate('2026-10-05', 'uz')).toBe('05-okt 2026')
    expect(formatDate(null, 'en')).toBe('—')
    expect(formatDate('nonsense', 'en')).toBe('—')
    expect(formatMoment('2026-10-04T20:30:00Z', 'en')).toBe('05 Oct 2026, 01:30')
    expect(formatMoment('2026-10-04T20:30:00Z', 'ru')).toBe('05 окт. 2026, 01:30')
  })
})

describe('formatPeriod', () => {
  it('names a month or a quarter, and falls back to a range', () => {
    expect(formatPeriod('2026-09-01', '2026-09-30', 'en')).toBe('September 2026')
    expect(formatPeriod('2026-09-01', '2026-09-30', 'ru')).toBe('сентябрь 2026')
    expect(formatPeriod('2026-09-01', '2026-09-30', 'uz')).toBe('2026-yil sentabr')
    expect(formatPeriod('2026-07-01', '2026-09-30', 'en')).toBe('Q3 2026')
    expect(formatPeriod('2026-07-01', '2026-09-30', 'ru')).toBe('III кв. 2026')
    expect(formatPeriod('2026-07-05', '2026-08-04', 'en')).toBe('05 Jul 2026 — 04 Aug 2026')
  })
})

describe('formatRate', () => {
  it('reads a stored percentage as a percentage', () => {
    expect(formatRate(0.18, 'en')).toBe('0.18%')
    expect(formatRate('0.125', 'en')).toBe('0.125%')
    expect(formatRate(null, 'en')).toBe('—')
  })
})

describe('formatDue', () => {
  it('shows a midnight-UTC deadline as a date, a real moment with its time', () => {
    expect(formatDue('2026-11-01T00:00:00+00:00', 'en')).toBe('01 Nov 2026')
    expect(formatDue('2026-11-01T00:00:00Z', 'en')).toBe('01 Nov 2026')
    expect(formatDue('2026-11-01T09:30:00Z', 'en')).toBe('01 Nov 2026, 14:30')
  })
})

describe('signed zero', () => {
  it('a change that rounds to zero carries no sign', () => {
    expect(formatSignedPercent(-0.0001, 'en')).toBe('0.0%')
    expect(formatSignedPercent(0.0004, 'en')).toBe('0.0%')
    expect(formatSignedPercent(-0.012, 'en')).toBe('−1.2%')
    expect(isZeroChange(-0.0004)).toBe(true)
    expect(isZeroChange(0.0006)).toBe(false)
  })
})

describe('separators', () => {
  it('groups thousands with a comma and uses a decimal point in every UI language', () => {
    for (const lang of ['en', 'ru', 'uz']) {
      expect(formatAmount(1_000_000, lang)).toBe('1,000,000')
      expect(formatAmount(1234567.891, lang, 2)).toBe('1,234,567.89')
      expect(formatAmount(-25000, lang)).toBe('-25,000')
    }
  })

  it('writes legal documents in the national notation of their language', () => {
    expect(formatDocumentAmount(1_250_000, 'ru', 2)).toBe('1\u00a0250\u00a0000,00')
    expect(formatDocumentAmount(1_250_000, 'uz', 0)).toBe('1\u00a0250\u00a0000')
    expect(formatDocumentAmount(1_250_000, 'en', 2)).toBe('1,250,000.00')
    expect(formatDocumentAmount(null, 'ru')).toBe('—')
  })
})
