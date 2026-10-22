/** The buyer package of a submission: one row per buyer with the requested
 * amount, where it stands, the effective limit (with the CREDIT and the
 * COMMERCIAL figure under it when commercial underwriting adjusted it, and
 * its conditions) and its release state. Sourced from
 * tci.v_effective_limits, which already applies the stage precedence
 * (commercial when present, else credit). Five columns, so the table fits the
 * page at 1280px without scrolling sideways. */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Card,
  COL,
  EmptyState,
  labelCol,
  SectionTitle,
  Table,
  Truncate,
} from '../../components/ui'
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

  // The package is in the submission's currency (requested amounts carry no
  // currency of their own); a limit states its own.
  const currency = request.currency_code ?? ''

  return (
    <Card className="p-5">
      <SectionTitle className="mb-3" hint={t('requests.package.hint')}>
        {t('requests.buyerPackage')}
      </SectionTitle>

      {buyers.length === 0 ? (
        <EmptyState title={t('requests.noBuyersYet')} hint={t('requests.noBuyersHint')} />
      ) : (
        <Table dense columns={[COL.fill, COL.money, labelCol('packageState'), COL.money, labelCol('releaseState')]}>
          <thead>
            <tr>
              <th>{t('limits.fields.buyer')}</th>
              <th className="num">{t('requests.fields.requestedAmount')}</th>
              <th>{t('requests.package.state')}</th>
              <th className="num">{t('requests.package.limit')}</th>
              <th>{t('requests.columns.release')}</th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((buyer) => {
              const limit = buyer.entity_id ? limitByEntity.get(buyer.entity_id) : undefined
              const openRequest = buyer.entity_id ? openByEntity.get(buyer.entity_id) : undefined
              const name = buyer.legal_entities?.name ?? buyer.proposed_name
              const noCover = limit && (limit.outcome === 'revoked' || limit.outcome === 'declined')
              return (
                <tr key={buyer.id}>
                  {/* One line per buyer: the name cut with a tooltip when long. */}
                  <td>
                    <Truncate text={name} className="max-w-none">
                      {buyer.entity_id ? (
                        <Link to={`/entities/${buyer.entity_id}`} className="font-medium text-accent-700 hover:underline">
                          {name ?? EM_DASH}
                        </Link>
                      ) : (
                        <span className="text-slate-800">{name ?? EM_DASH}</span>
                      )}
                    </Truncate>
                  </td>
                  <td className="num">
                    {formatAmount(Number(buyer.requested_amount), locale)}
                    {currency && <span className="ml-1 text-slate-500">{currency}</span>}
                  </td>
                  {/* Where the buyer stands: the decision once there is one,
                      else the open limit request, else how far its
                      identification has got. */}
                  <td>
                    {limit ? (
                      <Badge tone={outcomeTone(limit.outcome)}>{t(`limits.outcomes.${limit.outcome}`)}</Badge>
                    ) : openRequest ? (
                      <Link to={`/limits/${openRequest.id}`}>
                        <Badge tone={limitStatusTone(openRequest.status)}>
                          {t(`limits.statuses.${openRequest.status}`)}
                        </Badge>
                      </Link>
                    ) : (
                      <Badge tone={resolutionTone(buyer.resolution_status)}>
                        {t(`requests.resolutions.${buyer.resolution_status}`)}
                      </Badge>
                    )}
                  </td>
                  {/* The effective limit (commercial when adjusted, else
                      credit), with both stages under it when they differ. */}
                  <td className="num">
                    {!limit || noCover || limit.approved_amount === null ? (
                      <span className="text-slate-300">{EM_DASH}</span>
                    ) : (
                      <>
                        <span className="font-semibold">{formatAmount(Number(limit.approved_amount), locale)}</span>
                        <span className="ml-1 text-slate-500">{limit.currency_code}</span>
                        {limit.conditions_count > 0 && (
                          <span
                            className="ml-1.5 text-warn-500"
                            title={t('limits.conditionsTooltip', { count: limit.conditions_count })}
                          >
                            ⚑ {limit.conditions_count}
                          </span>
                        )}
                        {limit.commercially_adjusted && (
                          <span className="block text-xs font-normal text-slate-400">
                            {t('limits.stagePair', {
                              credit: formatAmount(Number(limit.credit_amount), locale),
                              commercial: formatAmount(Number(limit.approved_amount), locale),
                            })}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {limit ? (
                      <ReleaseBadge compact facts={limit} salesWindowHours={windowHours ?? 24} nowIso={nowIso} />
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
    </Card>
  )
}
