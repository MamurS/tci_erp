import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0048_rotation_and_claim_documents.sql?raw'
import { PASSWORD_UNCHANGED, rotationErrorKey, updateUserErrorKey } from './passwordErrors'

describe('password change errors', () => {
  it('matches the marker complete_password_change raises', () => {
    expect(MIGRATION).toContain(`raise exception '${PASSWORD_UNCHANGED}: the temporary password has not been changed'`)
    expect(MIGRATION).toContain("using errcode = 'P0001'")
  })

  it('names the deterministic refusals', () => {
    expect(updateUserErrorKey({ code: 'same_password' })).toBe('account.errors.samePassword')
    expect(updateUserErrorKey({ code: 'weak_password' })).toBe('account.errors.weakPassword')
    expect(updateUserErrorKey({ code: 'unexpected_failure', message: 'boom' })).toBe('account.errors.changeFailed')
    expect(rotationErrorKey({ message: 'password_unchanged: the temporary password has not been changed' })).toBe(
      'account.errors.samePassword',
    )
    expect(rotationErrorKey({ message: 'network down' })).toBeNull()
  })
})
