/** Contract test: add-entity dedup rules mirror migration 0015
 * (pg_trgm similar_entities + the blocking unique index). */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0015_legal_entities.sql?raw'
import {
  NAME_MIN_CHARS,
  REG_MIN_CHARS,
  SIMILARITY_LIMIT,
  SIMILARITY_THRESHOLD,
  dedupVerdict,
} from './dedup'
import type { LegalEntity, SimilarEntity } from './types'

const entity = { id: 'e1', name: 'Existing LLC' } as LegalEntity

const sim = (over: Partial<SimilarEntity>): SimilarEntity => ({
  id: 's1',
  name: 'Similar LLC',
  country_code: 'UZ',
  registration_number: '123',
  similarity: 0.5,
  ...over,
})

describe('dedupVerdict', () => {
  it('exact reg-number match blocks; fuzzy matches never block', () => {
    expect(dedupVerdict(entity, []).blocked).toBe(true)
    expect(dedupVerdict(entity, []).blockingEntity).toBe(entity)
    expect(dedupVerdict(null, [sim({})]).blocked).toBe(false)
    expect(dedupVerdict(undefined, undefined)).toEqual({
      blocked: false,
      blockingEntity: null,
      suggestions: [],
    })
  })

  it('suggestions are sorted by similarity, best first', () => {
    const verdict = dedupVerdict(null, [
      sim({ id: 'a', similarity: 0.42 }),
      sim({ id: 'b', similarity: 0.9 }),
    ])
    expect(verdict.suggestions.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('lookup thresholds are sane', () => {
    expect(REG_MIN_CHARS).toBeGreaterThanOrEqual(1)
    expect(NAME_MIN_CHARS).toBeGreaterThanOrEqual(REG_MIN_CHARS)
  })
})

describe('migration 0015 dedup contract', () => {
  it('pg_trgm function uses the same threshold and limit', () => {
    expect(MIGRATION).toContain('create extension if not exists pg_trgm')
    expect(MIGRATION).toContain(`> ${SIMILARITY_THRESHOLD}`)
    expect(MIGRATION).toContain(`limit ${SIMILARITY_LIMIT}`)
    expect(MIGRATION).toContain('extensions.similarity(e.name, p_name)')
  })

  it('the blocking rule is enforced by the DB, not only the UI', () => {
    expect(MIGRATION).toContain('create unique index legal_entities_reg_uq')
  })
})
