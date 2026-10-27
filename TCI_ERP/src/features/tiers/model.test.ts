import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0094_policyholder_tiers.sql?raw'
import { maySetThresholds, maySetTier, nextStep, THRESHOLD_TIERS, thresholdsValid, tierFor, tierMax, TIERS } from './model'
import type { TierThresholds } from './model'

const DEFAULTS: TierThresholds = {
  silver: { turnover_uzs: 60_000_000_000, premium_uzs: 120_000_000 },
  gold: { turnover_uzs: 300_000_000_000, premium_uzs: 600_000_000 },
  platinum: { turnover_uzs: 1_200_000_000_000, premium_uzs: 2_400_000_000 },
}

describe('policyholder tiers mirror 0094', () => {
  it('names the same tiers in the same order', () => {
    expect(MIGRATION).toContain(`select array[${TIERS.map((t) => `'${t}'`).join(', ')}]`)
    expect(MIGRATION).toContain(`foreach v_tier in array array[${THRESHOLD_TIERS.map((t) => `'${t}'`).join(', ')}] loop`)
  })

  it('starts from the same default thresholds', () => {
    for (const tier of THRESHOLD_TIERS) {
      expect(MIGRATION).toMatch(new RegExp(`"${tier}":\\s+\\{"turnover_uzs": ${DEFAULTS[tier].turnover_uzs},\\s+"premium_uzs": ${DEFAULTS[tier].premium_uzs}\\}`))
    }
  })

  it('lets a measure reach a tier at its threshold, the higher measure wins', () => {
    expect(MIGRATION).toContain("when p_amount >= (p_thresholds -> 'platinum' ->> p_measure)::numeric then 'platinum'")
    expect(MIGRATION).toContain('tci.policyholder_tier_max(t.turnover_tier, t.premium_tier) as automatic_tier')
    expect(tierFor(60_000_000_000, 'turnover_uzs', DEFAULTS)).toBe('silver')
    expect(tierFor(59_999_999_999.99, 'turnover_uzs', DEFAULTS)).toBe('bronze')
    expect(tierFor(null, 'premium_uzs', DEFAULTS)).toBe('bronze')
    expect(tierFor(2_400_000_000, 'premium_uzs', DEFAULTS)).toBe('platinum')
    expect(tierMax('silver', 'gold')).toBe('gold')
    expect(tierMax('platinum', 'bronze')).toBe('platinum')
  })

  it('refuses thresholds that do not rise', () => {
    expect(thresholdsValid(DEFAULTS)).toBe(true)
    expect(thresholdsValid({ ...DEFAULTS, gold: { turnover_uzs: 1, premium_uzs: 600_000_000 } })).toBe(false)
    expect(thresholdsValid({ ...DEFAULTS, silver: { turnover_uzs: 0, premium_uzs: 1 } })).toBe(false)
  })

  it('says what the next tier needs', () => {
    expect(nextStep(150_000_000_000, 'turnover_uzs', DEFAULTS)).toEqual({
      tier: 'gold',
      threshold: 300_000_000_000,
      missing: 150_000_000_000,
      share: 0.5,
    })
    expect(nextStep(3_000_000_000, 'premium_uzs', DEFAULTS)).toBeNull()
  })

  it('lets commercial underwriting set a tier and admin the thresholds', () => {
    expect(MIGRATION).toContain("perform tci.require_role('commercial_underwriter');")
    expect(MIGRATION).toContain("perform tci.require_role('admin');")
    expect(maySetTier('commercial_underwriter')).toBe(true)
    expect(maySetTier('admin')).toBe(false)
    expect(maySetTier('sales')).toBe(false)
    expect(maySetThresholds('admin')).toBe(true)
    expect(maySetThresholds('commercial_underwriter')).toBe(false)
  })
})
