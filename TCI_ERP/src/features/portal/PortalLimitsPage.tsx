/** «Мои кредитные лимиты» — the limits the policyholder may trade on.
 *
 * Everything here comes from tci.v_client_limits, which only ever returns
 * RELEASED decisions. A held decision is not filtered out by this component;
 * it never arrives. That distinction matters: if the filtering lived here,
 * a refactor could undo it.
 *
 * The view also returns the EFFECTIVE revocation of a limit (an overdue
 * notification suspends it at once). That row must read as a red state, never
 * as «0 USD» with a validity date: a policyholder who takes it for a live
 * limit keeps shipping on cover that no longer exists. */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  actionsCol,
  Badge,
  Button,
  Callout,
  Card,
  COL,
  EmptyState,
  labelCol,
  Modal,
  PageHeader,
  RowActions,
  SectionTitle,
  Spinner,
  Table,
  Truncate,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatDate, formatMoment } from '../../lib/format'
import {
  useMyLimitConditions,
  useMyLimitHistory,
  useMyLimitRequests,
  useMyLimits,
  useMyPolicies,
} from './api'
import { RequestLimitModal } from './RequestLimitModal'
import type { ClientLimit, ClientLimitHistoryRow } from './types'

/** A decision that grants nothing: revoked (or, rarely, declined). It has no
 * amount and no validity worth showing — only the date it took effect. */
function isWithdrawn(outcome: string): outcome is 'revoked' | 'declined' {
  return outcome === 'revoked' || outcome === 'declined'
}

/** «20 окт. 2026»: when the revocation reached the policyholder. */
function withdrawnOn(row: { released_at: string | null; decided_at: string }, locale: string) {
  return formatDate(row.released_at ?? row.decided_at, locale)
}

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

  // Live limits first, then the revoked ones: what can be traded on leads.
  const rows = useMemo(
    () =>
      [...(limits ?? [])].sort(
        (a, b) =>
          Number(isWithdrawn(a.outcome)) - Number(isWithdrawn(b.outcome)) ||
          a.buyer_name.localeCompare(b.buyer_name),
      ),
    [limits],
  )

  // Columns that would only ever say «—» or repeat one policy number are left
  // out: the buyer's name needs the width more.
  const manyPolicies = new Set(rows.map((r) => r.policy_id)).size > 1
  const anyConditions = rows.some(
    (r) => !isWithdrawn(r.outcome) && (conditionsByDecision.get(r.decision_id)?.length ?? 0) > 0,
  )

  const activePolicies = (policies ?? []).filter((p) => p.status === 'active')
  const pending = (requests ?? []).filter(
    (r) => r.status === 'pending_entity' || ['draft', 'submitted', 'information_gathering', 'under_review', 'escalated'].includes(r.status),
  )

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('portal.limits.title')}
        subtitle={t('portal.limits.subtitle')}
        actions={
          <Button
            disabled={!activePolicies.length}
            title={activePolicies.length ? undefined : t('portal.limits.needsActivePolicy')}
            onClick={() => setAsking(true)}
          >
            {t('portal.limits.request')}
          </Button>
        }
      />

      {!activePolicies.length && <Callout tone="info" title={t('portal.limits.needsActivePolicy')} />}

      {pending.length > 0 && (
        <Card className="p-5">
          <SectionTitle className="mb-3">{t('portal.limits.pendingTitle')}</SectionTitle>
          <Table columns={[COL.fill, COL.money, labelCol('portalRequestStatus'), COL.moment]}>
            <thead>
              <tr>
                <th>{t('portal.limits.buyer')}</th>
                <th className="num">{t('portal.limits.requested')}</th>
                <th>{t('portal.limits.status')}</th>
                <th>{t('portal.limits.asked')}</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const name = r.buyer_name ?? r.proposed_name
                return (
                  <tr key={r.id}>
                    {/* A proposal's status already says «Определяем организацию»;
                        the name cell does not repeat it. */}
                    <td>
                      <Truncate text={name} className="max-w-none">
                        {name ?? EM_DASH}
                      </Truncate>
                    </td>
                    <td className="num">
                      {formatAmount(r.requested_amount, locale)} {r.currency_code}
                    </td>
                    <td>
                      <Badge tone="warn">{t(`portal.limits.requestStatuses.${r.status}`)}</Badge>
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{formatMoment(r.created_at, locale)}</td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle className="mb-3">{t('portal.limits.limitsTitle')}</SectionTitle>
        {!rows.length ? (
          <EmptyState title={t('portal.limits.empty')} hint={t('portal.limits.emptyHint')} />
        ) : (
          <Table columns={[COL.fill, ...(manyPolicies ? [COL.code] : []), COL.money, COL.period, COL.days, ...(anyConditions ? ['14rem'] : []), labelCol('limitLifecycle'), actionsCol(['limitHistory'])]}>
            <thead>
              <tr>
                <th>{t('portal.limits.buyer')}</th>
                {manyPolicies && <th>{t('portal.limits.policy')}</th>}
                <th className="num">{t('portal.limits.approved')}</th>
                <th>{t('portal.limits.validity')}</th>
                <th className="num">{t('portal.limits.paymentTerms')}</th>
                {anyConditions && <th>{t('portal.limits.conditions')}</th>}
                <th>{t('portal.limits.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((limit) => {
                const withdrawn = isWithdrawn(limit.outcome)
                const rowConditions = withdrawn ? [] : (conditionsByDecision.get(limit.decision_id) ?? [])
                return (
                  <tr key={limit.decision_id}>
                    <td className="font-medium text-slate-900">
                      <Truncate text={limit.buyer_name} className="max-w-none" />
                    </td>
                    {manyPolicies && <td className="whitespace-nowrap text-slate-500 tabular-nums">{limit.policy_number}</td>}
                    <td className="num font-semibold">
                      {withdrawn || limit.approved_amount === null
                        ? EM_DASH
                        : `${formatAmount(limit.approved_amount, locale)} ${limit.currency_code}`}
                      {!withdrawn && limit.outcome === 'partial' && (
                        <span className="block text-xs font-normal text-slate-400">
                          {t('portal.limits.partialOf', {
                            requested: formatAmount(limit.requested_amount, locale),
                          })}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      {withdrawn ? (
                        EM_DASH
                      ) : (
                        <>
                          {formatDate(limit.valid_from, locale)}
                          {limit.valid_until && ` — ${formatDate(limit.valid_until, locale)}`}
                        </>
                      )}
                    </td>
                    <td className="num text-slate-500">
                      {withdrawn || limit.payment_terms_days === null
                        ? EM_DASH
                        : t('portal.days', {
                            count: limit.payment_terms_days,
                            value: limit.payment_terms_days,
                          })}
                    </td>
                    {anyConditions && (
                      <td className="text-[13px] text-slate-600">
                        {rowConditions.length ? (
                          <ul className="list-inside list-disc whitespace-normal">
                            {rowConditions.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        ) : (
                          EM_DASH
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap">
                      <LimitStatus row={limit} />
                    </td>
                    <RowActions>
                      <Button variant="ghost" size="sm" onClick={() => setHistoryFor(limit)}>
                        {t('portal.limits.history')}
                      </Button>
                    </RowActions>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {asking && <RequestLimitModal policies={activePolicies} open onClose={() => setAsking(false)} />}
      {historyFor && <HistoryModal limit={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  )
}

/** Green while the limit can be traded on; red, with the date, once it was
 * revoked — the explicit state Allianz Trade EOLIS and Atradius Atrium show. */
function LimitStatus({ row }: { row: Pick<ClientLimit, 'outcome' | 'released_at' | 'decided_at'> }) {
  const { t, i18n } = useTranslation()
  if (!isWithdrawn(row.outcome)) return <Badge tone="pos">{t('limits.lifecycles.effective')}</Badge>
  return (
    <span className="flex flex-col items-start gap-0.5" title={t('portal.limits.revokedHint')}>
      <Badge tone="neg">{t(`limits.outcomes.${row.outcome}`)}</Badge>
      <span className="text-xs text-slate-500">{withdrawnOn(row, i18n.language)}</span>
    </span>
  )
}

function HistoryStatus({ row }: { row: ClientLimitHistoryRow }) {
  const { t } = useTranslation()
  // A revocation is a red state whether or not it is the current decision:
  // it never reads as «Действующее».
  if (isWithdrawn(row.outcome)) return <Badge tone="neg">{t(`limits.outcomes.${row.outcome}`)}</Badge>
  return (
    <Badge tone={row.superseded ? 'neutral' : 'pos'}>
      {t(row.superseded ? 'portal.limits.superseded' : 'portal.limits.current')}
    </Badge>
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
        <Table dense columns={[COL.moment, COL.money, COL.period, COL.fill]}>
          <thead>
            <tr>
              <th>{t('portal.limits.decided')}</th>
              <th className="num">{t('portal.limits.approved')}</th>
              <th>{t('portal.limits.validity')}</th>
              <th>{t('portal.limits.status')}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => {
              const withdrawn = isWithdrawn(row.outcome)
              return (
                <tr key={row.decision_id}>
                  <td className="whitespace-nowrap text-slate-500">{formatMoment(row.decided_at, locale)}</td>
                  <td className="num">
                    {withdrawn || row.approved_amount === null
                      ? EM_DASH
                      : `${formatAmount(row.approved_amount, locale)} ${row.currency_code}`}
                  </td>
                  <td className="whitespace-nowrap text-slate-500">
                    {withdrawn
                      ? EM_DASH
                      : `${formatDate(row.valid_from, locale)}${
                          row.valid_until ? ` — ${formatDate(row.valid_until, locale)}` : ''
                        }`}
                  </td>
                  <td>
                    <HistoryStatus row={row} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      <p className="text-xs text-slate-400">{t('portal.limits.historyNote')}</p>
    </Modal>
  )
}
