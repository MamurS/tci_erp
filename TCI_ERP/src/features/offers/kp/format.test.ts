/** The document's formatters: typed values only, the document's notation. */

import { describe, expect, it } from 'vitest'

import { docAmount, docDate, docDays, docMoney, docPercent, docRate, EM_DASH, escapeHtml } from './format'

const NBSP = '\u00a0'

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })
})

describe('amounts', () => {
  it('ru / uz: a non-breaking space between groups and a decimal comma; en: comma and point', () => {
    expect(docMoney(1_000_000, 'ru', 'UZS')).toBe(`1${NBSP}000${NBSP}000${NBSP}UZS`)
    expect(docMoney(1_000_000.5, 'uz', 'USD')).toBe(`1${NBSP}000${NBSP}000,50${NBSP}USD`)
    expect(docMoney(1_000_000.5, 'en', 'USD')).toBe(`1,000,000.50${NBSP}USD`)
    expect(docAmount(0, 'en')).toBe('0')
  })

  it('only from numbers: a string, null or NaN prints the dash', () => {
    for (const v of ['1000', null, undefined, Number.NaN, Infinity, {}]) {
      expect(docMoney(v, 'ru', 'USD')).toBe(EM_DASH)
      expect(docPercent(v, 'ru')).toBe(EM_DASH)
      expect(docRate(v, 'ru')).toBe(EM_DASH)
      expect(docDays(v, 'ru')).toBe(EM_DASH)
    }
  })
})

describe('percentages and rates', () => {
  it('a percentage stored as a percentage', () => {
    expect(docPercent(90, 'ru')).toBe('90%')
    expect(docPercent(87.5, 'ru')).toBe('87,5%')
    expect(docPercent(87.5, 'en')).toBe('87.5%')
  })
  it('a premium rate to three significant decimals, never ×100', () => {
    expect(docRate(0.18, 'ru')).toBe('0,18%')
    expect(docRate(0.125, 'en')).toBe('0.125%')
  })
})

describe('days', () => {
  it('ru plural forms', () => {
    expect(docDays(1, 'ru')).toBe(`1${NBSP}день`)
    expect(docDays(3, 'ru')).toBe(`3${NBSP}дня`)
    expect(docDays(11, 'ru')).toBe(`11${NBSP}дней`)
    expect(docDays(21, 'ru')).toBe(`21${NBSP}день`)
    expect(docDays(90, 'ru')).toBe(`90${NBSP}дней`)
  })
  it('en and uz', () => {
    expect(docDays(1, 'en')).toBe(`1${NBSP}day`)
    expect(docDays(60, 'en')).toBe(`60${NBSP}days`)
    expect(docDays(60, 'uz')).toBe(`60${NBSP}kun`)
  })
})

describe('dates', () => {
  it('a calendar day in words, the day in Tashkent', () => {
    expect(docDate('2026-11-21', 'ru')).toContain('21 ноября 2026')
    expect(docDate('2026-11-21', 'en')).toBe('21 November 2026')
    expect(docDate('2026-11-21', 'uz')).toBe('2026-yil 21-noyabr')
    // 21:30 UTC on the 21st is already the 22nd in Tashkent
    expect(docDate('2026-11-21T21:30:00Z', 'en')).toBe('22 November 2026')
  })
  it('anything but an ISO date prints the dash', () => {
    for (const v of ['21.11.2026', '', null, 20261121]) expect(docDate(v, 'ru')).toBe(EM_DASH)
  })
})
