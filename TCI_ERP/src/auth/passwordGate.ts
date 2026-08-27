/** The forced-password-change gate as a pure rule.
 *
 * RequirePasswordChange is a three-line wrapper over this so the decision
 * itself is testable without a DOM: which paths a user holding a temporary
 * password may still reach.
 */

/** The one route reachable while a rotation is outstanding. */
export const PASSWORD_CHANGE_PATH = '/change-password'

export function shouldForcePasswordChange(
  mustChangePassword: boolean,
  pathname: string,
): boolean {
  if (!mustChangePassword) return false
  // Already there: redirecting again would loop.
  return pathname !== PASSWORD_CHANGE_PATH
}
