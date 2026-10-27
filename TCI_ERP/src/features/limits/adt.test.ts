/** Contract test: adt.ts must mirror migration 0061 — the ADT statuses, why a
 * request was not decided automatically, why an ADT is suspended, the mark an
 * auto decision carries, who may read and write what, the bounds of the
 * settings, and every refusal the screens name. Each rule is read from the
 * migration TEXT, so the two sides cannot drift apart silently. */

import { describe, expect, it } from 'vitest'

import M28 from '../../../supabase/migrations/0028_overdue_notifications.sql?raw'
import M34 from '../../../supabase/migrations/0034_indemnity_recoveries.sql?raw'
import M61 from '../../../supabase/migrations/0061_auto_decisions.sql?raw'
import M63 from '../../../supabase/migrations/0063_acting_role.sql?raw'
import M73 from '../../../supabase/migrations/0073_rating_proposals.sql?raw'
import M83 from '../../../supabase/migrations/0083_adt_count_max.sql?raw'
import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import { OPERATIONS_REFUSALS, refusalKey } from '../../lib/refusals'
import {
  ADT_BUYER_STOPS,
  ADT_COUNT_BOUNDS,
  ADT_COUNT_CHOICES,
  ADT_REVIEW_REASONS,
  ADT_SETTINGS_BOUNDS,
  ADT_STATUSES,
  ADT_SUSPENSION_REASONS,
  AUTO_DECISION_REASON_KEY,
  AUTO_DECISION_REASONS,
  SYSTEM_REASON_KEYS,
  adtFormValid,
  adtWithinAuthority,
  banNeedsReason,
  canManageAutoDecisions,
  canSeeAdt,
  canSetAdt,
  decisionMarkKey,
  filterReport,
  isAutoDecision,
  latestAttempt,
  parseAdtState,
  parseSettings,
  reportBuyers,
  settingsValid,
  withBlock,
  withoutLive,
} from './adt'
import type { AdtState } from './adt'
import { limitViewsFor } from './workbench/views'

/** The body of one function in 0061, from its create statement to its end. */
/** The LATEST definition of a function: 0063 restated the ADT writers. */
function fn(name: string): string {
  for (const migration of [M63, M61]) {
    const start = migration.search(new RegExp(`create (or replace )?function tci\\.${name}\\(`, 'i'))
    if (start < 0) continue
    const rest = migration.slice(start)
    return rest.slice(0, rest.search(/\n\$(function)?\$\n?;/))
  }
  throw new Error(`${name} is defined in neither 0061 nor 0063`)
}

/** The i18n keys a body appends to its reasons, in order of first use. */
function appended(body: string): string[] {
  return [...new Set([...body.matchAll(/v_(?:reasons|out) := v_(?:reasons|out) \|\| '([a-z_]+)'::text;/g)].map((m) => m[1]!))]
}

function leaf(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict)
}

describe('vocabularies (0061)', () => {
  it('ADT statuses are tci.adt_status, in order', () => {
    expect(M61).toContain("create type tci.adt_status as enum ('active', 'suspended', 'replaced', 'disabled');")
    expect([...ADT_STATUSES]).toEqual(['active', 'suspended', 'replaced', 'disabled'])
  })

  it('the stop factors are tci.adt_buyer_stops’, in its order', () => {
    expect(appended(fn('adt_buyer_stops'))).toEqual([...ADT_BUYER_STOPS])
  })

  it('the reasons are the ones tci.try_auto_decision records, in the order it finds them', () => {
    const rule = fn('try_auto_decision')
    const own = appended(rule)
    // the buyer's stop factors are appended where the rule calls them, and the
    // group limit last
    expect(rule).toContain('v_reasons := v_reasons || tci.adt_buyer_stops(v_request.entity_id);')
    const at = own.indexOf('group_limit')
    const order = [...own.slice(0, at), ...ADT_BUYER_STOPS, ...own.slice(at)]
    // 0073 restates the body: a rating without a recommended limit is tested
    // right after the rating is found, before its fx and amount
    expect(M73).toContain(`    -- 0073: a manual rating carries no recommended limit to stay under.
    if v_assessment.suggested_limit is null then
      v_reasons := v_reasons || ''no_recommended_limit''::text;
    elsif v_rec_uzs is null or v_req_uzs is null then`)
    order.splice(order.indexOf('no_rating') + 1, 0, 'no_recommended_limit')
    expect(order).toEqual([...AUTO_DECISION_REASONS])
  })

  it('an ADT is suspended for a downgrade or the first stop factor (and a ban)', () => {
    expect(fn('recheck_buyer_adt')).toContain("return tci.suspend_buyer_adt(p_entity_id, 'downgrade');")
    expect(fn('recheck_buyer_adt')).toContain('return tci.suspend_buyer_adt(p_entity_id, v_stops[1]);')
    expect(fn('set_buyer_adt_block')).toContain("perform tci.suspend_buyer_adt(p_entity_id, 'manual_block');")
    expect([...ADT_SUSPENSION_REASONS]).toEqual(['downgrade', ...ADT_BUYER_STOPS])
  })

  it('the review task is titled by its reason: used up, or a suspension reason', () => {
    expect(fn('handle_adt_event')).toContain(
      "'agenda.tasks.adt_review_' || case when new.event_type = 'adt.exhausted' then 'exhausted'",
    )
    expect(fn('handle_adt_event')).toContain("elsif new.event_type in ('adt.suspended', 'adt.exhausted') then")
    expect(fn('suspend_buyer_adt')).toContain("perform tci.emit_workflow_event('adt.suspended', 'legal_entity', p_entity_id,")
    expect([...ADT_REVIEW_REASONS]).toEqual(['exhausted', ...ADT_SUSPENSION_REASONS])
  })
})

describe('the auto decision itself', () => {
  const rule = fn('try_auto_decision')

  it('is an ordinary decision row, marked limits.auto.adt, with no author, released at once', () => {
    expect(rule).toContain("v_assessment.id, v_policy.max_payment_terms_days, null, true, 'limits.auto.adt',")
    expect(rule).toContain("now(), 'immediate', v_adt.id)")
    expect(AUTO_DECISION_REASON_KEY).toBe('limits.auto.adt')
    expect(isAutoDecision({ system_reason_key: 'limits.auto.adt' })).toBe(true)
    expect(isAutoDecision({ system_reason_key: 'limits.systemReason.noaSuspension' })).toBe(false)
  })

  it('every system reason a decision can carry is named by the screens, in three languages', () => {
    expect(M28).toContain("'limits.systemReason.noaSuspension'")
    expect(M34).toContain("'limits.systemReason.claimApproved'")
    for (const key of SYSTEM_REASON_KEYS) {
      for (const locale of [en, ru, uz]) expect(typeof leaf(locale, key), key).toBe('string')
    }
    expect(decisionMarkKey({ system_reason_key: 'limits.auto.adt' })).toBe('limits.auto.adt')
    expect(decisionMarkKey({ system_reason_key: null })).toBeNull()
    // an unknown key is never printed raw
    expect(decisionMarkKey({ system_reason_key: 'limits.something.new' })).toBeNull()
  })

  it('the snapshot carries what the request page reads', () => {
    for (const key of [
      'rating_grade',
      'rating_score',
      'grade_band',
      'recommended_limit',
      'recommended_currency',
      'requested_amount',
      'requested_currency',
      'adt_max_amount',
      'adt_currency',
      'adt_total',
      'adt_remaining_before',
    ])
      expect(rule).toContain(`'${key}'`)
    expect(rule).toContain("v_snapshot || jsonb_build_object('adt_remaining_after', v_adt.total_count - v_used - 1)")
  })

  it('the report view has the columns the report reads', () => {
    const view = M61.slice(M61.indexOf('create view tci.v_auto_decisions'), M61.indexOf('comment on view tci.v_auto_decisions'))
    for (const col of [
      'att.attempted_at as decided_at',
      'att.request_id',
      'att.entity_id as buyer_id',
      'buyer.name as buyer_name',
      'pol.policy_number',
      'holder.name as policyholder_name',
      'd.approved_amount as amount',
      'd.lifecycle',
      'a.total_count as adt_total',
      'as adt_remaining_now',
    ])
      expect(view).toContain(col)
    expect(view).toContain('with (security_invoker = true)')
  })

  it('a reason key is named in every language', () => {
    for (const locale of [en, ru, uz]) {
      for (const r of [...AUTO_DECISION_REASONS, 'downgrade'])
        expect(typeof leaf(locale, `limits.auto.reasons.${r}`), r).toBe('string')
      for (const s of ADT_STATUSES) expect(typeof leaf(locale, `limits.adt.statuses.${s}`), s).toBe('string')
    }
  })
})

describe('who (the gates the screens assume)', () => {
  it('credit analysts set, disable and ban too, and read (0073)', () => {
    for (const f of ['set_buyer_adt', 'disable_buyer_adt', 'set_buyer_adt_block'])
      expect(M73).toContain(`'tci.${f}(`)
    expect(M73).toContain(
      "execute replace(v_def, 'perform tci.require_role(''credit_underwriter'');',\n                           'perform tci.require_role(''credit_underwriter'', ''credit_analyst'');');",
    )
    expect(M73).toContain(
      "execute replace(v_def, 'perform tci.require_role(''admin'', ''credit_underwriter'');',\n                           'perform tci.require_role(''admin'', ''credit_underwriter'', ''credit_analyst'');');",
    )
    for (const table of ['buyer_adt', 'buyer_adt_blocks', 'auto_decision_attempts'])
      expect(M73).toContain(
        `alter policy "${table}: credit desk" on tci.${table}\n  using (tci.has_role('admin', 'credit_underwriter', 'credit_analyst'));`,
      )
    expect(canSetAdt(['credit_analyst'])).toBe(true)
    expect(canSeeAdt(['credit_analyst'])).toBe(true)
    expect(limitViewsFor(['credit_analyst'])).toContain('auto')
  })

  it('credit underwriting sets, disables and bans; admin reads and alone switches (0063)', () => {
    for (const f of ['set_buyer_adt', 'disable_buyer_adt', 'set_buyer_adt_block'])
      expect(fn(f), f).toContain("perform tci.require_role('credit_underwriter');")
    const desk = "perform tci.require_role('admin', 'credit_underwriter');"
    for (const f of ['auto_decision_settings', 'buyer_adt_state']) expect(fn(f), f).toContain(desk)
    expect(fn('set_auto_decision_settings')).toContain("perform tci.require_role('admin');")
    expect(canSetAdt(['credit_underwriter'])).toBe(true)
    expect(canSetAdt(['admin'])).toBe(false)
    expect(canSeeAdt(['credit_underwriter'])).toBe(true)
    expect(canSeeAdt(['admin'])).toBe(true)
    for (const role of ['sales', 'commercial_underwriter', 'information_manager', 'claims', 'client'] as const)
      expect(canSeeAdt([role]), role).toBe(false)
    expect(canManageAutoDecisions(['admin'])).toBe(true)
    expect(canManageAutoDecisions(['credit_underwriter'])).toBe(false)
  })

  it('RLS shows the three tables to the credit desk only', () => {
    for (const table of ['buyer_adt', 'buyer_adt_blocks', 'auto_decision_attempts'])
      expect(M61).toMatch(
        new RegExp(`create policy "${table}: credit desk" on tci\\.${table} for select to authenticated\\n  using \\(tci\\.has_role\\('admin', 'credit_underwriter'\\)\\);`),
      )
  })

  it('the report is a credit-desk view of the workbench', () => {
    expect(limitViewsFor(['credit_underwriter'])).toContain('auto')
    expect(limitViewsFor(['admin'])).toContain('auto')
    expect(limitViewsFor(['sales'])).not.toContain('auto')
    expect(limitViewsFor(['commercial_underwriter'])).not.toContain('auto')
  })
})

describe('settings', () => {
  it('a missing switch means OFF, so the screen always sends it', () => {
    expect(fn('set_auto_decision_settings')).toContain('set auto_decisions_enabled = coalesce(p_enabled, false),')
    expect(M61).toContain('add column auto_decisions_enabled boolean not null default false,')
  })

  it('mirrors the bounds of the check constraints', () => {
    expect(M61).toContain('check (adt_limit_validity_months between 1 and 60)')
    expect(M61).toContain('check (adt_financials_max_age_months between 3 and 60)')
    expect(M61).toContain('total_count       integer not null check (total_count between 1 and 1000)')
    expect(ADT_SETTINGS_BOUNDS).toEqual({ validityMonths: { min: 1, max: 60 }, financialsMaxAgeMonths: { min: 3, max: 60 } })
    expect(M83).toContain('add constraint buyer_adt_total_count_max check (total_count <= 5);')
    expect(ADT_COUNT_BOUNDS).toEqual({ min: 1, max: 5 })
    expect(ADT_COUNT_CHOICES).toEqual([1, 2, 3, 4, 5])
    expect(settingsValid({ validityMonths: 12, financialsMaxAgeMonths: 15 })).toBe(true)
    expect(settingsValid({ validityMonths: 0, financialsMaxAgeMonths: 15 })).toBe(false)
    expect(settingsValid({ validityMonths: 12, financialsMaxAgeMonths: 2 })).toBe(false)
    expect(settingsValid({ validityMonths: 61, financialsMaxAgeMonths: 15 })).toBe(false)
    expect(settingsValid({ validityMonths: 1.5, financialsMaxAgeMonths: 15 })).toBe(false)
    expect(settingsValid({ validityMonths: null, financialsMaxAgeMonths: 15 })).toBe(false)
  })

  it('reads the settings jsonb', () => {
    expect(parseSettings({ enabled: true, validity_months: 6, financials_max_age_months: '18' })).toEqual({
      enabled: true,
      validity_months: 6,
      financials_max_age_months: 18,
    })
    expect(parseSettings([])).toBeNull()
  })
})

describe('setting an ADT', () => {
  it('mirrors the authority test of set_buyer_adt (nobody exempt since 0063, strict >)', () => {
    expect(fn('set_buyer_adt')).toContain('  if v_amount_uzs > tci.my_authority_uzs(v_band) then')
    expect(adtWithinAuthority({ amountUzs: 100, authorityUzs: 100 })).toBe(true)
    expect(adtWithinAuthority({ amountUzs: 101, authorityUzs: 100 })).toBe(false)
    expect(adtWithinAuthority({ amountUzs: 1e15, authorityUzs: 0 })).toBe(false)
    expect(adtWithinAuthority({ amountUzs: null, authorityUzs: 100 })).toBeNull()
  })

  it('the band is the latest rating’s, and without one there is no ADT', () => {
    expect(fn('set_buyer_adt')).toContain('where a.entity_id = p_entity_id order by a.created_at desc limit 1;')
    expect(fn('set_buyer_adt')).toContain("raise exception 'adt_no_rating: rate the buyer before setting an ADT'")
  })

  it('accepts a positive amount and a whole count within the bounds', () => {
    expect(fn('set_buyer_adt')).toContain(
      'if p_max_amount is null or p_max_amount <= 0 or p_total_count is null or p_total_count < 1 then',
    )
    expect(adtFormValid({ amount: 1, count: 1, currency: 'UZS' })).toBe(true)
    expect(adtFormValid({ amount: 0, count: 1, currency: 'UZS' })).toBe(false)
    expect(adtFormValid({ amount: 5, count: 0, currency: 'UZS' })).toBe(false)
    expect(adtFormValid({ amount: 5, count: 1001, currency: 'UZS' })).toBe(false)
    expect(adtFormValid({ amount: 5, count: 2.5, currency: 'UZS' })).toBe(false)
    expect(adtFormValid({ amount: null, count: 1, currency: 'UZS' })).toBe(false)
  })

  it('a ban needs a reason; lifting it does not', () => {
    expect(fn('set_buyer_adt_block')).toContain("if p_blocked and coalesce(btrim(p_reason), '') = '' then")
    expect(banNeedsReason(true, '  ')).toBe(true)
    expect(banNeedsReason(true, 'fraud alert')).toBe(false)
    expect(banNeedsReason(false, '')).toBe(false)
  })
})

describe('every 0061 refusal is named on screen', () => {
  it('maps each refusal code the migration raises', () => {
    const codes = [...new Set([...M61.matchAll(/raise exception '([a-z_]+):/g)].map((m) => m[1]!))]
    expect(codes.length).toBeGreaterThanOrEqual(7)
    const mapped = OPERATIONS_REFUSALS.map((r) => r.fragment)
    expect(codes.filter((code) => !mapped.includes(code))).toEqual([])
  })

  it('names the ADT refusal before the generic «no UZS rate» one', () => {
    expect(refusalKey({ message: 'adt_fx_missing: no UZS rate for USD', code: 'P0001' })).toBe('limits.adt.errors.fxMissing')
    expect(refusalKey({ message: 'adt_beyond_authority: the ADT amount is beyond your authority for rating band B', code: 'P0001' })).toBe(
      'limits.adt.errors.beyondAuthority',
    )
    expect(refusalKey({ message: 'adt_none: this buyer has no ADT', code: 'P0002' })).toBe('limits.adt.errors.none')
  })
})

// ---------------------------------------------------------------------------
// Readings and optimistic paints
// ---------------------------------------------------------------------------

const live = {
  id: 'a2',
  status: 'active' as const,
  max_amount: 100,
  currency: 'UZS',
  total: 5,
  used: 2,
  remaining: 3,
  grade_band: 'B' as const,
  suspended_reason: null,
  suspended_at: null,
  comment: null,
  set_by: 'u',
  set_by_name: 'X',
  set_at: '2026-10-01T00:00:00Z',
}

const state: AdtState = {
  enabled: true,
  live,
  block: null,
  history: [
    { id: 'a2', status: 'active', max_amount: 100, currency: 'UZS', total: 5, used: 2, grade_band: 'B', set_by_name: 'X', set_at: '2026-10-01T00:00:00Z', ended_at: null, suspended_reason: null, comment: null },
    { id: 'a1', status: 'replaced', max_amount: 50, currency: 'UZS', total: 3, used: 3, grade_band: 'B', set_by_name: 'X', set_at: '2026-09-01T00:00:00Z', ended_at: '2026-10-01T00:00:00Z', suspended_reason: null, comment: null },
  ],
}

describe('reading buyer_adt_state', () => {
  it('turns numeric strings into numbers, and anything else into nothing', () => {
    const parsed = parseAdtState({
      enabled: false,
      live: { ...live, max_amount: '100.00', total: 5, used: '2', remaining: 3 },
      block: null,
      history: [{ ...state.history[0], max_amount: '100.00', used: '2' }],
    })
    expect(parsed?.live?.max_amount).toBe(100)
    expect(parsed?.live?.used).toBe(2)
    expect(parsed?.history[0]?.max_amount).toBe(100)
    expect(parsed?.enabled).toBe(false)
    expect(parseAdtState([])).toBeNull()
    expect(parseAdtState(null)).toBeNull()
    expect(parseAdtState({ enabled: true, live: null, block: null })?.history).toEqual([])
  })
})

describe('optimistic paints', () => {
  it('a ban suspends an active ADT for manual_block; lifting it reinstates nothing', () => {
    const banned = withBlock(state, true, ' fraud ', '2026-10-22T10:00:00Z')
    expect(banned.block).toMatchObject({ blocked: true, reason: 'fraud' })
    expect(banned.live).toMatchObject({ status: 'suspended', suspended_reason: 'manual_block' })
    expect(banned.history[0]).toMatchObject({ status: 'suspended', suspended_reason: 'manual_block' })
    const lifted = withBlock(banned, false, null, '2026-10-22T11:00:00Z')
    expect(lifted.block?.blocked).toBe(false)
    expect(lifted.live?.status).toBe('suspended')
  })

  it('a ban keeps the first suspension reason of an already suspended ADT', () => {
    const suspended = { ...state, live: { ...live, status: 'suspended' as const, suspended_reason: 'claims' } }
    expect(withBlock(suspended, true, 'x', 'now').live?.suspended_reason).toBe('claims')
  })

  it('disabling ends the live ADT and keeps it in the history', () => {
    const off = withoutLive(state, '2026-10-22T10:00:00Z')
    expect(off.live).toBeNull()
    expect(off.history[0]).toMatchObject({ status: 'disabled', ended_at: '2026-10-22T10:00:00Z' })
    expect(off.history[1]?.status).toBe('replaced')
    expect(fn('disable_buyer_adt')).toContain("set status = 'disabled', ended_at = now(), ended_by = (select auth.uid()),")
  })
})

describe('the request page and the report', () => {
  it('reads the latest attempt', () => {
    expect(latestAttempt([{ attempted_at: '2026-10-01' }, { attempted_at: '2026-10-03' }, { attempted_at: '2026-10-02' }])).toEqual({
      attempted_at: '2026-10-03',
    })
    expect(latestAttempt([])).toBeNull()
  })

  it('offers the buyers present, by name, and filters by one', () => {
    const rows = [
      { buyer_id: 'b', buyer_name: 'Beta' },
      { buyer_id: 'a', buyer_name: 'Alpha' },
      { buyer_id: 'b', buyer_name: 'Beta' },
    ]
    expect(reportBuyers(rows)).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ])
    expect(filterReport(rows, 'b')).toHaveLength(2)
    expect(filterReport(rows, '')).toHaveLength(3)
  })
})
