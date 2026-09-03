import { describe, expect, it } from 'vitest'

import M38 from '../../../supabase/migrations/0038_entity_relationships.sql?raw'
import M39 from '../../../supabase/migrations/0039_relationship_suggestions.sql?raw'
import M40 from '../../../supabase/migrations/0040_group_exposure.sql?raw'
import M41 from '../../../supabase/migrations/0041_group_agenda_financials.sql?raw'
import {
  DEFAULT_GROUP_DEPTH_CAP,
  DEFAULT_GROUP_WARN_PCT,
  SIGNAL_WEIGHTS,
  SUGGESTION_THRESHOLD,
  buildOwnershipTree,
  exposureByMember,
  exposureByPolicyholder,
  membersOutsideTree,
  preflightState,
  rankMembers,
  sortedSignals,
  utilisationTone,
} from './group'
import { GROUP_REFUSALS, groupErrorKey } from './errors'
import { RELATIONSHIP_TYPES, SUGGESTION_SIGNALS } from './types'
import type { EntityRelationship, GroupExposureLine, GroupPreflight } from './types'

function rel(patch: Partial<EntityRelationship> & { parent_entity_id: string; child_entity_id: string }): EntityRelationship {
  return {
    id: `${patch.parent_entity_id}->${patch.child_entity_id}`,
    parent_name: patch.parent_entity_id,
    child_name: patch.child_entity_id,
    relationship_type: 'ownership',
    ownership_pct: null,
    valid_from: '2025-01-01',
    valid_to: null,
    is_live: true,
    source: 'manual',
    source_note: null,
    created_by: 'u',
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...patch,
  }
}

// ---------------------------------------------------------------------------
// Contract with the migrations
// ---------------------------------------------------------------------------

describe('relationship types — contract with 0038', () => {
  it('lists exactly the SQL enum values', () => {
    const start = M38.indexOf('create type tci.relationship_type as enum (')
    const block = M38.slice(start, M38.indexOf(');', start))
    for (const t of RELATIONSHIP_TYPES) expect(block).toContain(`'${t}'`)
    const declared = block.match(/'[a-z_]+'/g) ?? []
    expect(declared).toHaveLength(RELATIONSHIP_TYPES.length)
  })

  it('only an ownership edge may carry a percentage', () => {
    expect(M38).toContain('constraint entity_relationships_pct_only_on_ownership check (')
    expect(M38).toContain("ownership_pct is null or relationship_type = 'ownership'")
  })

  it('mirrors the depth cap default', () => {
    expect(M38).toContain('add column group_depth_cap int not null default 10')
    expect(DEFAULT_GROUP_DEPTH_CAP).toBe(10)
  })

  it('keeps the visited set as the real cycle defence', () => {
    // The SQL walk refuses to re-enter a node already on the path.
    expect(M38).toContain('where not (e.b = any (w.path))')
    expect(M38).toContain('and w.depth < tci.group_depth_cap()')
  })

  it('walks the graph undirected, so sisters share a group', () => {
    // Both directions of every edge are unioned into one relation.
    expect(M38).toContain('select parent_entity_id as a, child_entity_id as b')
    expect(M38).toContain('select child_entity_id, parent_entity_id')
  })
})

describe('suggestions — contract with 0039', () => {
  it('mirrors the display threshold', () => {
    expect(M39).toContain("select 0.45::numeric")
    expect(SUGGESTION_THRESHOLD).toBe(0.45)
  })

  it('mirrors every signal weight', () => {
    for (const [signal, weight] of Object.entries(SIGNAL_WEIGHTS)) {
      if (signal === 'name_similarity') continue // scored by pg_trgm, not a constant
      expect(M39, `${signal} weight`).toContain(`'score', ${weight}`)
    }
  })

  it('lists exactly the signals the SQL can emit', () => {
    for (const s of SUGGESTION_SIGNALS) {
      expect(M39, `${s} not emitted by relationship_signals`).toContain(`jsonb_build_object('${s}'`)
    }
  })

  it('clears the threshold on a corporate email domain alone, and on nothing else alone', () => {
    expect(SIGNAL_WEIGHTS.email_domain).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD)
    for (const s of ['address', 'contact_person', 'registration_prefix'] as const) {
      expect(SIGNAL_WEIGHTS[s]).toBeLessThan(SUGGESTION_THRESHOLD)
    }
    expect(M39).toContain("raise exception '0039: a shared address alone would raise a suggestion'")
  })

  it('never lets a free-mail domain become a signal', () => {
    expect(M39).toContain('tci.is_free_email_domain')
    expect(M39).toContain("'gmail.com', 'mail.ru'")
  })

  it('never creates an edge by itself', () => {
    // The only path from a suggestion to an edge goes through the accept
    // function, and that calls the ordinary save with a human's direction.
    expect(M39).toContain('v_row := tci.save_entity_relationship(')
    expect(M39).toContain("'suggested_accepted'")
  })
})

describe('group enforcement — contract with 0040', () => {
  it('checks the group limit in BOTH decision paths', () => {
    expect(M40).toContain("raise exception '0040: decide_limit_request does not check the group limit'")
    expect(M40).toContain("raise exception '0040: adjust_limit_commercial does not check the group limit'")
  })

  it('escalates rather than merely failing', () => {
    expect(M40).toContain("update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;")
    expect(M40).toContain("'result', 'group_limit_exceeded',")
    expect(M40).toContain("'limit.group_limit_breached'")
  })

  it('nets off the decision being superseded', () => {
    expect(M40).toContain('and l.scope_id = p_exclude_scope;')
    expect(M40).toContain("v_after := greatest(v_current - v_replaced, 0) + v_added;")
  })

  it('never blocks a reduction', () => {
    expect(M40).toContain('if not v_is_reduction then')
    expect(M40).toContain(
      "raise exception '0040: the commercial group check is not restricted to increases'",
    )
  })

  it('never consults a group limit on the emergency path', () => {
    expect(M40).toContain(
      "raise exception '0040: the emergency release path must never consult a group limit'",
    )
  })

  it('exempts admin, deliberately and in writing', () => {
    expect(M40).toContain('if not tci.has_role(\'admin\') then')
    expect(M40).toContain('Admin may proceed regardless, and that is deliberate and documented')
  })

  it('counts missing fx rates separately instead of treating them as zero', () => {
    expect(M40).toContain('filter (where not l.rate_missing), 0) as exposure_uzs')
    expect(M40).toContain('count(*) filter (where l.rate_missing)::int as missing_rates')
  })

  it('uses ONE implementation for the screen and the rule', () => {
    expect(M40).toContain(
      'The UI preflight and the SQL enforcement both call THIS - there is no second implementation to drift.',
    )
  })
})

describe('group agenda and combined figures — contract with 0041', () => {
  it('mirrors the warning share default', () => {
    expect(M41 + M40 + M38).toContain('add column group_exposure_warn_pct numeric(5,2) not null default 90')
    expect(DEFAULT_GROUP_WARN_PCT).toBe(90)
  })

  it('adds exactly the two group task types', () => {
    const added = M41.split('\n').filter((l) => l.startsWith('alter type tci.task_type add value '))
    expect(added).toHaveLength(2)
    expect(M41).toContain("add value 'group_exposure_near_limit'")
    expect(M41).toContain("add value 'group_limit_missing'")
  })

  it('never calls the combined figures a consolidation', () => {
    expect(M41).toContain('NOT an IFRS consolidation')
    expect(M41).toContain('members_missing_statements')
  })

  it('counts only interest-bearing borrowings as gross debt', () => {
    expect(M41).toContain(
      '(coalesce(b.long_term_borrowings, 0) + coalesce(b.short_term_borrowings, 0)) as gross_debt',
    )
    expect(M41).toContain('trade payables')
  })
})

// ---------------------------------------------------------------------------
// The pure helpers
// ---------------------------------------------------------------------------

describe('ownership tree', () => {
  it('nests children under their parent, largest holding first', () => {
    const t = buildOwnershipTree('top', 'Top', [
      rel({ parent_entity_id: 'top', child_entity_id: 'a', child_name: 'A', ownership_pct: 50 }),
      rel({ parent_entity_id: 'top', child_entity_id: 'b', child_name: 'B', ownership_pct: 90 }),
      rel({ parent_entity_id: 'b', child_entity_id: 'c', child_name: 'C', ownership_pct: 60 }),
    ])
    expect(t.children.map((c) => c.name)).toEqual(['B', 'A'])
    expect(t.children[0]!.children.map((c) => c.name)).toEqual(['C'])
    expect(t.children[0]!.ownershipPct).toBe(90)
  })

  it('terminates on a cycle and marks where it closed', () => {
    // A -> B -> C -> A, the same shape the migration asserts against.
    const t = buildOwnershipTree('a', 'A', [
      rel({ parent_entity_id: 'a', child_entity_id: 'b', child_name: 'B' }),
      rel({ parent_entity_id: 'b', child_entity_id: 'c', child_name: 'C' }),
      rel({ parent_entity_id: 'c', child_entity_id: 'a', child_name: 'A' }),
    ])
    const closing = t.children[0]!.children[0]!.children[0]!
    expect(closing.entityId).toBe('a')
    expect(closing.cyclic).toBe(true)
    expect(closing.children).toEqual([])
  })

  it('ignores edges that are no longer live', () => {
    const t = buildOwnershipTree('top', 'Top', [
      rel({ parent_entity_id: 'top', child_entity_id: 'old', child_name: 'Old', is_live: false }),
      rel({ parent_entity_id: 'top', child_entity_id: 'now', child_name: 'Now' }),
    ])
    expect(t.children.map((c) => c.name)).toEqual(['Now'])
  })

  it('stops at the depth cap', () => {
    const chain = Array.from({ length: 6 }, (_, i) =>
      rel({ parent_entity_id: `n${i}`, child_entity_id: `n${i + 1}`, child_name: `N${i + 1}` }),
    )
    const t = buildOwnershipTree('n0', 'N0', chain, 3)
    let depth = 0
    let node = t
    while (node.children.length) {
      node = node.children[0]!
      depth += 1
    }
    expect(depth).toBe(3)
  })

  it('names the members the tree could not reach', () => {
    const t = buildOwnershipTree('top', 'Top', [
      rel({ parent_entity_id: 'top', child_entity_id: 'a', child_name: 'A' }),
    ])
    // `sister` is in the group (via common_owner elsewhere) but hangs off no
    // parent edge from the root, so it must still be listed.
    expect(membersOutsideTree(t, ['top', 'a', 'sister'])).toEqual(['sister'])
  })
})

describe('exposure breakdowns', () => {
  const lines: GroupExposureLine[] = [
    {
      ultimate_parent_id: 'top', member_id: 'a', member_name: 'A',
      policy_id: 'p1', policy_number: 'P1', policyholder_id: 'h1', policyholder_name: 'H1',
      decision_id: 'd1', request_id: 'r1', scope_id: 'p1',
      approved_amount: 100, currency_code: 'UZS', amount_uzs: 100, rate_missing: false, valid_until: null,
    },
    {
      ultimate_parent_id: 'top', member_id: 'b', member_name: 'B',
      policy_id: 'p1', policy_number: 'P1', policyholder_id: 'h1', policyholder_name: 'H1',
      decision_id: 'd2', request_id: 'r2', scope_id: 'p1',
      approved_amount: 300, currency_code: 'UZS', amount_uzs: 300, rate_missing: false, valid_until: null,
    },
    {
      ultimate_parent_id: 'top', member_id: 'a', member_name: 'A',
      policy_id: 'p2', policy_number: 'P2', policyholder_id: 'h2', policyholder_name: 'H2',
      decision_id: 'd3', request_id: 'r3', scope_id: 'p2',
      approved_amount: 7, currency_code: 'XXX', amount_uzs: null, rate_missing: true, valid_until: null,
    },
  ]

  it('sums per member, largest first, and never treats a missing rate as zero', () => {
    const rows = exposureByMember(lines)
    expect(rows.map((r) => r.memberId)).toEqual(['b', 'a'])
    expect(rows.find((r) => r.memberId === 'a')!.exposureUzs).toBe(100)
    expect(rows.find((r) => r.memberId === 'a')!.missingRates).toBe(1)
  })

  it('sums per policyholder, counting distinct policies', () => {
    const rows = exposureByPolicyholder(lines)
    expect(rows[0]).toMatchObject({ policyholderId: 'h1', exposureUzs: 400, policies: 1 })
    expect(rows[1]).toMatchObject({ policyholderId: 'h2', exposureUzs: 0, policies: 1 })
  })
})

describe('preflight presentation', () => {
  const base: GroupPreflight = {
    ultimate_parent_id: 'top', group_size: 3, has_group_limit: true,
    group_limit_id: 'g1', group_limit_amount: 100, group_limit_currency: 'UZS',
    group_limit_uzs: 100, exposure_uzs: 50, replaced_uzs: 0, added_uzs: 20,
    exposure_after_uzs: 70, headroom_uzs: 30, over_limit: false,
    utilisation_pct: 70, missing_rates: 0,
  }

  it('says nothing when there is no group limit', () => {
    expect(preflightState({ ...base, has_group_limit: false }).kind).toBe('no_limit')
  })

  it('is calm below the warning share', () => {
    expect(preflightState(base)).toEqual({ kind: 'ok', tone: 'pos' })
  })

  it('warns at the configured share', () => {
    expect(preflightState({ ...base, utilisation_pct: 90 })).toEqual({ kind: 'warn', tone: 'warn' })
  })

  it('is a hard error over the limit', () => {
    expect(
      preflightState({ ...base, over_limit: true, utilisation_pct: 130 }),
    ).toEqual({ kind: 'over', tone: 'neg' })
  })

  it('tones utilisation the way the financial display rules expect', () => {
    expect(utilisationTone(null)).toBe('neutral')
    expect(utilisationTone(10)).toBe('pos')
    expect(utilisationTone(95)).toBe('warn')
    expect(utilisationTone(101)).toBe('neg')
  })
})

describe('member rankings and signals', () => {
  it('drops members without the figure rather than ranking them as zero', () => {
    const rows = rankMembers(
      [
        { member_id: 'a', revenue: 10 },
        { member_id: 'b', revenue: null },
        { member_id: 'c', revenue: 30 },
      ] as never,
      'revenue',
    )
    expect(rows.map((r) => r.member_id)).toEqual(['c', 'a'])
  })

  it('orders the signals behind a suggestion strongest first', () => {
    const s = sortedSignals({
      signals: {
        address: { score: 0.35, value: 'x' },
        email_domain: { score: 0.6, value: 'alfa.uz' },
      },
    } as never)
    expect(s.map((x) => x.signal)).toEqual(['email_domain', 'address'])
  })
})

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe('group refusals — contract with the migrations', () => {
  const ALL = `${M38}\n${M39}\n${M40}`

  it('every mapped fragment still exists in the SQL', () => {
    for (const refusal of GROUP_REFUSALS) {
      expect(ALL, `missing refusal fragment: ${refusal.fragment}`).toContain(refusal.fragment)
    }
  })

  it('maps a refusal to its key and leaves an unknown failure alone', () => {
    expect(groupErrorKey({ message: 'a company cannot be related to itself' })).toBe(
      'groups.errors.selfReference',
    )
    // The index name is the only stable thing in a unique-violation message.
    expect(
      groupErrorKey({
        message:
          'duplicate key value violates unique constraint "entity_relationships_live_uq"',
      }),
    ).toBe('groups.errors.duplicateEdge')
    // An unknown failure gets the generic message, which is what it deserves.
    expect(groupErrorKey({ message: 'connection reset by peer' })).toBeNull()
    expect(groupErrorKey(null)).toBeNull()
  })

  it('the commercial adjustment refuses outright rather than escalating', () => {
    // decide_limit_request escalates; adjust_limit_commercial raises, because
    // there is no escalated state for an adjustment. Both texts must stay.
    expect(M40).toContain("'result', 'group_limit_exceeded'")
    expect(M40).toContain('this adjustment would take the group to')
  })
})
