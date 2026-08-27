/** Password rules for the self-service change screen. These are OUR rules,
 * stricter than Supabase's own minimum — the temporary passwords the
 * service issues are long, so a human-chosen replacement needs a floor. */

import { describe, expect, it } from 'vitest'

import { MIN_PASSWORD_LENGTH, checkPassword, passwordStrength } from './password'

const EMAIL = 'mamur@mosaic.uz'
const GOOD = 'Zarafshon2026river'

describe('checkPassword', () => {
  it('accepts a long password with letters and digits that matches', () => {
    expect(checkPassword(GOOD, GOOD, EMAIL)).toEqual({ problems: [], valid: true })
  })

  it('enforces the minimum length', () => {
    const short = 'Ab1' + 'x'.repeat(MIN_PASSWORD_LENGTH - 5)
    expect(short.length).toBeLessThan(MIN_PASSWORD_LENGTH)
    const verdict = checkPassword(short, short, EMAIL)
    expect(verdict.problems).toContain('tooShort')
    expect(verdict.valid).toBe(false)
    // ...and lets the boundary through
    const exact = 'Ab1' + 'x'.repeat(MIN_PASSWORD_LENGTH - 3)
    expect(exact).toHaveLength(MIN_PASSWORD_LENGTH)
    expect(checkPassword(exact, exact, EMAIL).valid).toBe(true)
  })

  it('rejects the email address itself', () => {
    const asPassword = 'mamur@mosaic.uz'
    expect(checkPassword(asPassword, asPassword, EMAIL).problems).toContain('sameAsEmail')
  })

  it('also rejects just the local part, which is the real temptation', () => {
    // «mamur» for mamur@mosaic.uz passes a literal "not equal to the email"
    // reading, and is exactly what the rule exists to stop.
    const local = 'mamur'.padEnd(MIN_PASSWORD_LENGTH, 'mamur').slice(0, MIN_PASSWORD_LENGTH)
    expect(checkPassword('mamur', 'mamur', EMAIL).problems).toContain('sameAsEmail')
    expect(local.length).toBe(MIN_PASSWORD_LENGTH)
  })

  it('compares the address case- and space-insensitively', () => {
    expect(checkPassword('  MAMUR@MOSAIC.UZ ', '  MAMUR@MOSAIC.UZ ', EMAIL).problems).toContain(
      'sameAsEmail',
    )
  })

  it('requires a letter and a digit', () => {
    expect(checkPassword('123456789012345', '123456789012345', EMAIL).problems).toContain('noLetter')
    expect(checkPassword('abcdefghijklmno', 'abcdefghijklmno', EMAIL).problems).toContain('noDigit')
  })

  it('accepts non-Latin letters', () => {
    // The UI is trilingual; «п» must count as a letter.
    const cyrillic = 'Зарафшон2026река'
    expect(checkPassword(cyrillic, cyrillic, EMAIL).problems).not.toContain('noLetter')
  })

  it('requires the confirmation to match', () => {
    expect(checkPassword(GOOD, GOOD + 'x', EMAIL).problems).toContain('mismatch')
    expect(checkPassword(GOOD, '', EMAIL).valid).toBe(false)
  })

  it('rejects reusing the current password when one is supplied', () => {
    expect(checkPassword(GOOD, GOOD, EMAIL, GOOD).problems).toContain('sameAsCurrent')
    expect(checkPassword(GOOD, GOOD, EMAIL, 'something-else').valid).toBe(true)
  })

  it('reports every problem at once, not just the first', () => {
    const verdict = checkPassword('abc', 'xyz', EMAIL)
    expect(verdict.problems).toEqual(
      expect.arrayContaining(['tooShort', 'noDigit', 'mismatch']),
    )
  })

  it('an empty password is invalid but not reported as matching the email', () => {
    const verdict = checkPassword('', '', EMAIL)
    expect(verdict.valid).toBe(false)
    expect(verdict.problems).not.toContain('sameAsEmail')
  })
})

describe('passwordStrength (display only — never a gate)', () => {
  it('anything under the minimum is weak', () => {
    expect(passwordStrength('Ab1!')).toBe('weak')
  })

  it('long and varied is strong', () => {
    expect(passwordStrength('Zarafshon2026river!')).toBe('strong')
  })

  it('long but single-class is not strong', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaaaaaa')).toBe('fair')
  })

  it('at the minimum length with three classes is fair, not strong', () => {
    expect(passwordStrength('Abcdefghij12')).toBe('fair')
  })
})
