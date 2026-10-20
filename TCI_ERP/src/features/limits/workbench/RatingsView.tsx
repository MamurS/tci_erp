/**
 * «Рейтинги» — the rating worklist (tci.v_rating_worklist): buyers with live
 * credit business whose rating needs work, and why — no financials to rate
 * on, never rated, a newer period than the one rated, or older than a year.
 * Each row opens the company on the tab where the work is done.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner, Table } from '../../../components/ui'
import { formatAmount, formatMoment } from '../../../lib/format'
import { useCountryName } from '../../portfolio/useCountryName'
import { useRatingWorklist } from './api'
import { countByReason, sortRatingWork } from './model'
import { RATING_REASONS } from './types'
import type { RatingReason } from './types'
import { BandBadge, EntityLink } from './parts'

const REASON_TONE: Record<RatingReason, 'neg' | 'warn' | 'accent' | 'neutral'> = {
  no_statements: 'neg',
  no_rating: 'warn',
  new_statement: 'accent',
  stale: 'neutral',
}

/** Financials are entered on the financials tab; everything else is rated. */
const REASON_TAB: Record<RatingReason, string> = {
  no_statements: 'financials',
  no_rating: 'rating',
  new_statement: 'rating',
  stale: 'rating',
}

export function RatingsView({ sectionTabs }: { sectionTabs?: ReactNode } = {}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const countryName = useCountryName()
  const { data, isLoading } = useRatingWorklist()
  const [reason, setReason] = useState<'all' | RatingReason>('all')

  const all = useMemo(() => sortRatingWork(data ?? []), [data])
  const counts = countByReason(all)
  const rows = reason === 'all' ? all : all.filter((r) => r.reason === reason)

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t('limits.workbench.ratings.title')}
        subtitle={t('limits.workbench.ratings.subtitle')}
        actions={
          all.length ? (
            <Segmented
              value={reason}
              onChange={(key) => setReason(key as 'all' | RatingReason)}
              ariaLabel={t('limits.workbench.ratings.filter')}
              options={[
                { key: 'all', label: `${t('limits.workbench.ratings.all')} · ${all.length}` },
                ...RATING_REASONS.filter((r) => counts[r] > 0).map((r) => ({
                  key: r,
                  label: `${t(`limits.workbench.ratings.reasons.${r}`)} · ${counts[r]}`,
                })),
              ]}
            />
          ) : undefined
        }
      />
      {sectionTabs}

      {isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Card className="p-6">
          <EmptyState title={t('limits.workbench.ratings.empty')} hint={t('limits.workbench.ratings.emptyHint')} />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table dense>
            <thead>
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th>{t('portfolio.credit.country')}</th>
                <th>{t('limits.workbench.ratings.reason')}</th>
                <th>{t('portfolio.credit.rating')}</th>
                <th>{t('portfolio.credit.ratedAt')}</th>
                <th>{t('limits.workbench.ratings.latestStatement')}</th>
                <th className="text-right">{t('limits.workbench.ratings.openRequests')}</th>
                <th className="text-right">{t('limits.workbench.ratings.limitsInForce')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entity_id}>
                  <td>
                    <EntityLink id={r.entity_id} name={r.buyer_name} tab={REASON_TAB[r.reason]} />
                  </td>
                  <td className="text-slate-600">{countryName(r.buyer_country)}</td>
                  <td>
                    <Badge tone={REASON_TONE[r.reason]}>{t(`limits.workbench.ratings.reasons.${r.reason}`)}</Badge>
                  </td>
                  <td>
                    {r.grade ? (
                      <span className="flex items-center gap-1.5">
                        <BandBadge band={r.band} />
                        <span className="text-[12px] text-slate-500">{r.grade}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">{t('portfolio.credit.notRated')}</span>
                    )}
                  </td>
                  <td className="text-slate-500">{r.rated_at ? formatMoment(r.rated_at, locale) : '—'}</td>
                  <td className="text-slate-600">{r.latest_fiscal_year ?? '—'}</td>
                  <td className="num text-right">{formatAmount(r.open_requests, locale)}</td>
                  <td className="num text-right">{formatAmount(r.limits_in_force, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
