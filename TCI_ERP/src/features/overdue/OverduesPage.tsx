/**
 * «Уведомления о просрочке» — the open NOA queue, aged.
 *
 * Two facts have to hit the reader before anything else: how long the account
 * has been overdue, and whether the notification itself was LATE. A late NOA
 * can prejudice cover, so it is flagged in red — this one really is an error
 * condition, not a warning.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, EmptyState, Field, PageHeader, Select, Spinner, Table } from '../../components/ui'
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
    <div className="p-6">
      <PageHeader
        title={t('overdues.title')}
        subtitle={t('overdues.subtitle')}
        actions={
          <Field label={t('overdues.fields.status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as '' | NoaStatus)}>
              <option value="">{t('common.all')}</option>
              {NOA_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`overdues.statuses.${s}`)}
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
              <th>{t('limits.fields.buyer')}</th>
              <th>{t('policies.fields.policyholder')}</th>
              <th className="text-right">{t('overdues.fields.overdueAmount')}</th>
              <th className="text-right">{t('overdues.fields.daysPastDue')}</th>
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
                <td className="font-medium text-slate-800">{n.buyer_name}</td>
                <td className="text-slate-500">{n.policyholder_name}</td>
                <td>
                  <span className="num block">
                    {formatAmount(Number(n.overdue_amount), locale)} {n.currency_code}
                  </span>
                </td>
                <td>
                  <span className="num block font-medium">{n.days_past_due}</span>
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
