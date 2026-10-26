/** Contract test: the rating proposal mirror (proposals.ts) against migration
 * 0073 — statuses, actions, which answers need a reason, the grade pattern,
 * and every refusal the functions raise mapped to a readable message. */

import { describe, expect, it } from 'vitest'

import M73 from '../../../../supabase/migrations/0073_rating_proposals.sql?raw'
import M78 from '../../../../supabase/migrations/0078_rating_self_approval.sql?raw'
import en from '../../../i18n/locales/en.json'
import ru from '../../../i18n/locales/ru.json'
import uz from '../../../i18n/locales/uz.json'
import { OPERATIONS_REFUSALS, refusalKey } from '../../../lib/refusals'
import {
  GRADE_PATTERN,
  mayForward,
  normaliseGrade,
  outcomeGrade,
  proposalTone,
  PROPOSAL_ACTIONS,
  PROPOSAL_STATUSES,
  SUBMIT_ROUTES,
  proposalActionNeedsComment,
} from './proposals'

function leaf(dict: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict)
}

describe('rating proposals mirror 0073', () => {
  it('statuses are the step check, in order', () => {
    expect(M73).toContain(
      "check (status in ('pending', 'approved', 'modified', 'returned', 'rejected', 'forwarded', 'withdrawn'))",
    )
    expect([...PROPOSAL_STATUSES]).toEqual(['pending', 'approved', 'modified', 'returned', 'rejected', 'forwarded', 'withdrawn'])
  })

  it('actions are the ones resolve_rating_proposal accepts', () => {
    expect(M73).toContain(
      "if p_action is null or p_action not in ('approve', 'approve_modified', 'return', 'reject', 'forward') then",
    )
    expect([...PROPOSAL_ACTIONS]).toEqual(['approve', 'approve_modified', 'return', 'reject', 'forward'])
  })

  it('another grade, a return and a rejection need a reason', () => {
    expect(M73).toContain("if p_action in ('approve_modified', 'return', 'reject') and v_comment is null then")
    expect(PROPOSAL_ACTIONS.filter(proposalActionNeedsComment)).toEqual(['approve_modified', 'return', 'reject'])
  })

  it('the grade pattern is the database’s', () => {
    expect(M73).toContain("select case when upper(btrim(coalesce(p_grade, ''))) ~ '^[A-D][0-9]{0,2}$'")
    expect(GRADE_PATTERN.source).toBe('^[A-D][0-9]{0,2}$')
    expect(normaliseGrade(' b1 ')).toBe('B1')
    expect(normaliseGrade('E5')).toBeNull()
    expect(normaliseGrade('A123')).toBeNull()
  })

  it('the committee is the top: nothing forwards from it', () => {
    expect(M73).toContain("if v_step.route = 'level' and coalesce(v_level.is_committee, false) then")
    expect(mayForward({ route: 'level', is_committee: true })).toBe(false)
    expect(mayForward({ route: 'level', is_committee: false })).toBe(true)
    expect(mayForward({ route: 'colleague', is_committee: false })).toBe(true)
  })

  it('the outcome grade is the answerer’s when modified, the proposal’s when approved', () => {
    expect(outcomeGrade({ status: 'modified', grade: 'B1', resolved_grade: 'B2' })).toBe('B2')
    expect(outcomeGrade({ status: 'approved', grade: 'B1', resolved_grade: 'B1' })).toBe('B1')
    expect(outcomeGrade({ status: 'returned', grade: 'B1', resolved_grade: null })).toBeNull()
  })

  it('every refusal 0073 raises reads as a message in three languages', () => {
    const raised = [...M73.matchAll(/raise exception '([a-z_]+):/g)].map((m) => m[1]!)
    const mapped = OPERATIONS_REFUSALS.map((r) => r.fragment)
    for (const code of new Set(raised)) {
      expect(mapped.some((f) => code.includes(f) || f.includes(code)), code).toBe(true)
      const key = refusalKey({ message: `${code}: x` })
      for (const locale of [en, ru, uz]) expect(typeof leaf(locale, key), `${code} → ${key}`).toBe('string')
    }
  })
})

describe('submit routes (mirror of tci.submit_rating, 0078)', () => {
  it('offers exactly the routes the function accepts', () => {
    expect(M78).toContain("if v_route not in ('self', 'colleague', 'level') then")
    expect([...SUBMIT_ROUTES]).toEqual(['self', 'colleague', 'level'])
  })
  it('a self-approved grade is a history row of its own, shown as approved', () => {
    expect(M78).toContain("''status'', ''self_approved''")
    expect(proposalTone('self_approved')).toBe('pos')
    expect(outcomeGrade({ status: 'self_approved', grade: 'B1', resolved_grade: 'B1' })).toBe('B1')
  })
})
