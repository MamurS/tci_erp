/**
 * SINGLE place mapping dashboard interactivity to buyer-page locations:
 * every narrative bullet key (narrative.ts) and every rating factor chip
 * (rating/chips.ts) resolves here to the tab / sub-tab / anchor it drills
 * into. Keep in sync when adding narrative keys or factors — the mapping
 * test (targets.test.ts) enforces completeness.
 */

export type FinancialsSubTab = 'balance' | 'pnl' | 'ratios' | 'cashflow' | 'risk'

export interface BuyerPageTarget {
  tab: 'overview' | 'financials' | 'rating'
  /** Financials sub-tab (?sub=). */
  sub?: FinancialsSubTab
  /** In-tab scroll anchor (?anchor=), e.g. the factor table on Rating. */
  anchor?: 'factors'
}

const FIN = (sub: FinancialsSubTab): BuyerPageTarget => ({ tab: 'financials', sub })

/** Narrative bullet key (report.narrative.*) → buyer page location. */
export const NARRATIVE_TARGETS: Record<string, BuyerPageTarget> = {
  // performance / margins → P&L
  revenue_grew: FIN('pnl'),
  revenue_fell: FIN('pnl'),
  revenue_flat: FIN('pnl'),
  revenue_level: FIN('pnl'),
  gross_margin_up: FIN('pnl'),
  gross_margin_down: FIN('pnl'),
  net_profit_positive: FIN('pnl'),
  net_loss: FIN('pnl'),
  // leverage & activity → ratios
  leverage_low: FIN('ratios'),
  leverage_moderate: FIN('ratios'),
  leverage_high: FIN('ratios'),
  dso_up: FIN('ratios'),
  dso_down: FIN('ratios'),
  ccc_level: FIN('ratios'),
  // cash flow → derived cash flow statement
  cfo_positive: FIN('cashflow'),
  cfo_negative: FIN('cashflow'),
  cfo_negative_persistent: FIN('cashflow'),
  // liquidity norms, Z''-zones, norm breaches → risk analysis
  liquidity_ok: FIN('risk'),
  liquidity_breach: FIN('risk'),
  z_safe: FIN('risk'),
  z_grey: FIN('risk'),
  z_distress: FIN('risk'),
  norm_breaches: FIN('risk'),
}

export function narrativeTarget(bulletKey: string): BuyerPageTarget {
  return NARRATIVE_TARGETS[bulletKey] ?? { tab: 'financials' }
}

/** Factor chips always drill into the Rating tab's factor table. */
export function factorChipTarget(): BuyerPageTarget {
  return { tab: 'rating', anchor: 'factors' }
}

/** Search params for navigating the buyer page to a target. */
export function targetSearchParams(target: BuyerPageTarget): Record<string, string> {
  return {
    tab: target.tab,
    ...(target.sub ? { sub: target.sub } : {}),
    ...(target.anchor ? { anchor: target.anchor } : {}),
  }
}
