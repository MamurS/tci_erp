import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../../supabase/migrations/0053_credit_workbench_views.sql?raw'
import M69 from '../../../../supabase/migrations/0069_credit_analysis.sql?raw'
import type { CreditPortfolioRow } from '../../portfolio/aggregate'
import {
  countByReason,
  filterInForce,
  groupState,
  groupsAtRisk,
  ratingDeteriorated,
  reviewsDueOrOverdue,
  sortRatingWork,
  uzsTotal,
} from './model'
import type { GroupLimitRow, RatingWorkRow } from './types'
import { RATING_REASONS } from './types'
import { LEGACY_LIMIT_VIEW_PATHS, LIMIT_VIEWS, limitViewsFor, parseLimitView } from './views'

function limit(over: Partial<CreditPortfolioRow>): CreditPortfolioRow {
  return {
    decision_id: 'd',
    request_id: 'r',
    policy_id: 'p',
    policy_number: 'P-1',
    policyholder_entity_id: 'h',
    policyholder_name: 'Holder',
    buyer_entity_id: 'b',
    buyer_name: 'Buyer',
    buyer_country: 'UZ',
    outcome: 'approved',
    approved_amount: 100,
    currency_code: 'UZS',
    amount_uzs: 100,
    valid_until: null,
    days_to_review: null,
    decision_band: 'B',
    current_grade: 'B1',
    current_band: 'B',
    rated_at: '2026-01-01',
    ...over,
  }
}

function group(over: Partial<GroupLimitRow>): GroupLimitRow {
  return {
    ultimate_parent_id: 'g',
    ultimate_parent_name: 'Group',
    ultimate_parent_country: 'UZ',
    members_count: 3,
    members_with_limits: 2,
    limits_count: 2,
    policyholders_count: 1,
    exposure_uzs: 50,
    missing_rates: 0,
    group_limit_id: 'gl',
    limit_amount: 100,
    limit_currency: 'UZS',
    limit_valid_from: '2026-01-01',
    limit_valid_to: null,
    limit_uzs: 100,
    utilisation_pct: 50,
    over_limit: false,
    ...over,
  }
}

function work(over: Partial<RatingWorkRow>): RatingWorkRow {
  return {
    entity_id: 'e',
    buyer_name: 'Buyer',
    buyer_country: 'UZ',
    engine_grade: null,
    confirmed_at: null,
    assessment_id: null,
    grade: null,
    rated_at: null,
    rated_period_end: null,
    statements_count: 0,
    latest_period_end: null,
    latest_fiscal_year: null,
    open_requests: 0,
    limits_in_force: 0,
    band: 'unrated',
    reason: 'no_rating',
    ...over,
  }
}

describe('limit views', () => {
  it('gives the credit desk the whole workbench and everyone else the queue and the register', () => {
    expect(limitViewsFor(['credit_underwriter'])).toEqual(LIMIT_VIEWS)
    expect(limitViewsFor(['admin'])).toEqual(LIMIT_VIEWS)
    expect(limitViewsFor(['sales'])).toEqual(['queue', 'inforce'])
    expect(limitViewsFor(['commercial_underwriter', 'sales'])).toEqual(['queue', 'inforce'])
    // the credit analyst (0069): the analysis views, never the decision queue
    expect(limitViewsFor(['credit_analyst'])).toEqual(['ratings', 'monitoring', 'inforce', 'groups', 'auto'])
  })

  it('opens the requested view, an old ?tab= link on the queue, otherwise the first view', () => {
    expect(parseLimitView('ratings', null, ['credit_underwriter'])).toBe('ratings')
    expect(parseLimitView(null, null, ['credit_underwriter'])).toBe('overview')
    expect(parseLimitView(null, 'escalated', ['credit_underwriter'])).toBe('queue')
    expect(parseLimitView(null, null, ['sales'])).toBe('queue')
    // a view the roles may not see falls back rather than leaking
    expect(parseLimitView('authority', null, ['sales'])).toBe('queue')
    expect(parseLimitView('nonsense', null, ['admin'])).toBe('overview')
    expect(parseLimitView(null, null, ['credit_analyst'])).toBe('ratings')
    // an old ?tab= link does not open a queue the analyst does not have
    expect(parseLimitView(null, 'escalated', ['credit_analyst'])).toBe('ratings')
  })

  it('keeps the old portfolio address working', () => {
    expect(LEGACY_LIMIT_VIEW_PATHS['/portfolio/credit']).toBe('/limits?view=overview')
  })
})

describe('monitoring rules', () => {
  it('flags a buyer rated worse than the band the limit was decided in', () => {
    const rows = [
      limit({ decision_id: 'same', decision_band: 'B', current_band: 'B' }),
      limit({ decision_id: 'better', decision_band: 'C', current_band: 'A' }),
      limit({ decision_id: 'worse', decision_band: 'A', current_band: 'C' }),
      limit({ decision_id: 'worst', decision_band: 'B', current_band: 'D' }),
      limit({ decision_id: 'unrated-then', decision_band: 'unrated', current_band: 'D' }),
    ]
    expect(ratingDeteriorated(rows).map((r) => r.decision_id)).toEqual(['worst', 'worse'])
  })

  it('lists reviews due inside the window, overdue ones first', () => {
    const rows = [
      limit({ decision_id: 'later', days_to_review: 45 }),
      limit({ decision_id: 'soon', days_to_review: 10 }),
      limit({ decision_id: 'overdue', days_to_review: -3 }),
      limit({ decision_id: 'open-ended', days_to_review: null }),
    ]
    expect(reviewsDueOrOverdue(rows, 30).map((r) => r.decision_id)).toEqual(['overdue', 'soon'])
  })

  it('reads a group state from the database fields', () => {
    expect(groupState(group({ over_limit: true, utilisation_pct: 112.5 }))).toBe('over')
    expect(groupState(group({ utilisation_pct: '90.0' }))).toBe('near')
    expect(groupState(group({ utilisation_pct: 89.9 }))).toBe('within')
    expect(groupState(group({ utilisation_pct: null, group_limit_id: null }))).toBe('uncapped')
    const at = groupsAtRisk([
      group({ ultimate_parent_id: 'ok', utilisation_pct: 20 }),
      group({ ultimate_parent_id: 'near', utilisation_pct: 95 }),
      group({ ultimate_parent_id: 'over', over_limit: true, utilisation_pct: 130 }),
      group({ ultimate_parent_id: 'free', utilisation_pct: null }),
    ])
    expect(at.map((g) => g.ultimate_parent_id)).toEqual(['over', 'near'])
  })
})

describe('rating worklist', () => {
  it('orders blockers first, then by live business', () => {
    const rows = [
      work({ entity_id: 'stale', reason: 'stale', limits_in_force: 3 }),
      work({ entity_id: 'new', reason: 'new_statement' }),
      work({ entity_id: 'nostat', reason: 'no_statements' }),
      work({ entity_id: 'unrated-quiet', reason: 'no_rating' }),
      work({ entity_id: 'unrated-busy', reason: 'no_rating', open_requests: 2 }),
    ]
    expect(sortRatingWork(rows).map((r) => r.entity_id)).toEqual([
      'nostat',
      'unrated-busy',
      'unrated-quiet',
      'new',
      'stale',
    ])
    expect(countByReason(rows)).toEqual({ no_statements: 1, no_rating: 2, new_statement: 1, stale: 1, unconfirmed: 0 })
  })
})

describe('in-force register', () => {
  const rows = [
    limit({ decision_id: '1', buyer_name: 'Alpha', current_band: 'A', buyer_country: 'DE', currency_code: 'EUR', amount_uzs: '1000' }),
    limit({ decision_id: '2', buyer_name: 'Beta', current_band: 'C', policy_number: 'TCI-77', amount_uzs: null }),
    limit({ decision_id: '3', buyer_name: 'Gamma', current_band: 'C', policyholder_name: 'Seller Beta', amount_uzs: 500 }),
  ]

  it('filters by text, band, country and currency', () => {
    const base = { query: '', band: '', country: '', currency: '' }
    expect(filterInForce(rows, { ...base, query: 'beta' }).map((r) => r.decision_id)).toEqual(['2', '3'])
    expect(filterInForce(rows, { ...base, query: 'tci-77' }).map((r) => r.decision_id)).toEqual(['2'])
    expect(filterInForce(rows, { ...base, band: 'C' }).map((r) => r.decision_id)).toEqual(['2', '3'])
    expect(filterInForce(rows, { ...base, country: 'DE', currency: 'EUR' }).map((r) => r.decision_id)).toEqual(['1'])
  })

  it('totals UZS over the rows with a rate and counts the rest', () => {
    expect(uzsTotal(rows)).toEqual({ uzs: 1500, missing: 1 })
  })
})

describe('contract with migration 0053', () => {
  it('lists the rating reasons in the order the view tests them (as restated by 0069)', () => {
    const positions = RATING_REASONS.map((r) => M69.indexOf(`THEN '${r}'::text`))
    expect(positions.every((p) => p > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('decides "alone" as admin or within the band authority', () => {
    expect(MIGRATION).toContain("tci.has_role('admin')")
    expect(MIGRATION).toContain('<= coalesce(auth_.authority_uzs, 0))')
    expect(MIGRATION).toContain("where r.status in ('submitted', 'under_review', 'escalated');")
  })

  it('takes over_limit and utilisation from the group view', () => {
    expect(MIGRATION).toContain('as over_limit')
    expect(MIGRATION).toContain('as utilisation_pct')
    expect(MIGRATION).toContain('where gs.members > 1 or ll.id is not null;')
  })
})
