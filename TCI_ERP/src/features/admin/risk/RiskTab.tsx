/**
 * Admin › «Риски» (Prompt 31, migration 0085): the technical side of sector
 * and country risk — the OECD list, the sanctions screening settings (0091;
 * the flags are the credit analysts', in «Санкции»), the cover matrix and
 * adjustment table, the risk settings and who reviews each sector. Admin
 * maintains these and decides nothing with them; the grades themselves are
 * the credit analysts' (the «Сектора» section).
 */

import { OecdImportCard } from './OecdImportCard'
import { RiskAdjustmentsCard } from './RiskAdjustmentsCard'
import { RiskSettingsCard } from './RiskSettingsCard'
import { SanctionsSettingsCard } from '../../sanctions/SanctionsSettingsCard'
import { SectorAnalystsCard } from './SectorAnalystsCard'

export function RiskTab() {
  return (
    <div className="flex flex-col gap-5">
      <OecdImportCard />
      <SanctionsSettingsCard />
      <RiskAdjustmentsCard />
      <RiskSettingsCard />
      <SectorAnalystsCard />
    </div>
  )
}
