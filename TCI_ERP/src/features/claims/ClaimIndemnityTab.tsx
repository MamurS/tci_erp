/** The indemnity calculation, step by step. The same trace the database
 * computes and — once approved — freezes onto the claim, so the figure a
 * policyholder was paid can always be re-read exactly as it was derived. */

import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, Spinner, Table } from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import { useIndemnity } from './api'
import type { Claim, IndemnityStep, IndemnityTrace } from './types'

export function ClaimIndemnityTab({ claim }: { claim: Claim }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: live, isLoading } = useIndemnity(claim.id)
  const frozen = claim.indemnity_trace

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!live) return <EmptyState title={t('claims.indemnity.emptyTitle')} hint={t('claims.indemnity.emptyHint')} />

  return (
    <div className="space-y-4">
      {frozen && (
        <Card className="border-accent-500/30 bg-accent-50">
          <p className="text-sm font-semibold text-slate-800">{t('claims.indemnity.frozenTitle')}</p>
          <p className="mt-1 text-[13px] text-slate-700">
            {t('claims.indemnity.frozenExplain', {
              amount: `${formatAmount(Number(claim.approved_indemnity ?? 0), locale)} ${claim.currency_code}`,
              at: claim.assessed_at ? formatMoment(claim.assessed_at, locale) : EM_DASH,
            })}
          </p>
        </Card>
      )}

      <TraceCard trace={frozen ?? live} claim={claim} locale={locale} live={!frozen} />

      {frozen && (
        <details className="rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {t('claims.indemnity.liveTitle')}
          </summary>
          <p className="mt-2 text-[13px] text-slate-600">{t('claims.indemnity.liveExplain')}</p>
          <div className="mt-3">
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
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('claims.indemnity.title')}</h2>
        <Badge tone={live ? 'neutral' : 'accent'}>
          {live ? t('claims.indemnity.live') : t('claims.indemnity.frozen')}
        </Badge>
      </div>

      <Table dense>
        <thead>
          <tr>
            <th>{t('claims.indemnity.stepLabel')}</th>
            <th>{t('claims.indemnity.applied')}</th>
            <th className="num">{t('claims.indemnity.running')}</th>
          </tr>
        </thead>
        <tbody>
          {trace.steps.map((step, i) => (
            <StepRow key={step.key} step={step} index={i} currency={claim.currency_code} locale={locale} />
          ))}
        </tbody>
      </Table>

      <div className="mt-4 flex items-baseline justify-between border-t border-slate-200 pt-3">
        <span className="text-sm font-semibold">{t('claims.indemnity.payable')}</span>
        <span className="num text-xl font-semibold">
          {formatAmount(Number(trace.payable), locale)} {trace.currency || claim.currency_code}
        </span>
      </div>
      {!trace.fully_covered && (
        <p className="mt-2 text-[13px] text-warn-600">
          {t('claims.indemnity.partialNote', {
            amount: `${formatAmount(Number(trace.uncovered_amount), locale)} ${claim.currency_code}`,
          })}
        </p>
      )}
    </Card>
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
  let applied = EM_DASH
  switch (step.key) {
    case 'claims.indemnity.step.insuredPercentage':
      applied = `× ${d.insured_percentage}%`
      break
    case 'claims.indemnity.step.nql':
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
  return (
    <tr>
      <td>
        <span className="mr-2 text-slate-400">{index + 1}</span>
        {t(step.key)}
        {step.key === 'claims.indemnity.step.aggregateFirstLoss' && Number(d.already_consumed) > 0 && (
          <span className="ml-2 text-xs text-slate-500">
            {t('claims.indemnity.aflConsumed', {
              amount: `${formatAmount(Number(d.already_consumed), locale)} ${currency}`,
            })}
          </span>
        )}
      </td>
      <td className="text-slate-600">{applied}</td>
      <td className="num font-medium">
        {formatAmount(Number(step.amount), locale)} {currency}
      </td>
    </tr>
  )
}
