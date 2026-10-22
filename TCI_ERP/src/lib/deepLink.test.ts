import { describe, expect, it } from 'vitest'

import { isIsoDate, narrowToIds, parseIdList, pickParam } from './deepLink'

describe('deep-link parameters', () => {
  it('pickParam accepts only the allowed values', () => {
    const allowed = ['decision', 'commercial'] as const
    expect(pickParam('decision', allowed)).toBe('decision')
    expect(pickParam('commercial', allowed)).toBe('commercial')
    expect(pickParam('Decision', allowed)).toBeNull()
    expect(pickParam('', allowed)).toBeNull()
    expect(pickParam(null, allowed)).toBeNull()
    expect(pickParam(undefined, allowed)).toBeNull()
  })

  it('parseIdList trims, drops empties and duplicates, keeps the order', () => {
    expect(parseIdList('b, a,,b , c,')).toEqual(['b', 'a', 'c'])
    expect(parseIdList('')).toEqual([])
    expect(parseIdList(null)).toEqual([])
    expect(parseIdList(' , ')).toEqual([])
  })

  it('narrowToIds narrows to the named rows, in the rows’ own order', () => {
    const rows = [{ id: '1' }, { id: '2' }, { id: '3' }]
    expect(narrowToIds(rows, ['3', '1'])).toEqual({ rows: [{ id: '1' }, { id: '3' }], filtered: true })
  })

  it('narrowToIds narrows nothing for an empty or entirely stale list', () => {
    const rows = [{ id: '1' }, { id: '2' }]
    expect(narrowToIds(rows, [])).toEqual({ rows, filtered: false })
    expect(narrowToIds(rows, ['9'])).toEqual({ rows, filtered: false })
    // A partly stale list still narrows to what it does name.
    expect(narrowToIds(rows, ['9', '2'])).toEqual({ rows: [{ id: '2' }], filtered: true })
  })

  it('isIsoDate accepts real calendar dates only', () => {
    expect(isIsoDate('2026-07-01')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2025-02-29')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('2026-7-1')).toBe(false)
    expect(isIsoDate('2026-07-01T00:00:00Z')).toBe(false)
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate(null)).toBe(false)
  })
})
