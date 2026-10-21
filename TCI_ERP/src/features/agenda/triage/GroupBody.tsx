/**
 * A group task in triage: the group against its cap, exactly as
 * tci.v_group_limit_status compares them (the same row the group tab and the
 * credit workbench show) — exposure, the cap in UZS, utilisation and
 * over_limit are the view's, never recomputed here. Limits without a rate
 * are counted by the view and said, never added as zero.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Callout, DescriptionList } from '../../../components/ui'
import { EM_DASH, formatAmount, formatPercent } from '../../../lib/format'
import { useGroupLimitStatusFor } from '../../groups/api'
import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import { GenericBody } from './GenericBody'
import { num } from './figures'
import { BodySkeleton, FigureStrip, Section } from './parts'

export function GroupBody(props: { row: AgendaRow; now: Date; subjects: TaskSubjects | undefined }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const parentId = props.row.lead.object_id
  const { data: status, isLoading, isError } = useGroupLimitStatusFor(parentId)

  if (isLoading) return <BodySkeleton />
  // No row: a standalone company with no cap — the task's own facts suffice.
  if (isError || !status) return <GenericBody {...props} />

  const limitUzs = num(status.limit_uzs)
  const pct = num(status.utilisation_pct)
  const original =
    status.limit_currency && status.limit_currency !== 'UZS'
      ? `${formatAmount(num(status.limit_amount), locale)} ${status.limit_currency}`
      : null

  return (
    <>
      <FigureStrip
        figures={[
          {
            label: t('groups.exposure.title'),
            value: formatAmount(num(status.exposure_uzs), locale),
            sub: ['UZS', t('agenda.triage.group.limits', { count: status.limits_count })].join(' · '),
          },
          {
            label: t('groups.exposure.groupLimit'),
            value: limitUzs === null ? EM_DASH : formatAmount(limitUzs, locale),
            sub:
              limitUzs === null
                ? t('agenda.triage.group.noLimit')
                : ['UZS', original ? t('agenda.triage.group.setIn', { amount: original }) : null].filter(Boolean).join(' · '),
          },
          {
            label: t('groups.exposure.utilisation'),
            value: pct === null ? EM_DASH : formatPercent(pct / 100, locale),
            sub: status.over_limit ? t('agenda.triage.group.over') : undefined,
            tone: status.over_limit ? 'warn' : 'default',
          },
        ]}
      />
      <Section title={t('agenda.triage.group.title')}>
        <DescriptionList
          columns={2}
          items={[
            {
              label: t('agenda.triage.group.parent'),
              value: (
                <Link to={`/entities/${status.ultimate_parent_id}?tab=group`} className="text-accent-600 hover:underline">
                  {status.ultimate_parent_name}
                </Link>
              ),
            },
            { label: t('agenda.triage.group.members'), value: status.members_count },
            { label: t('agenda.triage.group.membersWithLimits'), value: status.members_with_limits },
            { label: t('agenda.triage.group.policyholders'), value: status.policyholders_count },
          ]}
        />
      </Section>
      {status.missing_rates > 0 && (
        <Callout tone="warn" className="mt-5" title={t('agenda.triage.group.missingTitle', { count: status.missing_rates })}>
          {t('agenda.triage.group.missingExplain')}
        </Callout>
      )}
    </>
  )
}
