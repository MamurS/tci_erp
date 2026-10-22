/** Commercial stage of a limit decision: the effective credit decision with
 * an adjustment form for AMOUNT and PAYMENT TERMS only. Rating, validity
 * and conditions are not shown as inputs because commercial underwriting
 * cannot touch them — the column grants of migration 0020/0021 enforce it,
 * and this form deliberately offers nothing it would be refused.
 *
 * 0060: an INCREASE beyond the caller's commercial authority is not recorded;
 * it is sent to a commercial colleague whose authority covers it («Отправить
 * на валидацию»), and the credit decision is held meanwhile. A reduction is
 * the emergency path: never validated, never authority-checked. */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Badge, Button, Card, Field, Input, SectionTitle } from '../../components/ui'
import { refusalOr } from '../../lib/optimistic'
import { parseAmount } from '../../components/ui/amount'
import { useAuth } from '../../auth/AuthContext'
import { bandForGrade, hasRole } from '../../lib/roles'
import { formatAmount, formatDate } from '../../lib/format'
import { useAssessments } from '../entities/rating/assessmentsApi'
import {
  useAdjustLimitCommercial,
  useDecisionChain,
  useEffectiveLimits,
  useLatestRatesFor,
  useMyAuthorityGrants,
  useSalesWindowHours,
} from './api'
import { commercialPreflight } from './authority'
import { outcomeTone } from './machine'
import { GroupPreflightNotice, groupErrorKey, useGroupPreflight } from '../groups'
import { ReleaseBadge } from './ReleaseBadge'
import type { LimitRequestWithRefs } from './types'
import { requestScopeFilter } from './types'
import { SendForValidationModal } from './ValidationDialogs'
import { adjustmentCanBeValidated, validationKind } from './validation'
import type { NeedsValidation, ValidationState } from './validation'
import { useSubmitAdjustmentForValidation } from './validationApi'

export function CommercialStageSection({
  request,
  validation,
  onNotice,
}: {
  request: LimitRequestWithRefs
  /** The request's pending validation step, credit or commercial (0060). */
  validation: ValidationState | null
  onNotice: (message: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { session, roles } = useAuth()

  const { data: limits } = useEffectiveLimits(requestScopeFilter(request))
  const { data: windowHours } = useSalesWindowHours()
  const assessments = useAssessments(request.entity_id)
  const adjust = useAdjustLimitCommercial()
  const sendForValidation = useSubmitAdjustmentForValidation()
  const [validationOpen, setValidationOpen] = useState<{ needs: NeedsValidation | null } | null>(null)

  const limit = limits?.[0] ?? null
  const { data: chain } = useDecisionChain(limit?.credit_decision_id ?? '')
  const { data: grants } = useMyAuthorityGrants(session?.user.id)
  const { data: rates } = useLatestRatesFor(limit?.currency_code ?? '')

  const [amount, setAmount] = useState('')
  const [terms, setTerms] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const mayAdjust = hasRole(roles, 'admin', 'commercial_underwriter')
  const creditRow = chain?.find((d) => d.stage === 'credit') ?? null
  // The band is that of the CREDIT decision's assessment — the commercial
  // authority is looked up in the same band (migration 0020).
  const band = bandForGrade(
    assessments.data?.find((a) => a.id === limit?.based_on_assessment_id)?.rating_grade,
  )

  const parsedAmount = parseAmount(amount) ?? Number.NaN
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0
  const todayIso = new Date().toISOString().slice(0, 10)
  const nowIso = new Date().toISOString()

  const check = useMemo(
    () =>
      amountValid && limit
        ? commercialPreflight(
            parsedAmount,
            limit.currency_code,
            roles,
            band,
            grants ?? [],
            rates ?? [],
            todayIso,
          )
        : null,
    [amountValid, limit, parsedAmount, roles, band, grants, rates, todayIso],
  )

  // Where the adjusted amount would leave the group. The scope being
  // superseded is netted off by the SQL preflight, not here.
  const { data: groupCheck } = useGroupPreflight({
    entityId: request.entity_id,
    amount: amountValid ? parsedAmount : null,
    currency: limit?.currency_code ?? null,
    excludeScope: request.policy_id ?? request.insurance_request_id,
  })

  // Making the limit smaller is an emergency action: it reaches the client
  // at once, skipping the sales window (tci.apply_emergency_release).
  const isReduction =
    amountValid && limit?.credit_amount !== null && limit !== null
      ? parsedAmount < Number(limit.credit_amount)
      : false

  if (!limit) return null

  // Beyond authority an increase can only go to a validator; a reduction
  // never needs one (submit_adjustment_for_validation refuses it).
  const validatable =
    amountValid && limit.credit_amount !== null && adjustmentCanBeValidated(parsedAmount, Number(limit.credit_amount))
  const overAuthority = !isReduction && check?.withinAuthority === false && !hasRole(roles, 'admin')

  const handleAdjust = async () => {
    if (!amountValid) return
    setError(null)
    setResult(null)
    try {
      const outcome = await adjust.mutateAsync({
        decisionId: limit.credit_decision_id,
        amount: parsedAmount,
        paymentTermsDays: terms ? Number(terms) : null,
        comment: comment.trim() || null,
      })
      if (outcome.result === 'needs_validation') {
        // Nothing recorded: the dialog opens with this very proposal.
        setValidationOpen({ needs: outcome })
        return
      }
      setResult(
        outcome.released_immediately
          ? t('limits.commercial.adjustedImmediate')
          : t('limits.commercial.adjusted'),
      )
      setAmount('')
      setComment('')
    } catch (e) {
      // The group control refuses an INCREASE outright here — there is no
      // escalated state for a commercial adjustment — so it gets its own
      // message rather than the generic failure.
      setError(t(groupErrorKey(e) ?? refusalOr(e, 'limits.commercial.adjustFailed')))
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle actions={<ReleaseBadge facts={limit} salesWindowHours={windowHours ?? 24} nowIso={nowIso} />}>
        {t('limits.commercial.title')}
      </SectionTitle>

      {/* The chain as decided: credit → commercial. Both rows stay visible. */}
      <div className="flex flex-col gap-1.5 text-[13px]">
        <div className="flex flex-wrap items-baseline gap-x-3 rounded-md border border-slate-200 px-3 py-2">
          <Badge tone="neutral">{t('limits.stages.credit')}</Badge>
          <span className="num font-semibold">
            {formatAmount(Number(limit.credit_amount), locale)} {limit.currency_code}
          </span>
          <span className="text-slate-500">
            {formatDate(limit.valid_from, locale)} — {limit.valid_until ? formatDate(limit.valid_until, locale) : t('limits.untilReview')}
          </span>
          {creditRow?.payment_terms_days != null && (
            <span className="text-slate-500">
              {t('policies.terms.days', { count: creditRow.payment_terms_days })}
            </span>
          )}
        </div>
        {limit.commercially_adjusted && (
          <div className="flex flex-wrap items-baseline gap-x-3 rounded-md border border-accent-600/30 bg-accent-50 px-3 py-2">
            <Badge tone="accent">{t('limits.stages.commercial')}</Badge>
            <span className="num font-semibold">
              {formatAmount(Number(limit.approved_amount), locale)} {limit.currency_code}
            </span>
            {limit.payment_terms_days != null && (
              <span className="text-slate-500">
                {t('policies.terms.days', { count: limit.payment_terms_days })}
              </span>
            )}
            <span className="ml-auto">
              <Badge tone={outcomeTone(limit.outcome)}>
                {t(`limits.outcomes.${limit.outcome}`)}
              </Badge>
            </span>
          </div>
        )}
      </div>

      {!mayAdjust ? (
        <p className="text-[13px] text-slate-400">{t('limits.commercial.readOnly')}</p>
      ) : validation ? (
        // adjust_limit_commercial refuses while anything on this request is on
        // validation; the line at the top of the page says with whom.
        <p className="text-[13px] text-slate-500">{t(`limits.validation.adjustLocked.${validation.stream}`)}</p>
      ) : (
        <>
          <p className="text-[13px] text-slate-500">{t('limits.commercial.scopeHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* No placeholders: a grey «250,000» in the box read as a value
                already entered. What stands today is said under the box. */}
            <Field
              label={t('limits.commercial.newAmount')}
              hint={
                limit.approved_amount !== null
                  ? t('limits.commercial.currentAmount', {
                      amount: `${formatAmount(Number(limit.approved_amount), locale)} ${limit.currency_code}`,
                    })
                  : undefined
              }
            >
              <AmountInput value={amount} onChange={setAmount} suffix={limit.currency_code} />
            </Field>
            <Field
              label={t('limits.fields.paymentTerms')}
              hint={
                limit.payment_terms_days != null
                  ? t('limits.commercial.currentTerms', {
                      terms: t('policies.terms.days', { count: limit.payment_terms_days }),
                    })
                  : t('limits.commercial.termsUnchanged')
              }
            >
              <AmountInput
                decimals={0}
                value={terms}
                onChange={setTerms}
                suffix={t('policies.terms.daysSuffix')}
              />
            </Field>
          </div>
          <Field label={t('policies.transitionComment')}>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>

          {isReduction && (
            <div className="rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500">
              {t('limits.commercial.reductionWarning')}
            </div>
          )}

          {/* Commercial authority preflight — same rule as the SQL function. */}
          {/* 0060: a reduction is never authority-checked. */}
          {check && !hasRole(roles, 'admin') && !isReduction && (
            check.withinAuthority === null ? (
              <div className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
                {t('limits.preflight.missingRate', { currency: limit.currency_code })}
              </div>
            ) : check.withinAuthority ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] text-slate-600">
                {t('limits.commercial.within', {
                  band: t(`limits.bands.${check.band}`),
                  authority: formatAmount(check.authorityUzs ?? 0, locale),
                })}
              </div>
            ) : (
              // Amber, not red: not a refusal — the way on is a validator.
              <div className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
                {t('limits.commercial.exceeds', {
                  band: t(`limits.bands.${check.band}`),
                  authority: formatAmount(check.authorityUzs ?? 0, locale),
                })}
              </div>
            )
          )}

          {/* The group control applies to INCREASES only: a reduction lowers
              the group's exposure and is never blocked. */}
          {!isReduction && (
            <GroupPreflightNotice preflight={groupCheck} isAdmin={hasRole(roles, 'admin')} />
          )}

          {result && (
            <p className="text-[13px] text-pos-500" role="status">
              {result}
            </p>
          )}
          {error && (
            <p className="text-[13px] text-neg-500" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {overAuthority ? (
              // Beyond authority the only way on is a validator.
              <Button onClick={() => setValidationOpen({ needs: null })}>{t('limits.validation.send')}</Button>
            ) : (
              <>
                <Button
                  onClick={() => void handleAdjust()}
                  disabled={!amountValid}
                  loading={adjust.isPending}
                  variant={isReduction ? 'danger' : 'primary'}
                >
                  {t('limits.commercial.action')}
                </Button>
                {/* A second opinion on an increase; a reduction works at once. */}
                {!isReduction && (
                  <Button variant="secondary" disabled={!validatable} onClick={() => setValidationOpen({ needs: null })}>
                    {t('limits.validation.send')}
                  </Button>
                )}
              </>
            )}
            {/* A disabled button says why. */}
            {!adjust.isPending && !amountValid && (
              <span className="text-[13px] text-slate-500">{t('limits.commercial.enterAmount')}</span>
            )}
            {!adjust.isPending && overAuthority && (
              <span className="text-[13px] text-slate-500">{t('limits.commercial.overAuthority')}</span>
            )}
          </div>
        </>
      )}

      {validationOpen && amountValid && (
        <SendForValidationModal
          stream="commercial"
          band={validationOpen.needs?.grade_band ?? band}
          amount={parsedAmount}
          currency={limit.currency_code}
          kind={
            validationOpen.needs
              ? 'required'
              : validationKind({
                  amountUzs: check?.amountUzs ?? null,
                  authorityUzs: check?.authorityUzs ?? null,
                  isAdmin: hasRole(roles, 'admin'),
                })
          }
          figures={
            validationOpen.needs
              ? {
                  amountUzs: Number(validationOpen.needs.amount_uzs),
                  authorityUzs: Number(validationOpen.needs.authority_uzs),
                }
              : null
          }
          proposal={
            <span className="num font-semibold">
              {formatAmount(parsedAmount, locale)} {limit.currency_code}
              {terms !== '' && (
                <span className="ml-2 font-normal text-slate-500">
                  {t('policies.terms.days', { count: Number(terms) })}
                </span>
              )}
            </span>
          }
          pending={sendForValidation.isPending}
          onClose={() => setValidationOpen(null)}
          onSubmit={async (validatorId, validationComment, validatorName) => {
            await sendForValidation.mutateAsync({
              decisionId: limit.credit_decision_id,
              validatorId,
              amount: parsedAmount,
              paymentTermsDays: terms ? Number(terms) : null,
              comment: validationComment ?? (comment.trim() || null),
            })
            setValidationOpen(null)
            setAmount('')
            setComment('')
            onNotice(t('limits.validation.sent', { name: validatorName }))
          }}
        />
      )}
    </Card>
  )
}
