/**
 * «Мониторинг» — what in the in-force book needs a credit underwriter now:
 * limits coming up for (or past) review, buyers rated worse than the band the
 * limit was decided in, open overdue notifications (with the automatic
 * suspension), and corporate groups over or near their cap.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, PageHeader, Spinner } from '../../../components/ui'
import { formatAmount, formatDays, formatPercent } from '../../../lib/format'
import { num } from '../../portfolio/aggregate'
import { useCreditPortfolio } from '../../portfolio/api'
import { TableCard } from '../../portfolio/parts'
import { useOverdueNotifications } from '../../overdue/api'
import { useGroupLimitStatus } from './api'
import { REVIEW_WINDOW_DAYS, groupState, groupsAtRisk, ratingDeteriorated, reviewsDueOrOverdue } from './model'
import { BandBadge, EntityLink, Uzs } from './parts'

export function MonitoringView({ sectionTabs }: { sectionTabs?: ReactNode } = {}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const portfolio = useCreditPortfolio()
  const noas = useOverdueNotifications()
  const groups = useGroupLimitStatus()

  const rows = portfolio.data ?? []
  const reviews = reviewsDueOrOverdue(rows, REVIEW_WINDOW_DAYS)
  const worse = ratingDeteriorated(rows)
  const openNoas = (noas.data ?? []).filter((n) => n.status === 'open')
  const atRisk = groupsAtRisk(groups.data ?? [])
  const loading = portfolio.isLoading || noas.isLoading || groups.isLoading
  const clear = !reviews.length && !worse.length && !openNoas.length && !atRisk.length

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('limits.workbench.monitoring.title')} subtitle={t('limits.workbench.monitoring.subtitle')} />
      {sectionTabs}

      {loading ? (
        <Spinner />
      ) : clear ? (
        <Card className="p-6">
          <EmptyState
            title={t('limits.workbench.monitoring.clear')}
            hint={t('limits.workbench.monitoring.clearHint', { days: REVIEW_WINDOW_DAYS })}
          />
        </Card>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <TableCard
              title={t('limits.workbench.monitoring.reviews', { days: REVIEW_WINDOW_DAYS })}
              hint={t('limits.workbench.monitoring.reviewsHint')}
              empty={reviews.length ? null : t('portfolio.credit.noReviews')}
              head={
                <tr>
                  <th>{t('limits.fields.buyer')}</th>
                  <th>{t('policies.fields.policyNumber')}</th>
                  <th className="text-right">{t('portfolio.credit.amount')}</th>
                  <th className="text-right">{t('portfolio.credit.daysLeft')}</th>
                </tr>
              }
            >
              {reviews.map((r) => (
                <tr key={r.decision_id}>
                  <td>
                    <Link to={`/limits/${r.request_id}`} className="font-medium text-accent-600 hover:text-accent-500">
                      {r.buyer_name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-slate-600">{r.policy_number}</td>
                  <td className="num text-right whitespace-nowrap">
                    {formatAmount(num(r.approved_amount), locale)} {r.currency_code}
                  </td>
                  <td
                    className={`num text-right ${(r.days_to_review ?? 0) < 0 ? 'font-semibold text-neg-500' : ''}`}
                    title={(r.days_to_review ?? 0) < 0 ? t('limits.workbench.monitoring.overdueHint') : undefined}
                  >
                    {formatDays(r.days_to_review, locale)}
                  </td>
                </tr>
              ))}
            </TableCard>

            <TableCard
              title={t('limits.workbench.monitoring.worse')}
              hint={t('limits.workbench.monitoring.worseHint')}
              empty={worse.length ? null : t('limits.workbench.monitoring.noWorse')}
              head={
                <tr>
                  <th>{t('limits.fields.buyer')}</th>
                  <th>{t('limits.workbench.monitoring.decidedIn')}</th>
                  <th>{t('limits.workbench.monitoring.ratedNow')}</th>
                  <th className="text-right">{t('portfolio.credit.exposure')}</th>
                </tr>
              }
            >
              {worse.map((r) => (
                <tr key={r.decision_id}>
                  <td>
                    <EntityLink id={r.buyer_entity_id} name={r.buyer_name} tab="rating" />
                  </td>
                  <td>
                    <BandBadge band={r.decision_band} />
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <BandBadge band={r.current_band} />
                      {r.current_grade && <span className="text-[12px] text-slate-500">{r.current_grade}</span>}
                    </span>
                  </td>
                  <td className="num text-right">
                    <Uzs value={r.amount_uzs} />
                  </td>
                </tr>
              ))}
            </TableCard>
          </div>

          <TableCard
            title={t('limits.workbench.monitoring.noas')}
            hint={t('limits.workbench.monitoring.noasHint')}
            empty={openNoas.length ? null : t('limits.workbench.monitoring.noNoas')}
            head={
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th>{t('policies.fields.policyholder')}</th>
                <th className="text-right">{t('limits.workbench.monitoring.overdueAmount')}</th>
                <th className="text-right">{t('limits.workbench.monitoring.daysPastDue')}</th>
                <th>{t('limits.workbench.monitoring.limit')}</th>
              </tr>
            }
          >
            {openNoas.map((n) => (
              <tr key={n.id}>
                <td>
                  <Link to={`/overdues/${n.id}`} className="font-medium text-accent-600 hover:text-accent-500">
                    {n.buyer_name}
                  </Link>
                </td>
                <td className="text-slate-600">{n.policyholder_name}</td>
                <td className="num text-right whitespace-nowrap">
                  {formatAmount(num(n.overdue_amount), locale)} {n.currency_code}
                </td>
                <td className="num text-right">{formatDays(n.days_past_due, locale)}</td>
                <td>
                  {n.limit_suspended ? (
                    <Badge tone="neg">{t('limits.workbench.monitoring.suspended')}</Badge>
                  ) : (
                    <Badge tone="warn">{t('limits.workbench.monitoring.notSuspended')}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </TableCard>

          <TableCard
            title={t('limits.workbench.monitoring.groups')}
            hint={t('limits.workbench.monitoring.groupsHint')}
            empty={atRisk.length ? null : t('limits.workbench.monitoring.noGroups')}
            head={
              <tr>
                <th>{t('portfolio.credit.group')}</th>
                <th className="text-right">{t('portfolio.credit.exposure')}</th>
                <th className="text-right">{t('limits.workbench.groups.cap')}</th>
                <th className="text-right">{t('limits.workbench.groups.used')}</th>
              </tr>
            }
          >
            {atRisk.map((g) => (
              <tr key={g.ultimate_parent_id}>
                <td>
                  <EntityLink id={g.ultimate_parent_id} name={g.ultimate_parent_name} tab="group" />
                </td>
                <td className="num text-right">
                  <Uzs value={g.exposure_uzs} />
                </td>
                <td className="num text-right">
                  <Uzs value={g.limit_uzs} />
                </td>
                <td className="text-right">
                  <Badge tone={groupState(g) === 'over' ? 'neg' : 'warn'}>
                    {formatPercent((num(g.utilisation_pct) ?? 0) / 100, locale)}
                  </Badge>
                </td>
              </tr>
            ))}
          </TableCard>
        </div>
      )}
    </div>
  )
}
