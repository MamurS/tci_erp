import { describe, expect, it } from 'vitest'

import { checkEmail, checkRequired, checkUrl } from './validation'

describe('validation', () => {
  it('requires something other than spaces', () => {
    expect(checkRequired('')).toBe('required')
    expect(checkRequired('   ')).toBe('required')
    expect(checkRequired('Acme')).toBeNull()
  })
  it('accepts an empty or well-formed e-mail', () => {
    expect(checkEmail('')).toBeNull()
    expect(checkEmail('cfo@acme.uz')).toBeNull()
    expect(checkEmail('cfo@acme')).toBe('email')
    expect(checkEmail('cfo acme.uz')).toBe('email')
  })
  it('accepts an empty address or one with a host', () => {
    expect(checkUrl('')).toBeNull()
    expect(checkUrl('acme.uz')).toBeNull()
    expect(checkUrl('https://www.acme.uz/about')).toBeNull()
    expect(checkUrl('acme')).toBe('url')
    expect(checkUrl('http://')).toBe('url')
  })
})
