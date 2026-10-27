/** A policyholder's tier as a badge (0094): the medal, the tier's name, and
 * «manual» when commercial underwriting set it by hand. `TierMark` looks the
 * company up and shows nothing for a company that is not a policyholder. */

import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Medal } from 'lucide-react'

import { BadgeSizeContext, badgeClassName } from '../../components/ui'
import type { BadgeSize } from '../../components/ui'
import { usePolicyholderTier } from './api'
import type { Tier } from './model'
import { TIER_BADGE } from './tierTone'

export function TierBadge({ tier, manual = false, size }: { tier: Tier; manual?: boolean; size?: BadgeSize }) {
  const { t } = useTranslation()
  const slot = useContext(BadgeSizeContext)
  const resolved = size ?? slot
  const label = t(`tiers.name.${tier}`)
  return (
    <span
      data-badge={resolved}
      data-tier={tier}
      title={manual ? t('tiers.badgeManualHint', { tier: label }) : t('tiers.badgeHint', { tier: label })}
      className={badgeClassName(resolved, TIER_BADGE[tier])}
    >
      <Medal aria-hidden className="size-[0.9em] shrink-0" strokeWidth={2} />
      <span className="min-w-0 truncate">{label}</span>
      {manual && <span aria-hidden>·&nbsp;{t('tiers.manualShort')}</span>}
    </span>
  )
}

export function TierMark({ entityId, size }: { entityId: string | null | undefined; size?: BadgeSize }) {
  const row = usePolicyholderTier(entityId)
  if (!row) return null
  return <TierBadge tier={row.tier} manual={row.is_manual} size={size} />
}
