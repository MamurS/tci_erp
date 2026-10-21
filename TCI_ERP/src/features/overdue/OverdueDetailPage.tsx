/** One overdue notification: the ageing, the lateness verdict, what the
 * filing did to the buyer's cover, and how a human closes it. */

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Callout,
  DetailHeader,
  EmptyState,
  Field,
  KeyFigures,
  Modal,
  Panel,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui'
import { formatAmount, formatDate, formatMoment } from '../../lib/format'
import { useOverdueNotification, useResolveNoa } from './api'
import { canResolve, RESOLUTION_STATUSES } from './noa'
import type { NoaStatus } from './types'
import { refusalKey } from '../../lib/refusals'

export function OverdueDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: noa, isLoading } = useOverdueNotification(id)
  const resolve = useResolveNoa()
  const [status, setStatus] = useState<NoaStatus>('resolved_paid')
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!noa) return <EmptyState title={t('overdues.notFound')} />

  const open = noa.status === 'open'

  return (
    <div>
      <DetailHeader
        eyebrow={t('overdues.eyebrow')}
        title={noa.buyer_name}
        status={<Badge tone={open ? 'warn' : 'neutral'}>{t(`overdues.statuses.${noa.status}`)}</Badge>}
        meta={[
          <Link key="p" to={`/policies/${noa.policy_id}`} className="text-accent-600 hover:underline">
            {noa.policy_number}
          </Link>,
          noa.policyholder_name,
          `${t('overdues.fields.reportedAt')} ${formatMoment(noa.reported_at, locale)}`,
        ]}
        actions={
          canResolve(noa.status) && (
            <Button onClick={() => setResolving(true)}>{t('overdues.actions.resolve')}</Button>
          )
        }
      />

      <div className="space-y-3 empty:hidden [&:not(:empty)]:mb-6">
        {noa.reported_late && (
          <Callout tone="neg" title={t('overdues.lateTitle', { days: noa.days_late })}>
            {t('overdues.lateExplain', { date: formatDate(noa.notify_by_date, locale) })}
          </Callout>
        )}
        {noa.limit_suspended && (
          <Callout
            tone="warn"
            title={t('overdues.suspendedTitle')}
            action={
              <Link to={`/entities/${noa.buyer_entity_id}`} className="font-medium text-accent-600 hover:underline">
                {t('overdues.openBuyer')}
              </Link>
            }
          >
            {t('overdues.suspendedExplain')}
          </Callout>
        )}
      </div>

      <KeyFigures
        items={[
          {
            label: t('overdues.fields.overdueAmount'),
            value: `${formatAmount(Number(noa.overdue_amount), locale)} ${noa.currency_code}`,
          },
          { label: t('overdues.fields.firstDueDate'), value: formatDate(noa.first_due_date, locale) },
          {
            // No amber here: nothing about the count crosses a threshold, and
            // the status badge already says the notification is open.
            label: t('overdues.fields.pastDueColumn'),
            value: t('policies.terms.days', { count: Number(noa.days_past_due) }),
            meta: t('overdues.pastDueHint'),
          },
          {
            label: t('overdues.fields.notifyBy'),
            value: formatDate(noa.notify_by_date, locale),
            meta: t('overdues.windowHint', { extension: noa.max_extension_period_days, window: noa.noa_window_days }),
          },
        ]}
      />

      {noa.resolution_note && (
        <Panel title={t('overdues.fields.resolutionNote')}>
          <p className="border-l-2 border-slate-200 pl-3 text-[13px] leading-relaxed text-slate-700">
            {noa.resolution_note}
          </p>
        </Panel>
      )}

      <Modal
        open={resolving}
        title={t('overdues.resolveTitle')}
        onClose={() => {
          setResolving(false)
          setError(null)
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setResolving(false)
                setError(null)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={resolve.isPending}
              onClick={() => {
                setError(null)
                resolve
                  .mutateAsync({ id: noa.id, status, note })
                  .then(() => setResolving(false))
                  .catch((e: unknown) => setError(t(refusalKey(e))))
              }}
            >
              {t('overdues.actions.resolve')}
            </Button>
          </>
        }
      >
        {error && <Callout tone="neg" title={error} />}
        <p className="text-[13px] leading-relaxed text-slate-600">{t('overdues.resolveHint')}</p>
        <Field label={t('overdues.fields.resolution')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as NoaStatus)}>
            {RESOLUTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`overdues.statuses.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('overdues.fields.resolutionNote')}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
    </div>
  )
}
