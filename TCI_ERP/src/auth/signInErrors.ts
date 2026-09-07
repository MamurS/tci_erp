/** What a failed sign-in means to the person at the keyboard — pure module.
 *
 * Supabase Auth answers a wrong password with `invalid_credentials`, a
 * throttled IP with 429 `over_request_rate_limit`, a rejected CAPTCHA with
 * `captcha_failed`, a banned user with `user_banned`, and — when the
 * password-verification hook of migration 0044 refuses — a message that
 * starts with the machine token `account_locked:`. Before Phase A2 every
 * one of those except the first fell into "Sign-in failed. Please try
 * again.", which is the symptom the external reviewer saw: ten wrong
 * passwords, no visible reaction. The mapping below is what the login page
 * renders; `auth.errors.*` carries the wording in three languages.
 */

export type SignInErrorKind =
  | 'invalidCredentials'
  | 'rateLimited'
  | 'locked'
  | 'captcha'
  | 'emailNotConfirmed'
  | 'userBanned'
  | 'generic'

export interface SignInFailure {
  kind: SignInErrorKind
  /** Minutes until the lockout ends, when the server said so. */
  minutes?: number
}

export interface RawAuthError {
  /** GoTrue's `error_code` (supabase-js `AuthError.code`). */
  code?: string | null
  /** HTTP status (supabase-js `AuthApiError.status`). */
  status?: number | null
  message?: string | null
}

/** The machine token the lockout hook puts in front of its message. */
export const LOCKED_MESSAGE_PREFIX = 'account_locked'

export function classifySignInError(error: RawAuthError): SignInFailure {
  const message = (error.message ?? '').trim()
  const code = (error.code ?? '').toLowerCase()
  const lower = message.toLowerCase()

  if (lower.startsWith(LOCKED_MESSAGE_PREFIX)) {
    const m = /in (\d+) minute/i.exec(message)
    return { kind: 'locked', minutes: m ? Number(m[1]) : undefined }
  }
  if (code === 'over_request_rate_limit' || error.status === 429 || lower.includes('rate limit')) {
    return { kind: 'rateLimited' }
  }
  if (code === 'captcha_failed' || lower.includes('captcha')) return { kind: 'captcha' }
  if (code === 'user_banned' || lower.includes('banned')) return { kind: 'userBanned' }
  if (code === 'email_not_confirmed' || lower.includes('not confirmed')) {
    return { kind: 'emailNotConfirmed' }
  }
  if (code === 'invalid_credentials' || lower.includes('invalid login credentials')) {
    return { kind: 'invalidCredentials' }
  }
  // A hook may reject with a message of its own; GoTrue relays it verbatim.
  // Anything we cannot classify is shown as a generic failure, never raw.
  return { kind: 'generic' }
}

/** The i18n key for a failure. `minutes` is passed as interpolation. */
export function signInErrorKey(failure: SignInFailure): string {
  return `auth.errors.${failure.kind}`
}
