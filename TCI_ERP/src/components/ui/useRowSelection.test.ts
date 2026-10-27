import { describe, expect, it } from 'vitest'

import { allSelected, toggled } from './useRowSelection'

describe('row selection (bulk bar)', () => {
  it('toggles one id without touching the others', () => {
    const one = toggled(new Set(['a']), 'b')
    expect([...one].sort()).toEqual(['a', 'b'])
    expect([...toggled(one, 'a')]).toEqual(['b'])
  })

  it('is "all selected" only when every visible row is, and there is one', () => {
    expect(allSelected(new Set(['a', 'b']), ['a', 'b'])).toBe(true)
    expect(allSelected(new Set(['a']), ['a', 'b'])).toBe(false)
    expect(allSelected(new Set(['a']), [])).toBe(false)
  })
})
