import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0026_declarations.sql?raw'
import M65 from '../../../supabase/migrations/0065_admin_technical_only.sql?raw'
import { canCorrect, canTransition, isEditable, mayMoveAs, transitionsOffered } from './machine'

describe('the declaration status machine', () => {
  it('walks the happy path', () => {
    expect(canTransition('draft', 'submitted')).toBe(true)
    expect(canTransition('submitted', 'accepted')).toBe(true)
  })

  it('lets a disputed declaration be answered and resubmitted', () => {
    expect(canTransition('submitted', 'disputed')).toBe(true)
    expect(canTransition('disputed', 'submitted')).toBe(true)
  })

  it('refuses to reopen an accepted declaration', () => {
    expect(canTransition('accepted', 'submitted')).toBe(false)
    expect(canTransition('accepted', 'disputed')).toBe(false)
  })

  it('leaves a corrected declaration terminal', () => {
    expect(transitionsOffered('corrected')).toEqual([])
  })

  it('never offers `corrected` as a bare transition', () => {
    // It only happens through tci.correct_declaration, which creates the
    // replacement in the same breath; offering it alone would strand the
    // period with no live declaration.
    expect(transitionsOffered('accepted')).toEqual([])
    expect(canCorrect('accepted')).toBe(true)
    expect(canCorrect('draft')).toBe(false)
  })

  it('allows editing only while a draft or disputed', () => {
    expect(isEditable('draft')).toBe(true)
    expect(isEditable('disputed')).toBe(true)
    expect(isEditable('submitted')).toBe(false)
    expect(isEditable('accepted')).toBe(false)
  })
})

describe('contract with migration 0026', () => {
  it('mirrors the SQL transition table exactly', () => {
    for (const pair of [
      "('draft',     'submitted')",
      "('submitted', 'accepted')",
      "('submitted', 'disputed')",
      "('disputed',  'submitted')",
      "('accepted',  'corrected')",
      "('disputed',  'corrected')",
    ]) {
      expect(MIGRATION).toContain(pair)
    }
  })

  it('still refuses to submit a declaration with no lines', () => {
    expect(MIGRATION).toContain('a declaration cannot be submitted with no lines')
  })
})

describe('who moves a declaration on the staff side (0065)', () => {
  it('accepting is commercial underwriting\'s; disputing and the rest sales\' too; never admin', () => {
    expect(M65).toContain("  if not tci.has_role('commercial_underwriter') then\n    raise exception 'only commercial underwriting may accept a declaration'")
    expect(M65).toContain("if not tci.has_role('commercial_underwriter', 'sales') then")
    expect(mayMoveAs('accepted', ['commercial_underwriter'])).toBe(true)
    expect(mayMoveAs('accepted', ['sales'])).toBe(false)
    for (const to of ['submitted', 'disputed', 'corrected'] as const) {
      expect(mayMoveAs(to, ['sales'])).toBe(true)
      expect(mayMoveAs(to, ['commercial_underwriter'])).toBe(true)
    }
    for (const to of ['submitted', 'accepted', 'disputed', 'corrected'] as const) {
      expect(mayMoveAs(to, ['admin'])).toBe(false)
      expect(mayMoveAs(to, ['claims'])).toBe(false)
    }
  })
})
