import { describe, expect, it } from 'vitest'

import M85 from '../../../../supabase/migrations/0085_sector_country_risk.sql?raw'
import { DEFAULT_ADJUSTMENTS } from '../../risk/rules'
import type { RiskAdjustment } from '../../risk/rules'
import {
  CAP_GRADES,
  COVER_STATES,
  RISK_BOUNDS,
  adjustmentProblems,
  flagState,
  mayManageSanctions,
  rankColumn,
  sameAdjustment,
  sameSettings,
  sanctionFormProblems,
  settingsProblems,
} from './riskSettingsForm'

const quoted = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ')

describe('the bounds are the 0085 checks', () => {
  it('adjustment table', () => {
    const b = RISK_BOUNDS
    expect(M85).toContain(`check (notch between ${b.notch.min} and ${b.notch.max}),`)
    expect(M85).toContain(`check (rank_floor between ${b.rankFloor.min} and ${b.rankFloor.max}),`)
    expect(M85).toContain(`check (rank_add between ${b.rankAdd.min} and ${b.rankAdd.max}),`)
    expect(M85).toContain(
      `premium_loading_pct numeric(6,2) not null default 0 check (premium_loading_pct between ${b.premiumLoading.min} and ${b.premiumLoading.max}),`,
    )
    expect(M85).toContain(`check (cap_grade is null or cap_grade in (${quoted(CAP_GRADES)})),`)
    expect(M85).toContain(`check (cover in (${quoted(COVER_STATES)})),`)
  })

  it('settings', () => {
    const b = RISK_BOUNDS
    expect(M85).toContain(`check (sector_review_due_day between ${b.sectorReviewDueDay.min} and ${b.sectorReviewDueDay.max}),`)
    expect(M85).toContain(`check (oecd_stale_months between ${b.oecdStaleMonths.min} and ${b.oecdStaleMonths.max}),`)
    expect(M85).toContain(
      `concentration_warn_pct numeric(5,2) not null default 40\n    constraint workflow_settings_concentration check (concentration_warn_pct between ${b.concentrationWarnPct.min} and ${b.concentrationWarnPct.max}),`,
    )
  })

  it('the cover matrix reads the country floor and the sector addition only', () => {
    expect(M85).toContain("coalesce((select a.rank_floor from tci.risk_adjustment_settings a")
    expect(M85).toContain("+ coalesce((select a.rank_add from tci.risk_adjustment_settings a")
    expect(rankColumn({ dimension: 'country' })).toBe('rank_floor')
    expect(rankColumn({ dimension: 'sector' })).toBe('rank_add')
  })
})

describe('adjustmentProblems', () => {
  const base: RiskAdjustment = DEFAULT_ADJUSTMENTS.find((a) => a.dimension === 'country' && a.key === '6')!

  it('the seeded defaults are all valid', () => {
    for (const a of DEFAULT_ADJUSTMENTS) expect(adjustmentProblems(a)).toEqual([])
  })

  it('refuses out-of-range and fractional values, field by field', () => {
    expect(adjustmentProblems({ ...base, notch: 7 })).toEqual(['notch'])
    expect(adjustmentProblems({ ...base, notch: -6 })).toEqual([])
    expect(adjustmentProblems({ ...base, notch: 1.5 })).toEqual(['notch'])
    expect(adjustmentProblems({ ...base, cap_grade: 'A3' })).toEqual(['cap_grade'])
    expect(adjustmentProblems({ ...base, cap_grade: null })).toEqual([])
    expect(adjustmentProblems({ ...base, cover: 'none' as RiskAdjustment['cover'] })).toEqual(['cover'])
    expect(adjustmentProblems({ ...base, rank_floor: 6 })).toEqual(['rank_floor'])
    expect(adjustmentProblems({ ...base, rank_add: 5 })).toEqual(['rank_add'])
    expect(adjustmentProblems({ ...base, premium_loading_pct: 500 })).toEqual([])
    expect(adjustmentProblems({ ...base, premium_loading_pct: 500.01 })).toEqual(['premium_loading_pct'])
    expect(adjustmentProblems({ ...base, premium_loading_pct: 12.345 })).toEqual(['premium_loading_pct'])
    expect(adjustmentProblems({ ...base, premium_loading_pct: 12.35 })).toEqual([])
  })

  it('compares lines value by value', () => {
    expect(sameAdjustment(base, { ...base })).toBe(true)
    expect(sameAdjustment(base, { ...base, cap_grade: null })).toBe(false)
    expect(sameAdjustment(base, { ...base, premium_loading_pct: Number(String(base.premium_loading_pct)) })).toBe(true)
  })
})

describe('settingsProblems', () => {
  const ok = { sector_review_due_day: 15, oecd_stale_months: 6, concentration_warn_pct: 40 }
  it('accepts the defaults and the edges', () => {
    expect(settingsProblems(ok)).toEqual([])
    expect(settingsProblems({ sector_review_due_day: 90, oecd_stale_months: 36, concentration_warn_pct: 100 })).toEqual([])
    expect(settingsProblems({ sector_review_due_day: 1, oecd_stale_months: 1, concentration_warn_pct: 1 })).toEqual([])
  })
  it('refuses what the checks refuse', () => {
    expect(settingsProblems({ sector_review_due_day: 0, oecd_stale_months: 37, concentration_warn_pct: 0.5 })).toEqual([
      'sector_review_due_day',
      'oecd_stale_months',
      'concentration_warn_pct',
    ])
    expect(settingsProblems({ ...ok, sector_review_due_day: null })).toEqual(['sector_review_due_day'])
  })
  it('compares every value', () => {
    const s = { ...ok, sector_review_four_eyes: false, client_show_oecd: false }
    expect(sameSettings(s, { ...s })).toBe(true)
    expect(sameSettings(s, { ...s, client_show_oecd: true })).toBe(false)
    expect(sameSettings(s, { ...s, sector_review_four_eyes: true })).toBe(false)
  })
})

describe('sanctions', () => {
  it('mayManageSanctions mirrors tci.may_manage_sanctions: admin today', () => {
    const body = /create function tci\.may_manage_sanctions\(\) returns boolean\n[^\n]*\$\$\n([\s\S]*?)\n\$\$;/.exec(M85)
    expect(body?.[1]?.trim()).toBe("select tci.has_role('admin')")
    expect(mayManageSanctions(['admin'])).toBe(true)
    for (const role of ['sales', 'credit_underwriter', 'credit_analyst', 'commercial_underwriter', 'claims', 'information_manager', 'client'])
      expect(mayManageSanctions([role])).toBe(false)
    expect(mayManageSanctions([])).toBe(false)
  })

  it('a flag is live from its effective date until lifted', () => {
    expect(flagState({ lifted_at: null, effective_from: '2026-10-27' }, '2026-10-27')).toBe('live')
    expect(flagState({ lifted_at: null, effective_from: '2026-11-01' }, '2026-10-27')).toBe('scheduled')
    expect(flagState({ lifted_at: '2026-10-20T10:00:00Z', effective_from: '2026-01-01' }, '2026-10-27')).toBe('lifted')
  })

  it('a new flag names its party and its source', () => {
    const base = { scope: 'country' as const, countryCode: 'RU', entityId: null, source: 'EU 833/2014', effectiveFrom: '2026-10-27' }
    expect(sanctionFormProblems(base)).toEqual([])
    expect(sanctionFormProblems({ ...base, countryCode: null, source: '  ' })).toEqual(['target', 'source'])
    expect(sanctionFormProblems({ ...base, scope: 'entity' })).toEqual(['target'])
    expect(sanctionFormProblems({ ...base, effectiveFrom: '' })).toEqual(['effective_from'])
    expect(M85).toContain("source         text not null check (btrim(source) <> ''),")
  })
})
