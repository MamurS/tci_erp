/** The role split is a security boundary as well as a routing one, so it is
 * asserted rather than assumed. */

import { describe, expect, it } from 'vitest'

import {
  PORTAL_NAV_ITEMS,
  isPortalPath,
  isPortalUser,
  landingPath,
  redirectFor,
} from './navigation'
import type { UserRole } from '../../lib/roles'

describe('who is a portal user', () => {
  it('is someone whose only role is client', () => {
    expect(isPortalUser(['client'])).toBe(true)
  })

  it('is NOT someone who also holds a staff role', () => {
    // The owner's account holds every role including client and must land
    // in the staff app.
    expect(isPortalUser(['admin', 'sales', 'client'])).toBe(false)
    expect(isPortalUser(['client', 'information_manager'])).toBe(false)
  })

  it('is not staff', () => {
    for (const role of [
      'admin',
      'sales',
      'commercial_underwriter',
      'credit_underwriter',
      'claims',
      'information_manager',
    ] as const) {
      expect(isPortalUser([role])).toBe(false)
    }
  })

  it('is not a user with no roles at all', () => {
    expect(isPortalUser([])).toBe(false)
  })
})

describe('landing', () => {
  it('sends a client to the portal and staff to the dashboard', () => {
    expect(landingPath(['client'])).toBe('/portal')
    expect(landingPath(['sales'])).toBe('/')
    expect(landingPath(['admin', 'client'])).toBe('/')
  })
})

describe('redirects', () => {
  const client: UserRole[] = ['client']
  const staff: UserRole[] = ['sales']

  it('keeps a client out of every staff route', () => {
    for (const path of [
      '/',
      '/entities',
      '/entities/abc',
      '/agenda',
      '/limits',
      '/limits/req-1',
      '/requests',
      '/policies',
      '/admin',
      '/declarations',
      '/claims',
    ]) {
      expect(redirectFor(client, path)).toBe('/portal')
    }
  })

  it('leaves a client alone inside the portal', () => {
    for (const item of PORTAL_NAV_ITEMS) {
      expect(redirectFor(client, item.path)).toBeNull()
    }
    expect(redirectFor(client, '/portal/limits/buyer-1')).toBeNull()
  })

  it('lets a client reach the shared password change', () => {
    // A provisioned client is forced here on first sign-in; sending them to
    // /portal instead would be a redirect loop.
    expect(redirectFor(client, '/change-password')).toBeNull()
  })

  it('sends staff out of the portal', () => {
    // The portal would render perfectly and be empty for them, which looks
    // like data loss.
    expect(redirectFor(staff, '/portal')).toBe('/')
    expect(redirectFor(staff, '/portal/limits')).toBe('/')
  })

  it('leaves staff alone in the staff app', () => {
    expect(redirectFor(staff, '/')).toBeNull()
    expect(redirectFor(staff, '/limits')).toBeNull()
  })

  it('says nothing about a user with no roles', () => {
    expect(redirectFor([], '/')).toBeNull()
    expect(redirectFor([], '/portal')).toBeNull()
  })

  it('does not mistake a lookalike path for the portal', () => {
    expect(isPortalPath('/portalish')).toBe(false)
    expect(redirectFor(client, '/portalish')).toBe('/portal')
  })
})
