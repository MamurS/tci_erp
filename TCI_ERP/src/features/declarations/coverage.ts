/**
 * The DL / uncovered-excess rule — pure mirror of
 * tci.classify_declaration_line (migration 0026).
 *
 * Two rules, and the asymmetry between them is deliberate:
 *
 *  - With an approved, released limit the WHOLE turnover is covered, even
 *    when it dwarfs the limit. A credit limit caps the outstanding balance,
 *    not the flow of sales through a period.
 *  - Without one, cover stops at the policy's discretionary limit. Anything
 *    above it is uncovered excess: the policyholder sold more than they were
 *    allowed to self-assess, and that slice is not insured.
 *
 * The excess is never folded into the covered figure. Premium is earned on
 * `covered` alone, so quietly including it would charge for cover that does
 * not exist.
 */

import type { CoverageBasis } from './types'

export interface CoverageSplit {
  basis: CoverageBasis
  covered: number
  uncovered: number
}

export function classifyLine(
  hasLimit: boolean,
  insurableTurnover: number,
  discretionaryLimit: number | null,
): CoverageSplit {
  if (hasLimit) {
    return { basis: 'limit', covered: insurableTurnover, uncovered: 0 }
  }
  const dl = discretionaryLimit ?? 0
  if (insurableTurnover <= dl) {
    return { basis: 'discretionary', covered: insurableTurnover, uncovered: 0 }
  }
  return { basis: 'uncovered_excess', covered: dl, uncovered: insurableTurnover - dl }
}

/** Roll a set of already-classified lines up to a declaration total. */
export function sumSplits(
  lines: readonly { covered_amount: number; uncovered_excess: number }[],
): { covered: number; uncovered: number } {
  return lines.reduce(
    (acc, l) => ({
      covered: acc.covered + l.covered_amount,
      uncovered: acc.uncovered + l.uncovered_excess,
    }),
    { covered: 0, uncovered: 0 },
  )
}

/** Amber, not red: shipping outside cover is a warning about the policy, not
 * an error in the form (DESIGN.md). */
export function isUncovered(basis: CoverageBasis): boolean {
  return basis === 'uncovered_excess'
}
