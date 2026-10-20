import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0050_policy_wording.sql?raw'
import { PLACEHOLDERS, placeholderSyntax } from './catalogue'

describe('placeholder catalogue — contract with tci.wording_placeholder_catalogue() (0050)', () => {
  it('is the same list, in the same order, as the SQL catalogue', () => {
    const body = MIGRATION.slice(MIGRATION.indexOf('create function tci.wording_placeholder_catalogue()'))
    const list = body.slice(body.indexOf('select array['), body.indexOf(']::text[]'))
    const sql = [...list.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1])
    expect(sql).toEqual([...PLACEHOLDERS])
  })

  it('writes loop fields without their prefix', () => {
    expect(placeholderSyntax('limits.amount')).toBe('{{amount}}')
    expect(placeholderSyntax('policy.number')).toBe('{{policy.number}}')
    expect(placeholderSyntax('limits')).toContain('{{#limits}}')
  })
})
