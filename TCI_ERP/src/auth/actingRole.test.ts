/** The acting role the screen asks for when a session starts (0063). */
import { describe, expect, it } from 'vitest'

import M63 from '../../supabase/migrations/0063_acting_role.sql?raw'
import AUTH_CONTEXT from './AuthContext.tsx?raw'
import { chooseActingRole, rolesOpening } from './actingRole'

describe('chooseActingRole', () => {
  it('keeps the server\'s acting role while it is still held', () => {
    expect(chooseActingRole(['sales', 'credit_underwriter'], 'sales', 'credit')).toEqual({ role: 'sales', mustSet: false })
  })

  it('a role the server names but the person no longer holds is not kept', () => {
    expect(chooseActingRole(['sales', 'credit_underwriter'], 'admin', 'sales')).toEqual({ role: 'sales', mustSet: true })
  })

  it('a single role is never set: the server acts in it already', () => {
    expect(chooseActingRole(['credit_underwriter'], null, 'sales')).toEqual({ role: 'credit_underwriter', mustSet: false })
    expect(chooseActingRole(['client'], null, null)).toEqual({ role: 'client', mustSet: false })
  })

  it('several roles and none on the server: the remembered workspace, else the first', () => {
    expect(chooseActingRole(['admin', 'commercial_underwriter'], null, 'admin')).toEqual({ role: 'admin', mustSet: true })
    expect(chooseActingRole(['admin', 'commercial_underwriter'], null, null)).toEqual({ role: 'commercial_underwriter', mustSet: true })
  })

  it('no role: nothing to act in', () => {
    expect(chooseActingRole([], 'sales', null)).toEqual({ role: null, mustSet: false })
  })
})

describe('the server side (0063)', () => {
  it('several roles and none chosen act in no role; one role acts in it', () => {
    expect(M63).toContain('(select min(h.role::text)::tci.user_role from held h having count(*) = 1)')
    expect(M63).toContain('and a.role in (select h.role from held h)')
  })

  it('the gates answer for the acting role only', () => {
    expect(M63).toContain('select coalesce(tci.acting_role() = any(p_roles), false)')
    expect(M63).toContain("select coalesce(tci.acting_role() <> 'client', false)")
  })

  it('the screen settles the acting role before it loads anything, and refetches on a switch', () => {
    expect(AUTH_CONTEXT).toContain("await tci().rpc('set_acting_role', { p_role: acting })")
    expect(AUTH_CONTEXT).toContain('await queryClient.resetQueries()')
  })
})

describe('rolesOpening (the «no access» page offers a switch)', () => {
  it('offers the other held roles that open the section, never the acting one', () => {
    expect(rolesOpening(['sales', 'credit_underwriter'], 'sales', '/limits/abc')).toContain('credit_underwriter')
    expect(rolesOpening(['sales', 'credit_underwriter'], 'credit_underwriter', '/limits/abc')).not.toContain(
      'credit_underwriter',
    )
    expect(rolesOpening(['sales', 'claims'], 'sales', '/admin')).toEqual([])
    expect(rolesOpening(['sales', 'admin'], 'sales', '/admin')).toEqual(['admin'])
    expect(rolesOpening([], null, '/admin')).toEqual([])
  })
})
