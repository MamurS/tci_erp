/**
 * Limit request page: request card + status timeline, buyer snapshot
 * (grade, calculated limit, current effective limit), and the decision
 * form with the authority preflight banner (same conversion rule as the
 * SQL function — authority.ts is the contract mirror).
 */

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  GradeScale,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { bandForGrade, hasRole } from '../../lib/roles'
import { EM_DASH, formatAmount } from '../../lib/format'
import { useGradeScale } from '../../lib/gradeScale'
import { useAssessments } from '../entities/rating/assessmentsApi'
import {
  useDecideLimitRequest,
  useEffectiveLimits,
  useLatestRatesFor,
  useLimitRequest,
  useMyAuthorityUzs,
  useSalesWindowHours,
  useStartLimitReview,
  useSubmitLimitRequest,
  useWithdrawLimitRequest,
} from './api'
import { preflight } from './authority'
import { GroupChip, GroupPreflightNotice, useGroupPreflight } from '../groups'
import { CommercialStageSection } from './CommercialStageSection'
import { ReleaseBadge } from './ReleaseBadge'
import {
  canDecideAs,
  canStartReview,
  canSubmit,
  canWithdraw,
  outcomeTone,
  statusTone,
} from './machine'
import type { ConditionInput, LimitRequestWithRefs } from './types'
import { CONDITION_TYPES } from './types'

export function LimitRequestPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { id = '' } = useParams()
  const { session, roles } = useAuth()

  const { data: request, isLoading } = useLimitRequest(id)
  const submit = useSubmitLimitRequest()
  const startReview = useStartLimitReview()
  const withdraw = useWithdrawLimitRequest()
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawComment, setWithdrawComment] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!request) {
    return (
      <EmptyState
        title={t('limits.notFound')}
        action={
          <Link to="/limits" className="text-sm font-medium text-accent-700 hover:underline">
            {t('limits.backToQueue')}
          </Link>
        }
      />
    )
  }

  const isRequester = request.requested_by === session?.user.id
  const showDecisionForm = canDecideAs(request.status, roles)
  const awaitingSenior =
    request.status === 'escalated' && !hasRole(roles, 'admin', 'credit_underwriter')

  const act = async (action: Promise<unknown>) => {
    setActionError(null)
    try {
      await action
    } catch {
      setActionError(t('common.saveFailed'))
    }
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span>
              {t('limits.requestTitle', { buyer: request.legal_entities?.name ?? EM_DASH })}
            </span>
            <Badge tone={statusTone(request.status)} size="lg">
              {t(`limits.statuses.${request.status}`)}
            </Badge>
          </span>
        }
        subtitle={
          <span>
            <Link to="/limits" className="text-accent-700 hover:underline">
              {t('nav.limits')}
            </Link>
            {' / '}
            <Link to={`/policies/${request.policy_id}`} className="text-accent-700 hover:underline">
              {request.policies?.policy_number ?? EM_DASH}
            </Link>
            {request.insurance_request_id && (
              <>
                {' / '}
                <Link
                  to={`/requests/${request.insurance_request_id}`}
                  className="text-accent-700 hover:underline"
                >
                  {t('limits.fromSubmission')}
                </Link>
              </>
            )}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {canSubmit(request.status) && (
              <Button
                onClick={() => void act(submit.mutateAsync(request.id))}
                disabled={submit.isPending}
              >
                {t('limits.actions.submit')}
              </Button>
            )}
            {canStartReview(request.status) && showDecisionForm && (
              <Button
                variant="secondary"
                onClick={() => void act(startReview.mutateAsync(request.id))}
                disabled={startReview.isPending}
              >
                {t('limits.actions.startReview')}
              </Button>
            )}
            {canWithdraw(request.status, roles, isRequester) && (
              <Button variant="ghost" onClick={() => setWithdrawOpen(true)}>
                {t('limits.actions.withdraw')}
              </Button>
            )}
          </div>
        }
      />

      {actionError && (
        <div className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500" role="alert">
          {actionError}
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-5">
          <RequestCard request={request} locale={locale} />
          {awaitingSenior && (
            <Card className="border-warn-500/30 bg-warn-50 p-5 text-sm text-warn-500">
              {t('limits.awaitingSenior')}
            </Card>
          )}
          {showDecisionForm && <DecisionForm request={request} />}
          {/* Stage 2: commercial adjustment + the release state of the
              effective decision. Renders itself away when there is none. */}
          <CommercialStageSection request={request} />
        </div>
        <BuyerSnapshot request={request} locale={locale} />
      </div>

      {withdrawOpen && (
        <Modal
          open
          onClose={() => setWithdrawOpen(false)}
          title={t('limits.actions.withdraw')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setWithdrawOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={withdraw.isPending}
                onClick={() =>
                  void act(
                    withdraw
                      .mutateAsync({ requestId: request.id, comment: withdrawComment })
                      .then(() => setWithdrawOpen(false)),
                  )
                }
              >
                {t('common.confirm')}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-slate-600">{t('limits.withdrawConfirm')}</p>
          <Field label={t('policies.transitionComment')}>
            <Input value={withdrawComment} onChange={(e) => setWithdrawComment(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Request card + timeline
// ---------------------------------------------------------------------------

function RequestCard({ request, locale }: { request: LimitRequestWithRefs; locale: string }) {
  const { t } = useTranslation()

  const timeline: { key: string; at: string | null }[] = [
    { key: 'created', at: request.created_at },
    { key: 'submitted', at: request.submitted_at },
    { key: 'decided', at: request.decided_at },
    { key: 'withdrawn', at: request.withdrawn_at },
  ]

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('limits.requestCard')}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-slate-500">{t('limits.fields.buyer')}</dt>
        <dd>
          <Link to={`/entities/${request.entity_id}`} className="text-accent-700 hover:underline">
            {request.legal_entities?.name ?? EM_DASH}
          </Link>
          {/* Is this buyer part of a group we are already exposed to? */}
          <div className="mt-1">
            <GroupChip entityId={request.entity_id} />
          </div>
        </dd>
        <dt className="text-slate-500">{t('policies.fields.policyNumber')}</dt>
        <dd>
          <Link to={`/policies/${request.policy_id}`} className="text-accent-700 hover:underline">
            {request.policies?.policy_number ?? EM_DASH}
          </Link>
          <span className="ml-2 text-slate-500">
            {request.policies?.legal_entities?.name ?? ''}
          </span>
        </dd>
        <dt className="text-slate-500">{t('limits.fields.requestedAmount')}</dt>
        <dd>
          <span className="num font-semibold">
            {formatAmount(Number(request.requested_amount), locale)} {request.currency_code}
          </span>
        </dd>
        <dt className="text-slate-500">{t('limits.fields.paymentTerms')}</dt>
        <dd>
          {request.requested_payment_terms_days !== null
            ? t('policies.terms.days', { count: request.requested_payment_terms_days })
            : EM_DASH}
        </dd>
        <dt className="text-slate-500">{t('limits.fields.justification')}</dt>
        <dd className="text-slate-700">{request.justification || EM_DASH}</dd>
        {request.withdraw_comment && (
          <>
            <dt className="text-slate-500">{t('limits.fields.withdrawComment')}</dt>
            <dd className="text-slate-700">{request.withdraw_comment}</dd>
          </>
        )}
      </dl>

      <ol className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-3">
        {timeline
          .filter((step) => step.at)
          .map((step) => (
            <li key={step.key} className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">
                {t(`limits.timeline.${step.key}`)}
              </span>{' '}
              {step.at?.slice(0, 16).replace('T', ' ')}
            </li>
          ))}
      </ol>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Buyer snapshot panel
// ---------------------------------------------------------------------------

function BuyerSnapshot({ request, locale }: { request: LimitRequestWithRefs; locale: string }) {
  const { t } = useTranslation()
  const assessments = useAssessments(request.entity_id)
  const { data: gradeBands } = useGradeScale()
  const effective = useEffectiveLimits({
    policyId: request.policy_id,
    entityId: request.entity_id,
  })

  const latest = assessments.data?.[0] ?? null
  const current = effective.data?.[0] ?? null
  const { data: windowHours } = useSalesWindowHours()
  const nowIso = new Date().toISOString()

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-sm font-semibold text-slate-900">{t('limits.buyerSnapshot')}</h2>

      {latest ? (
        <>
          <GradeScale
            score={Number(latest.rating_score)}
            grade={latest.rating_grade}
            bands={gradeBands}
            size="compact"
          />
          <div className="text-[13px]">
            <span className="text-slate-500">{t('report.calculatedLimit')}: </span>
            <span className="num font-semibold">
              {formatAmount(Number(latest.suggested_limit), locale)} {latest.limit_currency}
            </span>
          </div>
        </>
      ) : (
        <p className="text-[13px] text-slate-500">{t('report.noAssessment')}</p>
      )}

      <Link
        to={`/entities/${request.entity_id}`}
        className="text-[13px] font-medium text-accent-700 hover:underline"
      >
        {t('limits.openBuyerCard')} →
      </Link>

      {current && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[13px]">
          <p className="text-slate-500">{t('limits.currentEffective')}</p>
          <p className="mt-0.5">
            <Badge tone={outcomeTone(current.outcome)}>
              {t(`limits.outcomes.${current.outcome}`)}
            </Badge>{' '}
            <span className="num font-semibold">
              {current.approved_amount !== null
                ? `${formatAmount(Number(current.approved_amount), locale)} ${current.currency_code}`
                : EM_DASH}
            </span>
            <span className="ml-2 text-slate-400">
              {current.valid_until
                ? t('limits.validUntil', { date: current.valid_until })
                : t('limits.untilReview')}
            </span>
          </p>
          {current.commercially_adjusted && (
            <p className="num mt-1 text-xs text-slate-500">
              {t('limits.stagePair', {
                credit: formatAmount(Number(current.credit_amount), locale),
                commercial: formatAmount(Number(current.approved_amount), locale),
              })}
            </p>
          )}
          <p className="mt-1.5">
            <ReleaseBadge
              facts={current}
              salesWindowHours={windowHours ?? 24}
              nowIso={nowIso}
            />
          </p>
          <p className="mt-1 text-xs text-warn-500">{t('limits.willSupersede')}</p>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Decision form
// ---------------------------------------------------------------------------

function DecisionForm({ request }: { request: LimitRequestWithRefs }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { roles } = useAuth()
  const decide = useDecideLimitRequest()
  const assessments = useAssessments(request.entity_id)

  const [outcome, setOutcome] = useState<'approved' | 'partial' | 'declined'>('approved')
  const [amount, setAmount] = useState(String(request.requested_amount))
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [validUntil, setValidUntil] = useState('')
  const [conditions, setConditions] = useState<ConditionInput[]>([])
  const [comment, setComment] = useState('')
  const [assessmentId, setAssessmentId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [escalatedInfo, setEscalatedInfo] = useState<string | null>(null)

  const currency = request.currency_code
  const latest = assessments.data?.[0] ?? null

  // The band comes from the assessment the decision is based on; with none
  // chosen the SQL function judges the decision as 'unrated'.
  const chosenAssessment =
    assessments.data?.find((a) => a.id === assessmentId) ?? null
  const band = bandForGrade(chosenAssessment?.rating_grade)
  const { data: myAuthority } = useMyAuthorityUzs(band)
  const { data: rates } = useLatestRatesFor(currency)
  const parsedAmount = Number(amount.replace(/\s/g, '').replace(',', '.'))
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0
  const needsAmount = outcome !== 'declined'

  // Where this decision would leave the whole group. The scope of the request
  // being decided is netted off, because the new decision supersedes it rather
  // than adding to it - the SQL preflight does that netting, not this call.
  const { data: groupCheck } = useGroupPreflight({
    entityId: request.entity_id,
    amount: needsAmount && amountValid ? parsedAmount : null,
    currency,
    excludeScope: request.policy_id ?? request.insurance_request_id,
  })

  const todayIso = new Date().toISOString().slice(0, 10)
  const check = useMemo(
    () =>
      needsAmount && amountValid
        ? preflight(parsedAmount, currency, roles, band, myAuthority ?? 0, rates ?? [], todayIso)
        : null,
    [needsAmount, amountValid, parsedAmount, currency, roles, band, myAuthority, rates, todayIso],
  )

  const handleDecide = async () => {
    setError(null)
    setEscalatedInfo(null)
    try {
      const result = await decide.mutateAsync({
        requestId: request.id,
        outcome,
        amount: needsAmount ? parsedAmount : null,
        currency,
        validFrom,
        validUntil: validUntil || null,
        conditions: conditions.filter((c) => c.description.trim()),
        comment: comment.trim() || null,
        assessmentId: assessmentId || null,
      })
      if (result.result === 'escalated') {
        setEscalatedInfo(
          t('limits.escalatedResult', { band: t(`limits.bands.${result.grade_band}`) }),
        )
      } else if (result.result === 'group_limit_exceeded') {
        // Not an error: the database escalated the request so a wider
        // authority can weigh the whole group.
        setEscalatedInfo(
          t('groups.escalatedResult', {
            after: formatAmount(Number(result.group.exposure_after_uzs), locale),
            limit: formatAmount(Number(result.group.group_limit_uzs ?? 0), locale),
          }),
        )
      }
    } catch {
      setError(t('limits.decideFailed'))
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-sm font-semibold text-slate-900">{t('limits.decisionTitle')}</h2>

      <div className="flex gap-2">
        {(['approved', 'partial', 'declined'] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOutcome(o)}
            className={`rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors ${
              outcome === o
                ? 'border-accent-600 bg-accent-50 text-accent-700'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
            }`}
          >
            {t(`limits.outcomes.${o}`)}
          </button>
        ))}
      </div>

      {needsAmount && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={`${t('limits.fields.approvedAmount')} (${currency})`}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num"
            />
            {latest && (
              <p className="mt-0.5 text-xs text-slate-400">
                {t('limits.calculatedHint', {
                  amount: formatAmount(Number(latest.suggested_limit), locale),
                  currency: latest.limit_currency,
                })}
              </p>
            )}
          </Field>
          <Field label={t('limits.fields.basedOnAssessment')}>
            <Select value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
              <option value="">{t('common.notSelected')}</option>
              {(assessments.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.created_at.slice(0, 10)} · {a.rating_grade} ·{' '}
                  {formatAmount(Number(a.suggested_limit), locale)} {a.limit_currency}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('limits.fields.validFrom')}>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label={t('limits.fields.validUntil')}>
            <Input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              placeholder={t('limits.untilReview')}
            />
            <p className="mt-0.5 text-xs text-slate-400">{t('limits.validUntilHint')}</p>
          </Field>
        </div>
      )}

      {needsAmount && (
        <ConditionsRepeater conditions={conditions} onChange={setConditions} />
      )}

      <Field label={t('policies.transitionComment')}>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-2 focus:outline-accent-600"
        />
      </Field>

      {/* Authority preflight — same conversion rule as the SQL function. */}
      {check && !hasRole(roles, 'admin') && (
        check.withinAuthority === null ? (
          <div className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
            {t('limits.preflight.missingRate', { currency })}
          </div>
        ) : check.withinAuthority ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] text-slate-600">
            {t('limits.preflight.within', {
              band: t(`limits.bands.${check.band}`),
              authority: formatAmount(check.authorityUzs ?? 0, locale),
            })}
          </div>
        ) : (
          <div className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
            {t('limits.preflight.exceeds', {
              band: t(`limits.bands.${check.band}`),
              authority: formatAmount(check.authorityUzs ?? 0, locale),
            })}
          </div>
        )
      )}

      <GroupPreflightNotice preflight={groupCheck} isAdmin={hasRole(roles, 'admin')} />

      {escalatedInfo && (
        <div className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500" role="status">
          {escalatedInfo}
        </div>
      )}
      {error && (
        <p className="text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}

      <div>
        <Button
          onClick={() => void handleDecide()}
          disabled={decide.isPending || (needsAmount && !amountValid)}
          variant={outcome === 'declined' ? 'danger' : 'primary'}
        >
          {decide.isPending ? t('common.saving') : t('limits.actions.decide')}
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Conditions repeater
// ---------------------------------------------------------------------------

function ConditionsRepeater({
  conditions,
  onChange,
}: {
  conditions: ConditionInput[]
  onChange: (next: ConditionInput[]) => void
}) {
  const { t } = useTranslation()

  const update = (index: number, patch: Partial<ConditionInput>) =>
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)))

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-slate-600">
          {t('limits.fields.conditions')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([...conditions, { condition_type: 'other', description: '' }])
          }
        >
          + {t('limits.addCondition')}
        </Button>
      </div>
      {conditions.length === 0 ? (
        <p className="text-xs text-slate-400">{t('limits.noConditions')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {conditions.map((c, index) => (
            <div key={index} className="grid grid-cols-[170px_1fr_auto] items-center gap-2">
              <Select
                value={c.condition_type}
                onChange={(e) =>
                  update(index, { condition_type: e.target.value as ConditionInput['condition_type'] })
                }
              >
                {CONDITION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`limits.conditionTypes.${type}`)}
                  </option>
                ))}
              </Select>
              <Input
                value={c.description}
                onChange={(e) => update(index, { description: e.target.value })}
                placeholder={t('limits.conditionPlaceholder')}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(conditions.filter((_, i) => i !== index))}
                aria-label={t('common.delete')}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
