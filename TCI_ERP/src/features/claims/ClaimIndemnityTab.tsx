/** The indemnity calculation, step by step. The same trace the database
 * computes and — once approved — freezes onto the claim, so the figure a
 * policyholder was paid can always be re-read exactly as it was derived. */

import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge, Callout, Card, EmptyState, Panel, Spinner, Table } from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import { useIndemnity } from './api'
import type { Claim, IndemnityStep, IndemnityTrace } from './types'

export function ClaimIndemnityTab({ claim }: { claim: Claim }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: live, isLoading } = useIndemnity(claim.id)
  const frozen = claim.indemnity_trace

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!live)
    return (
      <Card className="p-6">
        <EmptyState title={t('claims.indemnity.emptyTitle')} hint={t('claims.indemnity.emptyHint')} />
      </Card>
    )

  return (
    <div className="space-y-5">
      {frozen && (
        <Callout tone="info" title={t('claims.indemnity.frozenTitle')}>
          {t('claims.indemnity.frozenExplain', {
            amount: `${formatAmount(Number(claim.approved_indemnity ?? 0), locale)} ${claim.currency_code}`,
            at: claim.assessed_at ? formatMoment(claim.assessed_at, locale) : EM_DASH,
          })}
        </Callout>
      )}

      <TraceCard trace={frozen ?? live} claim={claim} locale={locale} live={!frozen} />

      {frozen && (
        <details className="group rounded-lg border border-slate-200/90 bg-white shadow-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-slate-700 hover:text-slate-900 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 text-slate-400 transition-transform group-open:rotate-90" aria-hidden />
            {t('claims.indemnity.liveTitle')}
          </summary>
          <div className="border-t border-slate-100 px-5 pt-3 pb-5">
            <p className="mb-4 text-[13px] text-slate-600">{t('claims.indemnity.liveExplain')}</p>
            <TraceCard trace={live} claim={claim} locale={locale} live />
          </div>
        </details>
      )}
    </div>
  )
}

function TraceCard({
  trace,
  claim,
  locale,
  live,
}: {
  trace: IndemnityTrace
  claim: Claim
  locale: string
  live: boolean
}) {
  const { t } = useTranslation()
  const currency = trace.currency || claim.currency_code
  return (
    <Panel
      title={t('claims.indemnity.title')}
      actions={
        <Badge tone={live ? 'neutral' : 'accent'}>
          {live ? t('claims.indemnity.live') : t('claims.indemnity.frozen')}
        </Badge>
      }
    >
      <Table dense>
        <thead>
          <tr>
            <th>{t('claims.indemnity.stepLabel')}</th>
            <th>{t('claims.indemnity.applied')}</th>
            <th className="text-right">{t('claims.indemnity.running')}</th>
          </tr>
        </thead>
        <tbody>
          {trace.steps.map((step, i) => (
            <StepRow key={step.key} step={step} index={i} currency={claim.currency_code} locale={locale} />
          ))}
          {/* The result closes the table it is derived in; before approval it
              is an estimate and says so. */}
          <tr className="!bg-accent-50 [&>td]:border-t [&>td]:border-accent-200 [&>td]:py-2.5">
            <td colSpan={2} className="font-semibold text-slate-900">
              {live ? t('claims.indemnity.payableEstimate') : t('claims.indemnity.payable')}
            </td>
            <td className="num text-[15px] font-bold text-accent-700">
              {formatAmount(Number(trace.payable), locale)} {currency}
            </td>
          </tr>
        </tbody>
      </Table>

      {trace.not_indemnifiable_reason && (
        <Callout
          tone="neg"
          className="mt-4"
          title={t(trace.not_indemnifiable_reason, {
            covered: `${formatAmount(Number(trace.covered_amount), locale)} ${claim.currency_code}`,
            threshold: `${formatAmount(Number(trace.nql_amount), locale)} ${claim.currency_code}`,
          })}
        />
      )}
      {!trace.not_indemnifiable_reason && !trace.fully_covered && (
        <Callout
          tone="warn"
          className="mt-4"
          title={t('claims.indemnity.partialNote', {
            amount: `${formatAmount(Number(trace.uncovered_amount), locale)} ${claim.currency_code}`,
          })}
        />
      )}
    </Panel>
  )
}

/** Each step names what it did to the running figure — the deduction applied,
 * not just the total after it. */
function StepRow({
  step,
  index,
  currency,
  locale,
}: {
  step: IndemnityStep
  index: number
  currency: string
  locale: string
}) {
  const { t } = useTranslation()
  const d = step.detail as Record<string, number | boolean | null>
  let applied: string
  switch (step.key) {
    case 'claims.indemnity.step.nqlThreshold':
      // A test, not a subtraction: show the comparison and its verdict.
      applied = d.met
        ? t('claims.indemnity.nqlMet', {
            threshold: `${formatAmount(Number(d.nql_amount ?? 0), locale)} ${currency}`,
          })
        : t('claims.indemnity.nqlNotMet', {
            threshold: `${formatAmount(Number(d.nql_amount ?? 0), locale)} ${currency}`,
          })
      break
    case 'claims.indemnity.step.insuredPercentage':
      applied = `× ${d.insured_percentage}%`
      break
    case 'claims.indemnity.step.deductible':
    case 'claims.indemnity.step.aggregateFirstLoss':
      applied = `− ${formatAmount(Number(d.applied ?? 0), locale)} ${currency}`
      break
    case 'claims.indemnity.step.maxLiability':
      applied = d.capped
        ? t('claims.indemnity.cappedAt', {
            amount: `${formatAmount(Number(d.available ?? 0), locale)} ${currency}`,
          })
        : t('claims.indemnity.notCapped')
      break
    default:
      applied = t('claims.indemnity.fromVerdicts')
  }
  const isThreshold = step.key === 'claims.indemnity.step.nqlThreshold'
  const failed = isThreshold && d.met === false
  return (
    <tr className={failed ? 'bg-neg-50' : undefined}>
      <td>
        <span className="mr-2 text-slate-400">{index + 1}</span>
        {t(step.key)}
        {isThreshold && (
          <span className="ml-2">
            <Badge tone={d.met ? 'pos' : 'neg'}>
              {t(d.met ? 'claims.indemnity.qualifies' : 'claims.indemnity.doesNotQualify')}
            </Badge>
          </span>
        )}
        {isThreshold && failed && Number(d.shortfall) > 0 && (
          <span className="ml-2 text-xs text-neg-500">
            {t('claims.indemnity.nqlShortfall', {
              amount: `${formatAmount(Number(d.shortfall), locale)} ${currency}`,
            })}
          </span>
        )}
        {step.key === 'claims.indemnity.step.aggregateFirstLoss' && Number(d.already_consumed) > 0 && (
          <span className="ml-2 text-xs text-slate-500">
            {t('claims.indemnity.aflConsumed', {
              amount: `${formatAmount(Number(d.already_consumed), locale)} ${currency}`,
            })}
          </span>
        )}
      </td>
      <td className={failed ? 'text-neg-500' : 'text-slate-600'}>{applied}</td>
      <td className="num font-medium">
        {formatAmount(Number(step.amount), locale)} {currency}
      </td>
    </tr>
  )
}
