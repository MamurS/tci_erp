/** Contract test: the frontend role model must mirror migration 0016
 * (the recreated tci.user_role enum + multi-role user_roles) and 0017
 * (grade bands). */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../supabase/migrations/0016_department_roles.sql?raw'
import MIGRATION_0017 from '../../supabase/migrations/0017_authority_matrix.sql?raw'
import {
  GRADE_BANDS,
  STAFF_ROLES,
  USER_ROLES,
  bandForGrade,
  hasRole,
  isStaff,
  isUserRole,
} from './roles'

describe('role set (mirror of the tci.user_role enum)', () => {
  it('is exactly the department set', () => {
    expect(USER_ROLES).toEqual([
      'admin',
      'sales',
      'commercial_underwriter',
      'credit_underwriter',
      'claims',
      'information_manager',
      'client',
    ])
    for (const role of USER_ROLES) {
      expect(MIGRATION).toContain(`'${role}'`)
    }
  })

  it('drops the pre-3b roles', () => {
    for (const gone of ['senior_underwriter', 'underwriter', 'policyholder']) {
      expect(isUserRole(gone)).toBe(false)
      expect(USER_ROLES as readonly string[]).not.toContain(gone)
    }
  })

  it('maps the old roles the way the migration does', () => {
    expect(MIGRATION).toContain("when 'underwriter'        then 'credit_underwriter'")
    expect(MIGRATION).toContain("when 'senior_underwriter' then 'credit_underwriter'")
    expect(MIGRATION).toContain("when 'policyholder'       then 'client'")
  })

  it('allows several roles per user (composite primary key)', () => {
    expect(MIGRATION).toContain('alter table tci.user_roles add primary key (user_id, role)')
  })

  it('staff = everyone except client (mirror of tci.is_staff)', () => {
    expect(STAFF_ROLES).not.toContain('client')
    expect(STAFF_ROLES).toHaveLength(USER_ROLES.length - 1)
    expect(isStaff(['client'])).toBe(false)
    expect(isStaff([])).toBe(false)
    expect(isStaff(['claims'])).toBe(true)
    expect(isStaff(['client', 'sales'])).toBe(true)
    expect(MIGRATION).toContain("where user_id = (select auth.uid()) and role <> 'client'")
  })

  it('hasRole matches ANY of the wanted roles (mirror of tci.has_role)', () => {
    expect(hasRole(['sales'], 'admin', 'sales')).toBe(true)
    expect(hasRole(['sales'], 'admin')).toBe(false)
    expect(hasRole([], 'admin')).toBe(false)
    expect(MIGRATION).toContain('where user_id = (select auth.uid()) and role = any(p_roles)')
  })
})

describe('grade bands (mirror of tci.grade_band + grade_band_for_assessment)', () => {
  it('is the fixed band-name set', () => {
    expect(GRADE_BANDS).toEqual(['A', 'B', 'C', 'D', 'unrated'])
    expect(MIGRATION_0017).toContain(
      "create type tci.grade_band as enum ('A', 'B', 'C', 'D', 'unrated')",
    )
  })

  it('band = the FAMILY (first character) of the grade code', () => {
    expect(bandForGrade('A1')).toBe('A')
    expect(bandForGrade('A2')).toBe('A')
    expect(bandForGrade('B1')).toBe('B')
    expect(bandForGrade('B2')).toBe('B')
    expect(bandForGrade('C1')).toBe('C')
    expect(bandForGrade('C2')).toBe('C')
    expect(bandForGrade('D')).toBe('D')
  })

  it('anything unknown, empty or absent is unrated', () => {
    expect(bandForGrade(null)).toBe('unrated')
    expect(bandForGrade(undefined)).toBe('unrated')
    expect(bandForGrade('')).toBe('unrated')
    expect(bandForGrade('Z9')).toBe('unrated')
    // lower-case grades still resolve, like upper(left(...)) in SQL
    expect(bandForGrade('b2')).toBe('B')
  })
})
