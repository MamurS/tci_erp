import { describe, expect, it } from 'vitest'

import { ROW_OWN_CLICK, rowClickAction } from './linkRow'
import type { RowClick } from './linkRow'

const click = (over: Partial<RowClick> = {}): RowClick => ({
  ownClick: false,
  selection: '',
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
})

describe('rowClickAction', () => {
  it('opens the row on a plain click anywhere on it', () => {
    expect(rowClickAction(click())).toBe('open')
  })

  it('leaves a link, a button or a checkbox inside the row to itself', () => {
    expect(rowClickAction(click({ ownClick: true }))).toBe('ignore')
    expect(rowClickAction(click({ ownClick: true, ctrlKey: true }))).toBe('ignore')
  })

  it('does not navigate when the click ends a text selection', () => {
    expect(rowClickAction(click({ selection: 'Ankara Tekstil' }))).toBe('ignore')
    expect(rowClickAction(click({ selection: '  ' }))).toBe('open')
  })

  it('opens a new tab as a link would', () => {
    expect(rowClickAction(click({ ctrlKey: true }))).toBe('newTab')
    expect(rowClickAction(click({ metaKey: true }))).toBe('newTab')
    expect(rowClickAction(click({ shiftKey: true }))).toBe('newTab')
    expect(rowClickAction(click({ button: 1 }))).toBe('newTab')
  })

  it('ignores the right button', () => {
    expect(rowClickAction(click({ button: 2 }))).toBe('ignore')
  })

  it('keeps every interactive element its own click', () => {
    for (const selector of ['a', 'button', 'input', 'select', 'label', '[role="checkbox"]', '[role="menuitem"]', '[data-row-ignore]']) {
      expect(ROW_OWN_CLICK).toContain(selector)
    }
  })
})
