/**
 * An overdue notification in triage — ripe for a claim, or up for a credit
 * review: what is unpaid since when, when the waiting period runs out, what
 * the filing did to the buyer's limit and whether a claim already holds the
 * slot. Every figure is the overdue view's own (v_overdue_notifications).
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Callout, DescriptionList } from '../../../components/ui'
import { todayIso } from '../../../components/ui/dateEntry'
import { EM_DASH, formatAmount, formatDate, formatMoment } from '../../../lib/format'
import { CLAIM_STATUS_TONE } from '../../claims/status'
import { useClaimSlots, useOverdueNotification } from '../../overdue/api'
import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import { GenericBody } from './GenericBody'
import { num } from './figures'
import { BodySkeleton, FigureStrip, Section, StatusBadge } from './parts'
import type { Figure } from './parts'

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export function NoticeBody(props: { row: AgendaRow; now: Date; subjects: TaskSubjects | undefined }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const lead = props.row.lead
  const p = lead.params ?? {}
  const noaId = str(p.noa_id) ?? lead.object_id
  const { data: noa, isLoading, isError } = useOverdueNotification(noaId)
  const slots = useClaimSlots(noa?.policy_id, true)

  if (isLoading) return <BodySkeleton />
  if (isError || !noa) return <GenericBody {...props} />

  const claimableFrom = str(p.claimable_from)
  const today = todayIso(props.now)
  const limitInStrip = lead.task_type === 'noa_credit_review' || !claimableFrom
  const third: Figure =
    limitInStrip
      ? {
          label: t('agenda.triage.notice.limit'),
          value: noa.limit_suspended ? t('agenda.triage.notice.suspended') : t('agenda.triage.notice.notSuspended'),
        }
      : {
          label: t('agenda.triage.notice.waitingEnds'),
          value: formatDate(claimableFrom, locale),
          sub: claimableFrom <= today ? t('agenda.triage.notice.waitingOver') : t('agenda.triage.notice.waitingRuns'),
        }

  const claim = slots.data?.find((c) => c.overdue_notification_id === noa.id) ?? null

  return (
    <>
      <FigureStrip
        figures={[
          {
            label: t('overdues.fields.overdueAmount'),
            value: formatAmount(num(noa.overdue_amount), locale),
            sub: noa.currency_code,
          },
          {
            label: t('overdues.fields.firstDueDate'),
            value: formatDate(noa.first_due_date, locale),
            sub: t('agenda.triage.notice.pastDue', { count: Number(noa.days_past_due) }),
          },
          third,
        ]}
      />
      <Section title={t('agenda.triage.notice.title')}>
        <DescriptionList
          columns={2}
          items={[
            {
              label: t('claims.fields.buyer'),
              value: (
                <Link to={`/entities/${noa.buyer_entity_id}`} className="text-accent-600 hover:underline">
                  {noa.buyer_name}
                </Link>
              ),
            },
            {
              label: t('agenda.triage.policy'),
              value: (
                <>
                  <Link to={`/policies/${noa.policy_id}`} className="text-accent-600 hover:underline">
                    {noa.policy_number}
                  </Link>{' '}
                  <span className="font-normal text-slate-600">· {noa.policyholder_name}</span>
                </>
              ),
            },
            { label: t('overdues.fields.reportedAt'), value: formatMoment(noa.reported_at, locale) },
            {
              label: t('overdues.fields.status'),
              value: <StatusBadge tone={noa.status === 'open' ? 'warn' : 'neutral'}>{t(`overdues.statuses.${noa.status}`)}</StatusBadge>,
            },
            // Said once: in the strip when it leads, here otherwise.
            ...(limitInStrip
              ? []
              : [
                  {
                    label: t('agenda.triage.notice.limit'),
                    value: noa.limit_suspended ? t('agenda.triage.notice.suspended') : t('agenda.triage.notice.notSuspended'),
                  },
                ]),
            {
              label: t('agenda.triage.notice.claim'),
              value: slots.isError ? (
                EM_DASH
              ) : claim ? (
                <Link to={`/claims/${claim.id}`} className="hover:underline">
                  <StatusBadge tone={CLAIM_STATUS_TONE[claim.status]}>{t(`claims.statuses.${claim.status}`)}</StatusBadge>
                </Link>
              ) : slots.isLoading ? (
                EM_DASH
              ) : (
                t('agenda.triage.notice.noClaim')
              ),
            },
          ]}
        />
      </Section>
      {noa.reported_late && (
        <Callout tone="neg" className="mt-5" title={t('overdues.lateTitle', { days: noa.days_late })}>
          {t('overdues.lateExplain', { date: formatDate(noa.notify_by_date, locale) })}
        </Callout>
      )}
    </>
  )
}
