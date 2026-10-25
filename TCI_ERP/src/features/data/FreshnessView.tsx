/**
 * «Свежесть данных» — companies with live business (a limit, an open
 * request, a live submission or an active policy) whose data needs the
 * information manager: no statements, statements older than fifteen months,
 * or registry fields missing (tci.v_data_freshness).
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
} from '../../components/ui'
import { formatDate } from '../../lib/format'
import { useCountryName } from '../portfolio/useCountryName'
import { useDataFreshness } from './api'
import { FRESHNESS_REASONS } from './types'
import type { FreshnessReason } from './types'

const REASON_TONE: Record<FreshnessReason, 'neg' | 'warn' | 'neutral'> = {
  no_statements: 'neg',
  stale_statements: 'warn',
  missing_registry: 'neutral',
}

/** Statements are entered on the financials tab; registry fields on the card. */
const REASON_TAB: Record<FreshnessReason, string> = {
  no_statements: 'financials',
  stale_statements: 'financials',
  missing_registry: 'overview',
}

export function FreshnessView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const countryName = useCountryName()
  const { data, isLoading } = useDataFreshness()
  const [reason, setReason] = useState<'all' | FreshnessReason>('all')

  const all = useMemo(() => data ?? [], [data])
  const count = (r: FreshnessReason) => all.filter((row) => row.reason === r).length
  const rows = reason === 'all' ? all : all.filter((row) => row.reason === reason)

  return (
    <div>
      <ViewBar
        hint={t('data.freshness.hint')}
        actions={
          all.length ? (
            <Segmented
              value={reason}
              onChange={(key) => setReason(key as 'all' | FreshnessReason)}
              ariaLabel={t('data.freshness.filter')}
              options={[
                { key: 'all', label: `${t('data.freshness.all')} · ${all.length}` },
                ...FRESHNESS_REASONS.filter((r) => count(r) > 0).map((r) => ({
                  key: r,
                  label: `${t(`data.freshness.reasons.${r}`)} · ${count(r)}`,
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
          <EmptyState title={t('data.freshness.empty')} hint={t('data.freshness.emptyHint')} />
        </Card>
      ) : (
        <Table dense columns={[COL.fill, '8.5rem', labelCol('freshnessReason'), COL.date, '8rem', labelCol('openDataRequest')]}>
          <thead>
            <tr>
              <th>{t('data.fields.company')}</th>
              <th>{t('data.fields.role')}</th>
              <th>{t('data.freshness.reason')}</th>
              <th>{t('data.freshness.latestPeriod')}</th>
              <th>{t('data.freshness.gaps')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gaps = [
                r.missing_registration && t('data.freshness.gap.registration'),
                r.missing_address && t('data.freshness.gap.address'),
                r.missing_industry && t('data.freshness.gap.industry'),
              ].filter(Boolean) as string[]
              return (
                <tr key={r.entity_id}>
                  <td>
                    <Link
                      to={`/entities/${r.entity_id}?tab=${REASON_TAB[r.reason]}`}
                      className="font-medium text-accent-600 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="block text-[0.7188rem] text-slate-500">{countryName(r.country_code)}</span>
                  </td>
                  <td className="text-slate-600">
                    <Truncate
                      text={[r.is_buyer && t('data.roles.buyer'), r.is_policyholder && t('data.roles.policyholder')]
                        .filter(Boolean)
                        .join(' · ')}
                      className="max-w-none"
                    />
                  </td>
                  <td>
                    <Badge tone={REASON_TONE[r.reason]}>{t(`data.freshness.reasons.${r.reason}`)}</Badge>
                  </td>
                  <td className="whitespace-nowrap text-slate-600">
                    {r.latest_period_end ? formatDate(r.latest_period_end, locale) : '—'}
                  </td>
                  <td className="text-[0.75rem] whitespace-normal text-slate-500">{gaps.length ? gaps.join(', ') : '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    {r.open_request_id && (
                      <Link to={`/data/requests/${r.open_request_id}`} className="text-[0.8125rem] text-accent-600 hover:underline">
                        {t('data.freshness.openRequest')}
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}
