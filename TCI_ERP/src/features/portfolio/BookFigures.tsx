/**
 * The key figures of a section's book, as tiles on its navy band (owner,
 * 2026-10-27: «like the dashboard»): the credit desk's limits and the
 * commercial desk's policies. Shown on every view of the section
 * (SectionPage `figures`), so the tabs under the band never move; always the
 * ACTIVE book — the overview's own scope switch governs only its tables.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlarmClock, Building2, FileText, Landmark, Scale, ShieldCheck } from 'lucide-react'

import { KpiCard } from '../../components/ui'
import { formatAmount, formatCompact } from '../../lib/format'
import { creditTotals, inForce, num, policyTotalsByCurrency } from './aggregate'
import type { CreditPortfolioRow } from './aggregate'
import { usePolicyPortfolio } from './api'

/** The credit desk's book: exposure, active limits, buyers, policies. */
export function CreditBookFigures({ rows }: { rows: readonly CreditPortfolioRow[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const totals = creditTotals(rows)
  return (
    <>
      <KpiCard
        tone="inverse"
        icon={<Landmark />}
        label={t('portfolio.credit.exposure')}
        value={formatCompact(totals.exposureUzs, locale)}
        unit="UZS"
        title={`${formatAmount(totals.exposureUzs, locale)} UZS`}
        meta={
          totals.missingRates > 0 ? t('portfolio.credit.exposureMissing', { count: totals.missingRates }) : undefined
        }
        to="/limits?view=overview"
      />
      <KpiCard
        tone="inverse"
        icon={<ShieldCheck />}
        label={t('limits.views.inforce')}
        value={formatAmount(totals.limits, locale)}
        to="/limits?view=inforce"
      />
      <KpiCard
        tone="inverse"
        icon={<Building2 />}
        label={t('portfolio.credit.buyers')}
        value={formatAmount(totals.buyers, locale)}
      />
      <KpiCard
        tone="inverse"
        icon={<FileText />}
        label={t('portfolio.credit.policies')}
        value={formatAmount(totals.policies, locale)}
      />
    </>
  )
}

/** The commercial desk's book: active policies, open claims, the credit
 * limits on them, policies with premium overdue. */
export function PolicyBookFigures() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data } = usePolicyPortfolio()
  const rows = useMemo(() => (data ?? []).filter(inForce), [data])
  const totals = policyTotalsByCurrency(rows)
  const openClaims = totals.reduce((a, c) => a + c.openClaims, 0)
  const claimsTotal = totals.reduce((a, c) => a + c.claims, 0)
  const limitsUzs = rows.reduce((a, r) => a + (num(r.limits_uzs) ?? 0), 0)
  const limitsCount = rows.reduce((a, r) => a + r.limits_count, 0)
  const limitsMissing = rows.reduce((a, r) => a + r.limits_missing_rates, 0)
  const overdue = rows.filter((r) => (num(r.premium_overdue) ?? 0) > 0).length
  return (
    <>
      <KpiCard
        tone="inverse"
        icon={<FileText />}
        label={t('portfolio.policies.policiesInForce')}
        value={formatAmount(rows.length, locale)}
        meta={t('portfolio.policies.currencies', { count: totals.length })}
        to="/policies?view=registry"
      />
      <KpiCard
        tone="inverse"
        icon={<Scale />}
        label={t('portfolio.policies.openClaimsTotal')}
        value={formatAmount(openClaims, locale)}
        meta={t('portfolio.policies.claimsTotal', { count: claimsTotal })}
        to="/claims"
      />
      <KpiCard
        tone="inverse"
        icon={<ShieldCheck />}
        label={t('portfolio.policies.limitsInForce')}
        value={formatAmount(limitsCount, locale)}
        meta={
          limitsMissing > 0
            ? t('portfolio.policies.limitsUzsMissing', { amount: formatCompact(limitsUzs, locale), count: limitsMissing })
            : t('portfolio.policies.limitsUzs', { amount: formatCompact(limitsUzs, locale) })
        }
      />
      <KpiCard
        tone="inverse"
        icon={<AlarmClock />}
        label={t('portfolio.policies.overduePolicies')}
        value={formatAmount(overdue, locale)}
        meta={t('portfolio.policies.overduePoliciesHint')}
        to="/policies?view=payments"
      />
    </>
  )
}
