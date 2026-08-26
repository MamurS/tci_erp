/** Buyer "Limits" tab: all limits for this buyer across policies —
 * effective ones, with a history toggle revealing the full supersede
 * chain per policy (immutable decision history). */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, Segmented, Spinner } from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import { usePolicies } from '../policies/api'
import { useBuyerDecisions, useBuyerExposure } from './api'
import { buildLimitChains } from './exposure'
import { outcomeTone } from './machine'
import type { CreditLimitDecision } from './types'

export function BuyerLimitsTab({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const decisions = useBuyerDecisions(entityId)
  const exposure = useBuyerExposure(entityId)
  const { data: policies } = usePolicies()
  const [mode, setMode] = useState<'effective' | 'history'>('effective')

  const policyLabel = useMemo(() => {
    const map = new Map((policies ?? []).map((p) => [p.id, p]))
    return (id: string) => map.get(id) ?? null
  }, [policies])

  const chains = useMemo(
    () =>
      buildLimitChains(
        (decisions.data ?? []).map((d) => ({
          ...d,
          policy_id: d.credit_limit_requests.policy_id,
        })),
      ),
    [decisions.data],
  )

  if (decisions.isLoading) return <Spinner label={t('common.loading')} />
  if (!chains.length) {
    return <EmptyState title={t('limits.noneForBuyer')} hint={t('limits.noneForBuyerHint')} />
  }

  const isCurrent = (d: CreditLimitDecision): boolean =>
    d.lifecycle === 'effective' && (d.valid_until === null || d.valid_until >= todayIso())

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={mode}
          options={[
            { key: 'effective', label: t('limits.modeEffective') },
            { key: 'history', label: t('limits.modeHistory') },
          ]}
          onChange={(key) => setMode(key as 'effective' | 'history')}
        />
        {exposure.data?.exposure_uzs != null && (
          <span className="text-[13px] text-slate-500">
            {t('limits.exposureTotal')}:{' '}
            <span className="num font-semibold text-slate-800">
              {formatAmount(Number(exposure.data.exposure_uzs), locale, 0)} UZS
            </span>
            {exposure.data.missing_rates > 0 && (
              <span className="ml-1 text-warn-500">
                ({t('limits.missingRates', { count: exposure.data.missing_rates })})
              </span>
            )}
          </span>
        )}
      </div>

      {chains.map((chain) => {
        const policy = policyLabel(chain.policyId)
        const shown =
          mode === 'history' ? chain.decisions : chain.decisions.filter(isCurrent).slice(0, 1)
        if (!shown.length) return null
        return (
          <Card key={chain.policyId} className="p-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              <Link to={`/policies/${chain.policyId}`} className="text-accent-700 hover:underline">
                {policy?.policy_number ?? chain.policyId}
              </Link>
              {policy?.legal_entities?.name && (
                <span className="ml-2 font-normal text-slate-500">
                  {policy.legal_entities.name}
                </span>
              )}
            </h3>
            <ol className="flex flex-col gap-2">
              {shown.map((d) => (
                <li
                  key={d.id}
                  className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-[13px] ${
                    isCurrent(d) ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-80'
                  }`}
                >
                  <Badge tone={outcomeTone(d.outcome)}>{t(`limits.outcomes.${d.outcome}`)}</Badge>
                  <span className="num font-semibold">
                    {d.approved_amount !== null
                      ? `${formatAmount(Number(d.approved_amount), locale)} ${d.currency_code}`
                      : EM_DASH}
                  </span>
                  <span className="text-slate-500">
                    {d.valid_from} — {d.valid_until ?? t('limits.untilReview')}
                  </span>
                  {mode === 'history' && (
                    <Badge tone={d.lifecycle === 'effective' ? 'pos' : 'neutral'}>
                      {t(`limits.lifecycles.${d.lifecycle}`)}
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-slate-400">
                    {d.decided_at.slice(0, 10)}
                  </span>
                  {d.comment && <p className="w-full text-slate-500">{d.comment}</p>}
                </li>
              ))}
            </ol>
          </Card>
        )
      })}
    </div>
  )
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
