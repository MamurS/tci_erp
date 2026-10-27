/**
 * Admin › «Риски» (Prompt 31, migration 0085): the technical side of sector
 * and country risk — the OECD list, sanctions flags, the cover matrix and
 * adjustment table, the risk settings and who reviews each sector. Admin
 * maintains these and decides nothing with them; the grades themselves are
 * the credit analysts' (the «Сектора» section).
 */

import { OecdImportCard } from './OecdImportCard'
import { RiskAdjustmentsCard } from './RiskAdjustmentsCard'
import { RiskSettingsCard } from './RiskSettingsCard'
import { SanctionsCard } from './SanctionsCard'
import { SectorAnalystsCard } from './SectorAnalystsCard'

export function RiskTab() {
  return (
    <div className="flex flex-col gap-5">
      <OecdImportCard />
      <SanctionsCard />
      <RiskAdjustmentsCard />
      <RiskSettingsCard />
      <SectorAnalystsCard />
    </div>
  )
}
