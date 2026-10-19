import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0050_policy_wording.sql?raw'
import { WordingError } from './api'
import { WORDING_REFUSALS, wordingErrorKey } from './errors'

describe('wording refusals — contract with 0050', () => {
  it('maps only refusals the migration raises', () => {
    for (const { fragment } of WORDING_REFUSALS) {
      expect(MIGRATION, fragment).toContain(fragment)
    }
  })

  it('names the refusal, then falls back by SQLSTATE', () => {
    expect(wordingErrorKey({ message: 'wording_unknown_placeholders: policy.secret' })).toBe('wording.errors.unknownPlaceholders')
    expect(wordingErrorKey(new WordingError('invalid_template', 'Unclosed tag'))).toBe('wording.errors.invalidTemplate')
    expect(wordingErrorKey({ message: 'nope', code: '42501' })).toBe('common.notPermitted')
  })
})
