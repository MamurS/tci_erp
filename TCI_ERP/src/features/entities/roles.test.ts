/** Contract test: computed roles + the legal-entities registry rules must
 * mirror migration 0015 (v_entity_roles, dedup objects, FK renames). */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0015_legal_entities.sql?raw'
import { computeRoles } from './roles'

describe('computeRoles (mirror of tci.v_entity_roles)', () => {
  it('policyholder = has any policy; buyer = has any limit request', () => {
    expect(computeRoles({ entityId: 'e', policiesCount: 0, limitRequestsCount: 0 })).toEqual({
      entity_id: 'e',
      is_policyholder: false,
      is_buyer: false,
      is_prospect: false,
    })
    expect(
      computeRoles({ entityId: 'e', policiesCount: 2, limitRequestsCount: 0 }).is_policyholder,
    ).toBe(true)
    expect(computeRoles({ entityId: 'e', policiesCount: 0, limitRequestsCount: 1 }).is_buyer).toBe(
      true,
    )
  })

  it('is_prospect is reserved (always false until Phase 3c)', () => {
    expect(
      computeRoles({ entityId: 'e', policiesCount: 5, limitRequestsCount: 5 }).is_prospect,
    ).toBe(false)
    expect(MIGRATION).toContain('false as is_prospect')
  })
})

describe('migration 0015 registry contract', () => {
  it('roles are computed from relationships, never stored', () => {
    expect(MIGRATION).toContain(
      'exists (select 1 from tci.policies p where p.entity_id = e.id) as is_policyholder',
    )
    expect(MIGRATION).toContain(
      'exists (select 1 from tci.credit_limit_requests r where r.entity_id = e.id)',
    )
    // no role column on the table itself
    const ddlStart = MIGRATION.indexOf('create table tci.legal_entities (')
    const ddl = MIGRATION.slice(ddlStart, MIGRATION.indexOf(');', ddlStart))
    expect(ddl).not.toMatch(/\brole\b/)
  })

  it('one entity per (country, registration number) when the number is known', () => {
    expect(MIGRATION).toContain('create unique index legal_entities_reg_uq')
    expect(MIGRATION).toContain('on tci.legal_entities (country_code, registration_number)')
    expect(MIGRATION).toContain('where registration_number is not null')
  })

  it('renames every child FK to entity_id and drops the old tables', () => {
    for (const table of [
      'financial_statements',
      'credit_assessments',
      'credit_limit_requests',
    ]) {
      expect(MIGRATION).toContain(`alter table tci.${table} rename column buyer_id to entity_id`)
    }
    expect(MIGRATION).toContain(
      'alter table tci.policies rename column policyholder_id to entity_id',
    )
    expect(MIGRATION).toContain(
      'alter table tci.policyholder_users rename column policyholder_id to entity_id',
    )
    expect(MIGRATION).toContain('drop table tci.buyers')
    expect(MIGRATION).toContain('drop table tci.policyholders')
  })

  it('verifies the backfill in-transaction before dropping', () => {
    expect(MIGRATION).toContain('entity count mismatch')
    expect(MIGRATION).toContain('orphaned child rows')
  })
})
