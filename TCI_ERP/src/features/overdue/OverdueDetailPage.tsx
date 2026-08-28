/** One overdue notification: the ageing, the lateness verdict, what the
 * filing did to the buyer's cover, and how a human closes it. */

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../../components/ui'
import { formatAmount, formatMoment } from '../../lib/format'
import { useOverdueNotification, useResolveNoa } from './api'
import { canResolve, RESOLUTION_STATUSES } from './noa'
import type { NoaStatus } from './types'

export function OverdueDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: noa, isLoading } = useOverdueNotification(id)
  const resolve = useResolveNoa()
  const [status, setStatus] = useState<NoaStatus>('resolved_paid')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!noa) return <EmptyState title={t('overdues.notFound')} />

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={noa.buyer_name}
        subtitle={`${noa.policy_number} · ${noa.policyholder_name}`}
      />

      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      {noa.reported_late && (
        <Card className="border-neg-500/40 bg-neg-50">
          <p className="text-sm font-semibold text-neg-500">
            {t('overdues.lateTitle', { days: noa.days_late })}
          </p>
          <p className="mt-1 text-[13px] text-slate-700">
            {t('overdues.lateExplain', { date: noa.notify_by_date })}
          </p>
        </Card>
      )}

      {noa.limit_suspended && (
        <Card className="border-warn-500/40 bg-warn-50">
          <p className="text-sm font-semibold text-slate-800">{t('overdues.suspendedTitle')}</p>
          <p className="mt-1 text-[13px] text-slate-700">{t('overdues.suspendedExplain')}</p>
          <Link
            to={`/entities/${noa.buyer_entity_id}`}
            className="mt-2 inline-block text-[13px] text-accent-600 hover:underline"
          >
            {t('overdues.openBuyer')}
          </Link>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-slate-500">{t('overdues.fields.overdueAmount')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {formatAmount(Number(noa.overdue_amount), locale)} {noa.currency_code}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">{t('overdues.fields.firstDueDate')}</p>
          <p className="mt-1 text-xl font-semibold">{noa.first_due_date}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">{t('overdues.fields.daysPastDue')}</p>
          <p className="num mt-1 text-xl font-semibold">{noa.days_past_due}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">{t('overdues.fields.notifyBy')}</p>
          <p className="mt-1 text-xl font-semibold">{noa.notify_by_date}</p>
          <p className="mt-1 text-xs text-slate-500">
            {t('overdues.windowHint', {
              extension: noa.max_extension_period_days,
              window: noa.noa_window_days,
            })}
          </p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('overdues.fields.status')}</h2>
          <Badge tone={noa.status === 'open' ? 'warn' : 'neutral'}>
            {t(`overdues.statuses.${noa.status}`)}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {t('overdues.fields.reportedAt')}: {formatMoment(noa.reported_at, locale)}
        </p>
        {noa.resolution_note && (
          <p className="mt-2 text-[13px] text-slate-700">{noa.resolution_note}</p>
        )}

        {canResolve(noa.status) && (
          <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
            <p className="text-xs text-slate-500">{t('overdues.resolveHint')}</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('overdues.fields.resolution')}>
                <Select value={status} onChange={(e) => setStatus(e.target.value as NoaStatus)}>
                  {RESOLUTION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`overdues.statuses.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('overdues.fields.resolutionNote')} className="flex-1">
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Button
                onClick={() => {
                  setError(null)
                  resolve
                    .mutateAsync({ id: noa.id, status, note })
                    .catch((e: { message?: string }) =>
                      setError(e.message ?? t('common.somethingWentWrong')),
                    )
                }}
              >
                {t('overdues.actions.resolve')}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
