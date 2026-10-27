/**
 * The companies of a sector by their rating grade: a compact distribution
 * (one bar, a segment per grade in the grade scale's colours, the counts in
 * words beside it — never colour alone) and the table — company, country with
 * its risk badges, rating grade, active limits, exposure in UZS. «With
 * limits» first: those are what credit underwriting reviews when the sector
 * is downgraded to C or D.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  COL,
  CountryFlag,
  EmptyState,
  GradeBadge,
  LinkRow,
  Segmented,
  SkeletonRows,
  Table,
  gradeSolid,
} from '../../components/ui'
import { formatAmount } from '../../lib/format'
import type { SectorBuyer } from '../risk/api'
import { CountryRiskBadges } from '../risk/badges'
import { buyersWithLimits, gradeDistribution } from './model'

type Scope = 'limits' | 'all'

export function GradeDistribution({ buyers }: { buyers: readonly SectorBuyer[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const dist = gradeDistribution(buyers).filter((d) => d.count > 0)
  const total = buyers.length
  if (!total) return null
  return (
    <div className="grid gap-2">
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={dist.map((d) => `${d.key === 'unrated' ? t('risk.sectors.buyers.unrated') : d.key}: ${d.count}`).join(', ')}
      >
        {dist.map((d) => (
          <span
            key={d.key}
            className={`h-full ${d.key === 'unrated' ? 'bg-slate-300' : gradeSolid(d.key)}`}
            style={{ width: `${(d.count / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-slate-600">
        {dist.map((d) => (
          <li key={d.key} className="inline-flex items-center gap-2">
            {d.key === 'unrated' ? (
              <span>{t('risk.sectors.buyers.unrated')}</span>
            ) : (
              <GradeBadge grade={d.key} />
            )}
            <span className="tabular-nums">{formatAmount(d.count, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SectorBuyersTable({
  buyers,
  loading,
  defaultScope,
}: {
  buyers: readonly SectorBuyer[] | undefined
  loading: boolean
  defaultScope?: Scope
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const all = buyers ?? []
  const withLimits = buyersWithLimits(all)
  const [scopeChoice, setScope] = useState<Scope | null>(null)
  const scope: Scope = scopeChoice ?? defaultScope ?? (withLimits.length ? 'limits' : 'all')
  const rows = scope === 'limits' ? withLimits : [...all].sort((a, b) => a.name.localeCompare(b.name, locale))

  const columns = [COL.fill, '14rem', COL.grade, COL.count, COL.amount]
  const head = (
    <thead>
      <tr>
        <th>{t('risk.sectors.buyers.company')}</th>
        <th>{t('risk.sectors.buyers.country')}</th>
        <th>{t('risk.sectors.buyers.rating')}</th>
        <th className="num">{t('risk.sectors.buyers.limits')}</th>
        <th className="num">{t('risk.sectors.fields.exposure')}</th>
      </tr>
    </thead>
  )

  if (loading)
    return (
      <Table columns={columns}>
        {head}
        <tbody>
          <SkeletonRows columns={columns.length} rows={3} />
        </tbody>
      </Table>
    )
  if (!all.length)
    return <EmptyState pictogram="companies" title={t('risk.sectors.buyers.empty')} hint={t('risk.sectors.buyers.emptyHint')} />

  return (
    <div className="grid gap-3">
      <div>
        <Segmented
          value={scope}
          onChange={(k) => setScope(k as Scope)}
          ariaLabel={t('risk.sectors.buyers.scope')}
          options={[
            { key: 'limits', label: `${t('risk.sectors.buyers.withLimits')} · ${withLimits.length}` },
            { key: 'all', label: `${t('risk.sectors.buyers.all')} · ${all.length}` },
          ]}
        />
      </div>
      {!rows.length ? (
        <EmptyState pictogram="limits" title={t('risk.sectors.buyers.noLimits')} hint={t('risk.sectors.buyers.noLimitsHint')} />
      ) : (
        <Table columns={columns} stickyHead={rows.length > 15}>
          {head}
          <tbody>
            {rows.map((b) => (
              <LinkRow key={b.entity_id} to={`/entities/${b.entity_id}`}>
                <td>
                  <Link to={`/entities/${b.entity_id}`} className="block truncate font-medium text-accent-600 hover:underline">
                    {b.name}
                  </Link>
                </td>
                <td>
                  <span className="inline-flex max-w-full items-center gap-2">
                    {b.country_code ? (
                      <>
                        <CountryFlag code={b.country_code} />
                        <span className="font-mono text-caption text-slate-600">{b.country_code}</span>
                        <CountryRiskBadges countryCode={b.country_code} entityId={b.entity_id} />
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                </td>
                <td>{b.rating_grade ? <GradeBadge grade={b.rating_grade} /> : '—'}</td>
                <td className="num">{b.limits > 0 ? formatAmount(b.limits, locale) : '—'}</td>
                <td className="num">
                  {b.limits === 0 ? (
                    '—'
                  ) : b.exposure_uzs === null ? (
                    <span className="text-caption text-warning-700">{t('risk.sectors.buyers.noRate')}</span>
                  ) : (
                    formatAmount(b.exposure_uzs, locale)
                  )}
                </td>
              </LinkRow>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
