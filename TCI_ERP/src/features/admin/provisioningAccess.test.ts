/** Contract test: provisioningAccess.ts must mirror the authorization
 * matrix the analytics service enforces (app/provisioning_rules.py). The
 * service is the enforcing side; this keeps the UI from offering an action
 * that would come back 403. */

import { describe, expect, it } from 'vitest'

import RULES from '../../../../services/analytics/app/provisioning_rules.py?raw'
import {
  canCreateWithRoles,
  canDisableUser,
  canManageUser,
  canProvision,
  canProvisionAnyRole,
  isClientOnlyProvisioner,
  showClientAccess,
} from './provisioningAccess'
import { USER_ROLES } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'

const CLIENT_PROVISIONERS: UserRole[] = ['sales', 'commercial_underwriter']
const NON_PROVISIONERS: UserRole[] = ['credit_underwriter', 'claims', 'information_manager', 'client']

describe('who may reach a provisioning surface', () => {
  it('admins and the two client provisioners, nobody else', () => {
    expect(canProvision(['admin'])).toBe(true)
    for (const role of CLIENT_PROVISIONERS) expect(canProvision([role])).toBe(true)
    for (const role of NON_PROVISIONERS) expect(canProvision([role])).toBe(false)
    expect(canProvision([])).toBe(false)
  })

  it('only admins choose the role set freely', () => {
    expect(canProvisionAnyRole(['admin'])).toBe(true)
    for (const role of CLIENT_PROVISIONERS) expect(canProvisionAnyRole([role])).toBe(false)
  })

  it('client-only means: can provision, but not anything', () => {
    for (const role of CLIENT_PROVISIONERS) expect(isClientOnlyProvisioner([role])).toBe(true)
    expect(isClientOnlyProvisioner(['admin'])).toBe(false)
    expect(isClientOnlyProvisioner(['claims'])).toBe(false)
  })

  it('a multi-role user gets the union: admin lifts the restriction', () => {
    expect(canProvisionAnyRole(['sales', 'admin'])).toBe(true)
    expect(isClientOnlyProvisioner(['sales', 'admin'])).toBe(false)
  })
})

describe('canCreateWithRoles (mirror of authorize_create)', () => {
  it('an admin may create any role set', () => {
    for (const role of USER_ROLES) expect(canCreateWithRoles(['admin'], [role])).toBe(true)
    expect(canCreateWithRoles(['admin'], ['sales', 'credit_underwriter'])).toBe(true)
  })

  it('sales and commercial may create exactly one client and nothing else', () => {
    for (const caller of CLIENT_PROVISIONERS) {
      expect(canCreateWithRoles([caller], ['client'])).toBe(true)
      expect(canCreateWithRoles([caller], ['sales'])).toBe(false)
      expect(canCreateWithRoles([caller], ['admin'])).toBe(false)
      // client PLUS something else is not "only client"
      expect(canCreateWithRoles([caller], ['client', 'sales'])).toBe(false)
    }
  })

  it('everyone else may create nothing', () => {
    for (const caller of NON_PROVISIONERS) {
      expect(canCreateWithRoles([caller], ['client'])).toBe(false)
    }
  })

  it('an empty role set is never creatable, not even by an admin', () => {
    expect(canCreateWithRoles(['admin'], [])).toBe(false)
  })
})

describe('canManageUser (mirror of authorize_manage)', () => {
  it('an admin may reset anyone', () => {
    expect(canManageUser(['admin'], ['credit_underwriter'])).toBe(true)
    expect(canManageUser(['admin'], [])).toBe(true)
  })

  it('sales and commercial may reset client users only', () => {
    for (const caller of CLIENT_PROVISIONERS) {
      expect(canManageUser([caller], ['client'])).toBe(true)
      expect(canManageUser([caller], ['credit_underwriter'])).toBe(false)
      // A client who also holds staff roles would leak a staff password.
      expect(canManageUser([caller], ['client', 'sales'])).toBe(false)
      // A user with no roles is not a client.
      expect(canManageUser([caller], [])).toBe(false)
    }
  })

  it('a non-provisioner may reset nobody', () => {
    for (const caller of NON_PROVISIONERS) {
      expect(canManageUser([caller], ['client'])).toBe(false)
    }
  })
})

describe('canDisableUser (mirror of authorize_admin_only + self-disable)', () => {
  it('admins only', () => {
    expect(canDisableUser(['admin'], 'u2', 'u1')).toBe(true)
    for (const role of [...CLIENT_PROVISIONERS, ...NON_PROVISIONERS]) {
      expect(canDisableUser([role], 'u2', 'u1')).toBe(false)
    }
  })

  it('never your own account', () => {
    expect(canDisableUser(['admin'], 'u1', 'u1')).toBe(false)
  })

  it('an unresolved session is not treated as a match', () => {
    expect(canDisableUser(['admin'], 'u1', undefined)).toBe(true)
  })
})

describe('showClientAccess (the company-card section)', () => {
  it('needs both a provisioning role and a company worth a portal login', () => {
    const yes = { isPolicyholder: true, hasOwnSubmission: false }
    expect(showClientAccess(['sales'], yes)).toBe(true)
    expect(showClientAccess(['admin'], yes)).toBe(true)
    expect(showClientAccess(['claims'], yes)).toBe(false)
    expect(showClientAccess(['credit_underwriter'], yes)).toBe(false)
  })

  it('an applicant with a submission qualifies before it becomes a policyholder', () => {
    expect(
      showClientAccess(['sales'], { isPolicyholder: false, hasOwnSubmission: true }),
    ).toBe(true)
  })

  it('a plain buyer with no submission does not', () => {
    expect(
      showClientAccess(['sales'], { isPolicyholder: false, hasOwnSubmission: false }),
    ).toBe(false)
  })
})

describe('the service enforces the same matrix (contract lock)', () => {
  it('admins are unrestricted; sales and commercial are client-only', () => {
    expect(RULES).toContain('ADMIN_ROLES = frozenset({"admin"})')
    expect(RULES).toContain(
      'CLIENT_PROVISIONER_ROLES = frozenset({"sales", "commercial_underwriter"})',
    )
    expect(RULES).toContain('if set(requested_roles) != {"client"}:')
    expect(RULES).toContain('"client_only",')
  })

  it('resetting a non-client is refused for client provisioners', () => {
    expect(RULES).toContain('if target_roles != {"client"}:')
  })

  it('disable/enable is admin-only', () => {
    expect(RULES).toContain('def authorize_admin_only(')
    expect(RULES).toContain('"admin_only"')
  })

  it('temporary passwords are long and drawn from a CSPRNG', () => {
    expect(RULES).toContain('MIN_TEMP_PASSWORD_LENGTH = 16')
    expect(RULES).toContain('secrets.choice(')
    expect(RULES).toContain('secrets.SystemRandom().shuffle(chars)')
    // Never `random` — that generator is predictable from observed output.
    expect(RULES).not.toMatch(/^import random$/m)
  })

  it('a client user is required to carry its company', () => {
    expect(RULES).toContain('def requires_entity(')
    expect(RULES).toContain('return "client" in roles')
  })
})
