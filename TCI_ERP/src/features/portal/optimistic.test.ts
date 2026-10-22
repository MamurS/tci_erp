import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0043_security_closure.sql?raw'
import { CLIENT_CLAIM_STATUS, portalClaimQueryAffected, SUBMISSION_RESPONSE_STATUS } from './optimistic'

describe('portal statuses painted before the answer', () => {
  it('a submission response moves to what client_respond_to_submission asks for', () => {
    expect(MIGRATION).toContain(`return tci.advance_insurance_request(p_request_id, '${SUBMISSION_RESPONSE_STATUS.accept}', null);`)
    expect(MIGRATION).toContain(
      `return tci.advance_insurance_request(p_request_id, '${SUBMISSION_RESPONSE_STATUS.decline}', btrim(p_comment));`,
    )
    expect(MIGRATION).toContain(
      `return tci.advance_insurance_request(p_request_id, '${SUBMISSION_RESPONSE_STATUS.request_changes}', btrim(p_comment));`,
    )
  })

  it('the claim actions move to what the client_* claim functions ask for', () => {
    expect(MIGRATION).toContain(`return tci.change_claim_status(p_claim_id, '${CLIENT_CLAIM_STATUS.submit}', null);`)
    expect(MIGRATION).toContain(`return tci.change_claim_status(p_claim_id, '${CLIENT_CLAIM_STATUS.withdraw}', p_comment);`)
    expect(MIGRATION).toContain(`return tci.change_claim_status(p_claim_id, '${CLIENT_CLAIM_STATUS.respond}', p_comment);`)
  })

  it('a claim write refreshes the claim queries only', () => {
    expect(portalClaimQueryAffected(['portal', 'claims'])).toBe(true)
    expect(portalClaimQueryAffected(['portal', 'claim-invoices', 'c'])).toBe(true)
    expect(portalClaimQueryAffected(['portal', 'claimable'])).toBe(true)
    expect(portalClaimQueryAffected(['portal', 'tasks'])).toBe(true)
    expect(portalClaimQueryAffected(['portal', 'policies'])).toBe(false)
    expect(portalClaimQueryAffected(['portal', 'declarations'])).toBe(false)
    expect(portalClaimQueryAffected(['claims', 'list'])).toBe(false)
  })
})
