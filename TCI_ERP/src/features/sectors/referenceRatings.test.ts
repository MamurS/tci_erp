import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0088_external_ratings.sql?raw'
import {
  mayEnterReferenceRatings,
  parseReferenceList,
  parseReferenceRating,
  RATING_PATTERN,
  REFERENCE_GRADES,
  REFERENCE_SOURCES,
  referenceTone,
} from './referenceRatings'

describe('the reference rating mirrors 0088', () => {
  it('reads the scale as the database does', () => {
    expect(MIGRATION).toContain(`'^(AA|A|BB|B|C|D)([1-4])$'`)
    expect(RATING_PATTERN.source).toBe('^(AA|A|BB|B|C|D)([1-4])$')
    expect(MIGRATION).toContain(`check (grade in (${REFERENCE_GRADES.map((g) => `'${g}'`).join(', ')}))`)
    expect(MIGRATION).toContain('check (risk_level between 1 and 4)')
    expect(MIGRATION).toContain(`check (source in (${REFERENCE_SOURCES.map((s) => `'${s}'`).join(', ')}))`)
  })

  it('lets admin and credit analysts enter, as the functions do', () => {
    expect(MIGRATION).toContain("perform tci.require_role('admin', 'credit_analyst');")
    expect(mayEnterReferenceRatings('admin')).toBe(true)
    expect(mayEnterReferenceRatings('credit_analyst')).toBe(true)
    for (const r of ['credit_underwriter', 'sales', 'commercial_underwriter', 'claims', 'information_manager', 'client'] as const) {
      expect(mayEnterReferenceRatings(r)).toBe(false)
    }
    expect(mayEnterReferenceRatings(null)).toBe(false)
  })

  it('is never read by what decides', () => {
    expect(MIGRATION).toContain("only the two writers may name the reference ratings")
  })
})

describe('parseReferenceRating', () => {
  it('reads codes case-blind', () => {
    expect(parseReferenceRating('bb2')).toEqual({ grade: 'BB', level: 2, code: 'BB2' })
    expect(parseReferenceRating(' AA1 ')).toEqual({ grade: 'AA', level: 1, code: 'AA1' })
    expect(parseReferenceRating('D4')?.code).toBe('D4')
  })
  it('refuses what is off the scale', () => {
    for (const bad of ['AAA1', 'B5', 'B0', 'E1', 'A', '1', '', null, undefined]) expect(parseReferenceRating(bad)).toBeNull()
  })
  it('tones by the short-term level, never green', () => {
    expect([null, 1, 2, 3, 4].map(referenceTone)).toEqual(['neutral', 'neutral', 'neutral', 'warn', 'neg'])
  })
})

describe('parseReferenceList', () => {
  const known = new Set(['DE', 'UZ', 'KZ', 'CN'])
  it('reads alpha-2 and alpha-3 codes with any separator', () => {
    const p = parseReferenceList('# Allianz Trade, Q3\nDE A1\nUZB;c3\n\nKZ,\tBB2\n', known)
    expect(p.rows).toEqual([
      { country_code: 'DE', rating: 'A1', line: 2 },
      { country_code: 'UZ', rating: 'C3', line: 3 },
      { country_code: 'KZ', rating: 'BB2', line: 5 },
    ])
    expect(p.errors).toEqual([])
  })
  it('names what it cannot read, by line', () => {
    const p = parseReferenceList('DE A1\nGermany\nZZZ B1\nCN E2\nDEU B1\nFR A1', known)
    expect(p.errors).toEqual([
      { kind: 'line', line: 2, text: 'Germany' },
      { kind: 'country', line: 3, value: 'ZZZ' },
      { kind: 'rating', line: 4, value: 'E2', code: 'CN' },
      { kind: 'duplicate', line: 5, code: 'DE', firstLine: 1 },
    ])
    expect(p.unknown).toEqual(['FR'])
    expect(p.rows.map((r) => r.country_code)).toEqual(['DE'])
  })
})
