/** The buyer package of a submission: one row per buyer with the requested
 * amount, the CREDIT decision, the COMMERCIAL adjustment, the effective
 * limit, its conditions and its release state. Sourced from
 * tci.v_effective_limits, which already applies the stage precedence
 * (commercial when present, else credit). */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, Table } from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import { ReleaseBadge } from '../limits/ReleaseBadge'
import { useEffectiveLimits, useLimitRequests, useSalesWindowHours } from '../limits/api'
import { outcomeTone, statusTone as limitStatusTone } from '../limits/machine'
import { resolutionTone } from './machine'
import type { InsuranceRequestWithRefs, RequestBuyerWithRefs } from './types'

export function BuyerPackageTable({
  request,
  buyers,
}: {
  request: InsuranceRequestWithRefs
  buyers: readonly RequestBuyerWithRefs[]
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const { data: limits } = useEffectiveLimits({ insuranceRequestId: request.id })
  const { data: limitRequests } = useLimitRequests()
  const { data: windowHours } = useSalesWindowHours()
  const nowIso = new Date().toISOString()

  const limitByEntity = useMemo(
    () => new Map((limits ?? []).map((l) => [l.entity_id, l])),
    [limits],
  )
  /** Open limit requests raised inside THIS submission, by buyer. */
  const openByEntity = useMemo(
    () =>
      new Map(
        (limitRequests ?? [])
          .filter((r) => r.insurance_request_id === request.id && r.status !== 'withdrawn')
          .map((r) => [r.entity_id, r]),
      ),
    [limitRequests, request.id],
  )

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('requests.buyerPackage')}</h2>

      {buyers.length === 0 ? (
        <EmptyState title={t('requests.noBuyersYet')} hint={t('requests.noBuyersHint')} />
      ) : (
        <Table dense>
          <thead>
            <tr>
              <th>{t('limits.fields.buyer')}</th>
              <th className="text-right">{t('requests.fields.requestedAmount')}</th>
              <th className="text-right">{t('requests.columns.credit')}</th>
              <th className="text-right">{t('requests.columns.commercial')}</th>
              <th className="text-right">{t('requests.columns.effective')}</th>
              <th>{t('limits.fields.conditions')}</th>
              <th>{t('requests.columns.release')}</th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((buyer) => {
              const limit = buyer.entity_id ? limitByEntity.get(buyer.entity_id) : undefined
              const openRequest = buyer.entity_id ? openByEntity.get(buyer.entity_id) : undefined
              return (
                <tr key={buyer.id}>
                  <td>
                    {buyer.entity_id ? (
                      <Link
                        to={`/entities/${buyer.entity_id}`}
                        className="font-medium text-accent-700 hover:underline"
                      >
                        {buyer.legal_entities?.name ?? buyer.proposed_name ?? EM_DASH}
                      </Link>
                    ) : (
                      <span className="text-slate-800">
                        {buyer.proposed_name ?? EM_DASH}
                      </span>
                    )}
                    <span className="ml-2 inline-block whitespace-nowrap">
                      <Badge tone={resolutionTone(buyer.resolution_status)}>
                        {t(`requests.resolutions.${buyer.resolution_status}`)}
                      </Badge>
                    </span>
                  </td>
                  <td className="num text-right">
                    {formatAmount(Number(buyer.requested_amount), locale)}
                  </td>
                  <td className="num text-right">
                    {limit ? (
                      <span className="font-medium">
                        {formatAmount(Number(limit.credit_amount), locale)} {limit.currency_code}
                      </span>
                    ) : openRequest ? (
                      <Link to={`/limits/${openRequest.id}`}>
                        <Badge tone={limitStatusTone(openRequest.status)}>
                          {t(`limits.statuses.${openRequest.status}`)}
                        </Badge>
                      </Link>
                    ) : (
                      <span className="text-slate-300">{EM_DASH}</span>
                    )}
                  </td>
                  <td className="num text-right">
                    {limit?.commercially_adjusted ? (
                      <span className="font-medium">
                        {formatAmount(Number(limit.approved_amount), locale)}
                      </span>
                    ) : (
                      <span className="text-slate-300">{EM_DASH}</span>
                    )}
                  </td>
                  <td className="num text-right">
                    {limit ? (
                      <span className="font-semibold">
                        {formatAmount(Number(limit.approved_amount), locale)}{' '}
                        {limit.currency_code}
                        <span className="ml-1.5 font-normal">
                          <Badge tone={outcomeTone(limit.outcome)}>
                            {t(`limits.outcomes.${limit.outcome}`)}
                          </Badge>
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-300">{EM_DASH}</span>
                    )}
                  </td>
                  <td>
                    {limit && limit.conditions_count > 0 ? (
                      <span
                        className="text-warn-500"
                        title={t('limits.conditionsTooltip', {
                          count: limit.conditions_count,
                        })}
                      >
                        ⚑ {limit.conditions_count}
                      </span>
                    ) : (
                      <span className="text-slate-300">{EM_DASH}</span>
                    )}
                  </td>
                  <td>
                    {limit ? (
                      <ReleaseBadge
                        facts={limit}
                        salesWindowHours={windowHours ?? 24}
                        nowIso={nowIso}
                      />
                    ) : (
                      <span className="text-slate-300">{EM_DASH}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <p className="mt-2 text-xs text-slate-400">{t('requests.packageHint')}</p>
    </Card>
  )
}
