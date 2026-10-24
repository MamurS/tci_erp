/** Contract test: the group rating mirror (groupRating.ts) against migration
 * 0074 — the grade order, who sets it, and every refusal mapped. */

import { describe, expect, it } from 'vitest'

import M74 from '../../../supabase/migrations/0074_group_ratings.sql?raw'
import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import { OPERATIONS_REFUSALS, refusalKey } from '../../lib/refusals'
import { aboveCap, gradeWorse } from './groupRating'

function leaf(dict: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict)
}

describe('group rating mirrors 0074', () => {
  it('the worse grade is the larger in byte order, as tci.grade_worse', () => {
    expect(M74).toContain('select greatest(p_a collate "C", p_b collate "C")')
    expect(M74).toContain("if tci.grade_worse('A1', 'B2') <> 'B2' or tci.grade_worse('C2', 'C1') <> 'C2' or tci.grade_worse('D', 'A') <> 'D'")
    expect(gradeWorse('A1', 'B2')).toBe('B2')
    expect(gradeWorse('C2', 'C1')).toBe('C2')
    expect(gradeWorse('D', 'A')).toBe('D')
    expect(gradeWorse('B1', null)).toBe('B1')
  })

  it('a grade better than the cap is above it; the cap itself and worse are not', () => {
    expect(aboveCap('A2', 'B1')).toBe(true)
    expect(aboveCap('B1', 'B1')).toBe(false)
    expect(aboveCap('C1', 'B1')).toBe(false)
    expect(aboveCap('A1', null)).toBe(false)
  })

  it('only a senior credit analyst sets or ends it', () => {
    for (const fn of ['set_group_rating', 'end_group_rating']) {
      const body = M74.slice(M74.indexOf(`create or replace function tci.${fn}(`))
      expect(body.slice(0, 600)).toContain("perform tci.require_role('credit_analyst');")
      expect(body.slice(0, 800)).toContain('if not tci.is_senior_credit_analyst() then')
    }
  })

  it('every refusal 0074 raises reads as a message in three languages', () => {
    const raised = [...M74.matchAll(/raise exception '([a-z_]+):/g)].map((m) => m[1]!)
    expect(raised.length).toBeGreaterThan(5)
    const mapped = OPERATIONS_REFUSALS.map((r) => r.fragment)
    for (const code of new Set(raised)) {
      expect(mapped.some((f) => code.includes(f) || f.includes(code)), code).toBe(true)
      const key = refusalKey({ message: `${code}: x` })
      for (const locale of [en, ru, uz]) expect(typeof leaf(locale, key), `${code} → ${key}`).toBe('string')
    }
  })
})
