import { describe, expect, it } from 'vitest'
import {
  MFA_ENROL_PATH_PORTAL,
  MFA_ENROL_PATH_STAFF,
  MFA_VERIFY_PATH,
  decideMfaRoute,
  parseAuthStatus,
} from './mfaGate'
import type { AuthStatus } from './mfaGate'

const base: AuthStatus = {
  aal: 'aal1',
  rotationPending: false,
  mfaEnrolled: false,
  mfaRequired: false,
  mfaSatisfied: true,
  mfaStaffEnforcedFrom: null,
  lockedUntil: null,
}

describe('decideMfaRoute', () => {
  it('passes when the database says the policy is satisfied', () => {
    expect(decideMfaRoute(base, '/limits', false)).toEqual({ kind: 'pass' })
    expect(decideMfaRoute(null, '/limits', false)).toEqual({ kind: 'pass' })
  })

  it('an enrolled user at aal1 steps up, except on the verify page itself', () => {
    const s = { ...base, mfaEnrolled: true, mfaSatisfied: false }
    expect(decideMfaRoute(s, '/limits', false)).toEqual({ kind: 'stepUp', to: MFA_VERIFY_PATH })
    expect(decideMfaRoute(s, MFA_VERIFY_PATH, false)).toEqual({ kind: 'pass' })
    // a client too - MFA is optional for them, but once enrolled it is a step-up
    expect(decideMfaRoute(s, '/portal', true)).toEqual({ kind: 'stepUp', to: MFA_VERIFY_PATH })
  })

  it('a required-but-unenrolled staff user is sent to enrol, on their own account page', () => {
    const s = { ...base, mfaRequired: true, mfaSatisfied: false }
    expect(decideMfaRoute(s, '/limits', false)).toEqual({ kind: 'enrol', to: MFA_ENROL_PATH_STAFF })
    expect(decideMfaRoute(s, MFA_ENROL_PATH_STAFF, false)).toEqual({ kind: 'pass' })
    expect(decideMfaRoute(s, '/portal', true)).toEqual({ kind: 'enrol', to: MFA_ENROL_PATH_PORTAL })
  })

  it('enrolled at aal2 passes even when required', () => {
    const s = { ...base, aal: 'aal2' as const, mfaEnrolled: true, mfaRequired: true }
    expect(decideMfaRoute(s, '/admin', false)).toEqual({ kind: 'pass' })
  })
})

describe('parseAuthStatus', () => {
  it('reads tci.my_auth_status() and falls to the safe side on anything missing', () => {
    expect(parseAuthStatus({ aal: 'aal2', mfa_enrolled: true, mfa_required: true, mfa_satisfied: true,
      rotation_pending: false, mfa_staff_enforced_from: '2026-10-01', locked_until: null }))
      .toEqual({ aal: 'aal2', rotationPending: false, mfaEnrolled: true, mfaRequired: true,
        mfaSatisfied: true, mfaStaffEnforcedFrom: '2026-10-01', lockedUntil: null })
    expect(parseAuthStatus(null)).toEqual({ ...base, mfaSatisfied: false })
    expect(parseAuthStatus({ aal: 'aal3' }).aal).toBe('aal1')
  })
})
