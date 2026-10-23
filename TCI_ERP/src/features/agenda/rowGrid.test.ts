/**
 * The Agenda list's shared row grid (rowGrid.ts): the tag track is measured
 * for TAG_LABEL_CHARS, so a translation that outgrows it must say so here —
 * the browser check (e2e/layout/agenda.spec.ts) only sees the tags the
 * recorded demo book happens to hold. And every row kind uses the one grid.
 */
import { describe, expect, it } from 'vitest'

import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import LIST from './AgendaList.tsx?raw'
import { DUE_TRACK, ROW_GRID, TAG_LABEL_CHARS, TAG_TRACK } from './rowGrid'

const LOCALES = { en, ru, uz } as const

describe('agenda row grid', () => {
  it('the tag track fits the longest tag label in en / ru / uz', () => {
    let longest = 0
    let which = ''
    for (const [lang, locale] of Object.entries(LOCALES)) {
      for (const [key, label] of Object.entries(locale.agenda.tags as Record<string, string>)) {
        if ([...label].length > longest) {
          longest = [...label].length
          which = `${lang} agenda.tags.${key} «${label}»`
        }
      }
    }
    expect(
      longest,
      `${which} is longer than TAG_LABEL_CHARS (${TAG_LABEL_CHARS}): measure it with the ⚡ icon and widen TAG_TRACK`,
    ).toBeLessThanOrEqual(TAG_LABEL_CHARS)
    // Not reserved for a label that no longer exists.
    expect(TAG_LABEL_CHARS, `the longest is now ${longest} (${which}): shrink TAG_TRACK`).toBeLessThanOrEqual(longest + 2)
  })

  it('the grid restates the measured tracks', () => {
    expect(ROW_GRID).toContain(`grid-cols-[3px_1.5rem_${TAG_TRACK}_minmax(0,1fr)_${DUE_TRACK}_1.75rem]`)
  })

  it('every row kind of the list is laid out on ROW_GRID, and nothing else sets its own columns', () => {
    // task row, sub-row, comment composer
    expect(LIST.match(/\$\{ROW_GRID\}/g)?.length).toBe(3)
    expect(LIST).not.toMatch(/grid-cols-|pl-\[3\.25rem\]|<table/)
  })
})
