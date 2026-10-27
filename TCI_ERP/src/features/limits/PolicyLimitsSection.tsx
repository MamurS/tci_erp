/** "Buyers & limits" section of the policy page: effective limits +
 * open requests for this policy, and the Request-limit entry point. */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  COL,
  EmptyState,
  labelCol,
  LinkRow,
  SectionTitle,
  Table,
  Truncate,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatDate } from '../../lib/format'
import { useEntities } from '../entities/api'
import type { PolicyWithRefs } from '../policies/types'
import { useSystemDecisionMarks } from './adtApi'
import { useEffectiveLimits, useLimitRequests, useSalesWindowHours } from './api'
import { isOpen, outcomeTone, statusTone } from './machine'
import { ReleaseBadge } from './ReleaseBadge'
import { RequestLimitModal } from './RequestLimitModal'
import { EntityRiskBadges } from '../risk/integrationBadges'

export function PolicyLimitsSection({ policy }: { policy: PolicyWithRefs }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const { data: effective } = useEffectiveLimits({ policyId: policy.id })
  // A system-made decision names its mark (an auto decision, a suspension).
  const { data: marks } = useSystemDecisionMarks()
  const { data: allRequests } = useLimitRequests()
  const { data: buyers } = useEntities()
  const { data: windowHours } = useSalesWindowHours()
  const [modalOpen, setModalOpen] = useState(false)
  const nowIso = new Date().toISOString()

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
  const empty = effectiveList.length === 0 && openOnly.length === 0

  return (
    <div>
      {/* One place for the action: here once there are rows, in the empty
          state while there are none. */}
      <SectionTitle
        className="mb-3"
        actions={
          !empty && (
            <Button size="sm" onClick={() => setModalOpen(true)}>
              {t('limits.requestLimit')}
            </Button>
          )
        }
      >
        {t('policies.buyersLimitsTitle')}
      </SectionTitle>

      {empty ? (
        <EmptyState
          title={t('limits.noneForPolicy')}
          action={
            <Button onClick={() => setModalOpen(true)}>{t('limits.requestLimit')}</Button>
          }
        />
      ) : (
        <Table dense columns={[COL.fill, COL.pair, labelCol('limitOutcome'), '13rem', labelCol('releaseState')]}>
          <thead>
            <tr>
              {/* The name takes what the figures leave and cuts with an
                  ellipsis — never four lines per buyer. */}
              <th>{t('limits.fields.buyer')}</th>
              <th className="num">{t('limits.pairHeader')}</th>
              <th>{t('limits.fields.outcome')}</th>
              <th>{t('limits.fields.validUntil')}</th>
              <th>{t('requests.columns.release')}</th>
            </tr>
          </thead>
          <tbody>
            {effectiveList.map((limit) => {
              const open = requestByBuyer.get(limit.entity_id)
              // A revoked or declined limit is no cover at all: «—», not
              // «0 USD», and no «until review» on something that is gone.
              const noCover = limit.outcome === 'revoked' || limit.outcome === 'declined'
              // The row opens the limit; the buyer opens the company, the
              // status badge the open request on it.
              return (
                <LinkRow key={limit.decision_id} to={`/limits/${limit.request_id}`}>
                  <td>
                    <div className="flex min-w-0 items-center gap-2">
                      <Truncate text={buyerName(limit.entity_id)} className="max-w-none min-w-0">
                        <Link
                          to={`/entities/${limit.entity_id}`}
                          className="font-medium text-accent-700 hover:underline"
                        >
                          {buyerName(limit.entity_id)}
                        </Link>
                      </Truncate>
                      <EntityRiskBadges entityId={limit.entity_id} />
                      {open && (
                        <Link to={`/limits/${open.id}`} className="shrink-0">
                          <Badge tone={statusTone(open.status)}>
                            {t(`limits.statuses.${open.status}`)}
                          </Badge>
                        </Link>
                      )}
                    </div>
                  </td>
                  <td>
                    {/* requested → approved pair (DESIGN.md pair styling) */}
                    <span className="num block">
                      <span className="text-slate-500">
                        {formatAmount(Number(limit.requested_amount), locale)}
                      </span>
                      <span aria-hidden className="mx-1 text-slate-500">→</span>
                      {noCover || limit.approved_amount === null ? (
                        <span className="text-slate-500">{EM_DASH}</span>
                      ) : (
                        <span className="font-semibold">
                          {formatAmount(Number(limit.approved_amount), locale)}
                        </span>
                      )}{' '}
                      {limit.currency_code}
                      {/* Conditions flagged beside the amount they qualify. */}
                      {limit.conditions_count > 0 && !noCover && (
                        <span
                          className="ml-2 text-warn-500"
                          title={t('limits.conditionsTooltip', { count: limit.conditions_count })}
                        >
                          ⚑ {limit.conditions_count}
                        </span>
                      )}
                    </span>
                    {/* Stage pairing: what credit decided vs what commercial
                        made of it (migration 0020 keeps both rows). */}
                    {limit.commercially_adjusted && (
                      <span className="num block text-caption text-slate-500">
                        {t('limits.stagePair', {
                          credit: formatAmount(Number(limit.credit_amount), locale),
                          commercial: formatAmount(Number(limit.approved_amount), locale),
                        })}
                      </span>
                    )}
                    {marks?.get(limit.decision_id) && (
                      <span className="block text-caption text-accent-600">{t(marks.get(limit.decision_id) as string)}</span>
                    )}
                  </td>
                  <td>
                    {/* When it was decided: on hover, so the row keeps to the
                        width of the page (a revocation names its date in the
                        next cell). */}
                    <span
                      className="inline-block whitespace-nowrap"
                      title={t('policies.limitsTable.decidedOn', { date: formatDate(limit.decided_at, locale) })}
                    >
                      <Badge tone={outcomeTone(limit.outcome)}>
                        {t(`limits.outcomes.${limit.outcome}`)}
                      </Badge>
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-slate-500">
                    {noCover ? (
                      <span className="text-neg-500">
                        {t(`policies.limitsTable.${limit.outcome === 'revoked' ? 'revokedOn' : 'declinedOn'}`, {
                          date: formatDate(limit.decided_at, locale),
                        })}
                      </span>
                    ) : limit.valid_until ? (
                      formatDate(limit.valid_until, locale)
                    ) : (
                      t('limits.untilReview')
                    )}
                  </td>
                  <td>
                    <ReleaseBadge
                      compact
                      facts={limit}
                      salesWindowHours={windowHours ?? 24}
                      nowIso={nowIso}
                    />
                  </td>
                </LinkRow>
              )
            })}
            {openOnly.map((r) => (
              <LinkRow key={r.id} to={`/limits/${r.id}`} className="transition-colors hover:bg-slate-50">
                <td>
                  <div className="flex min-w-0 items-center gap-2">
                    <Truncate text={buyerName(r.entity_id)} className="max-w-none min-w-0">
                      <Link to={`/entities/${r.entity_id}`} className="font-medium text-accent-700 hover:underline">
                        {buyerName(r.entity_id)}
                      </Link>
                    </Truncate>
                    <EntityRiskBadges entityId={r.entity_id} />
                  </div>
                </td>
                <td>
                  <span className="num block">
                    <span className="text-slate-500">
                      {formatAmount(Number(r.requested_amount), locale)}
                    </span>
                    <span aria-hidden className="mx-1 text-slate-500">→</span>
                    <span className="text-slate-500">{EM_DASH}</span> {r.currency_code}
                  </span>
                </td>
                <td>
                  <Badge tone={statusTone(r.status)}>{t(`limits.statuses.${r.status}`)}</Badge>
                </td>
                <td className="text-slate-500">{EM_DASH}</td>
                <td className="text-slate-500">{EM_DASH}</td>
              </LinkRow>
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
