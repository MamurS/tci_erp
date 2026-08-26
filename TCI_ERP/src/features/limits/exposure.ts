/**
 * Exposure aggregation + supersede-chain helpers — pure module.
 * aggregateExposure mirrors tci.v_buyer_exposure (UZS conversion via the
 * same latest-rate rule; rows with a missing rate are excluded from the
 * sum and counted). buildLimitChains orders the full decision history per
 * policy for the buyer Limits tab.
 */

import { latestUzsRate } from './authority'
import type { FxRateRow } from './authority'
import type { CreditLimitDecision, EffectiveLimit } from './types'

export interface ExposureAggregate {
  policiesCount: number
  exposureUzs: number | null
  missingRates: number
}

/** Mirror of tci.v_buyer_exposure for one buyer's effective limits. */
export function aggregateExposure(
  effective: readonly Pick<
    EffectiveLimit,
    'policy_id' | 'outcome' | 'approved_amount' | 'currency_code'
  >[],
  rates: readonly FxRateRow[],
  todayIso: string,
): ExposureAggregate {
  // The SQL view filters to approved/partial BEFORE grouping, so declined
  // effective rows count toward neither policies_count nor the sum.
  const approved = effective.filter(
    (l) => l.outcome === 'approved' || l.outcome === 'partial',
  )
  const policies = new Set(approved.map((l) => l.policy_id))
  let sum = 0
  let summed = 0
  let missing = 0
  for (const l of approved) {
    const rate = latestUzsRate(rates, l.currency_code, todayIso)
    if (rate === null) {
      missing += 1
    } else {
      sum += Number(l.approved_amount ?? 0) * rate
      summed += 1
    }
  }
  return {
    policiesCount: policies.size,
    exposureUzs: summed > 0 ? sum : null,
    missingRates: missing,
  }
}

export interface LimitChain {
  policyId: string
  /** Newest first; index 0 is the current state of the chain. */
  decisions: CreditLimitDecision[]
}

/** Group a buyer's full decision history into per-policy chains,
 * newest decision first (effective/current on top, superseded below). */
export function buildLimitChains(
  decisions: readonly (CreditLimitDecision & { policy_id: string })[],
): LimitChain[] {
  const byPolicy = new Map<string, CreditLimitDecision[]>()
  for (const d of decisions) {
    const list = byPolicy.get(d.policy_id) ?? []
    list.push(d)
    byPolicy.set(d.policy_id, list)
  }
  return [...byPolicy.entries()].map(([policyId, list]) => ({
    policyId,
    decisions: [...list].sort((a, b) => b.decided_at.localeCompare(a.decided_at)),
  }))
}
