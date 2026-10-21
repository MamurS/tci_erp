/**
 * «Портфель полисов» — the commercial underwriting workspace's home: the
 * book per currency (premium, liability, claims, loss ratio), its make-up by
 * product, status and the policyholder's country, the renewals coming up and
 * the worst loss ratios. Figures come from tci.v_policy_portfolio (0052).
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, ViewBar, Segmented, Spinner, StatCard } from '../../components/ui'
import { formatAmount, formatCompact, formatDays } from '../../lib/format'
import { statusTone } from '../policies/statusMachine'
import type { PolicyPortfolioRow } from './aggregate'
import { countBy, expiringWithin, inForce, num, policyTotalsByCurrency, worstLossRatios } from './aggregate'
import { usePolicyPortfolio } from './api'
import { ShareBar, TableCard } from './parts'
import { useCountryName } from './useCountryName'

type Scope = 'inForce' | 'all'

const RENEWAL_WINDOW_DAYS = 90

function lossTone(pct: number | null): 'default' | 'warn' | 'neg' {
  if (pct === null) return 'default'
  if (pct >= 100) return 'neg'
  if (pct >= 70) return 'warn'
  return 'default'
}

export function PolicyPortfolioPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const countryName = useCountryName()
  const { data, isLoading } = usePolicyPortfolio()
  const [scope, setScope] = useState<Scope>('inForce')

  const rows = useMemo(() => (data ?? []).filter((r) => scope === 'all' || inForce(r)), [data, scope])
  const totals = useMemo(() => policyTotalsByCurrency(rows), [rows])
  const limitsUzs = rows.reduce((a, r) => a + (num(r.limits_uzs) ?? 0), 0)
  const limitsCount = rows.reduce((a, r) => a + r.limits_count, 0)
  const limitsMissing = rows.reduce((a, r) => a + r.limits_missing_rates, 0)
  const renewals = expiringWithin(data ?? [], RENEWAL_WINDOW_DAYS)
  const worst = worstLossRatios(rows, 10)

  const pct = (value: number | null) => (value === null ? '—' : `${formatAmount(value, locale, 1)}%`)
  const money = (value: number | string | null, ccy: string) =>
    num(value) === null ? '—' : `${formatAmount(num(value), locale)} ${ccy}`

  const breakdown = (title: string, items: { key: string; count: number }[], label: (key: string) => string) => (
    <TableCard
      title={title}
      empty={items.length ? null : t('portfolio.none')}
      head={
        <tr>
          <th />
          <th className="text-right">{t('portfolio.policies.count')}</th>
          <th className="text-right">{t('portfolio.share')}</th>
        </tr>
      }
    >
      {items.map((item) => (
        <tr key={item.key}>
          <td>{label(item.key)}</td>
          <td className="num text-right">{item.count}</td>
          <td>
            <ShareBar compact share={rows.length ? item.count / rows.length : null} />
          </td>
        </tr>
      ))}
    </TableCard>
  )

  const policyLink = (r: PolicyPortfolioRow) => (
    <Link to={`/policies/${r.policy_id}`} className="font-medium whitespace-nowrap text-accent-600 hover:text-accent-500">
      {r.policy_number}
    </Link>
  )

  return (
    <div>
      <ViewBar
        hint={t('portfolio.policies.subtitle')}
        actions={
          <Segmented
            value={scope}
            onChange={(key) => setScope(key as Scope)}
            ariaLabel={t('portfolio.scope.label')}
            options={[
              { key: 'inForce', label: t('portfolio.scope.inForce') },
              { key: 'all', label: t('portfolio.scope.all') },
            ]}
          />
        }
      />

      {isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Card className="p-6">
          <EmptyState title={t('portfolio.policies.empty')} hint={t('portfolio.policies.emptyHint')} />
        </Card>
      ) : (
        <div className="grid gap-5">
          {totals.map((c) => (
            <section key={c.currency} aria-label={c.currency}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="font-display text-[15px] font-bold tracking-wide text-accent-600 uppercase">{c.currency}</h2>
                <span className="text-[12px] text-slate-500">{t('portfolio.policies.inCurrency', { count: c.policies })}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <StatCard
                  label={t('portfolio.policies.premiumBase')}
                  value={formatCompact(c.premiumBase, locale)}
                  meta={t('portfolio.policies.earned', { amount: formatCompact(c.earnedPremium, locale) })}
                />
                <StatCard
                  label={t('portfolio.policies.premiumPaid')}
                  value={formatCompact(c.premiumPaid, locale)}
                  meta={
                    c.premiumOverdue > 0
                      ? t('portfolio.policies.overdue', { amount: formatCompact(c.premiumOverdue, locale) })
                      : undefined
                  }
                  tone={c.premiumOverdue > 0 ? 'warn' : 'default'}
                />
                <StatCard label={t('portfolio.policies.maxLiability')} value={formatCompact(c.maxLiability, locale)} />
                <StatCard
                  label={t('portfolio.policies.claims')}
                  value={formatAmount(c.claims, locale)}
                  meta={t('portfolio.policies.openClaims', { count: c.openClaims })}
                />
                <StatCard label={t('portfolio.policies.incurred')} value={formatCompact(c.incurred, locale)} />
                <StatCard
                  label={t('portfolio.policies.lossRatio')}
                  value={pct(c.lossRatioPct)}
                  meta={t('portfolio.policies.lossRatioHint')}
                  tone={lossTone(c.lossRatioPct)}
                />
              </div>
            </section>
          ))}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label={t('portfolio.policies.limitsInForce')}
              value={formatAmount(limitsCount, locale)}
              meta={t('portfolio.policies.limitsUzs', { amount: formatCompact(limitsUzs, locale) })}
            />
            {limitsMissing > 0 && (
              <StatCard
                label={t('portfolio.missingRates')}
                value={formatAmount(limitsMissing, locale)}
                meta={t('portfolio.missingRatesHint')}
                tone="warn"
              />
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {breakdown(
              t('portfolio.policies.byProduct'),
              countBy(rows, (r) => r.product_structure),
              (k) => t(`policies.structures.${k}`),
            )}
            {breakdown(
              t('portfolio.policies.byStatus'),
              countBy(rows, (r) => r.status),
              (k) => t(`policies.statuses.${k}`),
            )}
            {breakdown(t('portfolio.policies.byCountry'), countBy(rows, (r) => r.policyholder_country), countryName)}
          </div>

          <TableCard
            title={t('portfolio.policies.renewals', { days: RENEWAL_WINDOW_DAYS })}
            hint={t('portfolio.policies.renewalsHint')}
            empty={renewals.length ? null : t('portfolio.policies.noRenewals')}
            head={
              <tr>
                <th>{t('policies.fields.policyNumber')}</th>
                <th>{t('policies.fields.policyholder')}</th>
                <th>{t('policies.fields.expiryDate')}</th>
                <th className="text-right">{t('portfolio.policies.daysLeft')}</th>
                <th className="text-right">{t('portfolio.policies.premiumBase')}</th>
                <th className="text-right">{t('portfolio.policies.lossRatio')}</th>
              </tr>
            }
          >
            {renewals.map((r) => (
              <tr key={r.policy_id}>
                <td>{policyLink(r)}</td>
                <td className="text-slate-600">{r.policyholder_name}</td>
                <td className="text-slate-500">{r.expiry_date}</td>
                <td className="num text-right">{formatDays(r.days_to_expiry, locale)}</td>
                <td className="num text-right">{money(r.premium_base, r.currency_code)}</td>
                <td className="num text-right">{pct(num(r.loss_ratio_pct))}</td>
              </tr>
            ))}
          </TableCard>

          <TableCard
            title={t('portfolio.policies.worst')}
            empty={worst.length ? null : t('portfolio.policies.noLosses')}
            head={
              <tr>
                <th>{t('policies.fields.policyNumber')}</th>
                <th>{t('policies.fields.policyholder')}</th>
                <th>{t('policies.fields.status')}</th>
                <th className="text-right">{t('portfolio.policies.premiumBase')}</th>
                <th className="text-right">{t('portfolio.policies.incurred')}</th>
                <th className="text-right">{t('portfolio.policies.lossRatio')}</th>
              </tr>
            }
          >
            {worst.map((r) => (
              <tr key={r.policy_id}>
                <td>{policyLink(r)}</td>
                <td className="text-slate-600">{r.policyholder_name}</td>
                <td>
                  <Badge tone={statusTone(r.status as Parameters<typeof statusTone>[0])}>
                    {t(`policies.statuses.${r.status}`)}
                  </Badge>
                </td>
                <td className="num text-right">{money(r.premium_base, r.currency_code)}</td>
                <td className="num text-right">{money(r.incurred, r.currency_code)}</td>
                <td className={`num text-right font-semibold ${lossTone(num(r.loss_ratio_pct)) === 'neg' ? 'text-neg-500' : ''}`}>
                  {pct(num(r.loss_ratio_pct))}
                </td>
              </tr>
            ))}
          </TableCard>
        </div>
      )}
    </div>
  )
}
