/** Every user-facing string must exist in all three languages. A key added
 * to en and forgotten in ru/uz silently falls back to English in the UI —
 * this test is the only thing that catches it. */

import { describe, expect, it } from 'vitest'

import en from './locales/en.json'
import ru from './locales/ru.json'
import uz from './locales/uz.json'

type Json = { [key: string]: string | Json }

function leafKeys(node: Json, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [path] : leafKeys(value as Json, path)
  })
}

/** i18next plural suffixes: ru/uz legitimately carry forms en does not. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

const base = (key: string) => key.replace(PLURAL_SUFFIX, '')

const EN = new Set(leafKeys(en as Json).map(base))
const RU = new Set(leafKeys(ru as Json).map(base))
const UZ = new Set(leafKeys(uz as Json).map(base))

describe('locale parity', () => {
  it('ru covers every en key', () => {
    expect([...EN].filter((k) => !RU.has(k)).sort()).toEqual([])
  })

  it('uz covers every en key', () => {
    expect([...EN].filter((k) => !UZ.has(k)).sort()).toEqual([])
  })

  it('ru and uz add no keys en does not have', () => {
    expect([...RU].filter((k) => !EN.has(k)).sort()).toEqual([])
    expect([...UZ].filter((k) => !EN.has(k)).sort()).toEqual([])
  })

  it('no translation was left as an empty string', () => {
    for (const [lang, dict] of [['en', en], ['ru', ru], ['uz', uz]] as const) {
      const empty = leafKeys(dict as Json).filter((key) => {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Json)[part], dict)
        return typeof value === 'string' && value.trim() === ''
      })
      expect({ lang, empty }).toEqual({ lang, empty: [] })
    }
  })

  it('interpolation placeholders match across languages', () => {
    const placeholders = (dict: Json, key: string): string[] => {
      const value = key.split('.').reduce<unknown>((node, part) => {
        if (node === undefined || node === null) return undefined
        return (node as Json)[part]
      }, dict)
      if (typeof value !== 'string') return []
      return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    }
    const mismatches: string[] = []
    for (const key of leafKeys(en as Json)) {
      const enPh = placeholders(en as Json, key)
      for (const [lang, dict] of [['ru', ru], ['uz', uz]] as const) {
        const other = placeholders(dict as Json, key)
        if (other.length && enPh.join(',') !== other.join(',')) {
          mismatches.push(`${lang}:${key} (${enPh.join(',')} vs ${other.join(',')})`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})
