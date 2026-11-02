import { describe, expect, it } from 'vitest'

import WORLDS from '../../../supabase/migrations/0096_demo_worlds.sql?raw'
import SEED from '../../../supabase/migrations/0097_demo_seed.sql?raw'
import {
  DEMO_AREAS,
  DEMO_NAME_PREFIX,
  DEMO_PASSWORD_MIN,
  areaCounts,
  demoPasswordProblem,
  inDemoWorld,
  mayToggleDemo,
  totalRows,
} from './model'

/** The array literal of `tci.demo_world_tables()` in 0096. */
function migrationTables(): string[] {
  const body = WORLDS.slice(WORLDS.indexOf('create function tci.demo_world_tables()'))
  const start = body.indexOf('array[')
  const array = body.slice(start, body.indexOf(']', start))
  return [...array.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
}

describe('demo areas mirror the migration', () => {
  it('group every demo-world table exactly once', () => {
    const grouped = Object.values(DEMO_AREAS).flat()
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual(migrationTables().sort())
    expect(grouped).toHaveLength(67)
  })

  it('name the rules the database enforces', () => {
    expect(WORLDS).toContain("new.name := 'DEMO ' || new.name;")
    expect(DEMO_NAME_PREFIX).toBe('DEMO ')
    expect(WORLDS).toContain(
      'using (is_demo = (select tci.demo_mode())) with check (is_demo = (select tci.demo_mode()))',
    )
    expect(SEED).toContain(
      `if p_password is not null and length(p_password) < ${DEMO_PASSWORD_MIN} then`,
    )
  })
})

describe('counts', () => {
  it('sum per area and in total, missing tables as zero', () => {
    const counts = { tables: { legal_entities: 18, claims: 1, tasks: 75, policies: 6 } }
    expect(areaCounts(counts)).toEqual([
      { area: 'companies', rows: 18 },
      { area: 'credit', rows: 0 },
      { area: 'policies', rows: 6 },
      { area: 'claims', rows: 1 },
      { area: 'agenda', rows: 75 },
    ])
    expect(totalRows(counts)).toBe(100)
    expect(totalRows(null)).toBe(0)
  })
})

describe('the demo password and the switch', () => {
  it('accepts empty or ≥ 12 characters', () => {
    expect(demoPasswordProblem('')).toBeNull()
    expect(demoPasswordProblem('short')).toBe('tooShort')
    expect(demoPasswordProblem('x'.repeat(12))).toBeNull()
  })

  it('keeps a demo account in the demo world', () => {
    expect(inDemoWorld({ isDemoUser: true, demoMode: false })).toBe(true)
    expect(inDemoWorld({ isDemoUser: false, demoMode: true })).toBe(true)
    expect(inDemoWorld({ isDemoUser: false, demoMode: false })).toBe(false)
    expect(inDemoWorld(null)).toBe(false)
    expect(mayToggleDemo({ isDemoUser: true, demoMode: true })).toBe(false)
    expect(mayToggleDemo({ isDemoUser: false, demoMode: true })).toBe(true)
  })
})
