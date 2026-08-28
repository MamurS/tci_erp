/** «Премия» in the portal: what the policyholder owes and why.
 *
 * The no-refund rule is stated in words, not implied by a zero adjustment. */

import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, PageHeader, Spinner, Table } from '../../components/ui'
import { formatAmount, formatPercent } from '../../lib/format'
import { isBelowMinimum } from '../policies/premium'
import { useClientInstalments, useClientPremium } from './api'

export function PortalPremiumPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: premiums, isLoading } = useClientPremium()
  const { data: instalments } = useClientInstalments()

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!premiums?.length) return <EmptyState title={t('portal.premium.empty')} />

  return (
    <div className="space-y-6">
      <PageHeader title={t('portal.premium.title')} subtitle={t('portal.premium.subtitle')} />

      {premiums.map((p) => {
        const below = isBelowMinimum(Number(p.earned_premium), Number(p.minimum_premium))
        const rows = (instalments ?? []).filter((i) => i.policy_id === p.policy_id)
        return (
          <Card key={p.policy_id}>
            <h2 className="text-sm font-semibold">{p.policy_number}</h2>

            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">{t('premium.fields.minimumPremium')}</p>
                <p className="num mt-1 font-semibold">
                  {formatAmount(Number(p.minimum_premium), locale)} {p.currency_code}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">{t('premium.fields.earnedPremium')}</p>
                <p className="num mt-1 font-semibold">
                  {formatAmount(Number(p.earned_premium), locale)} {p.currency_code}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatPercent(Number(p.premium_rate_pct), locale)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">{t('premium.fields.adjustment')}</p>
                <p className="num mt-1 font-semibold">
                  {formatAmount(Number(p.adjustment_amount), locale)} {p.currency_code}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">{t('premium.fields.dueTotal')}</p>
                <p className="num mt-1 font-semibold">
                  {formatAmount(Number(p.premium_due_total), locale)} {p.currency_code}
                </p>
              </div>
            </div>

            {below && (
              <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
                {t('premium.noRefundBelowMinimum')}
              </p>
            )}

            {rows.length > 0 && (
              <Table dense className="mt-4">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('premium.fields.dueDate')}</th>
                    <th className="text-right">{t('premium.fields.amount')}</th>
                    <th>{t('premium.fields.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id} className={i.overdue ? 'bg-warn-50' : undefined}>
                      <td className="num">{i.sequence}</td>
                      <td className={i.overdue ? 'font-medium text-warn-500' : undefined}>
                        {i.due_date}
                      </td>
                      <td>
                        <span className="num block">{formatAmount(Number(i.amount), locale)}</span>
                      </td>
                      <td>
                        <Badge tone={i.status === 'paid' ? 'pos' : 'neutral'}>
                          {t(`premium.instalmentStatuses.${i.status}`)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )
      })}
    </div>
  )
}
