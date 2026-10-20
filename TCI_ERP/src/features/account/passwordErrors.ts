/** Readable messages for a refused password change.
 *
 * Two refusals are deterministic and get named: GoTrue's own
 * (`same_password`, `weak_password`) when the new password is set, and
 * tci.complete_password_change's `password_unchanged` (migration 0048) when
 * the rotation is recorded while the password is still the temporary one.
 * Anything else is a genuinely unknown failure.
 */

/** The marker tci.complete_password_change raises with (0048). */
export const PASSWORD_UNCHANGED = 'password_unchanged'

export type PasswordErrorKey =
  | 'account.errors.samePassword'
  | 'account.errors.weakPassword'
  | 'account.errors.changeFailed'

interface ErrorLike {
  code?: unknown
  message?: unknown
}

/** For the error returned by supabase.auth.updateUser. */
export function updateUserErrorKey(error: ErrorLike): PasswordErrorKey {
  if (error.code === 'same_password') return 'account.errors.samePassword'
  if (error.code === 'weak_password') return 'account.errors.weakPassword'
  return 'account.errors.changeFailed'
}

/** For the error returned by rpc('complete_password_change'): a key when the
 * database refused because the password did not change, otherwise null (the
 * password itself did change, so the screen carries on). */
export function rotationErrorKey(error: ErrorLike): PasswordErrorKey | null {
  return typeof error.message === 'string' && error.message.includes(PASSWORD_UNCHANGED)
    ? 'account.errors.samePassword'
    : null
}
