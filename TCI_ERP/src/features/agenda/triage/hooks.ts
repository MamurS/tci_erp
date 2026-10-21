/** Figure builders shared by more than one triage body. */

import { useTranslation } from 'react-i18next'

import { EM_DASH, formatAmount } from '../../../lib/format'
import type { BuyerExposure } from '../../limits/types'
import { num } from './figures'
import type { Figure } from './parts'

/** The buyer's limits in force across every policy, in UZS — straight from
 * tci.v_buyer_exposure, which converts at the latest rates and counts the
 * limits it could not convert; those are said, never added as zero. */
export function useExposureFigure(exposure: BuyerExposure | null, labelKey = 'agenda.triage.rating.depending'): Figure {
  const { t, i18n } = useTranslation()
  const label = t(labelKey)
  if (!exposure) return { label, value: EM_DASH, sub: t('agenda.triage.rating.noLimits') }
  return {
    label,
    value: formatAmount(num(exposure.exposure_uzs), i18n.language),
    sub: [
      'UZS',
      t('agenda.triage.rating.dependsSub', { count: exposure.policies_count }),
      exposure.missing_rates > 0 ? t('agenda.triage.missingRates', { count: exposure.missing_rates }) : null,
    ]
      .filter(Boolean)
      .join(' · '),
  }
}
