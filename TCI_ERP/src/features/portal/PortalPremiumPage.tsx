/** «Премия» in the portal: what the policyholder owes and why.
 *
 * The no-refund rule is stated in words, not implied by a zero adjustment.
 * Each instalment shows what has been paid against it and what is still
 * owed (0056: derived from the payments, oldest first) — read-only. */

import { useTranslation } from 'react-i18next'

import { Badge, COL, Callout, Card, EmptyState, KeyFigures, PageHeader, SectionTitle, Spinner, Table, labelCol } from '../../components/ui'
import { EM_DASH, formatAmount, formatDate, formatRate } from '../../lib/format'
import { isBelowMinimum } from '../policies/premium'
import type { DerivedStatus } from '../policies/premium'
import { useClientInstalments, useClientPremium } from './api'

const STATUS_TONE: Record<DerivedStatus, 'neutral' | 'accent' | 'pos' | 'warn' | 'neg'> = {
  pending: 'neutral',
  invoiced: 'accent',
  partially_paid: 'warn',
  paid: 'pos',
  overdue: 'neg',
  cancelled: 'neutral',
}

/** № · Due · Amount · Paid · Outstanding · Status (fixed). */
const COLUMNS = ['3.5rem', COL.date, COL.money, COL.money, COL.money, labelCol('instalmentStatus')] as const

export function PortalPremiumPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: premiums, isLoading } = useClientPremium()
  const { data: instalments } = useClientInstalments()

  if (isLoading) return <Spinner label={t('common.loading')} />
  const header = <PageHeader title={t('portal.premium.title')} subtitle={t('portal.premium.subtitle')} />
  if (!premiums?.length)
    return (
      <div>
        {header}
        <Card className="p-6">
          <EmptyState title={t('portal.premium.empty')} />
        </Card>
      </div>
    )

  return (
    <div className="space-y-8">
      {header}

      {premiums.map((p) => {
        const below = isBelowMinimum(Number(p.earned_premium), Number(p.minimum_premium))
        const rows = (instalments ?? []).filter((i) => i.policy_id === p.policy_id)
        const money = (v: number | string) => `${formatAmount(Number(v), locale)} ${p.currency_code}`
        const paid = Number(p.instalments_paid)
        return (
          <section key={p.policy_id}>
            <SectionTitle className="mb-3">{p.policy_number}</SectionTitle>
            <KeyFigures
              items={[
                { label: t('premium.fields.minimumPremium'), value: money(p.minimum_premium) },
                {
                  label: t('premium.fields.earnedPremium'),
                  value: money(p.earned_premium),
                  meta: `${t('premium.fields.rate')} ${formatRate(p.premium_rate_pct, locale)}`,
                },
                {
                  label: t('premium.fields.adjustment'),
                  value: money(p.adjustment_amount),
                  tone: Number(p.adjustment_amount) > 0 ? 'default' : 'muted',
                },
                {
                  label: t('premium.fields.dueTotal'),
                  value: money(p.premium_due_total),
                  meta: t('premium.paidSoFar', { amount: money(paid) }),
                },
                {
                  label: t('premium.fields.outstanding'),
                  value: money(p.instalments_outstanding),
                  meta:
                    Number(p.instalments_overdue) > 0
                      ? t('premium.figures.overdueMeta', { amount: money(p.instalments_overdue) })
                      : t('premium.figures.nothingOverdue'),
                  tone: Number(p.instalments_overdue) > 0 ? 'neg' : 'default',
                },
              ]}
            />

            {below && <Callout tone="info" title={t('premium.noRefundBelowMinimum')} className="mb-4" />}

            {rows.length > 0 && (
              <Table dense columns={COLUMNS}>
                <thead>
                  <tr>
                    <th>{t('premium.fields.sequence')}</th>
                    <th>{t('premium.fields.dueDate')}</th>
                    <th className="text-right">{t('premium.fields.amount')}</th>
                    <th className="text-right">{t('premium.fields.paid')}</th>
                    <th className="text-right">{t('premium.fields.outstanding')}</th>
                    <th>{t('premium.fields.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td className="text-slate-500 tabular-nums">{i.sequence}</td>
                      <td className={i.overdue ? 'font-medium text-neg-600' : ''}>{formatDate(i.due_date, locale)}</td>
                      <td className="num">{money(i.amount)}</td>
                      <td className="num">{Number(i.paid_amount) > 0 ? money(i.paid_amount) : EM_DASH}</td>
                      <td className={`num ${i.overdue ? 'font-semibold text-neg-600' : ''}`}>
                        {Number(i.outstanding) > 0 ? money(i.outstanding) : EM_DASH}
                      </td>
                      <td
                        title={
                          i.invoice_number
                            ? t('premium.tooltips.invoiced', { number: i.invoice_number, date: formatDate(i.invoice_date ?? '', locale) })
                            : undefined
                        }
                      >
                        <Badge tone={STATUS_TONE[i.derived_status]}>{t(`premium.instalmentStatuses.${i.derived_status}`)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
        )
      })}
    </div>
  )
}
