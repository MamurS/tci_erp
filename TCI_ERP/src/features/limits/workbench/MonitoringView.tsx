/**
 * «Мониторинг» — what in the in-force book needs a credit underwriter now:
 * limits coming up for (or past) review, buyers rated worse than the band the
 * limit was decided in, open overdue notifications (with the automatic
 * suspension), and corporate groups over or near their cap.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Card,
  COL,
  EmptyState,
  labelCol,
  LinkRow,
  Spinner,
  Truncate,
  ViewBar,
} from '../../../components/ui'
import { formatAmount, formatDays, formatPercent } from '../../../lib/format'
import { num } from '../../portfolio/aggregate'
import { useCreditPortfolio } from '../../portfolio/api'
import { TableCard } from '../../portfolio/parts'
import { useOverdueNotifications } from '../../overdue/api'
import { GroupCapAmount } from '../../groups/GroupCapAmount'
import { useGroupLimitStatus } from './api'
import { REVIEW_WINDOW_DAYS, groupState, groupsAtRisk, ratingDeteriorated, reviewsDueOrOverdue } from './model'
import { BandBadge, EntityLink, Uzs } from './parts'

export function MonitoringView() {
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
    <div>
      <ViewBar hint={t('limits.workbench.monitoring.subtitle')} />

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
        // One list under another, full width: side by side the halves left
        // the buyer's name about 100px at 1280 and cut every one of them.
        <div className="grid gap-5">
          <TableCard columns={[COL.fill, COL.code, COL.moneyShort, COL.days]}
            title={t('limits.workbench.monitoring.reviews', { days: REVIEW_WINDOW_DAYS })}
            hint={t('limits.workbench.monitoring.reviewsHint')}
            empty={reviews.length ? null : t('portfolio.credit.noReviews')}
            head={
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th>{t('policies.fields.policyNumber')}</th>
                <th className="num">{t('portfolio.credit.amount')}</th>
                <th className="num">{t('portfolio.credit.daysLeft')}</th>
              </tr>
            }
          >
            {reviews.map((r) => (
              // Each row opens its own object (the limit, the notification,
              // the group); a name or a number inside opens what it names.
              <LinkRow key={r.decision_id} to={`/limits/${r.request_id}`}>
                <td>
                  <Truncate text={r.buyer_name} className="max-w-none">
                    <EntityLink id={r.buyer_entity_id} name={r.buyer_name} />
                  </Truncate>
                </td>
                <td className="whitespace-nowrap">
                  <Link to={`/policies/${r.policy_id}`} className="text-accent-600 hover:text-accent-500">
                    {r.policy_number}
                  </Link>
                </td>
                <td className="num whitespace-nowrap">
                  {formatAmount(num(r.approved_amount), locale)} {r.currency_code}
                </td>
                <td
                  className={`num text-right ${(r.days_to_review ?? 0) < 0 ? 'font-semibold text-neg-500' : ''}`}
                  title={(r.days_to_review ?? 0) < 0 ? t('limits.workbench.monitoring.overdueHint') : undefined}
                >
                  {formatDays(r.days_to_review, locale)}
                </td>
              </LinkRow>
            ))}
          </TableCard>

          <TableCard columns={[COL.fill, labelCol('limitBand'), labelCol('limitBand'), COL.amount]}
            title={t('limits.workbench.monitoring.worse')}
            hint={t('limits.workbench.monitoring.worseHint')}
            empty={worse.length ? null : t('limits.workbench.monitoring.noWorse')}
            head={
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th>{t('limits.workbench.monitoring.decidedIn')}</th>
                <th>{t('limits.workbench.monitoring.ratedNow')}</th>
                <th className="num">{t('portfolio.credit.exposure')}</th>
              </tr>
            }
          >
            {worse.map((r) => (
              <LinkRow key={r.decision_id} to={`/limits/${r.request_id}`}>
                <td>
                  <Truncate text={r.buyer_name} className="max-w-none">
                    <EntityLink id={r.buyer_entity_id} name={r.buyer_name} />
                  </Truncate>
                </td>
                <td>
                  <BandBadge band={r.decision_band} />
                </td>
                <td>
                  <BandBadge band={r.current_band} grade={r.current_grade} />
                </td>
                <td className="num">
                  <Uzs value={r.amount_uzs} />
                </td>
              </LinkRow>
            ))}
          </TableCard>

          <TableCard columns={[COL.fill, COL.fill, COL.moneyShort, COL.days, labelCol('monitoringSuspension')]}
            title={t('limits.workbench.monitoring.noas')}
            hint={t('limits.workbench.monitoring.noasHint')}
            empty={openNoas.length ? null : t('limits.workbench.monitoring.noNoas')}
            head={
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th>{t('policies.fields.policyholder')}</th>
                <th className="num">{t('limits.workbench.monitoring.overdueAmount')}</th>
                <th className="num">{t('limits.workbench.monitoring.daysPastDue')}</th>
                <th>{t('limits.workbench.monitoring.limit')}</th>
              </tr>
            }
          >
            {openNoas.map((n) => (
              <LinkRow key={n.id} to={`/overdues/${n.id}`}>
                <td>
                  <Truncate text={n.buyer_name} className="max-w-none">
                    <EntityLink id={n.buyer_entity_id} name={n.buyer_name} />
                  </Truncate>
                </td>
                <td>
                  <Truncate text={n.policyholder_name} className="max-w-none">
                    <Link
                      to={`/entities/${n.policyholder_entity_id}`}
                      className="text-slate-600 hover:text-accent-600 hover:underline"
                    >
                      {n.policyholder_name}
                    </Link>
                  </Truncate>
                </td>
                <td className="num whitespace-nowrap">
                  {formatAmount(num(n.overdue_amount), locale)} {n.currency_code}
                </td>
                <td className="num">{formatDays(n.days_past_due, locale)}</td>
                <td>
                  {n.limit_suspended ? (
                    <Badge tone="neg">{t('limits.workbench.monitoring.suspended')}</Badge>
                  ) : (
                    <Badge tone="warn">{t('limits.workbench.monitoring.notSuspended')}</Badge>
                  )}
                </td>
              </LinkRow>
            ))}
          </TableCard>

          <TableCard columns={[COL.fill, COL.amount, COL.money, '8rem']}
            title={t('limits.workbench.monitoring.groups')}
            hint={t('limits.workbench.monitoring.groupsHint')}
            empty={atRisk.length ? null : t('limits.workbench.monitoring.noGroups')}
            head={
              <tr>
                <th>{t('portfolio.credit.group')}</th>
                <th className="num">{t('portfolio.credit.exposure')}</th>
                <th className="num">{t('limits.workbench.groups.cap')}</th>
                <th className="num">{t('limits.workbench.groups.used')}</th>
              </tr>
            }
          >
            {atRisk.map((g) => (
              <LinkRow key={g.ultimate_parent_id} to={`/entities/${g.ultimate_parent_id}?tab=group`}>
                <td>
                  <Truncate text={g.ultimate_parent_name} className="max-w-none">
                    <EntityLink id={g.ultimate_parent_id} name={g.ultimate_parent_name} />
                  </Truncate>
                </td>
                <td className="num">
                  <Uzs value={g.exposure_uzs} />
                </td>
                <td className="num">
                  <GroupCapAmount amount={g.limit_amount} currency={g.limit_currency} amountUzs={g.limit_uzs} stacked />
                </td>
                <td className="text-right">
                  <Badge tone={groupState(g) === 'over' ? 'neg' : 'warn'}>
                    {formatPercent((num(g.utilisation_pct) ?? 0) / 100, locale)}
                  </Badge>
                </td>
              </LinkRow>
            ))}
          </TableCard>
        </div>
      )}
    </div>
  )
}
