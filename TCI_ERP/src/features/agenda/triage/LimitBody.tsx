/**
 * A limit task in triage: a decision to take (or one escalated), a decision
 * held by sales, a limit coming up for review. Three figures frame it — what
 * is asked, what the reader may decide (the database's answer, from the
 * credit workbench's queue view), what the engine calculated — then the
 * buyer, and any open overdue notification on it. Reads only.
 */

import { useTranslation } from 'react-i18next'

import { useAuth } from '../../../auth/AuthContext'
import { Skeleton } from '../../../components/ui'
import { todayIso } from '../../../components/ui/dateEntry'
import { EM_DASH, formatAmount, formatDate } from '../../../lib/format'
import { hasRole } from '../../../lib/roles'
import { useUzsRates } from '../../declarations/api'
import { useAssessments } from '../../entities/rating/assessmentsApi'
import { useBuyerExposure, useDecisionChain, useLimitRequest } from '../../limits/api'
import { convertAtLatest } from '../../limits/authority'
import type { LimitRequestWithRefs } from '../../limits/types'
import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import { BuyerBlock, OverdueWarning } from './BuyerBlock'
import { GenericBody } from './GenericBody'
import { useLimitQueueRow } from './api'
import { authorityState, num } from './figures'
import { useExposureFigure } from './hooks'
import { BodySkeleton, Dot, FigureStrip } from './parts'
import type { Figure } from './parts'

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

interface BodyProps {
  row: AgendaRow
  now: Date
  subjects: TaskSubjects | undefined
}

export function LimitBody(props: BodyProps) {
  const lead = props.row.lead
  if (lead.task_type === 'limit_review_due') return <ReviewBody {...props} />
  return <RequestBody {...props} />
}

// ---------------------------------------------------------------------------
// A request to decide, an escalation, a held decision
// ---------------------------------------------------------------------------

function RequestBody(props: BodyProps) {
  const lead = props.row.lead
  const held = lead.task_type === 'limit_held'
  const requestId = held ? (str(lead.params?.request_id) ?? '') : lead.object_id
  const request = useLimitRequest(requestId)

  if (request.isLoading) return <BodySkeleton />
  if (request.isError || !request.data) return <GenericBody {...props} />
  return <RequestLoaded {...props} request={request.data} held={held} />
}

function RequestLoaded(props: BodyProps & { request: LimitRequestWithRefs; held: boolean }) {
  const { request: r, held } = props
  const assessments = useAssessments(r.entity_id)
  // Read here so the strip appears whole, not with a blank authority card.
  const queue = useLimitQueueRow(held ? undefined : r.id)
  if (assessments.isLoading || queue.isLoading) return <BodySkeleton />
  const scope = r.policy_id ?? r.insurance_request_id
  return (
    <>
      {held ? <HeldStrip request={r} decisionId={props.row.lead.object_id} /> : <DecisionStrip {...props} />}
      <BuyerBlock entityId={r.entity_id} excludeScope={scope} />
      <OverdueWarning entityId={r.entity_id} policyId={r.policy_id} />
    </>
  )
}

function useRequestedFigure(request: LimitRequestWithRefs): Figure {
  const { t, i18n } = useTranslation()
  return {
    label: t('agenda.triage.limit.requested'),
    value: formatAmount(num(request.requested_amount), i18n.language),
    sub: [
      request.currency_code,
      request.requested_payment_terms_days === null
        ? null
        : t('agenda.triage.limit.terms', { count: request.requested_payment_terms_days }),
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

function DecisionStrip({ row, request }: BodyProps & { request: LimitRequestWithRefs }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { roles } = useAuth()
  const queue = useLimitQueueRow(request.id)
  const requested = useRequestedFigure(request)
  const engine = useEngineFigure(request.entity_id, request.currency_code, num(request.requested_amount), 'request')
  const p = row.lead.params ?? {}

  let middle: Figure
  if (p.reason === 'group_limit') {
    // Escalated by the group control, not by anyone's personal authority.
    middle = {
      label: t('groups.exposure.groupLimit'),
      value: formatAmount(num(p.group_limit_uzs), locale),
      sub: t('agenda.triage.limit.groupAfter', { amount: formatAmount(num(p.exposure_after_uzs), locale) }),
      tone: 'warn',
    }
  } else if (queue.isLoading) {
    middle = { label: t('agenda.triage.limit.yourAuthorityPlain'), value: EM_DASH }
  } else if (!queue.data) {
    // No longer open (or not readable): its status says why.
    middle = { label: t('limits.fields.status'), value: t(`limits.statuses.${request.status}`) }
  } else {
    const q = queue.data
    const label = t('agenda.triage.limit.yourAuthority', { band: t(`limits.bands.${q.band}`) })
    const state = authorityState(q, hasRole(roles, 'admin'))
    middle =
      state.kind === 'admin'
        ? { label, value: t('agenda.triage.limit.unlimited'), sub: t('agenda.triage.limit.adminNote') }
        : state.kind === 'noRate'
          ? { label, value: EM_DASH, sub: t('agenda.triage.limit.noRate', { currency: request.currency_code }), tone: 'warn' }
          : state.kind === 'within'
            ? {
                label,
                value: formatAmount(state.authorityUzs, locale),
                sub: (
                  <>
                    <Dot tone="pos" />
                    {t('agenda.triage.limit.withinAuthority')}
                  </>
                ),
              }
            : {
                label,
                value: formatAmount(state.authorityUzs, locale),
                sub: t('agenda.triage.limit.shortBy', { amount: formatAmount(state.shortfallUzs, locale) }),
                tone: 'warn',
              }
  }
  return <FigureStrip figures={[requested, middle, engine]} />
}

function HeldStrip({ request, decisionId }: { request: LimitRequestWithRefs; decisionId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: chain } = useDecisionChain(decisionId)
  const decision = chain?.find((d) => d.id === decisionId) ?? null
  const requested = useRequestedFigure(request)
  const amount = num(decision?.approved_amount)
  const engine = useEngineFigure(request.entity_id, request.currency_code, num(request.requested_amount), 'request')
  const held: Figure = {
    label: t('agenda.triage.limit.heldDecision'),
    value: decision ? (amount === null ? t(`limits.outcomes.${decision.outcome}`) : formatAmount(amount, locale)) : EM_DASH,
    sub: decision
      ? [
          amount === null ? null : decision.currency_code,
          amount === null ? null : t(`limits.outcomes.${decision.outcome}`),
          formatDate(decision.decided_at, locale),
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined,
  }
  return <FigureStrip figures={[requested, held, engine]} />
}

// ---------------------------------------------------------------------------
// A limit coming up for review
// ---------------------------------------------------------------------------

function ReviewBody(props: BodyProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const p = props.row.lead.params ?? {}
  const entityId = str(p.entity_id) ?? props.row.lead.object_id
  const policyId = str(p.policy_id)
  const currency = str(p.currency)
  const amount = num(p.amount)
  const assessments = useAssessments(entityId)
  const exposure = useBuyerExposure(entityId)
  const engine = useEngineFigure(entityId, currency ?? 'UZS', amount, 'limit')
  const exposureFigure = useExposureFigure(exposure.data ?? null, 'agenda.triage.limit.exposure')

  if (assessments.isLoading || exposure.isLoading) return <BodySkeleton />
  if (!currency) return <GenericBody {...props} />

  const validUntil = str(p.valid_until)
  const inForce: Figure = {
    label: t('agenda.triage.limit.inForce'),
    value: formatAmount(amount, locale),
    sub: [currency, validUntil ? t('limits.validUntil', { date: formatDate(validUntil, locale) }) : null]
      .filter(Boolean)
      .join(' · '),
  }
  return (
    <>
      <FigureStrip figures={[inForce, engine, exposureFigure]} />
      <BuyerBlock entityId={entityId} excludeScope={policyId} />
      <OverdueWarning entityId={entityId} policyId={policyId} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Shared figures
// ---------------------------------------------------------------------------

/** The engine's suggested limit from the buyer's latest assessment, in the
 * currency of the request (or the limit) — converted exactly as the limit
 * request page does it (convertAtLatest, through UZS at the latest rates),
 * for reading only. */
function useEngineFigure(entityId: string, currency: string, compare: number | null, subject: 'request' | 'limit'): Figure {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: assessments } = useAssessments(entityId)
  const latest = assessments?.[0] ?? null
  const from = latest?.limit_currency ?? currency
  const { data: rates, isLoading: ratesLoading } = useUzsRates([from, currency])
  const label = t('agenda.triage.limit.engine')
  // Never «no rate» while the rates are still on their way.
  if (ratesLoading) return { label, value: <Skeleton className="h-6 w-36" /> }
  if (!latest) return { label, value: EM_DASH, sub: t('agenda.triage.limit.noAssessment') }
  const suggested = num(latest.suggested_limit)
  if (suggested === null) return { label, value: EM_DASH }
  const converted = convertAtLatest(suggested, from, currency, rates ?? [], todayIso())
  const original = `${formatAmount(suggested, locale)} ${from}`
  if (converted === null) {
    return { label, value: formatAmount(suggested, locale), sub: t('agenda.triage.limit.engineNoRate', { from, to: currency }) }
  }
  const within = compare === null ? null : compare <= converted
  return {
    label,
    value: formatAmount(converted, locale),
    sub: (
      <>
        {[currency, from === currency ? null : t('agenda.triage.limit.engineOriginal', { amount: original })]
          .filter(Boolean)
          .join(' · ')}
        {within !== null && (
          <span className="mt-0.5 block font-semibold">
            <Dot tone={within ? 'pos' : 'neg'} />
            {t(`agenda.triage.limit.${subject}${within ? 'Within' : 'Above'}`)}
          </span>
        )}
      </>
    ),
  }
}
