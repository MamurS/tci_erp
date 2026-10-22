/** What a claim write is certain to change, painted before the answer.
 *
 * A status move's target is fixed by the machine (machine.ts mirrors it);
 * an override's effective verdict is `coalesce(override, system)` — the
 * generated column of 0033 — so both are painted. An APPROVAL is not: the
 * indemnity, and whether the result is approved or partially approved, are
 * the database's computation, so approval shows its pending state only. */

import type { ClaimInvoiceCoverage, ClaimStatus, CoverageVerdict } from './types'

export function withClaimStatus<T extends { status: ClaimStatus }>(claim: T, to: ClaimStatus): T {
  return { ...claim, status: to }
}

/** An underwriter's override on one invoice. The engine's verdict stays. */
export function overridden(
  line: ClaimInvoiceCoverage,
  verdict: CoverageVerdict,
  coveredAmount: number,
  justification: string,
  by: string | null,
  at: string,
): ClaimInvoiceCoverage {
  return {
    ...line,
    override_verdict: verdict,
    override_covered_amount: coveredAmount,
    override_justification: justification,
    overridden_by: by,
    overridden_at: at,
    effective_verdict: verdict,
    effective_covered_amount: coveredAmount,
    is_overridden: true,
  }
}

/** The override cleared: what the engine said is in force again. */
export function overrideCleared(line: ClaimInvoiceCoverage): ClaimInvoiceCoverage {
  return {
    ...line,
    override_verdict: null,
    override_covered_amount: null,
    override_justification: null,
    overridden_by: null,
    overridden_at: null,
    effective_verdict: line.system_verdict,
    effective_covered_amount: line.system_covered_amount,
    is_overridden: false,
  }
}

/** The claim's own queries share the shape ['claims', kind, claimId]; the
 * lists and the policy liability are ['claims', 'list' | 'liability', …].
 * A write on one claim affects its own queries and the lists, not every
 * other claim's tabs. */
export function claimQueryAffected(key: readonly unknown[], claimId: string | undefined): boolean {
  if (key[0] !== 'claims') return false
  if (!claimId) return true
  return key[1] === 'list' || key[1] === 'liability' || key[2] === claimId
}
