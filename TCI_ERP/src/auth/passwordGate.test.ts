/** The forced-password-change gate: which routes a user still holding a
 * temporary password may reach. */

import { describe, expect, it } from 'vitest'

import { PASSWORD_CHANGE_PATH, shouldForcePasswordChange } from './passwordGate'

const ROUTES = ['/', '/entities', '/entities/abc-1', '/limits/req-1', '/admin', '/requests']

describe('shouldForcePasswordChange', () => {
  it('blocks every application route while a rotation is outstanding', () => {
    for (const path of ROUTES) expect(shouldForcePasswordChange(true, path)).toBe(true)
  })

  it('lets the change page itself through, or the redirect would loop', () => {
    expect(shouldForcePasswordChange(true, PASSWORD_CHANGE_PATH)).toBe(false)
  })

  it('does nothing once the flag is clear', () => {
    for (const path of [...ROUTES, PASSWORD_CHANGE_PATH]) {
      expect(shouldForcePasswordChange(false, path)).toBe(false)
    }
  })

  it('the escape hatch is exactly one path, not a prefix', () => {
    // /change-password-something must not slip past the gate.
    expect(shouldForcePasswordChange(true, `${PASSWORD_CHANGE_PATH}-x`)).toBe(true)
    expect(shouldForcePasswordChange(true, `${PASSWORD_CHANGE_PATH}/sub`)).toBe(true)
  })
})
