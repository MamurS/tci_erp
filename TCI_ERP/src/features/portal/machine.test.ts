/** Contract test: the portal's client-side rules must mirror migration 0025,
 * and — more importantly — the migration must actually hold the guarantees
 * the portal is built on. Several of these assert an ABSENCE, because that
 * is what "a client cannot see this" means. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0025_client_portal.sql?raw'
import {
  CLIENT_ACTIONS,
  TERMS_VISIBLE_FROM,
  actionNeedsComment,
  canRespond,
  termsVisible,
} from './machine'

describe('when a client sees proposed terms', () => {
  it('mirrors tci.submission_terms_visible exactly', () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf('create function tci.submission_terms_visible'))
    const body = fn.slice(0, fn.indexOf('$$;'))
    const statuses = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(statuses).toEqual([...TERMS_VISIBLE_FROM])
  })

  it('hides them for every earlier stage', () => {
    for (const status of [
      'draft',
      'submitted',
      'entity_resolution',
      'underwriting',
      'commercial_review',
      'sales_confirmation',
    ]) {
      expect(termsVisible(status)).toBe(false)
    }
  })

  it('shows them once the offer has reached the client', () => {
    expect(termsVisible('client_review')).toBe(true)
    expect(termsVisible('accepted')).toBe(true)
    expect(termsVisible('bound')).toBe(true)
  })
})

describe('answering a submission', () => {
  it('offers the three actions the function accepts', () => {
    for (const action of CLIENT_ACTIONS) {
      expect(MIGRATION).toContain(`p_action = '${action}'`)
    }
  })

  it('needs a comment for everything but accept, as the function demands', () => {
    expect(MIGRATION).toContain("raise exception 'a decline needs a reason'")
    expect(MIGRATION).toContain("raise exception 'say what should change'")
    expect(actionNeedsComment('accept')).toBe(false)
    expect(actionNeedsComment('decline')).toBe(true)
    expect(actionNeedsComment('request_changes')).toBe(true)
  })

  it('is only possible while the submission is with the client', () => {
    expect(MIGRATION).toContain("if v_request.status <> 'client_review' then")
    expect(canRespond('client_review')).toBe(true)
    expect(canRespond('sales_confirmation')).toBe(false)
    expect(canRespond('accepted')).toBe(false)
  })

  it('sends "request changes" back to sales rather than declining', () => {
    expect(MIGRATION).toContain(
      "return tci.advance_insurance_request(p_request_id, 'sales_confirmation', btrim(p_comment))",
    )
    expect(MIGRATION).toContain(
      "when v_from = 'client_review'      and p_to_status in ('accepted', 'declined', 'sales_confirmation', 'withdrawn') then true",
    )
  })
})

describe('what the migration guarantees about client visibility', () => {
  it('drops every client SELECT policy on a base table', () => {
    for (const policy of [
      '"policies: client reads own"',
      '"limit_requests: client reads own"',
      '"limit_decisions: client reads own released"',
      '"decision_conditions: client reads own"',
      '"insurance_requests: client reads own"',
      '"request_buyers: client reads own"',
      '"request_history: client reads own"',
    ]) {
      expect(MIGRATION).toContain(`drop policy ${policy}`)
    }
  })

  it('drops the client UPDATE policy that was not column-restricted', () => {
    expect(MIGRATION).toContain(
      'drop policy "insurance_requests: client writes own while in its court"',
    )
  })

  it('asserts in-migration that no client policy survives', () => {
    expect(MIGRATION).toContain("qual ilike '%''client''%'")
    expect(MIGRATION).toContain('client policy/policies still on a base table')
    expect(MIGRATION).toContain('client write policy/policies remain')
  })

  it('gates every client view on the policyholder mapping', () => {
    const views = MIGRATION.match(/create view tci\.v_client_\w+ as/g) ?? []
    expect(views).toHaveLength(8)
    // Each view body must end at the same gate.
    const gates = MIGRATION.match(/in \(select tci\.my_client_entities\(\)\)/g) ?? []
    expect(gates.length).toBeGreaterThanOrEqual(views.length)
  })

  it('gates my_client_entities on the client role, not just the mapping', () => {
    expect(MIGRATION).toContain("and tci.has_role('client')")
  })

  it('never exposes the underwriter comment or the assessment link', () => {
    // The limit views are the ones that could: assert the columns are absent
    // from the whole migration, not merely from one view.
    const clientViews = MIGRATION.slice(
      MIGRATION.indexOf('create view tci.v_client_limits'),
      MIGRATION.indexOf('-- 3e.'),
    )
    expect(clientViews).not.toContain('d.comment')
    expect(clientViews).not.toContain('hold_comment')
    expect(clientViews).not.toContain('decided_by')
    expect(clientViews).not.toContain('based_on_assessment_id')
  })

  it('never exposes the staff comment on submission history', () => {
    const historyView = MIGRATION.slice(
      MIGRATION.indexOf('create view tci.v_client_submission_history'),
      MIGRATION.indexOf('-- 4. Grants'),
    )
    expect(historyView).not.toContain('comment')
  })

  it('applies the release gate to limits AND to their conditions', () => {
    // The dropped decision_conditions policy had no release check at all —
    // the conditions of a held decision were readable.
    const limits = MIGRATION.slice(
      MIGRATION.indexOf('create view tci.v_client_limits'),
      MIGRATION.indexOf('create view tci.v_client_limit_history'),
    )
    const occurrences =
      limits.match(/tci\.decision_is_released\(d\.released_at, d\.decided_at, d\.held\)/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  it('only shows history for decisions that were actually released', () => {
    const history = MIGRATION.slice(
      MIGRATION.indexOf('create view tci.v_client_limit_history'),
      MIGRATION.indexOf('-- 3e.'),
    )
    expect(history).toContain('where d.released_at is not null')
  })
})

describe('what a client may do', () => {
  it('cannot create a company in the registry', () => {
    // The only insert into legal_entities in this migration is inside
    // resolve_buyer_proposal, which is SECURITY INVOKER and staff-gated.
    const inserts = MIGRATION.match(/insert into tci\.legal_entities/g) ?? []
    expect(inserts).toHaveLength(1)
    const resolver = MIGRATION.slice(
      MIGRATION.indexOf('create function tci.resolve_buyer_proposal'),
    )
    expect(resolver).toContain('security invoker')
    expect(resolver.slice(0, resolver.indexOf('insert into tci.legal_entities'))).toContain(
      "tci.has_role('admin', 'information_manager', 'sales', 'credit_underwriter')",
    )
  })

  it('raises the same event the staff path does, so the Agenda is shared', () => {
    const clientFn = MIGRATION.slice(
      MIGRATION.indexOf('create function tci.client_request_limit'),
      MIGRATION.indexOf('create function tci.client_respond_to_submission'),
    )
    expect(clientFn).toContain("'limit.request_submitted', 'credit_limit_request'")
    expect(clientFn).toContain("'client.buyer_proposed', 'client_buyer_proposal'")
  })

  it('can only request a limit under an ACTIVE policy of its own company', () => {
    const clientFn = MIGRATION.slice(
      MIGRATION.indexOf('create function tci.client_request_limit'),
      MIGRATION.indexOf('create function tci.client_respond_to_submission'),
    )
    expect(clientFn).toContain(
      'if not found or v_policy.entity_id not in (select tci.my_client_entities()) then',
    )
    expect(clientFn).toContain("if v_policy.status <> 'active' then")
  })

  it('cannot walk the registry one letter at a time', () => {
    const search = MIGRATION.slice(
      MIGRATION.indexOf('create function tci.client_search_entities'),
    )
    expect(search).toContain("length(btrim(coalesce(p_query, ''))) >= 3")
    expect(search).toContain('limit least(greatest(coalesce(p_limit, 10), 1), 25)')
  })

  it('cannot clear its own forced password change by hand', () => {
    expect(MIGRATION).toContain('revoke update on tci.user_profiles from authenticated')
    expect(MIGRATION).toContain('grant update (full_name, phone) on tci.user_profiles to authenticated')
  })
})
