/** "Buyers & limits" section of the policy page: effective limits +
 * open requests for this policy, and the Request-limit entry point. */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Button, EmptyState, Table } from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import { useEntities } from '../entities/api'
import type { PolicyWithRefs } from '../policies/types'
import { useEffectiveLimits, useLimitRequests } from './api'
import { isOpen, outcomeTone, statusTone } from './machine'
import { RequestLimitModal } from './RequestLimitModal'

export function PolicyLimitsSection({ policy }: { policy: PolicyWithRefs }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()

  const { data: effective } = useEffectiveLimits({ policyId: policy.id })
  const { data: allRequests } = useLimitRequests()
  const { data: buyers } = useEntities()
  const [modalOpen, setModalOpen] = useState(false)

  const buyerName = useMemo(() => {
    const map = new Map((buyers ?? []).map((b) => [b.id, b.name]))
    return (id: string) => map.get(id) ?? EM_DASH
  }, [buyers])

  const openRequests = useMemo(
    () => (allRequests ?? []).filter((r) => r.policy_id === policy.id && isOpen(r.status)),
    [allRequests, policy.id],
  )
  const effectiveList = effective ?? []
  const requestByBuyer = new Map(openRequests.map((r) => [r.entity_id, r]))
  const effectiveBuyers = new Set(effectiveList.map((l) => l.entity_id))
  /** Open requests for buyers with no effective limit yet get their own rows. */
  const openOnly = openRequests.filter((r) => !effectiveBuyers.has(r.entity_id))

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {t('policies.buyersLimitsTitle')}
        </h2>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          {t('limits.requestLimit')}
        </Button>
      </div>

      {effectiveList.length === 0 && openOnly.length === 0 ? (
        <EmptyState
          title={t('limits.noneForPolicy')}
          action={
            <Button onClick={() => setModalOpen(true)}>{t('limits.requestLimit')}</Button>
          }
        />
      ) : (
        <Table dense>
          <thead>
            <tr>
              <th>{t('limits.fields.buyer')}</th>
              <th className="text-right">{t('limits.pairHeader')}</th>
              <th>{t('limits.fields.outcome')}</th>
              <th>{t('limits.fields.validUntil')}</th>
              <th>{t('limits.fields.conditions')}</th>
              <th>{t('limits.fields.decidedBy')}</th>
            </tr>
          </thead>
          <tbody>
            {effectiveList.map((limit) => {
              const open = requestByBuyer.get(limit.entity_id)
              return (
                <tr key={limit.decision_id}>
                  <td>
                    <Link
                      to={`/entities/${limit.entity_id}`}
                      className="font-medium text-accent-700 hover:underline"
                    >
                      {buyerName(limit.entity_id)}
                    </Link>
                    {open && (
                      <Link to={`/limits/${open.id}`} className="ml-2">
                        <Badge tone={statusTone(open.status)}>
                          {t(`limits.statuses.${open.status}`)}
                        </Badge>
                      </Link>
                    )}
                  </td>
                  <td>
                    {/* requested → approved pair (DESIGN.md pair styling) */}
                    <span className="num block">
                      <span className="text-slate-400">
                        {formatAmount(Number(limit.requested_amount), locale)}
                      </span>
                      <span aria-hidden className="mx-1 text-slate-300">→</span>
                      <span className="font-semibold">
                        {limit.approved_amount !== null
                          ? formatAmount(Number(limit.approved_amount), locale)
                          : EM_DASH}
                      </span>{' '}
                      {limit.currency_code}
                    </span>
                  </td>
                  <td>
                    <Badge tone={outcomeTone(limit.outcome)}>
                      {t(`limits.outcomes.${limit.outcome}`)}
                    </Badge>
                  </td>
                  <td className="text-slate-500">
                    {limit.valid_until ?? t('limits.untilReview')}
                  </td>
                  <td>
                    {limit.conditions_count > 0 ? (
                      <span
                        className="text-[13px] text-warn-500"
                        title={t('limits.conditionsTooltip', { count: limit.conditions_count })}
                      >
                        ⚑ {limit.conditions_count}
                      </span>
                    ) : (
                      <span className="text-slate-300">{EM_DASH}</span>
                    )}
                  </td>
                  <td className="text-slate-500">{limit.decided_at.slice(0, 10)}</td>
                </tr>
              )
            })}
            {openOnly.map((r) => (
              <tr
                key={r.id}
                onClick={() => void navigate(`/limits/${r.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="font-medium text-slate-800">{buyerName(r.entity_id)}</td>
                <td>
                  <span className="num block">
                    <span className="text-slate-400">
                      {formatAmount(Number(r.requested_amount), locale)}
                    </span>
                    <span aria-hidden className="mx-1 text-slate-300">→</span>
                    <span className="text-slate-400">{EM_DASH}</span> {r.currency_code}
                  </span>
                </td>
                <td>
                  <Badge tone={statusTone(r.status)}>{t(`limits.statuses.${r.status}`)}</Badge>
                </td>
                <td className="text-slate-400">{EM_DASH}</td>
                <td className="text-slate-300">{EM_DASH}</td>
                <td className="text-slate-300">{EM_DASH}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <RequestLimitModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        policy={policy}
        excludedBuyerIds={openRequests.map((r) => r.entity_id)}
      />
    </div>
  )
}
