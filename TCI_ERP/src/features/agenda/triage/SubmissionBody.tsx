/**
 * A submission in triage: its number, applicant, stage and buyer package,
 * and the terms proposed so far — read from the submission itself (the
 * requests feature's own query). A buyer a client proposed from the portal
 * has no submission behind it: the task's own facts are what there is.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, DescriptionList } from '../../../components/ui'
import { EM_DASH, formatAmount, formatPercent, formatRate } from '../../../lib/format'
import { useInsuranceRequest } from '../../requests/api'
import type { InsuranceRequestWithRefs } from '../../requests/types'
import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import { GenericBody } from './GenericBody'
import { num } from './figures'
import { BodySkeleton, Section } from './parts'

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

type Props = { row: AgendaRow; now: Date; subjects: TaskSubjects | undefined }

export function SubmissionBody(props: Props) {
  const lead = props.row.lead
  if (lead.object_type === 'client_buyer_proposal') return <ProposalFacts {...props} />
  if (lead.object_type !== 'insurance_request') return <GenericBody {...props} />
  return <RequestFacts {...props} />
}

function ProposalFacts({ row }: Props) {
  const { t } = useTranslation()
  const p = row.lead.params ?? {}
  return (
    <Section title={t('agenda.triage.submission.proposal')}>
      <DescriptionList
        columns={2}
        items={[
          { label: t('agenda.triage.submission.proposedName'), value: str(p.name) ?? EM_DASH },
          { label: t('agenda.triage.submission.registration'), value: str(p.registration_number) ?? EM_DASH },
        ]}
      />
    </Section>
  )
}

function RequestFacts(props: Props) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const lead = props.row.lead
  const { data: request, isLoading, isError } = useInsuranceRequest(lead.object_id)

  if (isLoading) return <BodySkeleton strip={false} />
  if (isError || !request) return <GenericBody {...props} />

  const buyerName = lead.task_type === 'buyer_needs_entity' ? str(lead.params?.name) : null
  return (
    <>
      <Section title={t('agenda.triage.submission.title')}>
        <DescriptionList
          columns={2}
          items={[
            {
              label: t('agenda.triage.submission.number'),
              value: (
                <Link to={`/requests/${request.id}`} className="text-accent-600 hover:underline">
                  {request.request_number}
                </Link>
              ),
            },
            {
              label: t('agenda.triage.submission.applicant'),
              value: (
                <Link to={`/entities/${request.entity_id}`} className="text-accent-600 hover:underline">
                  {request.legal_entities?.name ?? EM_DASH}
                </Link>
              ),
            },
            { label: t('agenda.triage.submission.status'), value: <Badge>{t(`requests.statuses.${request.status}`)}</Badge> },
            { label: t('agenda.triage.submission.buyers'), value: request.insurance_request_buyers.length },
            ...(buyerName ? [{ label: t('agenda.triage.submission.toResolve'), value: buyerName }] : []),
          ]}
        />
      </Section>
      {/* Identifying a buyer does not turn on the terms. */}
      {lead.task_type !== 'buyer_needs_entity' && <Terms request={request} locale={locale} />}
    </>
  )
}

/** The proposed terms, when commercial underwriting has set any. */
function Terms({ request, locale }: { request: InsuranceRequestWithRefs; locale: string }) {
  const { t } = useTranslation()
  const ccy = request.currency_code
  const money = (v: number | null) =>
    num(v) === null ? EM_DASH : <span className="whitespace-nowrap">{`${formatAmount(num(v), locale)}${ccy ? ` ${ccy}` : ''}`}</span>
  const pct = num(request.insured_percentage)
  const items = [
    { label: t('policies.terms.insuredPercentage'), value: pct === null ? EM_DASH : formatPercent(pct / 100, locale) },
    { label: t('policies.terms.premiumRate'), value: formatRate(request.premium_rate_pct, locale) },
    { label: t('policies.terms.minimumPremium'), value: money(request.minimum_premium) },
    { label: t('policies.terms.discretionaryLimit'), value: money(request.discretionary_limit) },
    { label: t('policies.terms.nql'), value: money(request.nql_amount) },
    {
      label: t('policies.terms.maxLiability'),
      value:
        num(request.max_liability_amount) !== null
          ? money(request.max_liability_amount)
          : num(request.max_liability_premium_multiple) !== null
            ? t('policies.terms.premiumMultiple', { value: formatAmount(num(request.max_liability_premium_multiple), locale, 1) })
            : EM_DASH,
    },
  ]
  const anySet = [
    request.insured_percentage,
    request.premium_rate_pct,
    request.minimum_premium,
    request.discretionary_limit,
    request.nql_amount,
    request.max_liability_amount,
    request.max_liability_premium_multiple,
  ].some((v) => num(v) !== null)
  return (
    <Section title={t('agenda.triage.submission.terms')}>
      {anySet ? (
        <DescriptionList columns={2} items={items} />
      ) : (
        <p className="text-[0.8125rem] text-slate-600">{t('agenda.triage.submission.noTerms')}</p>
      )}
    </Section>
  )
}
