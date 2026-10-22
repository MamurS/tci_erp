/**
 * The status and action columns reserve the width of their widest label in
 * en, ru and uz (columns.ts LABEL_SETS). This reads the three locale files and
 * fails when a translation outgrows its reservation — or when a reservation
 * is far wider than anything it holds — naming the number to write instead.
 * (The browser guard, e2e/layout, then checks that no status badge is cut.)
 */
import { describe, expect, it } from 'vitest'

import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import { COL, LABEL_SETS, actionsCol, labelCol, tableMinWidth } from './columns'

const LOCALES: Record<string, unknown> = { en, ru, uz }

function lookup(tree: unknown, path: string): unknown {
  let node = tree
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

/** Every label a key pattern stands for in one locale (`prefix.*` = every
 * string directly under prefix; plural forms count as labels too). */
function labels(tree: unknown, key: string): string[] {
  if (key.endsWith('.*')) {
    const node = lookup(tree, key.slice(0, -2))
    if (!node || typeof node !== 'object') return []
    return Object.values(node as Record<string, unknown>).filter((v): v is string => typeof v === 'string')
  }
  const value = lookup(tree, key)
  return typeof value === 'string' ? [value] : []
}

/** Interpolations ({{count}}) are reserved as four characters. */
const visible = (s: string) => s.replace(/\{\{[^}]+\}\}/g, '0000').length

describe('reserved label widths', () => {
  for (const [name, set] of Object.entries(LABEL_SETS)) {
    it(`${name} fits its longest label in en / ru / uz`, () => {
      let longest = 0
      let which = ''
      for (const [lang, tree] of Object.entries(LOCALES)) {
        for (const key of set.keys) {
          const found = labels(tree, key)
          expect(found.length, `${lang}: ${key} has no labels`).toBeGreaterThan(0)
          for (const label of found) {
            if (visible(label) > longest) {
              longest = visible(label)
              which = `${lang} «${label}»`
            }
          }
        }
      }
      expect(set.chars, `${name}: longest is ${longest} (${which}) — set chars: ${longest}`).toBeGreaterThanOrEqual(longest)
      expect(set.chars, `${name}: reserves ${set.chars} but the longest is ${longest} (${which})`).toBeLessThanOrEqual(longest + 3)
    })
  }

  it('turns reservations into CSS widths', () => {
    expect(labelCol('wordingStatus')).toMatch(/^\d+(\.\d+)?rem$/)
    // A short vocabulary still reserves the minimum.
    expect(parseFloat(labelCol('wordingStatus'))).toBeGreaterThanOrEqual(7)
    expect(parseFloat(labelCol('dataStatus'))).toBeGreaterThan(parseFloat(labelCol('wordingStatus')))
    expect(parseFloat(actionsCol(['wordingStatus'], 1))).toBeGreaterThan(parseFloat(actionsCol(['wordingStatus'])))
    expect(tableMinWidth([COL.date, COL.fill], '10rem')).toBe(`calc(${COL.date} + 10rem)`)
  })
})
