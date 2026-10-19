/**
 * Every statement template the migrations seed, held to the same rules the
 * authoring validator applies: valid sections and IFRS columns, formulas that
 * reference real lines, a reason on every unmapped leaf, uz captions with the
 * U+2018 apostrophe — and the numeric property that matters: fill the leaf
 * lines with arbitrary amounts, let the form's own formulas compute its
 * totals, map to IFRS, and every cross-checked total must reconcile. That is
 * what catches double counting, a missing mapping or a wrong sign.
 */

import { describe, expect, it } from 'vitest'

import { BALANCE_SHEET_KEYS, INCOME_STATEMENT_KEYS } from '../types'
import { frameworkDocs, mappingsOf, rulesOf } from './frameworkDocs'
import type { SeedTemplate } from './frameworkDocs'
import { mapLocalStatement, validateLocalStatement } from './mapping'

const COMPUTED = new Set([
  'total_non_current_assets', 'total_current_assets', 'total_assets', 'total_equity',
  'total_non_current_liabilities', 'total_current_liabilities', 'total_liabilities',
  'total_equity_and_liabilities', 'gross_profit', 'operating_profit', 'profit_before_tax', 'net_profit',
])
const MAPPABLE = {
  balance_sheet: new Set<string>(BALANCE_SHEET_KEYS.filter((k) => !COMPUTED.has(k))),
  income_statement: new Set<string>(INCOME_STATEMENT_KEYS.filter((k) => !COMPUTED.has(k))),
}
const SECTIONS = {
  balance_sheet: new Set(['assets_long_term', 'assets_current', 'equity', 'liabilities_long_term', 'liabilities_current']),
  income_statement: new Set(['operating', 'financial', 'result']),
}

/** Deterministic pseudo-random amounts so a failure reproduces. */
function amounts(seed: number): () => number {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return 1 + (x % 1_000_000)
  }
}

/** Leaves get amounts; formula lines are computed the way the form computes them. */
function fill(template: SeedTemplate, seed: number): Record<string, number> {
  const next = amounts(seed)
  const byCode = new Map(template.lines.map((l) => [l.code, l]))
  const values: Record<string, number> = {}
  const value = (code: string, stack: string[]): number => {
    if (code in values) return values[code]
    if (stack.includes(code)) throw new Error(`${template.code}: formula cycle at ${code}`)
    const line = byCode.get(code)
    if (!line) throw new Error(`${template.code}: formula references unknown line ${code}`)
    values[code] = line.formula
      ? line.formula.plus.reduce((s, c) => s + value(c, [...stack, code]), 0) -
        line.formula.minus.reduce((s, c) => s + value(c, [...stack, code]), 0)
      : next()
    return values[code]
  }
  for (const line of template.lines) value(line.code, [])
  return values
}

const docs = frameworkDocs()

describe('seeded statement frameworks', () => {
  it('are found in the migrations', () => {
    expect(docs.map((d) => d.framework.code)).toContain('UZ_NAS')
  })

  it('have unique framework, template and per-template line codes', () => {
    const frameworks = docs.map((d) => d.framework.code)
    expect(new Set(frameworks).size).toBe(frameworks.length)
    const templates = docs.flatMap((d) => d.templates.map((t) => t.code))
    expect(new Set(templates).size).toBe(templates.length)
    for (const t of docs.flatMap((d) => d.templates)) {
      const codes = t.lines.map((l) => l.code)
      expect(new Set(codes).size, t.code).toBe(codes.length)
    }
  })

  it('link every country to at most one framework', () => {
    const countries = docs.flatMap((d) => d.framework.countries)
    expect(new Set(countries).size).toBe(countries.length)
  })

  for (const doc of docs) {
    describe(doc.framework.code, () => {
      it('has one balance sheet and one income statement', () => {
        expect(doc.templates.map((t) => t.form_kind).sort()).toEqual(['balance_sheet', 'income_statement'])
      })

      for (const template of doc.templates) {
        it(`${template.code}: lines are well formed`, () => {
          const codes = new Set(template.lines.map((l) => l.code))
          for (const line of template.lines) {
            const where = `${template.code} ${line.code}`
            expect(SECTIONS[template.form_kind].has(line.section), `${where} section`).toBe(true)
            if (line.map) {
              expect(MAPPABLE[template.form_kind].has(line.map.column), `${where} column ${line.map.column}`).toBe(true)
              expect([1, -1], `${where} sign`).toContain(line.map.sign)
            }
            for (const ref of [...(line.formula?.plus ?? []), ...(line.formula?.minus ?? [])]) {
              expect(codes.has(ref), `${where} formula -> ${ref}`).toBe(true)
            }
            if (line.check) {
              expect(COMPUTED.has(line.check), `${where} check`).toBe(true)
              expect(line.formula, `${where} a checked line needs a formula`).not.toBeNull()
            }
            if (line.subtotal) expect(line.formula, `${where} subtotal formula`).not.toBeNull()
            if (!line.subtotal && !line.map && !line.formula) {
              expect(line.note, `${where} unmapped leaf needs a note`).toBeTruthy()
            }
            for (const lang of ['en', 'ru', 'uz', 'local'] as const) {
              expect(line.name[lang], `${where} name.${lang}`).toBeTruthy()
            }
            expect(line.name.uz, `${where} uz apostrophe`).not.toMatch(/['’`ʻʼ]/)
          }
          expect(template.lines.some((l) => l.check), `${template.code} has no cross-check`).toBe(true)
        })

        it(`${template.code}: totals reconcile after mapping to IFRS`, () => {
          const rules = rulesOf(template)
          const mappings = mappingsOf(template)
          for (const seed of [1, 7, 42, 1009]) {
            const values = fill(template, seed)
            // The form's own arithmetic holds by construction...
            expect(validateLocalStatement(rules, values), `${template.code} formulas`).toEqual([])
            // ...so any cross-check warning is a mapping defect.
            const { warnings } = mapLocalStatement(rules, values, mappings)
            expect(warnings, `${template.code} seed ${seed}`).toEqual([])
          }
        })
      }
    })
  }
})

const SOURCES = import.meta.glob('../../../../supabase/frameworks/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('framework sources (supabase/frameworks/*.json)', () => {
  it('are exactly what the migrations load', () => {
    const loaded = new Map<string, unknown>()
    for (const doc of docs) {
      loaded.set(doc.framework.code, { framework: doc.framework, templates: doc.templates })
    }
    const files = Object.values(SOURCES).map((raw) => JSON.parse(raw) as { framework: { code: string } })
    expect(files.map((f) => f.framework.code).sort()).toEqual([...loaded.keys()].sort())
    for (const file of files) {
      expect(file, file.framework.code).toEqual(loaded.get(file.framework.code))
    }
  })
})
