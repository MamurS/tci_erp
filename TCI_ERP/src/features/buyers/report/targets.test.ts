/** The dashboard drill-down mapping must cover every narrative bullet the
 * narrative module can emit, and always produce a valid buyer-page target. */

import { describe, expect, it } from 'vitest'

import {
  NARRATIVE_TARGETS,
  factorChipTarget,
  narrativeTarget,
  targetSearchParams,
} from './targets'

/** Complete inventory of keys buildNarrative can emit (narrative.ts). */
const NARRATIVE_KEYS = [
  'revenue_grew', 'revenue_fell', 'revenue_flat', 'revenue_level',
  'gross_margin_up', 'gross_margin_down', 'net_profit_positive', 'net_loss',
  'leverage_low', 'leverage_moderate', 'leverage_high',
  'liquidity_ok', 'liquidity_breach',
  'cfo_positive', 'cfo_negative', 'cfo_negative_persistent',
  'dso_up', 'dso_down', 'ccc_level',
  'z_safe', 'z_grey', 'z_distress', 'norm_breaches',
]

const VALID_TABS = ['overview', 'financials', 'rating']
const VALID_SUBS = ['balance', 'pnl', 'ratios', 'cashflow', 'risk']

describe('bullet → target mapping', () => {
  it('has an explicit target for every narrative key', () => {
    for (const key of NARRATIVE_KEYS) {
      expect(NARRATIVE_TARGETS[key], `missing target for ${key}`).toBeDefined()
    }
  })

  it('has no stale mappings for keys the narrative cannot emit', () => {
    for (const key of Object.keys(NARRATIVE_TARGETS)) {
      expect(NARRATIVE_KEYS, `stale mapping ${key}`).toContain(key)
    }
  })

  it('every target is a valid tab / sub-tab combination', () => {
    for (const [key, target] of Object.entries(NARRATIVE_TARGETS)) {
      expect(VALID_TABS, key).toContain(target.tab)
      if (target.sub) {
        expect(target.tab).toBe('financials')
        expect(VALID_SUBS, key).toContain(target.sub)
      }
    }
  })

  it('maps the accepted examples: CFO → cash flow, liquidity/norms → risk, margins → P&L', () => {
    expect(narrativeTarget('cfo_negative')).toEqual({ tab: 'financials', sub: 'cashflow' })
    expect(narrativeTarget('liquidity_breach')).toEqual({ tab: 'financials', sub: 'risk' })
    expect(narrativeTarget('norm_breaches')).toEqual({ tab: 'financials', sub: 'risk' })
    expect(narrativeTarget('gross_margin_down')).toEqual({ tab: 'financials', sub: 'pnl' })
  })

  it('factor chips drill into the Rating factor table', () => {
    expect(factorChipTarget()).toEqual({ tab: 'rating', anchor: 'factors' })
  })

  it('serializes targets to buyer-page search params', () => {
    expect(targetSearchParams({ tab: 'financials', sub: 'cashflow' })).toEqual({
      tab: 'financials',
      sub: 'cashflow',
    })
    expect(targetSearchParams({ tab: 'rating', anchor: 'factors' })).toEqual({
      tab: 'rating',
      anchor: 'factors',
    })
  })

  it('falls back to the Financials tab for unknown keys', () => {
    expect(narrativeTarget('unknown_future_key')).toEqual({ tab: 'financials' })
  })
})
