/** «Мои кредитные лимиты» — the limits the policyholder may trade on.
 *
 * Everything here comes from tci.v_client_limits, which only ever returns
 * RELEASED decisions. A held decision is not filtered out by this component;
 * it never arrives. That distinction matters: if the filtering lived here,
 * a refactor could undo it. */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Spinner,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import {
  useMyLimitConditions,
  useMyLimitHistory,
  useMyLimitRequests,
  useMyLimits,
  useMyPolicies,
} from './api'
import { RequestLimitModal } from './RequestLimitModal'
import type { ClientLimit } from './types'

export function PortalLimitsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: limits, isLoading } = useMyLimits()
  const { data: conditions } = useMyLimitConditions()
  const { data: requests } = useMyLimitRequests()
  const { data: policies } = useMyPolicies()

  const [historyFor, setHistoryFor] = useState<ClientLimit | null>(null)
  const [asking, setAsking] = useState(false)

  const conditionsByDecision = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const c of conditions ?? []) {
      const label = c.description?.trim() || t(`limits.conditionTypes.${c.condition_type}`)
      map.set(c.decision_id, [...(map.get(c.decision_id) ?? []), label])
    }
    return map
  }, [conditions, t])

  const activePolicies = (policies ?? []).filter((p) => p.status === 'active')
  const pending = (requests ?? []).filter(
    (r) => r.status === 'pending_entity' || ['draft', 'submitted', 'under_review', 'escalated'].includes(r.status),
  )

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div>
      <PageHeader
        title={t('portal.limits.title')}
        subtitle={t('portal.limits.subtitle')}
        actions={
          <Button disabled={!activePolicies.length} onClick={() => setAsking(true)}>
            {t('portal.limits.request')}
          </Button>
        }
      />

      {!activePolicies.length && (
        <div className="mb-4 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
          {t('portal.limits.needsActivePolicy')}
        </div>
      )}

      {pending.length > 0 && (
        <Card className="mb-5 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            {t('portal.limits.pendingTitle')}
          </h2>
          <Table dense>
            <thead>
              <tr>
                <th>{t('portal.limits.buyer')}</th>
                <th className="text-right">{t('portal.limits.requested')}</th>
                <th>{t('portal.limits.status')}</th>
                <th>{t('portal.limits.asked')}</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.buyer_name ?? r.proposed_name ?? EM_DASH}
                    {r.kind === 'proposal' && (
                      <span className="ml-2 text-xs text-slate-400">
                        {t('portal.limits.beingIdentified')}
                      </span>
                    )}
                  </td>
                  <td className="num text-right">
                    {formatAmount(r.requested_amount, locale)} {r.currency_code}
                  </td>
                  <td>
                    <Badge tone="warn">{t(`portal.limits.requestStatuses.${r.status}`)}</Badge>
                  </td>
                  <td className="text-slate-500">{formatMoment(r.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {!limits?.length ? (
        <EmptyState title={t('portal.limits.empty')} hint={t('portal.limits.emptyHint')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('portal.limits.buyer')}</th>
              <th>{t('portal.limits.policy')}</th>
              <th className="text-right">{t('portal.limits.approved')}</th>
              <th>{t('portal.limits.validity')}</th>
              <th>{t('portal.limits.paymentTerms')}</th>
              <th>{t('portal.limits.conditions')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {limits.map((limit) => {
              const rowConditions = conditionsByDecision.get(limit.decision_id) ?? []
              return (
                <tr key={limit.decision_id}>
                  <td className="font-medium text-slate-900">{limit.buyer_name}</td>
                  <td className="num text-slate-500">{limit.policy_number}</td>
                  <td className="num text-right font-semibold">
                    {limit.approved_amount === null
                      ? EM_DASH
                      : `${formatAmount(limit.approved_amount, locale)} ${limit.currency_code}`}
                    {limit.outcome === 'partial' && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {t('portal.limits.partialOf', {
                          requested: formatAmount(limit.requested_amount, locale),
                        })}
                      </span>
                    )}
                  </td>
                  <td className="text-slate-500">
                    {limit.valid_from}
                    {limit.valid_until ? ` — ${limit.valid_until}` : ''}
                  </td>
                  <td className="num text-slate-500">
                    {limit.payment_terms_days === null
                      ? EM_DASH
                      : t('portal.days', {
                          count: limit.payment_terms_days,
                          value: limit.payment_terms_days,
                        })}
                  </td>
                  <td className="text-[13px] text-slate-600">
                    {rowConditions.length ? (
                      <ul className="list-inside list-disc">
                        {rowConditions.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    ) : (
                      EM_DASH
                    )}
                  </td>
                  <td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setHistoryFor(limit)}>
                      {t('portal.limits.history')}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {asking && (
        <RequestLimitModal
          policies={activePolicies}
          open
          onClose={() => setAsking(false)}
        />
      )}
      {historyFor && (
        <HistoryModal limit={historyFor} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  )
}

function HistoryModal({ limit, onClose }: { limit: ClientLimit; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: history, isLoading } = useMyLimitHistory(limit.buyer_id)

  return (
    <Modal open wide title={t('portal.limits.historyFor', { buyer: limit.buyer_name })} onClose={onClose}>
      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : !history?.length ? (
        <p className="text-sm text-slate-500">{t('portal.limits.noHistory')}</p>
      ) : (
        <Table dense>
          <thead>
            <tr>
              <th>{t('portal.limits.decided')}</th>
              <th className="text-right">{t('portal.limits.approved')}</th>
              <th>{t('portal.limits.validity')}</th>
              <th>{t('portal.limits.status')}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.decision_id}>
                <td className="text-slate-500">{formatMoment(row.decided_at, locale)}</td>
                <td className="num text-right">
                  {row.approved_amount === null
                    ? EM_DASH
                    : `${formatAmount(row.approved_amount, locale)} ${row.currency_code}`}
                </td>
                <td className="text-slate-500">
                  {row.valid_from}
                  {row.valid_until ? ` — ${row.valid_until}` : ''}
                </td>
                <td>
                  <Badge tone={row.superseded ? 'neutral' : 'pos'}>
                    {t(row.superseded ? 'portal.limits.superseded' : 'portal.limits.current')}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-xs text-slate-400">{t('portal.limits.historyNote')}</p>
    </Modal>
  )
}
