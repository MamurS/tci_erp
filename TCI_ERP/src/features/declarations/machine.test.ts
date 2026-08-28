import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0026_declarations.sql?raw'
import { canCorrect, canTransition, isEditable, transitionsOffered } from './machine'

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
