import { describe, expect, it } from 'vitest'

import M32 from '../../../supabase/migrations/0032_claims.sql?raw'
import M43 from '../../../supabase/migrations/0043_security_closure.sql?raw'
import type { ClaimStatus } from '../claims/types'
import { blockingClaim, mayOpenClaimFromNoa, openClaimErrorKey } from './openClaim'

const noa = { id: 'n1', policy_id: 'p1', buyer_entity_id: 'b1', status: 'open' as const }
const claim = (over: Partial<{ id: string; policy_id: string; buyer_entity_id: string; overdue_notification_id: string | null; status: ClaimStatus }>) => ({
  id: 'c1',
  policy_id: 'p1',
  buyer_entity_id: 'b1',
  overdue_notification_id: null,
  status: 'draft' as ClaimStatus,
  ...over,
})

describe('opening a claim from an overdue notification', () => {
  it('is offered to claims, sales and admin on an open notification with no claim', () => {
    for (const role of ['claims', 'sales', 'admin'] as const) {
      expect(mayOpenClaimFromNoa([role], noa, [])).toBe(true)
    }
  })

  it('is not offered to other roles, or the client (the portal is theirs)', () => {
    for (const role of ['commercial_underwriter', 'credit_underwriter', 'information_manager', 'client'] as const) {
      expect(mayOpenClaimFromNoa([role], noa, [])).toBe(false)
    }
  })

  it('is not offered once the notification is closed', () => {
    for (const status of ['resolved_paid', 'escalated_to_claim', 'withdrawn'] as const) {
      expect(mayOpenClaimFromNoa(['claims'], { ...noa, status }, [])).toBe(false)
    }
  })

  it('is blocked by a live claim on the same policy and buyer (claims_live_uq)', () => {
    expect(blockingClaim(noa, [claim({ status: 'under_assessment' })])?.id).toBe('c1')
    for (const status of ['declined', 'closed', 'withdrawn'] as const) {
      expect(blockingClaim(noa, [claim({ status })])).toBeNull()
    }
    // Another buyer, or another policy, holds a different slot.
    expect(blockingClaim(noa, [claim({ buyer_entity_id: 'b2' })])).toBeNull()
    expect(blockingClaim(noa, [claim({ policy_id: 'p2' })])).toBeNull()
  })

  it('is blocked by any claim but a withdrawn one raised from this notification (claims_noa_uq)', () => {
    expect(blockingClaim(noa, [claim({ overdue_notification_id: 'n1', status: 'closed' })])?.id).toBe('c1')
    expect(blockingClaim(noa, [claim({ overdue_notification_id: 'n1', status: 'withdrawn' })])).toBeNull()
  })

  it('mirrors the rules the database enforces', () => {
    expect(M43).toContain("if not (tci.has_role('claims', 'sales', 'admin') or tci.has_role('client')) then")
    expect(M32).toContain("create unique index claims_live_uq\n  on tci.claims (policy_id, entity_id)\n  where status not in ('declined', 'closed', 'withdrawn');")
    expect(M32).toContain("on tci.claims (overdue_notification_id)\n  where overdue_notification_id is not null and status <> 'withdrawn';")
  })

  it('maps refusals to readable messages, never raw text', () => {
    expect(openClaimErrorKey({ message: 'duplicate key value violates unique constraint "claims_live_uq"', code: '23505' })).toBe(
      'claims.errors.alreadyOpen',
    )
    expect(openClaimErrorKey({ message: 'duplicate key value violates unique constraint "claims_noa_uq"', code: '23505' })).toBe(
      'claims.errors.noaAlreadyClaimed',
    )
    expect(openClaimErrorKey({ message: 'a claim needs a policy that was in force', code: 'P0001' })).toBe(
      'claims.errors.policyNotInForce',
    )
    expect(openClaimErrorKey({ message: 'not permitted to open a claim', code: '42501' })).toBe('common.notPermitted')
    expect(openClaimErrorKey({ message: 'buyer not found', code: 'P0002' })).toBe('common.recordNotFound')
    expect(openClaimErrorKey({ message: 'socket hang up' })).toBe('common.somethingWentWrong')
  })
})
