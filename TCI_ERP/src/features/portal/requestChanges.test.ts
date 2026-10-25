/** Contract test: the portal's change/withdraw mirror against migration 0075. */

import { describe, expect, it } from 'vitest'

import M75 from '../../../supabase/migrations/0075_client_limit_request_changes.sql?raw'
import {
  changeMode,
  CLIENT_AMENDABLE_STATUSES,
  CLIENT_OPEN_STATUSES,
  clientRequestAmendable,
  clientRequestOpen,
  isUnchanged,
} from './requestChanges'

describe('client limit request changes mirror 0075', () => {
  it('open = what a policyholder may withdraw', () => {
    expect(M75).toContain(
      "select p_status in ('submitted', 'information_gathering', 'under_review', 'escalated', 'pending_entity')",
    )
    expect([...CLIENT_OPEN_STATUSES]).toEqual(['submitted', 'information_gathering', 'under_review', 'escalated', 'pending_entity'])
    expect(clientRequestOpen('decided')).toBe(false)
    expect(clientRequestOpen('withdrawn')).toBe(false)
  })

  it('amendable = before underwriting has it', () => {
    expect(M75).toContain("select p_status in ('submitted', 'information_gathering', 'pending_entity')")
    expect([...CLIENT_AMENDABLE_STATUSES]).toEqual(['submitted', 'information_gathering', 'pending_entity'])
    expect(clientRequestAmendable('under_review')).toBe(false)
    expect(clientRequestAmendable('escalated')).toBe(false)
  })

  it('after review a change replaces the request', () => {
    expect(changeMode({ may_amend: true, may_withdraw: true })).toBe('amend')
    expect(changeMode({ may_amend: false, may_withdraw: true })).toBe('replace')
    expect(changeMode({ may_amend: false, may_withdraw: false })).toBeNull()
  })

  it('unchanged is the database’s rule', () => {
    expect(M75).toContain("raise exception 'amendment_unchanged: nothing was changed'")
    const row = { requested_amount: 100, requested_payment_terms_days: 60, justification: 'x' }
    expect(isUnchanged(row, { amount: 100, paymentTermsDays: 60, justification: ' x ' })).toBe(true)
    expect(isUnchanged(row, { amount: 101, paymentTermsDays: 60, justification: 'x' })).toBe(false)
    expect(isUnchanged({ ...row, justification: null }, { amount: 100, paymentTermsDays: 60, justification: '' })).toBe(true)
    expect(isUnchanged(row, { amount: 100, paymentTermsDays: null, justification: 'x' })).toBe(false)
  })
})
