import { describe, expect, it } from 'vitest'

import { isSidebarShortcut, parseSidebarState, sectionFor } from './shell'

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('sidebar state', () => {
  it('opens unless explicitly closed', () => {
    expect(parseSidebarState(null)).toBe('open')
    expect(parseSidebarState('garbage')).toBe('open')
    expect(parseSidebarState('closed')).toBe('closed')
  })

  it('toggles on Ctrl+B and ⌘B only', () => {
    expect(isSidebarShortcut(key('b', { ctrlKey: true }))).toBe(true)
    expect(isSidebarShortcut(key('B', { metaKey: true }))).toBe(true)
    expect(isSidebarShortcut(key('b'))).toBe(false)
    expect(isSidebarShortcut(key('b', { ctrlKey: true, shiftKey: true }))).toBe(false)
  })
})

describe('sectionFor', () => {
  it('matches the longest prefix and keeps "/" exact', () => {
    expect(sectionFor('/')?.key).toBe('dashboard')
    expect(sectionFor('/entities/abc')?.key).toBe('entities')
    expect(sectionFor('/limits')?.key).toBe('limits')
    expect(sectionFor('/account')).toBeNull()
    expect(sectionFor('/entitiesx')).toBeNull()
  })
})
