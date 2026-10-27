/** The risk context a decision screen reads (tci.buyer_risk_context), with
 * whether an OECD list exists — the second fact the warnings need. */

import { useBuyerRiskContext, useCountryRisk } from './api'
import type { BuyerRiskContext } from './rules'

export function useDecisionRisk(entityId: string | null | undefined): {
  ctx: BuyerRiskContext | null
  oecdImported: boolean
} {
  const context = useBuyerRiskContext(entityId)
  const countries = useCountryRisk()
  return {
    ctx: context.data ?? null,
    oecdImported: Boolean(countries.data?.some((c) => c.latest_import_effective)),
  }
}
