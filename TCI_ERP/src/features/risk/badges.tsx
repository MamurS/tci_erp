/**
 * The risk badges (Prompt 31): a sector grade with its outlook arrow beside
 * every industry, a country category and a red sanctions badge beside every
 * country. Staff only — the lookups are never enabled for a client, so a
 * client surface renders nothing of them.
 *
 * The sector grade wears the grade-scale colours (GradeBadge: A as A1 … D);
 * the country category is neutral up to 3, amber at 4–5, red at 6–7, and
 * «not classified» is said in words — never shown as 0.
 */

import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui'
import { GradeBadge } from '../../components/ui/GradeBadge'
import { formatDate } from '../../lib/format'
import { useCountryRiskByCode, useLiveSanctions, useSectorByIndustry } from './api'
import { countryTone } from './rules'
import type { Outlook } from './rules'

const OUTLOOK_ARROW: Record<Outlook, string> = { positive: '↑', stable: '→', negative: '↓' }

export function SectorBadge({
  grade,
  outlook,
  stale,
  reviewedAt,
  industryName,
}: {
  grade: string | null
  outlook?: Outlook | null
  stale?: boolean
  reviewedAt?: string | null
  industryName?: string | null
}) {
  const { t, i18n } = useTranslation()
  if (!grade) return null
  const title = [
    t('risk.sector.badgeTitle', { grade, industry: industryName ?? '' }),
    outlook ? t(`risk.outlook.${outlook}`) : null,
    reviewedAt ? t('risk.sector.reviewedOn', { date: formatDate(reviewedAt, i18n.language) }) : null,
    stale ? t('risk.sector.stale') : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span data-risk="sector" className="inline-flex items-center">
      <GradeBadge grade={grade} title={title}>
        {grade}
        {outlook ? <span aria-hidden>{OUTLOOK_ARROW[outlook]}</span> : null}
        {stale ? <span aria-hidden>·</span> : null}
        <span className="sr-only">{title}</span>
      </GradeBadge>
    </span>
  )
}

export function CountryCategoryBadge({
  category,
  source,
  oecdCategory,
}: {
  category: number | null
  source?: 'oecd' | 'internal' | null
  oecdCategory?: number | null
}) {
  const { t } = useTranslation()
  const label =
    category === null
      ? t('risk.country.unclassifiedShort')
      : t(source === 'internal' ? 'risk.country.internalShort' : 'risk.country.oecdShort', { category })
  const title =
    category === null
      ? t('risk.country.unclassifiedTitle')
      : source === 'internal'
        ? t('risk.country.internalTitle', { category, oecd: oecdCategory ?? '—' })
        : t('risk.country.oecdTitle', { category })
  return (
    <span data-risk="country">
      <Badge tone={countryTone(category)} title={title}>
        {label}
      </Badge>
    </span>
  )
}

export function SanctionsBadge({ title }: { title?: string }) {
  const { t } = useTranslation()
  return (
    <span data-risk="sanctions">
      <Badge tone="negStrong" title={title ?? t('risk.sanctions.badgeTitle')}>
        {t('risk.sanctions.badge')}
      </Badge>
    </span>
  )
}

/** The sector badge of an industry, from the cached grades (staff only). */
export function IndustrySectorBadge({ industryCode }: { industryCode: string | null | undefined }) {
  const sectors = useSectorByIndustry()
  const { i18n } = useTranslation()
  if (!industryCode) return null
  const row = sectors.get(industryCode)
  if (!row?.grade) return null
  const lang = i18n.language.slice(0, 2) as 'en' | 'ru' | 'uz'
  return (
    <SectorBadge
      grade={row.grade}
      outlook={row.outlook}
      stale={row.stale}
      reviewedAt={row.reviewed_at}
      industryName={row[`name_${lang}`] ?? row.name_en}
    />
  )
}

/** The country's category and, when flagged, the sanctions badge — and the
 * sanctions badge of the company itself (staff only). Nothing while the
 * country has no list behind it and no internal grade. */
export function CountryRiskBadges({
  countryCode,
  entityId,
}: {
  countryCode: string | null | undefined
  entityId?: string | null
}) {
  const countries = useCountryRiskByCode()
  const sanctions = useLiveSanctions()
  if (!countryCode && !entityId) return null
  const row = countryCode ? countries.get(countryCode) : undefined
  const listExists = Boolean(row?.latest_import_effective) || row?.source === 'internal'
  const flagged = (countryCode && sanctions.countries.has(countryCode)) || (entityId && sanctions.entities.has(entityId))
  if (!row && !flagged) return null
  return (
    <span className="inline-flex items-center gap-1">
      {row && listExists ? (
        <CountryCategoryBadge category={row.category} source={row.source} oecdCategory={row.oecd_category} />
      ) : null}
      {flagged ? <SanctionsBadge /> : null}
    </span>
  )
}
