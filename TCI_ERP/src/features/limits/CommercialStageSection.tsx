/** Commercial stage of a limit decision: the effective credit decision with
 * an adjustment form for AMOUNT and PAYMENT TERMS only. Rating, validity
 * and conditions are not shown as inputs because commercial underwriting
 * cannot touch them — the column grants of migration 0020/0021 enforce it,
 * and this form deliberately offers nothing it would be refused. */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, Field, Input } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { bandForGrade, hasRole } from '../../lib/roles'
import { EM_DASH, formatAmount } from '../../lib/format'
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
import { ReleaseBadge } from './ReleaseBadge'
import type { LimitRequestWithRefs } from './types'

export function CommercialStageSection({ request }: { request: LimitRequestWithRefs }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { session, roles } = useAuth()

  const { data: limits } = useEffectiveLimits({
    policyId: request.policy_id,
    entityId: request.entity_id,
  })
  const { data: windowHours } = useSalesWindowHours()
  const assessments = useAssessments(request.entity_id)
  const adjust = useAdjustLimitCommercial()

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

  const parsedAmount = Number(amount.replace(/\s/g, '').replace(',', '.'))
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

  // Making the limit smaller is an emergency action: it reaches the client
  // at once, skipping the sales window (tci.apply_emergency_release).
  const isReduction =
    amountValid && limit?.credit_amount !== null && limit !== null
      ? parsedAmount < Number(limit.credit_amount)
      : false

  if (!limit) return null

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
      setResult(
        outcome.released_immediately
          ? t('limits.commercial.adjustedImmediate')
          : t('limits.commercial.adjusted'),
      )
      setAmount('')
      setComment('')
    } catch {
      setError(t('limits.commercial.adjustFailed'))
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{t('limits.commercial.title')}</h2>
        <ReleaseBadge facts={limit} salesWindowHours={windowHours ?? 24} nowIso={nowIso} />
      </div>

      {/* The chain as decided: credit → commercial. Both rows stay visible. */}
      <div className="flex flex-col gap-1.5 text-[13px]">
        <div className="flex flex-wrap items-baseline gap-x-3 rounded-md border border-slate-200 px-3 py-2">
          <Badge tone="neutral">{t('limits.stages.credit')}</Badge>
          <span className="num font-semibold">
            {formatAmount(Number(limit.credit_amount), locale)} {limit.currency_code}
          </span>
          <span className="text-slate-500">
            {limit.valid_from} — {limit.valid_until ?? t('limits.untilReview')}
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
      ) : (
        <>
          <p className="text-[13px] text-slate-500">{t('limits.commercial.scopeHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`${t('limits.commercial.newAmount')} (${limit.currency_code})`}>
              <Input
                inputMode="decimal"
                className="num"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={formatAmount(Number(limit.approved_amount), locale)}
              />
            </Field>
            <Field label={t('limits.fields.paymentTerms')}>
              <Input
                inputMode="numeric"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder={
                  limit.payment_terms_days != null
                    ? String(limit.payment_terms_days)
                    : t('policies.terms.daysSuffix')
                }
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
          {check && !hasRole(roles, 'admin') && (
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
              <div className="rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500">
                {t('limits.commercial.exceeds', {
                  band: t(`limits.bands.${check.band}`),
                  authority: formatAmount(check.authorityUzs ?? 0, locale),
                })}
              </div>
            )
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

          <div>
            <Button
              onClick={() => void handleAdjust()}
              disabled={!amountValid || adjust.isPending || check?.withinAuthority === false}
              variant={isReduction ? 'danger' : 'primary'}
            >
              {adjust.isPending ? t('common.saving') : t('limits.commercial.action')}
            </Button>
            {limit.approved_amount === null && (
              <span className="ml-2 text-xs text-slate-400">{EM_DASH}</span>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
