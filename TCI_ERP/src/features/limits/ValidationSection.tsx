/**
 * Validation on the limit request page (migrations 0060 and 0071):
 *
 *  * ValidationStatusLine — «На валидации: уровень 3 / кредитный комитет с
 *    <дата>» (or the named validator of a 0060 step), for every colleague who
 *    can see the request — never the proposal;
 *  * ValidationPanel — for a member of the level the step sits with (or the
 *    named validator): the proposal, the author's comment, the buyer's rating
 *    and key financials, and the answers (approve / modify and approve /
 *    return / reject / forward to the next rank);
 *  * CommitteePanel — before the committee: the tally, the member's vote or
 *    declared conflict, and the chair's close;
 *  * ValidationHistory — every chain on the request, step by step, for admin
 *    and the people of a chain and its levels.
 *
 * The database decides; nothing here is optimistic.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import { BuyerBlock } from '../agenda/triage/BuyerBlock'
import { useStatements } from '../entities/api'
import { useAssessments } from '../entities/rating/assessmentsApi'
import { annualSeries, keyFigures } from '../entities/report/model'
import { latestAnnualType } from '../entities/report/useRiskReport'
import { useLatestRatesFor, useMyStreamAuthorityUzs } from './api'
import { preflight } from './authority'
import { outcomeTone } from './machine'
import type { LimitRequestWithRefs } from './types'
import { levelName } from './levelName'
import { useDecisionRisk } from '../risk/integrationHooks'
import {
  actionNeedsComment,
  chainsOf,
  closeNeedsComment,
  committeeOutcome,
  COMMITTEE_VOTES,
  creditApprovalOutcome,
  MODIFIABLE,
  validationTone,
  voteNeedsComment,
} from './validation'
import type {
  CommitteeVote,
  StepLevel,
  StepState,
  ValidationAction,
  ValidationProposal,
  ValidationState,
  ValidationStep,
} from './validation'
import { useCommitteeActions, useResolveLimitValidation, useValidationProposal } from './validationApi'

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

export function ValidationStatusLine({ state, level }: { state: ValidationState; level: StepLevel | null }) {
  const { t, i18n } = useTranslation()
  return (
    <Callout
      tone="warn"
      title={t('limits.validation.onValidationWith', {
        name: level ? levelName(t, state.stream, level.rank, level.is_committee) : (state.validator_name ?? EM_DASH),
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

export function ValidationHistory({
  steps,
  levels,
  locale,
}: {
  steps: readonly ValidationStep[]
  /** The level each step went to (0071); a 0060 step has a named validator. */
  levels: readonly StepLevel[]
  locale: string
}) {
  const { t } = useTranslation()
  if (steps.length === 0) return null
  const chains = chainsOf(steps)
  const levelOf = new Map(levels.map((l) => [l.validation_id, l]))
  const addressee = (step: ValidationStep) => {
    const level = levelOf.get(step.id)
    return level ? levelName(t, step.stream, level.rank, level.is_committee) : (step.validator_name ?? EM_DASH)
  }
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
                    <span className="block text-caption text-slate-500">
                      {t('limits.validation.history.resolvedAt', { date: formatMoment(step.resolved_at, locale) })}
                    </span>
                  )}
                </td>
                <td className="align-top whitespace-normal">
                  <span className="block text-slate-800">
                    {step.forwarded_by
                      ? t('limits.validation.history.forwarded', {
                          from: step.forwarded_by_name ?? EM_DASH,
                          to: addressee(step),
                        })
                      : t('limits.validation.history.sent', {
                          from: step.proposed_by_name ?? EM_DASH,
                          to: addressee(step),
                        })}
                  </span>
                  <span className="block text-caption text-slate-500">
                    {[
                      t(`limits.stages.${step.stream}`),
                      t(`limits.validation.kinds.${step.kind}`),
                      t('limits.validation.bandOf', { band: t(`limits.bands.${step.grade_band}`) }),
                    ].join(' · ')}
                  </span>
                  {step.comment && i === 0 && (
                    <span className="mt-1 block text-caption text-slate-700">
                      <span className="text-slate-500">{t('limits.validation.history.authorComment')}: </span>
                      {step.comment}
                    </span>
                  )}
                  {step.resolution_comment && (
                    <span className="mt-1 block text-caption text-slate-700">
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
                        <span className="block text-caption text-slate-500">
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
  /** The level the step sits with; null for a 0060 step named to the caller. */
  level: StepLevel | null
  /** Said at page level, since the panel goes away once answered. */
  onResolved: (message: string) => void
}

export function ValidationPanel({ request, step, level, onResolved }: PanelProps) {
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
          <span className="inline-flex gap-2">
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
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-small text-slate-700">
          <span className="block text-caption font-medium text-slate-500">
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
        {/* Forward goes to the next rank up (0071); a 0060 step named to
            someone is answered, not passed on. */}
        {level && (
          <Button variant="secondary" onClick={() => setAction('forward')}>
            {t('limits.validation.actions.forward')}
          </Button>
        )}
        <Button variant="dangerOutline" onClick={() => setAction('reject')}>
          {t('limits.validation.actions.reject')}
        </Button>
      </div>

      {action && (
        <ResolveModal
          action={action}
          step={step}
          levelStep={level !== null}
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
        <div className="text-small">
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
    return <p className="text-small text-slate-500">{t('limits.validation.panel.noFinancials')}</p>
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
      <p className="mb-2 text-caption font-medium text-slate-500">
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
  levelStep,
  request,
  amountText,
  onClose,
  onDone,
}: {
  action: ValidationAction
  step: ValidationStep
  levelStep: boolean
  request: LimitRequestWithRefs
  amountText: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const resolve = useResolveLimitValidation()
  const [amount, setAmount] = useState(step.amount === null ? '' : amountToPlain(step.amount))
  const [terms, setTerms] = useState(step.payment_terms_days === null ? '' : String(step.payment_terms_days))
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const modifiable = MODIFIABLE[step.stream]
  const parsed = parseAmount(amount)
  const amountValid = parsed !== null && parsed > 0
  // The member's own authority for what they would approve — the same rule
  // the decision functions apply (they run as the member): personal grants or
  // the level, whichever is larger (0071).
  const checkedAmount = action === 'approve' ? step.amount : action === 'approve_modified' && amountValid ? parsed : null
  const { data: myAuthority } = useMyStreamAuthorityUzs(step.stream, step.grade_band)
  const { data: rates } = useLatestRatesFor(step.currency_code)
  const check =
    checkedAmount === null
      ? null
      : preflight(checkedAmount, step.currency_code, step.grade_band, myAuthority ?? null, rates ?? [], todayIso())
  const beyond = check !== null && check.withinAuthority === false
  // A level member approving AS IS beyond their own authority passes it on
  // to the next rank (resolve_limit_validation does it); a modified amount
  // beyond it is refused.
  const passesOn = levelStep && action === 'approve' && beyond

  // Prompt 31: no approval grants cover to a sanctioned company or country
  // (0085 refuses it for every path, the levels and the committee included).
  // A credit step proposing a decline may still be approved.
  const { ctx: risk } = useDecisionRisk(request.entity_id)
  const coverStop =
    Boolean(risk?.cover_block) &&
    (action === 'approve' || action === 'approve_modified') &&
    (step.stream === 'commercial' || step.outcome !== 'declined')

  const commentMissing = actionNeedsComment(action) && comment.trim() === ''
  const blocked =
    coverStop ||
    commentMissing ||
    (action === 'approve_modified' && !amountValid) ||
    (action === 'approve_modified' && beyond) ||
    (action === 'approve' && beyond && !levelStep)

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
      })
      onDone(
        result.result === 'forwarded'
          ? t('limits.validation.done.forwarded', {
              name: result.rank === null ? EM_DASH : levelName(t, step.stream, result.rank, result.rank === 5),
            })
          : t(`limits.validation.done.${result.result}`),
      )
    } catch (failure) {
      setError(t(refusalOr(failure, 'limits.validation.resolveFailed')))
    }
  }

  return (
    <Modal
      open
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
      <p className="text-small text-slate-600">
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
        <p className="text-caption text-slate-500">{t(`limits.validation.modifyScope.${step.stream}`)}</p>
      )}

      {outcomePreview && !passesOn && (
        <p className="text-small text-slate-600">
          {t('limits.validation.recordsAs')}{' '}
          <Badge tone={outcomeTone(outcomePreview)}>{t(`limits.outcomes.${outcomePreview}`)}</Badge>
        </p>
      )}

      {passesOn && check ? (
        <Callout tone="info" title={t('limits.validation.passesOn')}>
          {t('limits.validation.passesOnHint', { authority: formatAmount(check.authorityUzs ?? 0, locale) })}
        </Callout>
      ) : (
        beyond &&
        check && (
          <Callout tone="warn" title={t('limits.validation.beyondMine', { band: t(`limits.bands.${step.grade_band}`) })}>
            {t('limits.validation.beyondMineHint', { authority: formatAmount(check.authorityUzs ?? 0, locale) })}
          </Callout>
        )
      )}

      {action === 'forward' && <p className="text-small text-slate-600">{t('limits.validation.forwardHint')}</p>}

      {coverStop && (
        <Callout tone="neg" title={t('risk.decision.blockTitle')}>
          {t(risk?.cover_block === 'company' ? 'risk.errors.coverCompany' : 'risk.errors.coverCountry')}
        </Callout>
      )}

      <Field
        label={t('limits.validation.resolutionComment')}
        hint={actionNeedsComment(action) ? t('limits.validation.commentRequiredWhy') : t('limits.validation.commentOptionalHint')}
      >
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>

      {error && (
        <p className="text-small text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// The committee (0071)
// ---------------------------------------------------------------------------

/** Before the committee: the proposal, the tally, the member's own vote or
 * declared conflict, and — for the chair — the close. Quorum, the majority
 * and the casting vote are decided in SQL; the screen says what closing now
 * would record (committeeOutcome mirrors close_committee_vote). */
export function CommitteePanel({
  request,
  step,
  state,
  onResolved,
}: {
  request: LimitRequestWithRefs
  step: ValidationStep
  state: StepState
  onResolved: (message: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const proposal = useValidationProposal(step.id)
  const { vote, conflict, close } = useCommitteeActions(step.id)
  const [dialog, setDialog] = useState<CommitteeVote | 'conflict' | 'close' | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const committee = state.committee
  if (!committee) return null

  const chairVote = committee.votes.find((v) => v.voter === committee.chair_id)?.vote ?? null
  const outcome = committeeOutcome({ approve: committee.approve, reject: committee.reject, chairVote })
  const needsComment =
    dialog === null
      ? false
      : dialog === 'conflict'
        ? true
        : dialog === 'close'
          ? closeNeedsComment(outcome)
          : voteNeedsComment(dialog)
  const pending = vote.isPending || conflict.isPending || close.isPending

  const run = async () => {
    if (!dialog) return
    setError(null)
    try {
      if (dialog === 'conflict') {
        await conflict.mutateAsync(comment.trim())
      } else if (dialog === 'close') {
        const result = await close.mutateAsync(comment.trim() || null)
        onResolved(t(`limits.validation.committeeDone.${result.committee.action}`))
      } else {
        await vote.mutateAsync({ vote: dialog, comment: comment.trim() || null })
      }
      setDialog(null)
      setComment('')
    } catch (failure) {
      setError(t(refusalOr(failure, 'limits.validation.resolveFailed')))
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle
        hint={t('limits.validation.committeePanel.intro', {
          author: step.proposed_by_name ?? EM_DASH,
          date: formatMoment(step.created_at, locale),
        })}
        actions={
          <span className="inline-flex gap-2">
            <Badge tone={step.kind === 'required' ? 'warn' : 'accent'}>{t(`limits.validation.kinds.${step.kind}`)}</Badge>
            <Badge tone="neutral">{t(`limits.stages.${step.stream}`)}</Badge>
          </span>
        }
      >
        {levelName(t, step.stream, state.rank, true)}
      </SectionTitle>

      {proposal.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ProposalFacts step={step} proposal={proposal.data ?? null} request={request} />
      )}
      {step.comment && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-small text-slate-700">
          <span className="block text-caption font-medium text-slate-500">
            {t('limits.validation.panel.authorComment', { author: step.proposed_by_name ?? EM_DASH })}
          </span>
          <span className="whitespace-pre-line">{step.comment}</span>
        </div>
      )}
      <BuyerKeyFigures entityId={request.entity_id} />

      <KeyFigures
        className=""
        items={[
          { label: t('limits.validation.committeePanel.approve'), value: String(committee.approve), tone: 'pos' },
          { label: t('limits.validation.committeePanel.reject'), value: String(committee.reject), tone: 'neg' },
          { label: t('limits.validation.committeePanel.abstain'), value: String(committee.abstain) },
          {
            label: t('limits.validation.committeePanel.turnout'),
            value: `${committee.cast} / ${committee.electorate}`,
            meta: committee.quorum_met
              ? t('limits.validation.committeePanel.quorumMet')
              : t('limits.validation.committeePanel.quorumNot'),
          },
        ]}
      />
      <p className="text-small text-slate-600">
        {t('limits.validation.committeePanel.chair', { name: committee.chair_name ?? EM_DASH })}
        {' · '}
        {t('limits.validation.committeePanel.rule')}
      </p>

      {committee.votes.length > 0 && (
        <Table columns={[COL.moment, COL.fill, labelCol('validationStatus')]}>
          <thead>
            <tr>
              <th>{t('limits.validation.history.when')}</th>
              <th>{t('limits.validation.committeePanel.member')}</th>
              <th>{t('limits.validation.committeePanel.vote')}</th>
            </tr>
          </thead>
          <tbody>
            {committee.votes.map((v) => (
              <tr key={v.voter}>
                <td className="text-slate-500">{formatMoment(v.voted_at, locale)}</td>
                <td className="whitespace-normal">
                  <span className="block text-slate-800">
                    {v.name ?? EM_DASH}
                    {v.voter === committee.chair_id && ` · ${t('limits.validation.committeePanel.chairMark')}`}
                  </span>
                  {v.comment && <span className="block text-caption text-slate-600">{v.comment}</span>}
                </td>
                <td>
                  <Badge tone={v.vote === 'approve' ? 'pos' : v.vote === 'reject' ? 'neg' : 'neutral'}>
                    {t(`limits.validation.votes.${v.vote}`)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {committee.conflicts.length > 0 && (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-small text-slate-600">
          {committee.conflicts.map((c) => (
            <li key={c.member}>
              {t('limits.validation.committeePanel.conflictOf', { name: c.name ?? EM_DASH })}: {c.reason}
            </li>
          ))}
        </ul>
      )}

      {committee.my_vote && (
        <p className="text-small text-slate-600">
          {t('limits.validation.committeePanel.myVote', { vote: t(`limits.validation.votes.${committee.my_vote}`) })}
        </p>
      )}
      {committee.i_am_conflicted && (
        <p className="text-small text-slate-600">{t('limits.validation.committeePanel.iAmConflicted')}</p>
      )}

      {(committee.i_may_vote || committee.i_may_close) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {committee.i_may_vote &&
            COMMITTEE_VOTES.map((v) => (
              <Button
                key={v}
                variant={v === 'approve' ? 'primary' : v === 'reject' ? 'dangerOutline' : 'secondary'}
                onClick={() => setDialog(v)}
              >
                {t(`limits.validation.voteActions.${v}`)}
              </Button>
            ))}
          {committee.i_may_vote && (
            <Button variant="secondary" onClick={() => setDialog('conflict')}>
              {t('limits.validation.voteActions.conflict')}
            </Button>
          )}
          {committee.i_may_close && (
            <Button variant="secondary" disabled={!committee.quorum_met} onClick={() => setDialog('close')}>
              {t('limits.validation.voteActions.close')}
            </Button>
          )}
          {committee.i_may_close && !committee.quorum_met && (
            <span className="text-small text-slate-500">{t('limits.validation.committeePanel.needQuorum')}</span>
          )}
        </div>
      )}

      {dialog && (
        <Modal
          open
          onClose={() => setDialog(null)}
          title={t(`limits.validation.voteActions.${dialog}`)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant={dialog === 'reject' ? 'danger' : 'primary'}
                loading={pending}
                disabled={needsComment && comment.trim() === ''}
                onClick={() => void run()}
              >
                {t(`limits.validation.voteActions.${dialog}`)}
              </Button>
            </>
          }
        >
          {dialog === 'close' && (
            <p className="text-small text-slate-600">
              {t('limits.validation.committeePanel.closeWillRecord')}{' '}
              <Badge tone={outcome === 'approve' ? 'pos' : outcome === 'reject' ? 'neg' : 'accent'}>
                {t(`limits.validation.committeeOutcome.${outcome}`)}
              </Badge>
            </p>
          )}
          {dialog === 'conflict' && (
            <p className="text-small text-slate-600">{t('limits.validation.committeePanel.conflictNote')}</p>
          )}
          <Field
            label={
              dialog === 'conflict'
                ? t('limits.validation.committeePanel.conflictReason')
                : dialog === 'close'
                  ? t('limits.validation.committeePanel.minutes')
                  : t('limits.validation.resolutionComment')
            }
            hint={needsComment ? t('limits.validation.commentRequiredWhy') : t('limits.validation.commentOptionalHint')}
          >
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          {error && (
            <p className="text-small text-neg-500" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </Card>
  )
}
