import { describe, expect, it } from 'vitest'
import { classifySignInError, signInErrorKey } from './signInErrors'

describe('classifySignInError', () => {
  it('a wrong password is invalid credentials, by code or by message', () => {
    expect(classifySignInError({ code: 'invalid_credentials', status: 400 }).kind).toBe('invalidCredentials')
    expect(classifySignInError({ message: 'Invalid login credentials' }).kind).toBe('invalidCredentials')
  })

  it('a throttled IP is rate-limited, by code, by status or by message', () => {
    expect(classifySignInError({ code: 'over_request_rate_limit', status: 429 }).kind).toBe('rateLimited')
    expect(classifySignInError({ status: 429, message: 'x' }).kind).toBe('rateLimited')
    expect(classifySignInError({ message: 'Request rate limit reached' }).kind).toBe('rateLimited')
  })

  it('the lockout hook message is recognised by its machine token, with the minutes', () => {
    const f = classifySignInError({
      status: 403,
      message: 'account_locked: too many failed sign-in attempts; try again in 30 minute(s) or contact your administrator',
    })
    expect(f).toEqual({ kind: 'locked', minutes: 30 })
    expect(signInErrorKey(f)).toBe('auth.errors.locked')
    // no minutes in the MFA variant
    expect(classifySignInError({ message: 'account_locked: too many failed verification codes; try again later' }))
      .toEqual({ kind: 'locked', minutes: undefined })
  })

  it('captcha, banned and unconfirmed are named, not generic', () => {
    expect(classifySignInError({ code: 'captcha_failed' }).kind).toBe('captcha')
    expect(classifySignInError({ code: 'user_banned' }).kind).toBe('userBanned')
    expect(classifySignInError({ code: 'email_not_confirmed' }).kind).toBe('emailNotConfirmed')
  })

  it('anything else is generic and never the raw server string', () => {
    expect(classifySignInError({ message: 'unexpected upstream failure', status: 500 }).kind).toBe('generic')
    expect(classifySignInError({}).kind).toBe('generic')
  })
})

describe('no answer at all (0064)', () => {
  it('is a network failure, not a wrong password', () => {
    expect(classifySignInError({ name: 'AuthRetryableFetchError', status: 0, message: '{}' }).kind).toBe('network')
    expect(classifySignInError({ message: 'Failed to fetch' }).kind).toBe('network')
    expect(classifySignInError({ message: 'Load failed' }).kind).toBe('network')
    // a real wrong password stays one
    expect(classifySignInError({ code: 'invalid_credentials', status: 400 }).kind).toBe('invalidCredentials')
  })
})
