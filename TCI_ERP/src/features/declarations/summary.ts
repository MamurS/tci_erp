/**
 * Dashboard summaries for Phase 4 — pure, so the numbers can be tested
 * without a database and the cards stay dumb.
 *
 * Declaration COMPLIANCE is the question a dashboard should answer: not "how
 * many declarations exist" but "how many periods are still owed to us". That
 * is the difference between a count and a control.
 */

import type { DeclarationStatus } from './types'

export interface DeclarationCompliance {
  /** Waiting on the insurer: submitted, not yet accepted or disputed. */
  awaitingAcceptance: number
  /** Back with the policyholder. */
  disputed: number
  /** Accepted this period — the ones that earned premium. */
  accepted: number
}

export function declarationCompliance(
  declarations: readonly { status: DeclarationStatus }[],
): DeclarationCompliance {
  return {
    awaitingAcceptance: declarations.filter((d) => d.status === 'submitted').length,
    disputed: declarations.filter((d) => d.status === 'disputed').length,
    accepted: declarations.filter((d) => d.status === 'accepted').length,
  }
}

export interface PremiumAccrual {
  earned: number
  minimum: number
  /** greatest(earned - minimum, 0), summed across policies. */
  adjustment: number
  instalmentsOverdue: number
}

export function premiumAccrual(
  policies: readonly {
    earned_premium: number
    minimum_premium: number
    adjustment_amount: number
    instalments_overdue: number
  }[],
): PremiumAccrual {
  return policies.reduce<PremiumAccrual>(
    (acc, p) => ({
      earned: acc.earned + Number(p.earned_premium),
      minimum: acc.minimum + Number(p.minimum_premium),
      adjustment: acc.adjustment + Number(p.adjustment_amount),
      instalmentsOverdue: acc.instalmentsOverdue + Number(p.instalments_overdue),
    }),
    { earned: 0, minimum: 0, adjustment: 0, instalmentsOverdue: 0 },
  )
}

// ---------------------------------------------------------------------------
// Premium across currencies
// ---------------------------------------------------------------------------

export interface PremiumInCurrency {
  currency: string
  earned: number
  minimum: number
}

export interface PremiumAccrualUzs {
  /** Earned premium in UZS over the currencies that have a rate. */
  earnedUzs: number
  /** Minimum premium in UZS over the same currencies — the ratio's base. */
  minimumUzs: number
  /** What each currency holds, as booked: UZS first, then alphabetical. */
  byCurrency: PremiumInCurrency[]
  /** Currencies with no UZS rate: LEFT OUT of the UZS totals and named, never
   * counted as zero — a total with a currency missing is incomplete, not small
   * (the same rule as the portfolio views, 0052). */
  missingRates: string[]
}

/**
 * The book's premium as ONE figure. Policies are written in UZS, USD and EUR,
 * and adding those raw (62.8M UZS + 11.7K USD) is a number that means nothing.
 * Each currency is summed on its own and converted by `rateFor` — the app's fx
 * rule, tci.latest_uzs_rate (limits/authority.ts `latestUzsRate`): the latest
 * rate on or before today, CBU over manual, UZS = 1, null when there is none.
 */
export function premiumAccrualUzs(
  policies: readonly { currency_code: string; earned_premium: number; minimum_premium: number }[],
  rateFor: (currency: string) => number | null,
): PremiumAccrualUzs {
  const sums = new Map<string, PremiumInCurrency>()
  for (const p of policies) {
    const row = sums.get(p.currency_code) ?? { currency: p.currency_code, earned: 0, minimum: 0 }
    row.earned += Number(p.earned_premium)
    row.minimum += Number(p.minimum_premium)
    sums.set(p.currency_code, row)
  }
  const byCurrency = [...sums.values()].sort((a, b) =>
    a.currency === 'UZS' ? -1 : b.currency === 'UZS' ? 1 : a.currency.localeCompare(b.currency),
  )

  let earnedUzs = 0
  let minimumUzs = 0
  const missingRates: string[] = []
  for (const row of byCurrency) {
    const rate = row.currency === 'UZS' ? 1 : rateFor(row.currency)
    if (rate === null) {
      // A currency with nothing booked in it needs no rate to be complete.
      if (row.earned !== 0 || row.minimum !== 0) missingRates.push(row.currency)
      continue
    }
    earnedUzs += row.earned * rate
    minimumUzs += row.minimum * rate
  }
  return { earnedUzs, minimumUzs, byCurrency, missingRates }
}
