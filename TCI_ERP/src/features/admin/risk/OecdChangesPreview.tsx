/**
 * What an OECD list about to be imported CHANGES against the list in use
 * (tci.country_risk_import_preview, 0087): every country whose category
 * moves — worse first, then by the buyers with in-force limits there — with
 * those buyers and their limits in UZS, and where an approved internal
 * category keeps decisions where they are. A file older than the list in
 * use is said to be stored but not used; a first list has nothing to
 * compare with.
 */

import type { UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Badge, Callout, COL, CountryFlag, SectionTitle, Skeleton, Table } from '../../../components/ui'
import { formatAmount, formatDate } from '../../../lib/format'
import { useCountryName } from '../../portfolio/useCountryName'
import type { CountryRiskPreview } from '../../risk/api'
import { CountryCategoryBadge } from '../../risk/badges'

export function OecdChangesPreview({ preview }: { preview: UseQueryResult<CountryRiskPreview> }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const countryName = useCountryName()

  if (preview.isLoading) return <Skeleton className="h-24 w-full" />
  if (preview.isError || !preview.data) return <Callout tone="warn" title={t('admin.risk.oecd.changes.failed')} />

  const p = preview.data
  if (p.first_import) return <Callout tone="info" title={t('admin.risk.oecd.changes.first')} />
  const previous = p.previous_effective ? formatDate(p.previous_effective, lang) : '—'
  if (p.superseded)
    return <Callout tone="warn" title={t('admin.risk.oecd.changes.superseded', { date: previous })} />
  if (p.changes.length === 0) return <Callout tone="info" title={t('admin.risk.oecd.changes.none', { date: previous })} />

  const worse = p.changes.filter((c) => c.direction === 'worse')
  const affected = worse.filter((c) => c.internal_category === null).reduce((n, c) => n + c.buyers, 0)

  return (
    <div className="flex flex-col gap-2">
      <SectionTitle hint={t('admin.risk.oecd.changes.hint', { date: previous })}>
        {t('admin.risk.oecd.changes.title')}
      </SectionTitle>
      <p className="text-small text-slate-700">
        {t('admin.risk.oecd.changes.summary', {
          worse: worse.length,
          better: p.changes.length - worse.length,
        })}
        {affected > 0 && (
          <>
            {' · '}
            <span className="font-medium text-danger-700">{t('admin.risk.oecd.changes.affected', { count: affected })}</span>
          </>
        )}
      </p>
      <Table dense stickyHead columns={[COL.fill, '9rem', '9rem', '8rem', COL.count, '11rem', '14rem']}>
        <thead>
          <tr>
            <th>{t('admin.risk.oecd.changes.columns.country')}</th>
            <th>{t('admin.risk.oecd.changes.columns.before')}</th>
            <th>{t('admin.risk.oecd.changes.columns.after')}</th>
            <th>{t('admin.risk.oecd.changes.columns.direction')}</th>
            <th className="num text-right">{t('admin.risk.oecd.changes.columns.buyers')}</th>
            <th className="num text-right">{t('admin.risk.oecd.changes.columns.exposure')}</th>
            <th>{t('admin.risk.oecd.changes.columns.note')}</th>
          </tr>
        </thead>
        <tbody>
          {p.changes.map((c) => (
            <tr key={c.country_code}>
              <td>
                <span className="inline-flex min-w-0 items-center gap-2">
                  <CountryFlag code={c.country_code} />
                  <span className="truncate">{countryName(c.country_code)}</span>
                </span>
              </td>
              <td>
                <CountryCategoryBadge category={c.oecd_before} source="oecd" />
              </td>
              <td>
                <CountryCategoryBadge category={c.oecd_after} source="oecd" />
              </td>
              <td>
                <Badge tone={c.direction === 'worse' ? 'neg' : 'pos'}>
                  {t(`admin.risk.oecd.changes.direction.${c.direction}`)}
                </Badge>
              </td>
              <td className="num text-right">{c.buyers > 0 ? c.buyers : '—'}</td>
              <td className="num text-right">
                {c.buyers > 0 ? formatAmount(c.exposure_uzs, lang) : '—'}
                {c.rates_missing > 0 && (
                  <span className="block text-caption text-slate-500">
                    {t('admin.risk.oecd.changes.ratesMissing', { count: c.rates_missing })}
                  </span>
                )}
              </td>
              <td className="text-slate-600">
                {c.internal_category !== null
                  ? t('admin.risk.oecd.changes.masked', { category: c.internal_category })
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
