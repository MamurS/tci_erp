/**
 * Validation on the limit request page (migration 0060):
 *
 *  * ValidationStatusLine — «На валидации у <ФИО> с <дата>», for every
 *    colleague who can see the request (limit_request_validation_state:
 *    who and since when, never the proposal);
 *  * ValidationPanel — for the ASSIGNED validator only: the proposal, the
 *    author's comment, the buyer's rating and key financials, and the five
 *    answers (approve / modify and approve / return / reject / forward);
 *  * ValidationHistory — every chain on the request, step by step, for admin
 *    and the people of a chain (the function returns nothing to anyone else,
 *    and the section is then not drawn at all).
 *
 * The database decides; nothing here is optimistic.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  AmountInput,
  Badge,
  Button,
  Callout,
  Card,
  COL,
  DescriptionList,
  Field,
  KeyFigures,
  labelCol,
  Modal,
  SectionTitle,
  Skeleton,
  Table,
  Textarea,
} from '../../components/ui'
import type { Fact, KeyFigure as FigureCell } from '../../components/ui'
import { amountToPlain, parseAmount } from '../../components/ui/amount'
import { todayIso } from '../../components/ui/dateEntry'
import { EM_DASH, formatAmount, formatCompact, formatDate, formatMoment, formatPercent, formatRatio } from '../../lib/format'
import { refusalOr } from '../../lib/optimistic'
import { hasRole } from '../../lib/roles'
import { BuyerBlock } from '../agenda/triage/BuyerBlock'
import { useStatements } from '../entities/api'
import { useAssessments } from '../entities/rating/assessmentsApi'
import { annualSeries, keyFigures } from '../entities/report/model'
import { latestAnnualType } from '../entities/report/useRiskReport'
import { useLatestRatesFor, useMyAuthorityGrants, useMyAuthorityUzs } from './api'
import { commercialPreflight, preflight } from './authority'
import { outcomeTone } from './machine'
import type { LimitRequestWithRefs } from './types'
import { ValidatorPicker } from './ValidationDialogs'
import { actionNeedsComment, chainsOf, creditApprovalOutcome, MODIFIABLE, validationTone } from './validation'
import type { ValidationAction, ValidationProposal, ValidationState, ValidationStep } from './validation'
import { useResolveLimitValidation, useValidationProposal } from './validationApi'

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

export function ValidationStatusLine({ state }: { state: ValidationState }) {
  const { t, i18n } = useTranslation()
  return (
    <Callout
      tone="warn"
      title={t('limits.validation.onValidationWith', {
        name: state.validator_name ?? EM_DASH,
        date: formatMoment(state.since, i18n.language),
      })}
    >
      {t(`limits.validation.stateNote.${state.stream}`)}{' '}
      <span className="whitespace-nowrap text-slate-500">· {t(`limits.validation.kinds.${state.kind}`)}</span>
    </Callout>
  )
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export function ValidationHistory({ steps, locale }: { steps: readonly ValidationStep[]; locale: string }) {
  const { t } = useTranslation()
  if (steps.length === 0) return null
  const chains = chainsOf(steps)
  return (
    <Card className="flex flex-col gap-3 p-5">
      <SectionTitle hint={t('limits.validation.historyHint')}>{t('limits.validation.historyTitle')}</SectionTitle>
      <Table columns={[COL.moment, COL.fill, COL.money, labelCol('validationStatus')]}>
        <thead>
          <tr>
            <th>{t('limits.validation.history.when')}</th>
            <th>{t('limits.validation.history.who')}</th>
            <th className="num">{t('limits.validation.history.proposal')}</th>
            <th>{t('limits.validation.history.status')}</th>
          </tr>
        </thead>
        <tbody>
          {chains.flatMap((chain, chainIndex) =>
            chain.map((step, i) => (
              <tr key={step.id} className={i === 0 && chainIndex > 0 ? 'border-t-2 border-slate-200' : ''}>
                <td className="align-top text-slate-500">
                  {formatMoment(step.created_at, locale)}
                  {step.resolved_at && (
                    <span className="block text-xs text-slate-400">
                      {t('limits.validation.history.resolvedAt', { date: formatMoment(step.resolved_at, locale) })}
                    </span>
                  )}
                </td>
                <td className="align-top whitespace-normal">
                  <span className="block text-slate-800">
                    {step.forwarded_by
                      ? t('limits.validation.history.forwarded', {
                          from: step.forwarded_by_name ?? EM_DASH,
                          to: step.validator_name ?? EM_DASH,
                        })
                      : t('limits.validation.history.sent', {
                          from: step.proposed_by_name ?? EM_DASH,
                          to: step.validator_name ?? EM_DASH,
                        })}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {[
                      t(`limits.stages.${step.stream}`),
                      t(`limits.validation.kinds.${step.kind}`),
                      t('limits.validation.bandOf', { band: t(`limits.bands.${step.grade_band}`) }),
                    ].join(' · ')}
                  </span>
                  {step.comment && i === 0 && (
                    <span className="mt-1 block text-xs text-slate-700">
                      <span className="text-slate-500">{t('limits.validation.history.authorComment')}: </span>
                      {step.comment}
                    </span>
                  )}
                  {step.resolution_comment && (
                    <span className="mt-1 block text-xs text-slate-700">
                      <span className="text-slate-500">{t('limits.validation.history.validatorComment')}: </span>
                      {step.resolution_comment}
                    </span>
                  )}
                </td>
                <td className="num align-top">
                  {step.amount === null ? (
                    t(`limits.outcomes.${step.outcome}`)
                  ) : (
                    <>
                      {formatAmount(step.amount, locale)} {step.currency_code}
                      {step.payment_terms_days !== null && step.stream === 'commercial' && (
                        <span className="block text-xs text-slate-500">
                          {t('policies.terms.days', { count: step.payment_terms_days })}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="align-top">
                  <Badge tone={validationTone(step.status)}>{t(`limits.validation.statuses.${step.status}`)}</Badge>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </Table>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The validator's panel
// ---------------------------------------------------------------------------

interface PanelProps {
  request: LimitRequestWithRefs
  step: ValidationStep
  /** Said at page level, since the panel goes away once answered. */
  onResolved: (message: string) => void
}

export function ValidationPanel({ request, step, onResolved }: PanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const proposal = useValidationProposal(step.id)
  const [action, setAction] = useState<ValidationAction | null>(null)

  const p = proposal.data
  const amountText =
    step.amount === null ? t(`limits.outcomes.${step.outcome}`) : `${formatAmount(step.amount, locale)} ${step.currency_code}`

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle
        hint={
          step.forwarded_by
            ? t('limits.validation.panel.forwardedIntro', {
                from: step.forwarded_by_name ?? EM_DASH,
                author: step.proposed_by_name ?? EM_DASH,
                date: formatMoment(step.created_at, locale),
              })
            : t('limits.validation.panel.intro', {
                author: step.proposed_by_name ?? EM_DASH,
                date: formatMoment(step.created_at, locale),
              })
        }
        actions={
          <span className="inline-flex gap-1.5">
            <Badge tone={step.kind === 'required' ? 'warn' : 'accent'}>{t(`limits.validation.kinds.${step.kind}`)}</Badge>
            <Badge tone="neutral">{t(`limits.stages.${step.stream}`)}</Badge>
          </span>
        }
      >
        {t('limits.validation.panel.title')}
      </SectionTitle>

      {proposal.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : (
        <ProposalFacts step={step} proposal={p ?? null} request={request} />
      )}

      {step.comment && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
          <span className="block text-xs font-medium text-slate-500">
            {t('limits.validation.panel.authorComment', { author: step.proposed_by_name ?? EM_DASH })}
          </span>
          <span className="whitespace-pre-line">{step.comment}</span>
        </div>
      )}

      <BuyerKeyFigures entityId={request.entity_id} />
      <BuyerBlock entityId={request.entity_id} excludeScope={request.policy_id ?? request.insurance_request_id} />

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <Button onClick={() => setAction('approve')}>{t('limits.validation.actions.approve')}</Button>
        <Button variant="secondary" onClick={() => setAction('approve_modified')}>
          {t('limits.validation.actions.approve_modified')}
        </Button>
        <Button variant="secondary" onClick={() => setAction('return')}>
          {t('limits.validation.actions.return')}
        </Button>
        <Button variant="secondary" onClick={() => setAction('forward')}>
          {t('limits.validation.actions.forward')}
        </Button>
        <Button variant="dangerOutline" onClick={() => setAction('reject')}>
          {t('limits.validation.actions.reject')}
        </Button>
      </div>

      {action && (
        <ResolveModal
          action={action}
          step={step}
          request={request}
          amountText={amountText}
          onClose={() => setAction(null)}
          onDone={(message) => {
            setAction(null)
            onResolved(message)
          }}
        />
      )}
    </Card>
  )
}

function ProposalFacts({
  step,
  proposal,
  request,
}: {
  step: ValidationStep
  proposal: ValidationProposal | null
  request: LimitRequestWithRefs
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const assessments = useAssessments(request.entity_id)
  const basedOn = proposal?.assessment_id ? assessments.data?.find((a) => a.id === proposal.assessment_id) : null

  const items: Fact[] = [
    {
      label: t('limits.validation.panel.outcome'),
      value: <Badge tone={outcomeTone(step.outcome)}>{t(`limits.outcomes.${step.outcome}`)}</Badge>,
    },
    {
      label: step.stream === 'commercial' ? t('limits.commercial.newAmount') : t('limits.fields.approvedAmount'),
      value: step.amount === null ? EM_DASH : `${formatAmount(step.amount, locale)} ${step.currency_code}`,
      hint: t('limits.validation.panel.requested', {
        amount: `${formatAmount(Number(request.requested_amount), locale)} ${request.currency_code}`,
      }),
    },
    {
      label: t('admin.fields.band'),
      value: t(`limits.bands.${step.grade_band}`),
      hint: basedOn
        ? t('limits.validation.panel.basedOn', { grade: basedOn.rating_grade, date: formatDate(basedOn.created_at, locale) })
        : t('limits.validation.panel.noAssessment'),
    },
  ]
  if (step.stream === 'commercial' || step.payment_terms_days !== null) {
    items.push({
      label: t('limits.fields.paymentTerms'),
      value: step.payment_terms_days === null ? EM_DASH : t('policies.terms.days', { count: step.payment_terms_days }),
    })
  }
  if (proposal && step.stream === 'credit' && step.outcome !== 'declined') {
    items.push({
      label: t('limits.validation.panel.validity'),
      value: `${formatDate(proposal.valid_from, locale)} — ${proposal.valid_until ? formatDate(proposal.valid_until, locale) : t('limits.untilReview')}`,
    })
  }

  const conditions = proposal?.conditions ?? []
  return (
    <div className="flex flex-col gap-3">
      <DescriptionList items={items} />
      {conditions.length > 0 && (
        <div className="text-[13px]">
          <span className="text-slate-500">{t('limits.fields.conditions')}</span>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-slate-700">
            {conditions.map((c, i) => (
              <li key={i}>
                <span className="text-slate-500">{t(`limits.conditionTypes.${c.condition_type}`)}: </span>
                {c.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The buyer's latest annual figures, as the risk report's key figures —
 * computed by the report's own model, amounts in the statement currency. */
function BuyerKeyFigures({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const statements = useStatements(entityId)
  if (statements.isLoading) return <Skeleton className="h-20 w-full" />
  const series = annualSeries(statements.data ?? [], latestAnnualType(statements.data ?? [])).slice(-2)
  const latest = series[series.length - 1]
  if (!latest) {
    return <p className="text-[13px] text-slate-500">{t('limits.validation.panel.noFinancials')}</p>
  }
  const figures = keyFigures(series)
  const show = (format: 'amount' | 'percent' | 'ratio', v: number | null) =>
    v === null
      ? EM_DASH
      : format === 'amount'
        ? `${formatCompact(v, locale, 1)} ${latest.currency_code}`
        : format === 'percent'
          ? formatPercent(v, locale, 1)
          : `${formatRatio(v, locale)}x`
  const items: FigureCell[] = figures.map((f) => ({
    label: t(`report.keyFigureLabels.${f.key}`),
    value: show(f.format, f.value),
    tone: f.value === null ? 'muted' : f.tone === 'neg' ? 'neg' : f.tone === 'pos' ? 'pos' : 'default',
    meta:
      f.previousYear !== null
        ? t('limits.validation.panel.previous', { year: f.previousYear, value: show(f.format, f.previous) })
        : undefined,
  }))
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-slate-500">
        {t('limits.validation.panel.financials', { year: latest.fiscal_year })}
      </p>
      <KeyFigures items={items} className="" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// One answer
// ---------------------------------------------------------------------------

function ResolveModal({
  action,
  step,
  request,
  amountText,
  onClose,
  onDone,
}: {
  action: ValidationAction
  step: ValidationStep
  request: LimitRequestWithRefs
  amountText: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { session, roles } = useAuth()
  const resolve = useResolveLimitValidation()
  const [amount, setAmount] = useState(step.amount === null ? '' : amountToPlain(step.amount))
  const [terms, setTerms] = useState(step.payment_terms_days === null ? '' : String(step.payment_terms_days))
  const [comment, setComment] = useState('')
  const [forwardTo, setForwardTo] = useState<string | null>(null)
  const [forwardName, setForwardName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const modifiable = MODIFIABLE[step.stream]
  const parsed = parseAmount(amount)
  const amountValid = parsed !== null && parsed > 0
  // The validator's own authority for what they would approve — the same
  // rule the decision functions apply (they run as the validator).
  const checkedAmount = action === 'approve' ? step.amount : action === 'approve_modified' && amountValid ? parsed : null
  const { data: creditAuthority } = useMyAuthorityUzs(step.grade_band)
  const { data: grants } = useMyAuthorityGrants(session?.user.id)
  const { data: rates } = useLatestRatesFor(step.currency_code)
  const check =
    checkedAmount === null
      ? null
      : step.stream === 'credit'
        ? preflight(checkedAmount, step.currency_code, roles, step.grade_band, creditAuthority ?? null, rates ?? [], todayIso())
        : commercialPreflight(checkedAmount, step.currency_code, roles, step.grade_band, grants ?? [], rates ?? [], todayIso())
  const beyond = check !== null && check.withinAuthority === false && !hasRole(roles, 'admin')

  const commentMissing = actionNeedsComment(action) && comment.trim() === ''
  const blocked =
    commentMissing ||
    (action === 'approve_modified' && !amountValid) ||
    (action === 'forward' && !forwardTo) ||
    ((action === 'approve' || action === 'approve_modified') && beyond)

  const outcomePreview =
    step.stream === 'credit' && (action === 'approve' || action === 'approve_modified')
      ? creditApprovalOutcome({
          proposed: step.outcome,
          action,
          amount: action === 'approve' ? step.amount : amountValid ? parsed : null,
          requestedAmount: Number(request.requested_amount),
        })
      : null

  const submit = async () => {
    setError(null)
    try {
      const result = await resolve.mutateAsync({
        validationId: step.id,
        action,
        amount: action === 'approve_modified' ? parsed : null,
        paymentTermsDays: action === 'approve_modified' && step.stream === 'commercial' && terms !== '' ? Number(terms) : null,
        comment: comment.trim() || null,
        forwardTo: action === 'forward' ? forwardTo : null,
      })
      onDone(
        result.result === 'forwarded'
          ? t('limits.validation.done.forwarded', { name: forwardName || EM_DASH })
          : t(`limits.validation.done.${result.result}`),
      )
    } catch (failure) {
      setError(t(refusalOr(failure, 'limits.validation.resolveFailed')))
    }
  }

  return (
    <Modal
      open
      wide={action === 'forward'}
      onClose={onClose}
      title={t(`limits.validation.actions.${action}`)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={action === 'reject' ? 'danger' : 'primary'}
            loading={resolve.isPending}
            disabled={blocked}
            onClick={() => void submit()}
          >
            {t(`limits.validation.actions.${action}`)}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-slate-600">
        {t(`limits.validation.confirm.${action}`, { amount: amountText })}
        {action === 'reject' && ` ${t(`limits.validation.confirm.rejectEffect.${step.stream}`)}`}
      </p>

      {action === 'approve_modified' && (
        <div className={`grid gap-3 ${modifiable.includes('paymentTerms') ? 'sm:grid-cols-2' : ''}`}>
          <Field label={t('limits.validation.modifiedAmount')}>
            <AmountInput value={amount} onChange={setAmount} suffix={step.currency_code} />
          </Field>
          {modifiable.includes('paymentTerms') && (
            <Field label={t('limits.fields.paymentTerms')}>
              <AmountInput decimals={0} value={terms} onChange={setTerms} suffix={t('policies.terms.daysSuffix')} />
            </Field>
          )}
        </div>
      )}
      {action === 'approve_modified' && (
        <p className="text-xs text-slate-500">{t(`limits.validation.modifyScope.${step.stream}`)}</p>
      )}

      {outcomePreview && (
        <p className="text-[13px] text-slate-600">
          {t('limits.validation.recordsAs')}{' '}
          <Badge tone={outcomeTone(outcomePreview)}>{t(`limits.outcomes.${outcomePreview}`)}</Badge>
        </p>
      )}

      {beyond && check && (
        <Callout tone="warn" title={t('limits.validation.beyondMine', { band: t(`limits.bands.${step.grade_band}`) })}>
          {t('limits.validation.beyondMineHint', { authority: formatAmount(check.authorityUzs ?? 0, locale) })}
        </Callout>
      )}

      {action === 'forward' && (
        <Field label={t('limits.validation.forwardTo')} hint={t('limits.validation.forwardHint')}>
          <ValidatorPicker
            stream={step.stream}
            band={step.grade_band}
            amount={step.amount}
            currency={step.currency_code}
            chainId={step.chain_id}
            value={forwardTo}
            onChange={(id, candidate) => {
              setForwardTo(id)
              setForwardName(candidate?.full_name?.trim() || candidate?.email || '')
            }}
          />
        </Field>
      )}

      <Field
        label={t('limits.validation.resolutionComment')}
        hint={actionNeedsComment(action) ? t('limits.validation.commentRequiredWhy') : t('limits.validation.commentOptionalHint')}
      >
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>

      {error && (
        <p className="text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
