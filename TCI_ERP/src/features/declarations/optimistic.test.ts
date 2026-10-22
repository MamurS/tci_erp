import { describe, expect, it } from 'vitest'

import MIGRATION_0026 from '../../../supabase/migrations/0026_declarations.sql?raw'
import MIGRATION_0043 from '../../../supabase/migrations/0043_security_closure.sql?raw'
import { classifyLine } from './coverage'
import { retotalled, savedLine, transitioned } from './optimistic'
import type { LineShape } from './optimistic'

const declaration = {
  id: 'd',
  status: 'submitted' as const,
  submitted_at: '2026-10-01T00:00:00Z',
  accepted_at: null,
  disputed_at: null,
  dispute_note: null,
  total_insurable_turnover: 1000,
  line_count: 2,
}

describe('declaration transitions', () => {
  it('stamps the moment of the status it moves to, and nothing else', () => {
    expect(transitioned(declaration, 'accepted', 'T')).toMatchObject({ status: 'accepted', accepted_at: 'T', submitted_at: '2026-10-01T00:00:00Z' })
    expect(transitioned(declaration, 'disputed', 'T', 'fix line 2')).toMatchObject({
      status: 'disputed',
      disputed_at: 'T',
      dispute_note: 'fix line 2',
    })
    expect(transitioned({ ...declaration, status: 'draft', submitted_at: null }, 'submitted', 'T').submitted_at).toBe('T')
  })

  it('mirrors what the SQL functions write', () => {
    const sql = MIGRATION_0026 + MIGRATION_0043
    expect(sql).toContain("set status = 'disputed',")
    expect(sql).toContain('disputed_at = now(),')
    expect(sql).toContain('dispute_note = p_note,')
  })
})

describe('declaration lines', () => {
  const line = (entity: string, turnover: number): LineShape => ({
    id: `l-${entity}`,
    declaration_id: 'd',
    entity_id: entity,
    entity_name: entity.toUpperCase(),
    insurable_turnover: turnover,
    overdue_amount: null,
    line_note: null,
    coverage_basis: 'limit',
    covered_amount: turnover,
    uncovered_excess: 0,
    is_frozen: false,
  })
  const lines = [line('b', 100), line('d', 200)]

  it('saving for a buyer already declared replaces that line (one per buyer)', () => {
    const next = savedLine(lines, { declaration_id: 'd', entity_id: 'b', turnover: 150 }, null)
    expect(next.map((l) => [l.entity_id, l.insurable_turnover])).toEqual([
      ['b', 150],
      ['d', 200],
    ])
  })

  it('a new buyer is shown with the split classifyLine gives it, in name order', () => {
    const split = classifyLine(false, 700, 500)
    const next = savedLine(lines, { declaration_id: 'd', entity_id: 'c', turnover: 700 }, { entity_name: 'C', split, id: 'pending-1' })
    expect(next.map((l) => l.entity_id)).toEqual(['b', 'c', 'd'])
    expect(next[1]).toMatchObject({ coverage_basis: 'uncovered_excess', covered_amount: 500, uncovered_excess: 200 })
  })

  it('a new buyer without a known split is not painted (its cover is not certain)', () => {
    expect(savedLine(lines, { declaration_id: 'd', entity_id: 'c', turnover: 1 }, null)).toEqual(lines)
  })

  it('the total and line count follow the change', () => {
    expect(retotalled(declaration, 100, 150)).toMatchObject({ total_insurable_turnover: 1050, line_count: 2 })
    expect(retotalled(declaration, null, 300)).toMatchObject({ total_insurable_turnover: 1300, line_count: 3 })
    expect(retotalled(declaration, 200, null)).toMatchObject({ total_insurable_turnover: 800, line_count: 1 })
    expect(retotalled({ total_insurable_turnover: 10 }, null, 5)).toEqual({ total_insurable_turnover: 15, line_count: undefined })
  })
})
