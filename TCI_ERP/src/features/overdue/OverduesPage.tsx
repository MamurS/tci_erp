/**
 * «Уведомления о просрочке» — the open NOA queue, aged.
 *
 * Two facts have to hit the reader before anything else: how long the account
 * has been overdue, and whether the notification itself was LATE. A late NOA
 * can prejudice cover, so it is flagged in red — this one really is an error
 * condition, not a warning.
 */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, EmptyState, Field, PageHeader, Select, Spinner, Table, Truncate } from '../../components/ui'
import { formatAmount } from '../../lib/format'
import { useOverdueNotifications } from './api'
import { NOA_STATUSES } from './types'
import type { NoaStatus } from './types'

const STATUS_TONE: Record<NoaStatus, 'warn' | 'pos' | 'negStrong' | 'neutral'> = {
  open: 'warn',
  resolved_paid: 'pos',
  escalated_to_claim: 'negStrong',
  withdrawn: 'neutral',
}

export function OverduesPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const locale = i18n.language
  const [status, setStatus] = useState<'' | NoaStatus>('open')
  const { data, isLoading, isError } = useOverdueNotifications()

  const rows = useMemo(
    () => (data ?? []).filter((n) => !status || n.status === status),
    [data, status],
  )

  return (
    <div>
      <PageHeader
        title={t('overdues.title')}
        subtitle={t('overdues.subtitle')}
        actions={
          <Field label={t('overdues.fields.status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as '' | NoaStatus)}>
              <option value="">
                {t('common.all')} ({(data ?? []).length})
              </option>
              {/* Only the statuses the list holds, with their counts. */}
              {NOA_STATUSES.filter((s) => s === status || (data ?? []).some((row) => row.status === s)).map((s) => (
                <option key={s} value={s}>
                  {t(`overdues.statuses.${s}`)} ({(data ?? []).filter((row) => row.status === s).length})
                </option>
              ))}
            </Select>
          </Field>
        }
      />

      {isError ? (
        <EmptyState title={t('common.loadFailed')} hint={t('common.tryAgain')} />
      ) : isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('overdues.empty')} hint={t('overdues.emptyHint')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className="cell-fill w-[30%]">{t('limits.fields.buyer')}</th>
              <th className="cell-fill w-[30%]">{t('policies.fields.policyholder')}</th>
              <th className="text-right">{t('overdues.fields.overdueAmount')}</th>
              {/* The unit is in each cell; what the count runs from on hover. */}
              <th className="text-right" title={t('overdues.pastDueHint')}>
                {t('overdues.fields.pastDueColumn')}
              </th>
              <th>{t('overdues.fields.reported')}</th>
              <th>{t('overdues.fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr
                key={n.id}
                onClick={() => void navigate(`/overdues/${n.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="cell-fill font-medium">
                  {/* The row opens on click; the link is what a keyboard reaches. */}
                  <Truncate text={n.buyer_name} className="max-w-none">
                    <Link to={`/overdues/${n.id}`} className="text-accent-700 hover:underline">
                      {n.buyer_name}
                    </Link>
                  </Truncate>
                </td>
                <td className="cell-fill text-slate-500">
                  <Truncate text={n.policyholder_name} className="max-w-none" />
                </td>
                <td>
                  <span className="num block">
                    {formatAmount(Number(n.overdue_amount), locale)} {n.currency_code}
                  </span>
                </td>
                <td className="num font-medium" title={t('overdues.pastDueHint')}>
                  {t('policies.terms.days', { count: Number(n.days_past_due) })}
                </td>
                <td>
                  {n.reported_late ? (
                    <Badge tone="negStrong">
                      {t('overdues.lateBy', { days: n.days_late })}
                    </Badge>
                  ) : (
                    <span className="text-[13px] text-slate-500">
                      {t('overdues.onTime')}
                    </span>
                  )}
                </td>
                <td>
                  <Badge tone={STATUS_TONE[n.status]}>{t(`overdues.statuses.${n.status}`)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
