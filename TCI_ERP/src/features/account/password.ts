/**
 * Password rules for the self-service change screen — pure module.
 *
 * These are OUR rules, checked before the call; Supabase enforces only its
 * own minimum length. Deliberately stricter than the temporary passwords the
 * service issues are long: a human-chosen password needs the floor raised.
 */

export const MIN_PASSWORD_LENGTH = 12

export type PasswordProblem =
  | 'tooShort'
  | 'sameAsEmail'
  | 'noLetter'
  | 'noDigit'
  | 'mismatch'
  | 'sameAsCurrent'

export interface PasswordVerdict {
  /** Every rule the candidate breaks, in the order they are shown. */
  problems: PasswordProblem[]
  valid: boolean
}

/** The local part of an address, lowercased — «mamur@x.uz» -> «mamur». */
function localPart(email: string): string {
  return email.trim().toLowerCase().split('@')[0] ?? ''
}

export function checkPassword(
  password: string,
  confirmation: string,
  email: string,
  currentPassword?: string,
): PasswordVerdict {
  const problems: PasswordProblem[] = []
  const value = password ?? ''

  if (value.length < MIN_PASSWORD_LENGTH) problems.push('tooShort')

  // "Not equal to the email" read literally would let «mamur» through for
  // «mamur@mosaic.uz», which is the case the rule exists to stop.
  const normalised = value.trim().toLowerCase()
  const address = (email ?? '').trim().toLowerCase()
  if (normalised && (normalised === address || normalised === localPart(address))) {
    problems.push('sameAsEmail')
  }

  if (!/\p{L}/u.test(value)) problems.push('noLetter')
  if (!/\d/.test(value)) problems.push('noDigit')

  if (currentPassword && value && value === currentPassword) problems.push('sameAsCurrent')
  if (confirmation !== undefined && value !== confirmation) problems.push('mismatch')

  return { problems, valid: problems.length === 0 }
}

/** Coarse strength for the meter: never used to allow or block, only to
 * show. `checkPassword` is the gate. */
export type PasswordStrength = 'weak' | 'fair' | 'strong'

export function passwordStrength(password: string): PasswordStrength {
  const value = password ?? ''
  if (value.length < MIN_PASSWORD_LENGTH) return 'weak'
  let classes = 0
  if (/[a-z]/.test(value)) classes += 1
  if (/[A-Z]/.test(value)) classes += 1
  if (/\d/.test(value)) classes += 1
  if (/[^\p{L}\d]/u.test(value)) classes += 1
  if (value.length >= 16 && classes >= 3) return 'strong'
  if (classes >= 3) return 'fair'
  return value.length >= 16 ? 'fair' : 'weak'
}
