/** «Премия» in the portal: what the policyholder owes and why.
 *
 * The no-refund rule is stated in words, not implied by a zero adjustment. */

import { useTranslation } from 'react-i18next'

import { Badge, Callout, Card, EmptyState, KeyFigures, PageHeader, SectionTitle, Spinner, Table } from '../../components/ui'
import { formatAmount, formatDate, formatRate } from '../../lib/format'
import { isBelowMinimum } from '../policies/premium'
import { useClientInstalments, useClientPremium } from './api'

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
        const paid = rows.filter((i) => i.status === 'paid').reduce((sum, i) => sum + Number(i.amount), 0)
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
              ]}
            />

            {below && <Callout tone="info" title={t('premium.noRefundBelowMinimum')} className="mb-4" />}

            {rows.length > 0 && (
              <Table dense>
                <thead>
                  <tr>
                    <th className="w-px">№</th>
                    <th>{t('premium.fields.dueDate')}</th>
                    <th className="text-right">{t('premium.fields.amount')}</th>
                    <th>{t('premium.fields.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td className="text-slate-400 tabular-nums">{i.sequence}</td>
                      <td className={`whitespace-nowrap ${i.overdue ? 'font-medium text-neg-500' : ''}`}>
                        {formatDate(i.due_date, locale)}
                      </td>
                      <td className="num">{money(i.amount)}</td>
                      <td>
                        {i.overdue ? (
                          <Badge tone="neg">{t('premium.overdue')}</Badge>
                        ) : (
                          <Badge tone={i.status === 'paid' ? 'pos' : 'neutral'}>
                            {t(`premium.instalmentStatuses.${i.status}`)}
                          </Badge>
                        )}
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
