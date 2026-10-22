import { describe, expect, it } from 'vitest'

import { datePattern, isoToMasked, maskDate, monthGrid, monthTitle, parseDate, todayIso } from './dateEntry'

describe('date entry', () => {
  it('is typed day first with the separator of the language, whatever the browser', () => {
    expect(maskDate('21102026', 'ru')).toBe('21.10.2026')
    expect(maskDate('21', 'ru')).toBe('21.')
    expect(maskDate('2110', 'uz')).toBe('21.10.')
    expect(maskDate('211020', 'en')).toBe('21/10/20')
    expect(maskDate('21a10b2026999', 'ru')).toBe('21.10.2026')
    expect(datePattern('ru')).toBe('ДД.ММ.ГГГГ')
  })

  it('accepts only real dates and keeps them as ISO', () => {
    expect(parseDate('04.03.2026')).toBe('2026-03-04')
    expect(parseDate('31.02.2026')).toBeNull()
    expect(parseDate('29.02.2028')).toBe('2028-02-29')
    expect(parseDate('12.13.2026')).toBeNull()
    expect(parseDate('01.01.26')).toBeNull()
    expect(isoToMasked('2026-03-04', 'ru')).toBe('04.03.2026')
    expect(isoToMasked('2026-03-04T00:00:00Z', 'en')).toBe('04/03/2026')
    expect(isoToMasked('', 'ru')).toBe('')
  })

  it('lays a month out Monday first', () => {
    const october = monthGrid(2026, 9) // 1 Oct 2026 is a Thursday
    expect(october.slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(october.length % 7).toBe(0)
    expect(october.filter(Boolean)).toHaveLength(31)
  })

  it('names the month in the interface language', () => {
    expect(monthTitle(2026, 9, 'ru')).toBe('Октябрь 2026')
    expect(monthTitle(2026, 9, 'uz')).toBe('Oktabr 2026')
    expect(monthTitle(2026, 9, 'en')).toBe('October 2026')
  })

  it('takes today from the Tashkent calendar', () => {
    expect(todayIso(new Date('2026-10-20T20:30:00Z'))).toBe('2026-10-21')
  })
})
