/**
 * Every literal translation key the code asks for exists. A missing key is
 * printed raw on screen («portal.limits.decided» reached a client's column
 * header before this test). Keys built at run time (`t(\`x.${y}\`)`) are
 * covered by their own contract tests; this one checks the literals.
 */
import { describe, expect, it } from 'vitest'

import en from './locales/en.json'

const SOURCES = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function has(path: string): boolean {
  let node: unknown = en
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in (node as Record<string, unknown>))) return false
    node = (node as Record<string, unknown>)[part]
  }
  return node !== undefined
}

/** i18next resolves `key` with a count through `key_one` / `key_other`. */
function resolves(key: string): boolean {
  return has(key) || has(`${key}_one`) || has(`${key}_other`)
}

describe('translation keys', () => {
  it('every literal key used in the code exists in the locales', () => {
    const missing = new Set<string>()
    for (const [path, text] of Object.entries(SOURCES)) {
      for (const m of text.matchAll(/\bt\(\s*['"]([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"]/g)) {
        if (!resolves(m[1]!)) missing.add(`${path}: ${m[1]}`)
      }
      for (const m of text.matchAll(/\bi18nKey=["']([a-z][A-Za-z0-9_.]+)["']/g)) {
        if (!resolves(m[1]!)) missing.add(`${path}: ${m[1]}`)
      }
    }
    expect([...missing].sort()).toEqual([])
  })
})
