/**
 * Policyholder tiers (migration 0094): bronze, silver, gold, platinum, set
 * automatically from the insured turnover and the premium in UZS — each
 * measure reaches the highest tier whose threshold it meets (equal
 * qualifies), the automatic tier is the higher of the two — or by hand by
 * commercial underwriting. This module mirrors tci.policyholder_tier_for /
 * policyholder_tier_max / policyholder_tier_thresholds_valid
 * (contract-tested against the migration text) so the card can explain
 * what the next tier needs.
 */

import type { UserRole } from '../../lib/roles'

export const TIERS = ['bronze', 'silver', 'gold', 'platinum'] as const
export type Tier = (typeof TIERS)[number]

/** The tiers that have thresholds, rising. */
export const THRESHOLD_TIERS = ['silver', 'gold', 'platinum'] as const
export type ThresholdTier = (typeof THRESHOLD_TIERS)[number]

export const TIER_MEASURES = ['turnover_uzs', 'premium_uzs'] as const
export type TierMeasure = (typeof TIER_MEASURES)[number]

export type TierThresholds = Record<ThresholdTier, Record<TierMeasure, number>>

export type TurnoverBasis = 'declared' | 'estimated' | 'none'

export function isTier(value: unknown): value is Tier {
  return (TIERS as readonly unknown[]).includes(value)
}

/** The tier one measure reaches (equal qualifies; nothing known is bronze). */
export function tierFor(amount: number | null | undefined, measure: TierMeasure, th: TierThresholds): Tier {
  if (amount === null || amount === undefined) return 'bronze'
  for (const tier of [...THRESHOLD_TIERS].reverse()) {
    if (amount >= th[tier][measure]) return tier
  }
  return 'bronze'
}

/** The higher of two tiers. */
export function tierMax(a: Tier, b: Tier): Tier {
  return TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b
}

/** Every threshold above zero and each measure rising from silver to platinum. */
export function thresholdsValid(th: TierThresholds): boolean {
  return TIER_MEASURES.every((m) => {
    let prev = 0
    return THRESHOLD_TIERS.every((tier) => {
      const v = th[tier]?.[m]
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= prev) return false
      prev = v
      return true
    })
  })
}

/** What a measure still needs for the next tier, or null at platinum. */
export function nextStep(
  amount: number | null | undefined,
  measure: TierMeasure,
  th: TierThresholds,
): { tier: ThresholdTier; threshold: number; missing: number; share: number } | null {
  const current = tierFor(amount, measure, th)
  const next = THRESHOLD_TIERS.find((tier) => TIERS.indexOf(tier) > TIERS.indexOf(current))
  if (!next) return null
  const threshold = th[next][measure]
  const have = Math.max(amount ?? 0, 0)
  return { tier: next, threshold, missing: Math.max(threshold - have, 0), share: Math.min(have / threshold, 1) }
}

/** Who sets a tier by hand (set_policyholder_tier) — commercial underwriting. */
export function maySetTier(role: UserRole | null): boolean {
  return role === 'commercial_underwriter'
}

/** Who sets the thresholds (set_policyholder_tier_thresholds) — admin. */
export function maySetThresholds(role: UserRole | null): boolean {
  return role === 'admin'
}

export const TIER_REASON_MIN = 3
export const TIER_REASON_MAX = 2000
