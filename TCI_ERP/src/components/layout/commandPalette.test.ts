import { describe, expect, it } from 'vitest'

import { isPaletteShortcut, matchesQuery, sanitizeSearchTerm } from './commandPalette'

describe('commandPalette', () => {
  it('matches every word, ignoring case and accents', () => {
    expect(matchesQuery('Кредитные лимиты', 'лим')).toBe(true)
    expect(matchesQuery('Credit limits', 'LIMITS cred')).toBe(true)
    expect(matchesQuery('Sug‘urta da’volari', 'sug')).toBe(true)
    expect(matchesQuery('Policies', 'claims')).toBe(false)
    expect(matchesQuery('Anything', '')).toBe(true)
  })

  it('makes a term safe for a PostgREST or-filter', () => {
    expect(sanitizeSearchTerm('OOO "WB", (Moscow)')).toBe('OOO WB Moscow')
    expect(sanitizeSearchTerm('100%')).toBe('100')
    expect(sanitizeSearchTerm(' a ')).toBeNull()
    expect(sanitizeSearchTerm('3012')).toBe('3012')
  })

  it('opens on Ctrl+K and Cmd+K only', () => {
    expect(isPaletteShortcut({ key: 'k', ctrlKey: true, metaKey: false })).toBe(true)
    expect(isPaletteShortcut({ key: 'K', ctrlKey: false, metaKey: true })).toBe(true)
    expect(isPaletteShortcut({ key: 'k', ctrlKey: false, metaKey: false })).toBe(false)
    expect(isPaletteShortcut({ key: 'j', ctrlKey: true, metaKey: false })).toBe(false)
  })
})
