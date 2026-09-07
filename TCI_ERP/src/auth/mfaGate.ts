/** The MFA gate as a pure rule — mirror of tci.mfa_satisfied() (0044).
 *
 * The database is what enforces: while the policy is unmet, has_role() and
 * is_staff() return false and every screen is empty. This rule only decides
 * WHERE to send the person so they can fix it, the way passwordGate does for
 * the temporary password.
 */

export interface AuthStatus {
  /** Assurance level of the current JWT: aal2 once a second factor was verified. */
  aal: 'aal1' | 'aal2'
  rotationPending: boolean
  /** A verified TOTP factor exists for this user. */
  mfaEnrolled: boolean
  /** The policy makes a second factor mandatory for this user's roles today. */
  mfaRequired: boolean
  /** tci.mfa_satisfied(): the gates are open. */
  mfaSatisfied: boolean
  /** From when non-admin staff must have a factor; null while not enforced. */
  mfaStaffEnforcedFrom: string | null
  /** A standing lockout, when the server says so. */
  lockedUntil: string | null
}

export const MFA_VERIFY_PATH = '/mfa/verify'
/** Where a factor is enrolled. Staff: the account page; clients: their portal account. */
export const MFA_ENROL_PATH_STAFF = '/account'
export const MFA_ENROL_PATH_PORTAL = '/portal/account'

export type MfaDecision =
  | { kind: 'pass' }
  | { kind: 'stepUp'; to: string }
  | { kind: 'enrol'; to: string }

/** Which way the session has to go before it may see anything.
 *
 * - enrolled but at aal1 → verify the code (step up);
 * - required by policy but not enrolled → enrol;
 * - otherwise pass.
 *
 * The verify page and the enrolment pages are reachable while the gate is
 * closed, or nobody could ever open it.
 */
export function decideMfaRoute(
  status: AuthStatus | null,
  pathname: string,
  isPortalUser: boolean,
): MfaDecision {
  if (!status) return { kind: 'pass' }
  if (status.mfaSatisfied) return { kind: 'pass' }
  if (status.mfaEnrolled && status.aal !== 'aal2') {
    return pathname === MFA_VERIFY_PATH ? { kind: 'pass' } : { kind: 'stepUp', to: MFA_VERIFY_PATH }
  }
  if (status.mfaRequired && !status.mfaEnrolled) {
    const to = isPortalUser ? MFA_ENROL_PATH_PORTAL : MFA_ENROL_PATH_STAFF
    return pathname === to ? { kind: 'pass' } : { kind: 'enrol', to }
  }
  return { kind: 'pass' }
}

/** Parses tci.my_auth_status() output; any missing field falls to the safe side. */
export function parseAuthStatus(raw: unknown): AuthStatus {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    aal: r.aal === 'aal2' ? 'aal2' : 'aal1',
    rotationPending: r.rotation_pending === true,
    mfaEnrolled: r.mfa_enrolled === true,
    mfaRequired: r.mfa_required === true,
    mfaSatisfied: r.mfa_satisfied === true,
    mfaStaffEnforcedFrom: typeof r.mfa_staff_enforced_from === 'string' ? r.mfa_staff_enforced_from : null,
    lockedUntil: typeof r.locked_until === 'string' ? r.locked_until : null,
  }
}
