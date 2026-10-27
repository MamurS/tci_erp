/**
 * The risk badges where an industry or a country already appears on a staff
 * screen (Prompt 31). Tables get the COMPACT country badge — «OECD 5»,
 * «Int. 4», «OECD —» for not classified — so a column keeps its reserved
 * width; the full words stay in the badge's title. A sanctions flag (on the
 * company or its country) takes the country badge's place in a table:
 * no cover is the only fact that matters then. Staff only — the lookups are
 * disabled for a client, so nothing renders for one.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui'
import { useEntities } from '../entities/api'
import { useCountryRiskByCode, useIsStaffReader, useLiveSanctions } from './api'
import { CountryRiskBadges, IndustrySectorBadge, SanctionsBadge } from './badges'
import { countryTone } from './rules'

/** The country's category in a table cell, or the sanctions badge. */
export function CountryRiskCompact({
  countryCode,
  entityId,
}: {
  countryCode: string | null | undefined
  entityId?: string | null
}) {
  const { t } = useTranslation()
  const countries = useCountryRiskByCode()
  const sanctions = useLiveSanctions()
  if (!countryCode && !entityId) return null
  const flagged =
    (countryCode ? sanctions.countries.has(countryCode) : false) || (entityId ? sanctions.entities.has(entityId) : false)
  if (flagged) return <SanctionsBadge />
  const row = countryCode ? countries.get(countryCode) : undefined
  if (!row) return null
  const listExists = Boolean(row.latest_import_effective) || row.source === 'internal'
  if (!listExists) return null
  const label =
    row.category === null
      ? t('risk.badges.compact.unclassified')
      : t(row.source === 'internal' ? 'risk.badges.compact.internal' : 'risk.badges.compact.oecd', {
          category: row.category,
        })
  const title =
    row.category === null
      ? t('risk.country.unclassifiedTitle')
      : row.source === 'internal'
        ? t('risk.country.internalTitle', { category: row.category, oecd: row.oecd_category ?? '—' })
        : t('risk.country.oecdTitle', { category: row.category })
  return (
    <span data-risk="country">
      <Badge tone={countryTone(row.category)} title={title}>
        {label}
      </Badge>
    </span>
  )
}

/** A buyer's sector badge and compact country badge, side by side — beside
 * a buyer's name in a table row (it never shrinks; the name does). */
export function BuyerRiskBadges({
  industryCode,
  countryCode,
  entityId,
}: {
  industryCode: string | null | undefined
  countryCode: string | null | undefined
  entityId?: string | null
}) {
  const staff = useIsStaffReader()
  if (!staff) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <IndustrySectorBadge industryCode={industryCode} />
      <CountryRiskCompact countryCode={countryCode} entityId={entityId} />
    </span>
  )
}

/** BuyerRiskBadges for a company known only by its id: the industry and
 * country come from the registry (one cached query shared by the screens). */
export function EntityRiskBadges({ entityId }: { entityId: string | null | undefined }) {
  const staff = useIsStaffReader()
  const { data: entities } = useEntities()
  if (!staff || !entityId) return null
  const entity = (entities ?? []).find((e) => e.id === entityId)
  if (!entity) return null
  return <BuyerRiskBadges industryCode={entity.industry_id} countryCode={entity.country_code} entityId={entityId} />
}

/** The second line of a registry cell: one badge height, reserved whether or
 * not a badge arrives, so a row never grows when the risk data loads. */
export function RiskSubline({ children }: { children: ReactNode }) {
  const staff = useIsStaffReader()
  if (!staff) return null
  return <span className="mt-0.5 flex h-text-5 min-w-0 items-center gap-1 overflow-hidden">{children}</span>
}

/** A fact's value with its badges after it: the industry and its sector
 * grade, or the country and its category / sanctions (object pages). */
export function IndustryWithSector({ name, industryCode }: { name: ReactNode; industryCode: string | null | undefined }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <span>{name}</span>
      <IndustrySectorBadge industryCode={industryCode} />
    </span>
  )
}

export function CountryWithRisk({
  name,
  countryCode,
  entityId,
}: {
  name: ReactNode
  countryCode: string | null | undefined
  entityId?: string | null
}) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <span>{name}</span>
      <CountryRiskBadges countryCode={countryCode} entityId={entityId} />
    </span>
  )
}
