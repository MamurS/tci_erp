import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0032_claims.sql?raw'
import {
  CLAIM_TRANSITIONS,
  NOT_OFFERED_DIRECTLY,
  canTransition,
  isOpen,
  mayTransition,
  offeredTransitions,
  requiresReason,
} from './machine'
import { CLAIM_STATUSES } from './types'

describe('claim status machine — contract with 0032', () => {
  it('declares the same statuses as the SQL enum', () => {
    const enumBlock = MIGRATION.slice(
      MIGRATION.indexOf('create type tci.claim_status as enum ('),
      MIGRATION.indexOf(');', MIGRATION.indexOf('create type tci.claim_status as enum (')),
    )
    for (const status of CLAIM_STATUSES) {
      expect(enumBlock).toContain(`'${status}'`)
    }
    const declared = enumBlock.match(/'[a-z_]+'/g) ?? []
    expect(declared).toHaveLength(CLAIM_STATUSES.length)
  })

  it('mirrors every row of the SQL transition table', () => {
    expect(MIGRATION).toContain(
      "when v_from = 'draft'              and p_to in ('submitted', 'withdrawn') then true",
    )
    expect(MIGRATION).toContain(
      "when v_from = 'submitted'          and p_to in ('under_assessment', 'info_requested', 'declined', 'withdrawn') then true",
    )
    expect(MIGRATION).toContain(
      "when v_from = 'under_assessment'   and p_to in ('info_requested', 'approved', 'partially_approved', 'declined') then true",
    )
    expect(MIGRATION).toContain(
      "when v_from = 'info_requested'     and p_to in ('under_assessment', 'declined', 'withdrawn') then true",
    )
    expect(MIGRATION).toContain(
      "when v_from in ('approved', 'partially_approved') and p_to in ('paid', 'closed') then true",
    )
    expect(MIGRATION).toContain("when v_from = 'paid'               and p_to = 'closed' then true")
    expect(MIGRATION).toContain("when v_from = 'declined'           and p_to = 'closed' then true")
    expect(MIGRATION).toContain("when v_from = 'withdrawn'          and p_to = 'closed' then true")
  })

  it('offers nothing out of closed', () => {
    expect(CLAIM_TRANSITIONS.closed).toHaveLength(0)
  })

  it('only a decline demands a typed reason, as the SQL says', () => {
    expect(MIGRATION).toContain("if p_to = 'declined'")
    expect(MIGRATION).toContain('raise exception \'declining a claim requires a reason\'')
    expect(requiresReason('declined')).toBe(true)
    expect(requiresReason('partially_approved')).toBe(false)
  })

  it('routes filing and withdrawal to the policyholder, sales or claims', () => {
    expect(MIGRATION).toContain(
      "raise exception 'only the policyholder, sales or claims may file a claim'",
    )
    expect(mayTransition(['sales'], 'draft', 'submitted')).toBe(true)
    expect(mayTransition(['claims'], 'draft', 'submitted')).toBe(true)
    expect(mayTransition(['client'], 'draft', 'submitted', true)).toBe(true)
    expect(mayTransition(['client'], 'draft', 'submitted', false)).toBe(false)
    expect(mayTransition(['credit_underwriter'], 'draft', 'submitted')).toBe(false)
  })

  it('leaves assessment decisions to claims alone', () => {
    expect(mayTransition(['sales'], 'under_assessment', 'declined')).toBe(false)
    expect(mayTransition(['claims'], 'under_assessment', 'declined')).toBe(true)
    expect(mayTransition(['admin'], 'under_assessment', 'approved')).toBe(true)
  })

  it('lets the policyholder answer an information request', () => {
    expect(mayTransition(['client'], 'info_requested', 'under_assessment', true)).toBe(true)
    expect(mayTransition(['client'], 'info_requested', 'under_assessment', false)).toBe(false)
  })

  it('never offers the transitions that must go through a function', () => {
    expect(NOT_OFFERED_DIRECTLY).toContain('approved->paid')
    expect(NOT_OFFERED_DIRECTLY).toContain('under_assessment->approved')
    expect(offeredTransitions(['claims'], 'approved')).not.toContain('paid')
    expect(offeredTransitions(['claims'], 'under_assessment')).not.toContain('approved')
    // ...but the database still accepts them, because the functions use them.
    expect(canTransition('approved', 'paid')).toBe(true)
    expect(canTransition('under_assessment', 'approved')).toBe(true)
  })

  it('counts a settled or refused claim as no longer open', () => {
    expect(isOpen('under_assessment')).toBe(true)
    expect(isOpen('info_requested')).toBe(true)
    expect(isOpen('paid')).toBe(false)
    expect(isOpen('declined')).toBe(false)
    expect(isOpen('withdrawn')).toBe(false)
  })
})
