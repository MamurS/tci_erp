/**
 * «Портфель полисов» — the commercial underwriting workspace's home: the
 * book per currency (premium, liability, claims, loss ratio), its make-up by
 * product, status and the policyholder's country, the renewals coming up and
 * the worst loss ratios. Figures come from tci.v_policy_portfolio (0052).
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, KeyFigures, Panel, Segmented, Spinner, Table, ViewBar } from '../../components/ui'
import { formatAmount, formatCompact, formatDate, formatDays, formatPercent } from '../../lib/format'
import { statusTone } from '../policies/statusMachine'
import type { PolicyPortfolioRow } from './aggregate'
import { countBy, expiringWithin, inForce, num, policyTotalsByCurrency, worstLossRatios } from './aggregate'
import { usePolicyPortfolio } from './api'
import { TableCard } from './parts'
import { useCountryName } from './useCountryName'

type Scope = 'inForce' | 'all'

const RENEWAL_WINDOW_DAYS = 90

function lossTone(pct: number | null): 'default' | 'warn' | 'neg' {
  if (pct === null) return 'default'
  if (pct >= 100) return 'neg'
  if (pct >= 70) return 'warn'
  return 'default'
}

/** One colour rule for a loss ratio wherever it is printed. */
const LOSS_TEXT = { default: '', warn: 'font-semibold text-warn-500', neg: 'font-semibold text-neg-500' } as const
const LOSS_BAR = { default: 'bg-accent-500', warn: 'bg-warn-500', neg: 'bg-neg-500' } as const

/** A quiet second line under a figure. */
function Sub({ children, tone }: { children: ReactNode; tone?: 'warn' }) {
  return (
    <span className={`mt-0.5 block text-[11.5px] font-normal ${tone === 'warn' ? 'text-warn-500' : 'text-slate-500'}`}>
      {children}
    </span>
  )
}

/** A thin share bar under a figure; nothing when the share is unknown. */
function Meter({ share, tone }: { share: number | null; tone: 'pos' | 'accent' }) {
  if (share === null) return null
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
      <div
        className={`h-full rounded-full ${tone === 'pos' ? 'bg-pos-500' : 'bg-accent-500'}`}
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </div>
  )
}

/** The loss ratio with a bar on a 0–150 % scale and a tick at 100 %. */
function LossRatio({ pct, locale }: { pct: number | null; locale: string }) {
  if (pct === null) return <span className="text-slate-400">—</span>
  const tone = lossTone(pct)
  return (
    <div>
      <span className={`tabular-nums ${LOSS_TEXT[tone]}`}>{formatAmount(pct, locale, 1)}%</span>
      <div className="relative mt-1 h-1.5 w-full rounded-full bg-slate-100" aria-hidden>
        <div className={`h-full rounded-full ${LOSS_BAR[tone]}`} style={{ width: `${Math.min(pct / 150, 1) * 100}%` }} />
        <div className="absolute inset-y-[-2px] w-px bg-slate-400" style={{ left: `${(100 / 150) * 100}%` }} />
      </div>
    </div>
  )
}

/** Counts by one attribute, as a short list with share bars. */
function Breakdown({
  title,
  items,
  total,
  label,
}: {
  title: string
  items: { key: string; count: number }[]
  total: number
  label: (key: string) => string
}) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{title}</h3>
      <ul className="space-y-2.5 text-[13px]">
        {items.map((item) => (
          <li key={item.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-slate-700">{label(item.key)}</span>
              <span className="font-medium text-slate-900 tabular-nums">{item.count}</span>
            </div>
            <Meter share={total ? item.count / total : null} tone="accent" />
          </li>
        ))}
      </ul>
    </div>
  )
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
  const openClaims = totals.reduce((a, c) => a + c.openClaims, 0)
  const claimsTotal = totals.reduce((a, c) => a + c.claims, 0)
  const overduePolicies = rows.filter((r) => (num(r.premium_overdue) ?? 0) > 0).length
  const worst = worstLossRatios(rows, 10)

  const pct = (value: number | null) => (value === null ? '—' : `${formatAmount(value, locale, 1)}%`)
  const money = (value: number | string | null, ccy: string) =>
    num(value) === null ? '—' : `${formatAmount(num(value), locale)} ${ccy}`

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
          <KeyFigures
            className=""
            items={[
              {
                label: t(scope === 'inForce' ? 'portfolio.policies.policiesInForce' : 'portfolio.policies.policiesAll'),
                value: formatAmount(rows.length, locale),
                meta: t('portfolio.policies.currencies', { count: totals.length }),
              },
              {
                label: t('portfolio.policies.openClaimsTotal'),
                value: formatAmount(openClaims, locale),
                meta: t('portfolio.policies.claimsTotal', { count: claimsTotal }),
                tone: openClaims > 0 ? 'warn' : 'muted',
              },
              {
                label: t('portfolio.policies.limitsInForce'),
                value: formatAmount(limitsCount, locale),
                meta:
                  limitsMissing > 0
                    ? t('portfolio.policies.limitsUzsMissing', {
                        amount: formatCompact(limitsUzs, locale),
                        count: limitsMissing,
                      })
                    : t('portfolio.policies.limitsUzs', { amount: formatCompact(limitsUzs, locale) }),
              },
              {
                label: t('portfolio.policies.overduePolicies'),
                value: formatAmount(overduePolicies, locale),
                meta: t('portfolio.policies.overduePoliciesHint'),
                tone: overduePolicies > 0 ? 'warn' : 'muted',
              },
            ]}
          />

          {/* The book per currency: one row each, the metrics as columns, so two
              currencies are compared by eye. Amounts are never added ACROSS
              currencies (DESIGN.md). */}
          <Panel title={t('portfolio.policies.byCurrency')} hint={t('portfolio.policies.byCurrencyHint')}>
            <Table dense>
              <thead>
                <tr>
                  <th>{t('policies.fields.currency')}</th>
                  <th className="text-right">{t('portfolio.policies.premiumBase')}</th>
                  <th>{t('portfolio.policies.premiumPaid')}</th>
                  <th className="text-right">{t('portfolio.policies.maxLiability')}</th>
                  <th className="text-right">{t('portfolio.policies.claimsShort')}</th>
                  <th className="text-right">{t('portfolio.policies.incurred')}</th>
                  <th>{t('portfolio.policies.lossRatio')}</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((c) => {
                  const paidShare = c.premiumBase > 0 ? Math.min(c.premiumPaid / c.premiumBase, 1) : null
                  return (
                    <tr key={c.currency} className="[&>td]:py-2.5 [&>td]:align-top">
                      <td>
                        <span className="font-display text-[15px] font-bold tracking-wide text-accent-600">{c.currency}</span>
                        <Sub>{t('portfolio.policies.inCurrency', { count: c.policies })}</Sub>
                      </td>
                      <td className="num">
                        {formatCompact(c.premiumBase, locale)}
                        <Sub>{t('portfolio.policies.earned', { amount: formatCompact(c.earnedPremium, locale) })}</Sub>
                      </td>
                      <td className="min-w-44">
                        <div className="flex items-baseline justify-between gap-3 tabular-nums">
                          <span>{formatCompact(c.premiumPaid, locale)}</span>
                          <span className="text-[12px] text-slate-500">{formatPercent(paidShare, locale, 0)}</span>
                        </div>
                        <Meter share={paidShare} tone="pos" />
                        {c.premiumOverdue > 0 && (
                          <Sub tone="warn">
                            {t('portfolio.policies.overdue', { amount: formatCompact(c.premiumOverdue, locale) })}
                          </Sub>
                        )}
                      </td>
                      <td className="num">{formatCompact(c.maxLiability, locale)}</td>
                      <td className="num">
                        {formatAmount(c.claims, locale)}
                        <Sub>{t('portfolio.policies.openClaims', { count: c.openClaims })}</Sub>
                      </td>
                      <td className="num">{c.incurred > 0 ? formatCompact(c.incurred, locale) : '—'}</td>
                      <td className="min-w-36">
                        <LossRatio pct={c.lossRatioPct} locale={locale} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </Panel>

          <Panel title={t('portfolio.policies.composition')} hint={t('portfolio.policies.compositionHint')}>
            <div className="grid gap-x-10 gap-y-6 md:grid-cols-3">
              <Breakdown
                title={t('portfolio.policies.byProduct')}
                items={countBy(rows, (r) => r.product_structure)}
                total={rows.length}
                label={(k) => t(`policies.structures.${k}`)}
              />
              <Breakdown
                title={t('portfolio.policies.byStatus')}
                items={countBy(rows, (r) => r.status)}
                total={rows.length}
                label={(k) => t(`policies.statuses.${k}`)}
              />
              <Breakdown
                title={t('portfolio.policies.byCountry')}
                items={countBy(rows, (r) => r.policyholder_country)}
                total={rows.length}
                label={countryName}
              />
            </div>
          </Panel>

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
                <td className="text-slate-500">{formatDate(r.expiry_date, locale)}</td>
                <td className="num text-right">{formatDays(r.days_to_expiry, locale)}</td>
                <td className="num text-right">{money(r.premium_base, r.currency_code)}</td>
                <td className={`num ${LOSS_TEXT[lossTone(num(r.loss_ratio_pct))]}`}>{pct(num(r.loss_ratio_pct))}</td>
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
                <td className={`num ${LOSS_TEXT[lossTone(num(r.loss_ratio_pct))]}`}>{pct(num(r.loss_ratio_pct))}</td>
              </tr>
            ))}
          </TableCard>
        </div>
      )}
    </div>
  )
}
