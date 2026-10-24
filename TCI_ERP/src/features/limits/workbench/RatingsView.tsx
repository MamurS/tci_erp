/**
 * «Рейтинги» — the rating worklist (tci.v_rating_worklist): buyers with live
 * credit business whose rating needs work, and why — no financials to rate
 * on, never rated, a newer period than the one rated, or older than a year.
 * Each row opens the company on the tab where the work is done.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Card,
  COL,
  EmptyState,
  labelCol,
  Segmented,
  Spinner,
  Table,
  Truncate,
  ViewBar,
} from '../../../components/ui'
import { EM_DASH, formatAmount, formatDate } from '../../../lib/format'
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
  unconfirmed: 'warn',
}

/** Financials are entered on the financials tab; everything else is rated. */
const REASON_TAB: Record<RatingReason, string> = {
  no_statements: 'financials',
  no_rating: 'rating',
  new_statement: 'rating',
  stale: 'rating',
  unconfirmed: 'rating',
}

export function RatingsView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const countryName = useCountryName()
  const { data, isLoading } = useRatingWorklist()
  const [reason, setReason] = useState<'all' | RatingReason>('all')

  const all = useMemo(() => sortRatingWork(data ?? []), [data])
  const counts = countByReason(all)
  const rows = reason === 'all' ? all : all.filter((r) => r.reason === reason)

  return (
    <div>
      <ViewBar
        hint={t('limits.workbench.ratings.subtitle')}
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

      {isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Card className="p-6">
          <EmptyState title={t('limits.workbench.ratings.empty')} hint={t('limits.workbench.ratings.emptyHint')} />
        </Card>
      ) : (
        <Table dense columns={[COL.fill, labelCol('ratingReason'), COL.grade, COL.date, COL.count, COL.count, COL.count]}>
          <thead>
            <tr>
              <th>{t('limits.fields.buyer')}</th>
              <th>{t('limits.workbench.ratings.reason')}</th>
              <th>{t('portfolio.credit.rating')}</th>
              <th>{t('portfolio.credit.ratedAt')}</th>
              <th className="num">{t('limits.workbench.ratings.latestStatement')}</th>
              <th className="num">{t('limits.workbench.ratings.openRequests')}</th>
              <th className="num">{t('limits.workbench.ratings.limitsInForce')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entity_id}>
                {/* The country is a second line under the name, so the name
                    keeps the width the counts would otherwise take. */}
                <td>
                  <Truncate text={r.buyer_name} className="max-w-none">
                    <EntityLink id={r.entity_id} name={r.buyer_name} tab={REASON_TAB[r.reason]} />
                  </Truncate>
                  <Truncate text={countryName(r.buyer_country)} className="max-w-none text-[12px] text-slate-500" />
                </td>
                <td>
                  <Badge tone={REASON_TONE[r.reason]}>{t(`limits.workbench.ratings.reasons.${r.reason}`)}</Badge>
                </td>
                <td>
                  {/* Unrated is already the row's reason; the column stays a dash. */}
                  {r.grade ? <BandBadge band={r.band} grade={r.grade} /> : <span className="text-slate-400">{EM_DASH}</span>}
                </td>
                <td className="whitespace-nowrap text-slate-500">{formatDate(r.rated_at, locale)}</td>
                <td className="num">{r.latest_fiscal_year ?? EM_DASH}</td>
                <td className="num">{formatAmount(r.open_requests, locale)}</td>
                <td className="num">{formatAmount(r.limits_in_force, locale)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
