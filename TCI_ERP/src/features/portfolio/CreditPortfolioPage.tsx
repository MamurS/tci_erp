/**
 * «Портфель лимитов» — the credit underwriting workspace's home: in-force
 * exposure in UZS by the buyer's current rating band, by country and by
 * currency, the largest buyers and groups, and what needs attention as a
 * count that opens «Мониторинг» or «Рейтинги» — the lists themselves live
 * there, once, not repeated here. Figures come from tci.v_credit_portfolio
 * (0052) and tci.v_group_exposure (0040); a limit in a currency with no UZS
 * rate is counted, never added as zero.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { ChevronRight } from 'lucide-react'

import {
  Badge,
  Card,
  COL,
  EmptyState,
  labelCol,
  Panel,
  PanelGrid,
  Skeleton,
  Spinner,
  Truncate,
  ViewBar,
} from '../../components/ui'
import { formatAmount, formatCompact } from '../../lib/format'
import {
  creditTotals,
  exposureByBand,
  exposureByCountry,
  limitsByCurrency,
  topBuyers,
} from './aggregate'
import type { CreditPortfolioRow } from './aggregate'
import { useCreditPortfolio, useTopGroups } from './api'
import { ShareBar, TableCard } from './parts'
import { useCountryName } from './useCountryName'
import { useOverdueNotifications } from '../overdue/api'
import { useGroupLimitStatus, useRatingWorklist } from '../limits/workbench/api'
import { REVIEW_WINDOW_DAYS, groupsAtRisk, ratingDeteriorated, reviewsDueOrOverdue } from '../limits/workbench/model'
import { BandBadge, EntityLink } from '../limits/workbench/parts'

const BAND_TONE = { A: 'pos', B: 'accent', C: 'warn', D: 'neg', unrated: 'neutral' } as const

export function CreditPortfolioPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const countryName = useCountryName()
  const { data, isLoading } = useCreditPortfolio()
  const { data: groups } = useTopGroups(5)

  const rows = useMemo(() => data ?? [], [data])
  const totals = creditTotals(rows)
  const bands = exposureByBand(rows)
  const countries = exposureByCountry(rows).slice(0, 10)
  const currencies = limitsByCurrency(rows)
  const buyers = topBuyers(rows, 10)

  const band = (key: string) => (
    <Badge tone={BAND_TONE[key as keyof typeof BAND_TONE] ?? 'neutral'}>{t(`limits.bands.${key}`)}</Badge>
  )
  const uzs = (value: number) => `${formatCompact(value, locale)} UZS`
  const buyerLink = (id: string, name: string) => (
    <Link to={`/entities/${id}`} className="font-medium text-accent-600 hover:text-accent-500">
      {name}
    </Link>
  )

  return (
    <div>
      <ViewBar hint={t('portfolio.credit.subtitle')} />

      {isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Card className="p-6">
          <EmptyState title={t('portfolio.credit.empty')} hint={t('portfolio.credit.emptyHint')} />
        </Card>
      ) : (
        <div className="grid gap-5">
          {/* The book's key figures are on the section's band (BookFigures). */}

          <AttentionPanel rows={rows} />

          <PanelGrid>
            <TableCard columns={['7.5rem', '4.5rem', '8.5rem', '5rem']}
              title={t('portfolio.credit.byBand')}
              hint={t('portfolio.credit.byBandHint')}
              empty={null}
              head={
                <tr>
                  <th>{t('portfolio.credit.band')}</th>
                  <th className="num">{t('portfolio.credit.limits')}</th>
                  <th className="num">{t('portfolio.credit.exposure')}</th>
                  <th className="num">{t('portfolio.share')}</th>
                </tr>
              }
            >
              {bands.map((b) => (
                <tr key={b.key}>
                  <td>{band(b.key)}</td>
                  <td className="num">{b.limits}</td>
                  <td className="num whitespace-nowrap">{uzs(b.exposureUzs)}</td>
                  <td>
                    <ShareBar compact share={b.share} />
                  </td>
                </tr>
              ))}
            </TableCard>

            <TableCard columns={[COL.fill, '4.5rem', '8.5rem', '5rem']}
              title={t('portfolio.credit.byCountry')}
              empty={countries.length ? null : t('portfolio.none')}
              head={
                <tr>
                  <th>{t('portfolio.credit.country')}</th>
                  <th className="num">{t('portfolio.credit.limits')}</th>
                  <th className="num">{t('portfolio.credit.exposure')}</th>
                  <th className="num">{t('portfolio.share')}</th>
                </tr>
              }
            >
              {countries.map((c) => (
                <tr key={c.key}>
                  <td>
                    <Truncate text={countryName(c.key || null)} className="max-w-none" />
                  </td>
                  <td className="num">{c.limits}</td>
                  <td className="num whitespace-nowrap">{uzs(c.exposureUzs)}</td>
                  <td>
                    <ShareBar compact share={c.share} />
                  </td>
                </tr>
              ))}
            </TableCard>
          </PanelGrid>

          <TableCard columns={[COL.fill, '11rem', labelCol('limitBand'), COL.count, COL.count, COL.amount, COL.share]}
            title={t('portfolio.credit.topBuyers')}
            empty={null}
            head={
              <tr>
                <th>{t('portfolio.credit.buyer')}</th>
                <th>{t('portfolio.credit.country')}</th>
                <th>{t('portfolio.credit.rating')}</th>
                <th className="num">{t('portfolio.credit.limits')}</th>
                <th className="num">{t('portfolio.credit.policies')}</th>
                <th className="num">{t('portfolio.credit.exposure')}</th>
                <th className="num">{t('portfolio.share')}</th>
              </tr>
            }
          >
            {buyers.map((b) => (
              <tr key={b.buyerId}>
                <td>
                  <Truncate text={b.buyerName} className="max-w-none">
                    {buyerLink(b.buyerId, b.buyerName)}
                  </Truncate>
                </td>
                <td className="text-slate-600">
                  <Truncate text={countryName(b.country)} className="max-w-none" />
                </td>
                <td>
                  <BandBadge band={b.band} grade={b.grade} />
                </td>
                <td className="num">{b.limits}</td>
                <td className="num">{b.policies}</td>
                <td className="num">
                  {uzs(b.exposureUzs)}
                  {b.missingRates > 0 && (
                    <span className="ml-1 text-warn-500" title={t('portfolio.missingRatesHint')}>
                      *
                    </span>
                  )}
                </td>
                <td>
                  <ShareBar share={totals.exposureUzs > 0 ? b.exposureUzs / totals.exposureUzs : null} />
                </td>
              </tr>
            ))}
          </TableCard>

          <PanelGrid>
            <TableCard columns={[COL.fill, COL.count, COL.amount]}
              title={t('portfolio.credit.byCurrency')}
              hint={t('portfolio.credit.byCurrencyHint')}
              empty={null}
              head={
                <tr>
                  <th>{t('policies.fields.currency')}</th>
                  <th className="num">{t('portfolio.credit.limits')}</th>
                  <th className="num">{t('portfolio.credit.amount')}</th>
                </tr>
              }
            >
              {currencies.map((c) => (
                <tr key={c.currency}>
                  <td>{c.currency}</td>
                  <td className="num">{c.limits}</td>
                  <td className="num">{formatAmount(c.amount, locale)}</td>
                </tr>
              ))}
            </TableCard>

            <TableCard columns={[COL.fill, COL.amount]}
              title={t('portfolio.credit.groups')}
              hint={t('portfolio.credit.groupsHint')}
              empty={groups?.length ? null : t('portfolio.credit.noGroups')}
              head={
                <tr>
                  {/* No cell-fill on this header: it is longer than the names
                      below it and would spill over the next column. The member
                      count sits under the name — a third column did not fit
                      half the page. */}
                  <th>{t('portfolio.credit.group')}</th>
                  <th className="num">{t('portfolio.credit.exposure')}</th>
                </tr>
              }
            >
              {(groups ?? []).map((g) => (
                <tr key={g.ultimate_parent_id}>
                  <td>
                    <Truncate text={g.ultimate_parent_name} className="max-w-none">
                      <EntityLink id={g.ultimate_parent_id} name={g.ultimate_parent_name} tab="group" />
                    </Truncate>
                    <span className="block text-caption text-slate-500">
                      {t('portfolio.credit.membersWithLimits', { count: g.members_with_limits })}
                    </span>
                  </td>
                  <td className="num">{uzs(Number(g.exposure_uzs))}</td>
                </tr>
              ))}
            </TableCard>
          </PanelGrid>
        </div>
      )}
    </div>
  )
}

/** What needs a credit underwriter, as counts. Each row opens the workbench
 * view that holds the list: the overview summarises, it does not repeat
 * Monitoring's tables (they were shown twice, with different formatting). */
function AttentionPanel({ rows }: { rows: readonly CreditPortfolioRow[] }) {
  const { t } = useTranslation()
  const ratings = useRatingWorklist()
  const noas = useOverdueNotifications()
  const groups = useGroupLimitStatus()

  const items: { key: string; label: string; count: number | null; view: string }[] = [
    {
      key: 'reviews',
      label: t('limits.workbench.monitoring.reviews', { days: REVIEW_WINDOW_DAYS }),
      count: reviewsDueOrOverdue(rows, REVIEW_WINDOW_DAYS).length,
      view: 'monitoring',
    },
    { key: 'worse', label: t('limits.workbench.monitoring.worse'), count: ratingDeteriorated(rows).length, view: 'monitoring' },
    {
      key: 'noas',
      label: t('limits.workbench.monitoring.noas'),
      count: noas.data ? noas.data.filter((n) => n.status === 'open').length : null,
      view: 'monitoring',
    },
    {
      key: 'groups',
      label: t('limits.workbench.monitoring.groups'),
      count: groups.data ? groupsAtRisk(groups.data).length : null,
      view: 'monitoring',
    },
    { key: 'ratings', label: t('limits.workbench.ratings.title'), count: ratings.data ? ratings.data.length : null, view: 'ratings' },
  ]

  return (
    <Panel title={t('portfolio.credit.attention')} hint={t('portfolio.credit.attentionHint')}>
      <ul className="grid gap-x-6 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              to={`/limits?view=${item.view}`}
              className="group flex items-center gap-3 rounded-md px-2 py-2 text-small text-slate-700 hover:bg-accent-50"
            >
              <span className="min-w-0 flex-1 truncate" title={item.label}>
                {item.label}
              </span>
              {item.count === null ? (
                <Skeleton className="h-5 w-7 rounded-full" />
              ) : (
                <Badge tone={item.count > 0 ? 'warn' : 'neutral'}>{item.count}</Badge>
              )}
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-slate-400 group-hover:text-accent-600" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
