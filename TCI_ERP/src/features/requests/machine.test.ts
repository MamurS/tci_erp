/** Contract test: machine.ts must mirror tci.advance_insurance_request
 * (migration 0019) exactly — the transition table, the role gate per target
 * state, and the content guards. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0019_insurance_requests.sql?raw'
import {
  TERMINAL_STATUSES,
  TRANSITIONS,
  canCreateSubmission,
  canEditPackage,
  canEditTerms,
  canResolveBuyers,
  canTransitionAs,
  creditComplete,
  entitiesResolved,
  guardFor,
  isAllowedTransition,
  isTerminal,
  owningRole,
  requestAgeDays,
  resolutionTone,
  statusTone,
  transitionOffers,
} from './machine'
import { BUYER_RESOLUTION_STATUSES, INSURANCE_REQUEST_STATUSES } from './types'

describe('transition table (mirror of the CASE in advance_insurance_request)', () => {
  it('matches the SQL branch for branch', () => {
    expect(TRANSITIONS).toEqual({
      draft: ['submitted', 'withdrawn'],
      submitted: ['entity_resolution', 'underwriting', 'withdrawn'],
      entity_resolution: ['underwriting', 'withdrawn'],
      underwriting: ['commercial_review', 'withdrawn'],
      commercial_review: ['sales_confirmation', 'withdrawn'],
      sales_confirmation: ['client_review', 'withdrawn'],
      client_review: ['accepted', 'declined', 'withdrawn'],
      accepted: ['bound'],
      declined: [],
      withdrawn: [],
      bound: [],
    })
    expect(MIGRATION).toContain(
      "when v_from = 'submitted'          and p_to_status in ('entity_resolution', 'underwriting', 'withdrawn') then true",
    )
    expect(MIGRATION).toContain(
      "when v_from = 'client_review'      and p_to_status in ('accepted', 'declined', 'withdrawn') then true",
    )
    expect(MIGRATION).toContain(
      "when v_from = 'accepted'           and p_to_status = 'bound' then true",
    )
  })

  it('covers every status of the enum', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...INSURANCE_REQUEST_STATUSES].sort())
  })

  it('declined, withdrawn and bound are terminal', () => {
    expect(TERMINAL_STATUSES).toEqual(['declined', 'withdrawn', 'bound'])
    for (const s of INSURANCE_REQUEST_STATUSES) {
      expect(isTerminal(s)).toBe(TRANSITIONS[s].length === 0)
    }
  })

  it('rejects everything the table does not list', () => {
    expect(isAllowedTransition('draft', 'submitted')).toBe(true)
    expect(isAllowedTransition('draft', 'underwriting')).toBe(false)
    expect(isAllowedTransition('bound', 'withdrawn')).toBe(false)
    // no path skips the commercial review
    expect(isAllowedTransition('underwriting', 'sales_confirmation')).toBe(false)
    // and none goes backwards
    expect(isAllowedTransition('client_review', 'sales_confirmation')).toBe(false)
  })
})

describe('role gates (mirror of the elsif ladder)', () => {
  it('only the creator or an admin may withdraw', () => {
    expect(canTransitionAs('withdrawn', ['sales'], true)).toBe(true)
    expect(canTransitionAs('withdrawn', ['sales'], false)).toBe(false)
    expect(canTransitionAs('withdrawn', ['admin'], false)).toBe(true)
    expect(MIGRATION).toContain('only the creator or an admin may withdraw a submission')
  })

  it('accept/decline is the client, or sales/admin on its behalf', () => {
    for (const to of ['accepted', 'declined'] as const) {
      expect(canTransitionAs(to, ['client'], false)).toBe(true)
      expect(canTransitionAs(to, ['sales'], false)).toBe(true)
      expect(canTransitionAs(to, ['admin'], false)).toBe(true)
      expect(canTransitionAs(to, ['credit_underwriter'], false)).toBe(false)
      expect(canTransitionAs(to, ['commercial_underwriter'], false)).toBe(false)
    }
    expect(MIGRATION).toContain("if not tci.has_role('client', 'admin', 'sales') then")
  })

  it('only sales release a submission to the client', () => {
    expect(canTransitionAs('client_review', ['sales'], false)).toBe(true)
    expect(canTransitionAs('client_review', ['admin'], false)).toBe(true)
    expect(canTransitionAs('client_review', ['commercial_underwriter'], false)).toBe(false)
    expect(MIGRATION).toContain('only sales may release a submission to the client')
  })

  it('only commercial underwriting finishes the commercial review', () => {
    expect(canTransitionAs('sales_confirmation', ['commercial_underwriter'], false)).toBe(true)
    expect(canTransitionAs('sales_confirmation', ['admin'], false)).toBe(true)
    expect(canTransitionAs('sales_confirmation', ['sales'], false)).toBe(false)
    expect(canTransitionAs('sales_confirmation', ['credit_underwriter'], false)).toBe(false)
    expect(MIGRATION).toContain(
      'only commercial underwriting may finish the commercial review',
    )
  })

  it('every other move is any staff role, never the client alone', () => {
    for (const to of ['submitted', 'entity_resolution', 'underwriting', 'commercial_review', 'bound'] as const) {
      expect(canTransitionAs(to, ['information_manager'], false)).toBe(true)
      expect(canTransitionAs(to, ['client'], false)).toBe(false)
      expect(canTransitionAs(to, [], false)).toBe(false)
    }
    expect(MIGRATION).toContain('only staff may move a submission')
  })

  it('multi-role users get the union of the gates', () => {
    expect(canTransitionAs('sales_confirmation', ['sales', 'commercial_underwriter'], false)).toBe(true)
    expect(canTransitionAs('client_review', ['claims', 'sales'], false)).toBe(true)
  })
})

describe('content guards (mirror of the three raises)', () => {
  it('underwriting needs every buyer resolved', () => {
    expect(guardFor('underwriting', { entitiesResolved: false, creditComplete: true, hasComment: true }))
      .toBe('entitiesUnresolved')
    expect(guardFor('underwriting', { entitiesResolved: true, creditComplete: true, hasComment: true }))
      .toBeNull()
    expect(MIGRATION).toContain(
      'every buyer must be resolved to a company before underwriting',
    )
  })

  it('the commercial review needs a credit decision per buyer', () => {
    expect(guardFor('commercial_review', { entitiesResolved: true, creditComplete: false, hasComment: true }))
      .toBe('creditIncomplete')
    expect(MIGRATION).toContain(
      'every buyer needs a credit decision before the commercial review',
    )
  })

  it('a decline needs a reason', () => {
    expect(guardFor('declined', { entitiesResolved: true, creditComplete: true, hasComment: false }))
      .toBe('declineNeedsReason')
    expect(guardFor('declined', { entitiesResolved: true, creditComplete: true, hasComment: true }))
      .toBeNull()
    expect(MIGRATION).toContain('a decline needs a reason')
  })

  it('guards apply only to their own target status', () => {
    expect(guardFor('withdrawn', { entitiesResolved: false, creditComplete: false, hasComment: false }))
      .toBeNull()
  })
})

describe('entitiesResolved / creditComplete (mirror of the two SQL predicates)', () => {
  it('an unresolved buyer blocks, resolved ones pass', () => {
    expect(entitiesResolved([])).toBe(true) // vacuously, as the SQL not-exists
    expect(entitiesResolved([{ entity_id: 'e1', resolution_status: 'ready' }])).toBe(true)
    expect(entitiesResolved([{ entity_id: null, resolution_status: 'pending_entity' }])).toBe(false)
    // an entity_id alone is not enough while the status still says pending
    expect(entitiesResolved([{ entity_id: 'e1', resolution_status: 'pending_entity' }])).toBe(false)
    expect(MIGRATION).toContain("(b.entity_id is null or b.resolution_status = 'pending_entity')")
  })

  it('credit completeness requires at least one buyer, all of them decided', () => {
    expect(creditComplete([], new Set())).toBe(false)
    expect(MIGRATION).toContain(
      'select exists (select 1 from tci.insurance_request_buyers b where b.request_id = p_request_id)',
    )
    expect(creditComplete([{ entity_id: 'e1' }], new Set(['e1']))).toBe(true)
    expect(creditComplete([{ entity_id: 'e1' }, { entity_id: 'e2' }], new Set(['e1']))).toBe(false)
    expect(creditComplete([{ entity_id: null }], new Set(['e1']))).toBe(false)
  })
})

describe('transitionOffers', () => {
  const facts = { entitiesResolved: false, creditComplete: false }

  it('hides what the role cannot do and disables what a guard blocks', () => {
    const offers = transitionOffers('submitted', ['credit_underwriter'], false, facts)
    const underwriting = offers.find((o) => o.to === 'underwriting')
    expect(underwriting).toEqual({
      to: 'underwriting',
      allowedByRole: true,
      guard: 'entitiesUnresolved',
    })
    // not the creator, not an admin -> withdraw is not on offer
    expect(offers.find((o) => o.to === 'withdrawn')?.allowedByRole).toBe(false)
  })

  it('clears the guard once the facts allow it', () => {
    const offers = transitionOffers('submitted', ['sales'], true, {
      entitiesResolved: true,
      creditComplete: true,
    })
    expect(offers.find((o) => o.to === 'underwriting')?.guard).toBeNull()
  })

  it('a terminal status offers nothing', () => {
    expect(transitionOffers('bound', ['admin'], true, facts)).toEqual([])
  })
})

describe('who owns the submission at each step', () => {
  it('routes the same way the SQL stamps target_role on request.status_changed', () => {
    expect(owningRole('entity_resolution')).toBe('sales')
    expect(owningRole('underwriting')).toBe('credit_underwriter')
    expect(owningRole('commercial_review')).toBe('commercial_underwriter')
    expect(owningRole('sales_confirmation')).toBe('sales')
    expect(owningRole('client_review')).toBe('client')
    for (const s of TERMINAL_STATUSES) expect(owningRole(s)).toBeNull()
    expect(MIGRATION).toContain("when 'entity_resolution'  then 'sales'::tci.user_role")
    expect(MIGRATION).toContain("when 'underwriting'       then 'credit_underwriter'::tci.user_role")
    expect(MIGRATION).toContain("when 'commercial_review'  then 'commercial_underwriter'::tci.user_role")
    expect(MIGRATION).toContain("when 'sales_confirmation' then 'sales'::tci.user_role")
    expect(MIGRATION).toContain("when 'client_review'      then 'client'::tci.user_role")
  })
})

describe('capability helpers', () => {
  it('who may raise a submission', () => {
    for (const r of ['admin', 'sales', 'commercial_underwriter', 'credit_underwriter'] as const) {
      expect(canCreateSubmission([r])).toBe(true)
    }
    for (const r of ['claims', 'information_manager', 'client'] as const) {
      expect(canCreateSubmission([r])).toBe(false)
    }
  })

  it('only commercial underwriting edits the terms, and never once terminal', () => {
    expect(canEditTerms('commercial_review', ['commercial_underwriter'])).toBe(true)
    expect(canEditTerms('draft', ['commercial_underwriter'])).toBe(true)
    expect(canEditTerms('bound', ['commercial_underwriter'])).toBe(false)
    expect(canEditTerms('withdrawn', ['admin'])).toBe(false)
    expect(canEditTerms('commercial_review', ['sales'])).toBe(false)
    expect(canEditTerms('commercial_review', ['credit_underwriter'])).toBe(false)
  })

  it('who may resolve package buyers (mirror of resolve_request_buyer)', () => {
    for (const r of ['admin', 'sales', 'information_manager', 'credit_underwriter'] as const) {
      expect(canResolveBuyers([r])).toBe(true)
    }
    expect(canResolveBuyers(['commercial_underwriter'])).toBe(false)
    expect(canResolveBuyers(['client'])).toBe(false)
    expect(MIGRATION).toContain(
      "if not tci.has_role('admin', 'sales', 'information_manager', 'credit_underwriter') then",
    )
  })

  it('the package is editable only on the sales side of the pipeline', () => {
    expect(canEditPackage('draft', ['sales'])).toBe(true)
    expect(canEditPackage('entity_resolution', ['sales'])).toBe(true)
    expect(canEditPackage('underwriting', ['sales'])).toBe(false)
    expect(canEditPackage('draft', ['claims'])).toBe(false)
  })
})

describe('presentation helpers', () => {
  it('assigns a tone to every status and resolution state', () => {
    for (const s of INSURANCE_REQUEST_STATUSES) expect(statusTone(s)).toBeTruthy()
    for (const s of BUYER_RESOLUTION_STATUSES) expect(resolutionTone(s)).toBeTruthy()
    expect(statusTone('declined')).toBe('neg')
    expect(statusTone('bound')).toBe('pos')
    expect(resolutionTone('pending_entity')).toBe('warn')
  })

  it('age in whole days since submission', () => {
    expect(requestAgeDays(null, '2026-08-26T00:00:00Z')).toBeNull()
    expect(requestAgeDays('2026-08-20T10:00:00Z', '2026-08-26T09:00:00Z')).toBe(5)
    expect(requestAgeDays('2026-08-26T10:00:00Z', '2026-08-26T09:00:00Z')).toBe(0)
  })
})

describe('migration 0019 structural locks', () => {
  it('the submission number is generated, not typed', () => {
    expect(MIGRATION).toContain("'IR-' || to_char(now(), 'YYYY') || '-' ||")
    expect(MIGRATION).toContain('create trigger insurance_requests_number')
  })

  it('an unresolved package buyer keeps a name instead of an entity', () => {
    expect(MIGRATION).toContain('request_buyers_identified check (entity_id is not null or proposed_name is not null)')
    expect(MIGRATION).toContain("check (resolution_status = 'pending_entity' or entity_id is not null)")
  })

  it('limit requests can be attached to a submission', () => {
    expect(MIGRATION).toContain(
      'add column insurance_request_id uuid references tci.insurance_requests (id)',
    )
  })

  it('the client reads its own submissions and writes only in its own court', () => {
    expect(MIGRATION).toContain('"insurance_requests: client reads own"')
    expect(MIGRATION).toContain("and status in ('draft', 'client_review')")
  })
})
