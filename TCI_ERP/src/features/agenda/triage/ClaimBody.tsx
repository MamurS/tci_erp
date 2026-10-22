/**
 * A claim in triage: what was claimed, what was approved, what has been paid
 * — the claim page's own figures (v_claims, v_claim_position) — with the
 * notification-duty warning the claim page raises when cover is prejudiced.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Callout, DescriptionList } from '../../../components/ui'
import { EM_DASH, formatAmount, formatDate } from '../../../lib/format'
import { useClaim, useClaimPosition } from '../../claims/api'
import { noaWarning } from '../../claims/coverage'
import { CLAIM_STATUS_TONE } from '../../claims/status'
import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import { GenericBody } from './GenericBody'
import { num } from './figures'
import { BodySkeleton, FigureStrip, Section, StatusBadge } from './parts'

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export function ClaimBody(props: { row: AgendaRow; now: Date; subjects: TaskSubjects | undefined }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const lead = props.row.lead
  const claimId = str(lead.params?.claim_id) ?? lead.object_id
  const { data: claim, isLoading, isError } = useClaim(claimId)
  const position = useClaimPosition(claimId)

  if (isLoading) return <BodySkeleton />
  if (isError || !claim) return <GenericBody {...props} />

  const ccy = claim.currency_code
  const indemnity = num(claim.approved_indemnity)
  const paid = position.data ? num(position.data.paid_total) : null
  const outstanding = position.data ? num(position.data.outstanding_indemnity) : null
  const warning = noaWarning(claim)

  return (
    <>
      <FigureStrip
        figures={[
          { label: t('claims.fields.claimed'), value: formatAmount(num(claim.claimed_amount), locale), sub: ccy },
          indemnity === null
            ? { label: t('claims.fields.indemnity'), value: EM_DASH, sub: t('claims.indemnityPending') }
            : { label: t('claims.fields.indemnity'), value: formatAmount(indemnity, locale), sub: ccy },
          {
            label: t('agenda.triage.claim.paid'),
            value: formatAmount(paid, locale),
            sub:
              paid === null
                ? undefined
                : [ccy, outstanding !== null && outstanding > 0 ? t('agenda.triage.claim.outstanding', { amount: formatAmount(outstanding, locale) }) : null]
                    .filter(Boolean)
                    .join(' · '),
          },
        ]}
      />
      <Section title={t('agenda.triage.claim.title')}>
        <DescriptionList
          columns={2}
          items={[
            {
              label: t('claims.fields.number'),
              value: (
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  <Link to={`/claims/${claim.id}`} className="text-accent-600 hover:underline">
                    {claim.claim_number}
                  </Link>
                  <StatusBadge tone={CLAIM_STATUS_TONE[claim.status]}>{t(`claims.statuses.${claim.status}`)}</StatusBadge>
                </span>
              ),
            },
            {
              label: t('claims.fields.buyer'),
              value: (
                <Link to={`/entities/${claim.buyer_entity_id}`} className="text-accent-600 hover:underline">
                  {claim.buyer_name}
                </Link>
              ),
            },
            {
              label: t('agenda.triage.policy'),
              value: (
                <>
                  <Link to={`/policies/${claim.policy_id}`} className="text-accent-600 hover:underline">
                    {claim.policy_number}
                  </Link>{' '}
                  <span className="font-normal text-slate-600">· {claim.policyholder_name}</span>
                </>
              ),
            },
            { label: t('claims.fields.cause'), value: t(`claims.causes.${claim.cause_of_loss}`) },
            { label: t('claims.fields.filedAt'), value: claim.filed_at ? formatDate(claim.filed_at, locale) : EM_DASH },
            { label: t('claims.fields.invoices'), value: claim.invoice_count },
          ]}
        />
      </Section>
      {warning && (
        <Callout
          tone="neg"
          className="mt-5"
          title={warning.key === 'late' ? t('claims.noaLateTitle', { days: warning.days }) : t('claims.noaMissingTitle')}
        >
          {warning.key === 'late' ? t('claims.noaLateExplain') : t('claims.noaMissingExplain')}
        </Callout>
      )}
    </>
  )
}
