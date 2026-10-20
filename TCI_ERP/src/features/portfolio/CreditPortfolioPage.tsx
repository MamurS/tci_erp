/**
 * «Портфель лимитов» — the credit underwriting workspace's home: in-force
 * exposure in UZS by the buyer's current rating band, by country and by
 * currency, the largest buyers and groups, limits coming up for review and
 * buyers whose rating is stale. Figures come from tci.v_credit_portfolio
 * (0052) and tci.v_group_exposure (0040); a limit in a currency with no UZS
 * rate is counted, never added as zero.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, PageHeader, Spinner, StatCard } from '../../components/ui'
import { formatAmount, formatCompact, formatDays, formatMoment } from '../../lib/format'
import {
  creditTotals,
  exposureByBand,
  exposureByCountry,
  limitsByCurrency,
  num,
  reviewsDue,
  staleRatings,
  topBuyers,
} from './aggregate'
import { useCreditPortfolio, useTopGroups } from './api'
import { ShareBar, TableCard } from './parts'
import { useCountryName } from './useCountryName'

const REVIEW_WINDOW_DAYS = 30
const STALE_RATING_DAYS = 365

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
  const due = reviewsDue(rows, REVIEW_WINDOW_DAYS)
  const stale = staleRatings(rows, STALE_RATING_DAYS, new Date())

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
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('portfolio.credit.title')} subtitle={t('portfolio.credit.subtitle')} />

      {isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Card className="p-6">
          <EmptyState title={t('portfolio.credit.empty')} hint={t('portfolio.credit.emptyHint')} />
        </Card>
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label={t('portfolio.credit.exposure')} value={uzs(totals.exposureUzs)} />
            <StatCard label={t('portfolio.credit.limits')} value={formatAmount(totals.limits, locale)} />
            <StatCard label={t('portfolio.credit.buyers')} value={formatAmount(totals.buyers, locale)} />
            <StatCard label={t('portfolio.credit.policies')} value={formatAmount(totals.policies, locale)} />
            <StatCard
              label={t('portfolio.missingRates')}
              value={formatAmount(totals.missingRates, locale)}
              meta={t('portfolio.missingRatesHint')}
              tone={totals.missingRates > 0 ? 'warn' : 'default'}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <TableCard
              title={t('portfolio.credit.byBand')}
              hint={t('portfolio.credit.byBandHint')}
              empty={null}
              head={
                <tr>
                  <th>{t('portfolio.credit.band')}</th>
                  <th className="text-right">{t('portfolio.credit.limits')}</th>
                  <th className="text-right">{t('portfolio.credit.exposure')}</th>
                  <th className="text-right">{t('portfolio.share')}</th>
                </tr>
              }
            >
              {bands.map((b) => (
                <tr key={b.key}>
                  <td>{band(b.key)}</td>
                  <td className="num text-right">{b.limits}</td>
                  <td className="num text-right whitespace-nowrap">{uzs(b.exposureUzs)}</td>
                  <td>
                    <ShareBar compact share={b.share} />
                  </td>
                </tr>
              ))}
            </TableCard>

            <TableCard
              title={t('portfolio.credit.byCountry')}
              empty={countries.length ? null : t('portfolio.none')}
              head={
                <tr>
                  <th>{t('portfolio.credit.country')}</th>
                  <th className="text-right">{t('portfolio.credit.limits')}</th>
                  <th className="text-right">{t('portfolio.credit.exposure')}</th>
                  <th className="text-right">{t('portfolio.share')}</th>
                </tr>
              }
            >
              {countries.map((c) => (
                <tr key={c.key}>
                  <td>{countryName(c.key || null)}</td>
                  <td className="num text-right">{c.limits}</td>
                  <td className="num text-right whitespace-nowrap">{uzs(c.exposureUzs)}</td>
                  <td>
                    <ShareBar share={c.share} />
                  </td>
                </tr>
              ))}
            </TableCard>
          </div>

          <TableCard
            title={t('portfolio.credit.topBuyers')}
            empty={null}
            head={
              <tr>
                <th>{t('portfolio.credit.buyer')}</th>
                <th>{t('portfolio.credit.country')}</th>
                <th>{t('portfolio.credit.rating')}</th>
                <th className="text-right">{t('portfolio.credit.limits')}</th>
                <th className="text-right">{t('portfolio.credit.policies')}</th>
                <th className="text-right">{t('portfolio.credit.exposure')}</th>
                <th className="text-right">{t('portfolio.share')}</th>
              </tr>
            }
          >
            {buyers.map((b) => (
              <tr key={b.buyerId}>
                <td>{buyerLink(b.buyerId, b.buyerName)}</td>
                <td className="text-slate-600">{countryName(b.country)}</td>
                <td>
                  <span className="flex items-center gap-1.5">
                    {band(b.band)}
                    {b.grade && <span className="text-[12px] text-slate-500">{b.grade}</span>}
                  </span>
                </td>
                <td className="num text-right">{b.limits}</td>
                <td className="num text-right">{b.policies}</td>
                <td className="num text-right">
                  {uzs(b.exposureUzs)}
                  {b.missingRates > 0 && <span className="ml-1 text-warn-500">*</span>}
                </td>
                <td>
                  <ShareBar share={totals.exposureUzs > 0 ? b.exposureUzs / totals.exposureUzs : null} />
                </td>
              </tr>
            ))}
          </TableCard>

          <div className="grid gap-5 lg:grid-cols-2">
            <TableCard
              title={t('portfolio.credit.reviews', { days: REVIEW_WINDOW_DAYS })}
              empty={due.length ? null : t('portfolio.credit.noReviews')}
              head={
                <tr>
                  <th>{t('portfolio.credit.buyer')}</th>
                  <th>{t('policies.fields.policyNumber')}</th>
                  <th className="text-right">{t('portfolio.credit.amount')}</th>
                  <th className="text-right">{t('portfolio.credit.daysLeft')}</th>
                </tr>
              }
            >
              {due.map((r) => (
                <tr key={r.decision_id}>
                  <td>
                    <Link to={`/limits/${r.request_id}`} className="font-medium text-accent-600 hover:text-accent-500">
                      {r.buyer_name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-slate-600">{r.policy_number}</td>
                  <td className="num text-right">
                    {formatAmount(num(r.approved_amount), locale)} {r.currency_code}
                  </td>
                  <td className="num text-right">{formatDays(r.days_to_review, locale)}</td>
                </tr>
              ))}
            </TableCard>

            <TableCard
              title={t('portfolio.credit.stale')}
              hint={t('portfolio.credit.staleHint')}
              empty={stale.length ? null : t('portfolio.credit.noStale')}
              head={
                <tr>
                  <th>{t('portfolio.credit.buyer')}</th>
                  <th>{t('portfolio.credit.rating')}</th>
                  <th>{t('portfolio.credit.ratedAt')}</th>
                </tr>
              }
            >
              {stale.map((r) => (
                <tr key={r.buyer_entity_id}>
                  <td>{buyerLink(r.buyer_entity_id, r.buyer_name)}</td>
                  <td>{r.current_grade ? `${r.current_grade}` : t('portfolio.credit.notRated')}</td>
                  <td className="text-slate-500">{r.rated_at ? formatMoment(r.rated_at, locale) : '—'}</td>
                </tr>
              ))}
            </TableCard>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <TableCard
              title={t('portfolio.credit.byCurrency')}
              hint={t('portfolio.credit.byCurrencyHint')}
              empty={null}
              head={
                <tr>
                  <th>{t('policies.fields.currency')}</th>
                  <th className="text-right">{t('portfolio.credit.limits')}</th>
                  <th className="text-right">{t('portfolio.credit.amount')}</th>
                </tr>
              }
            >
              {currencies.map((c) => (
                <tr key={c.currency}>
                  <td>{c.currency}</td>
                  <td className="num text-right">{c.limits}</td>
                  <td className="num text-right">{formatAmount(c.amount, locale)}</td>
                </tr>
              ))}
            </TableCard>

            <TableCard
              title={t('portfolio.credit.groups')}
              hint={t('portfolio.credit.groupsHint')}
              empty={groups?.length ? null : t('portfolio.credit.noGroups')}
              head={
                <tr>
                  <th>{t('portfolio.credit.group')}</th>
                  <th className="text-right">{t('portfolio.credit.members')}</th>
                  <th className="text-right">{t('portfolio.credit.exposure')}</th>
                </tr>
              }
            >
              {(groups ?? []).map((g) => (
                <tr key={g.ultimate_parent_id}>
                  <td>{buyerLink(g.ultimate_parent_id, g.ultimate_parent_name)}</td>
                  <td className="num text-right">{g.members_with_limits}</td>
                  <td className="num text-right">{uzs(Number(g.exposure_uzs))}</td>
                </tr>
              ))}
            </TableCard>
          </div>
        </div>
      )}
    </div>
  )
}
