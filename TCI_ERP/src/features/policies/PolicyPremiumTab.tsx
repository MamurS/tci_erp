/**
 * «Премия» — the policy premium picture in one place.
 *
 * A whole-turnover policy is priced twice: a minimum paid in instalments, and
 * an adjustment once real turnover is known. Both are shown side by side,
 * with the rule that decides the adjustment stated in words rather than left
 * for the reader to infer from a zero:
 *
 *   there is NO refund below the minimum.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, EmptyState, Spinner, Table } from '../../components/ui'
import { EM_DASH, formatAmount, formatPercent } from '../../lib/format'
import { isBelowMinimum, isInstalmentEditable } from './premium'
import type { InstalmentStatus } from './premium'
import {
  useGenerateInstalments,
  usePolicyPremium,
  usePremiumEntries,
  usePremiumInstalments,
  useUpdateInstalment,
} from './premiumApi'

const STATUS_TONE: Record<InstalmentStatus, 'neutral' | 'accent' | 'pos' | 'warn'> = {
  pending: 'neutral',
  invoiced: 'accent',
  paid: 'pos',
  cancelled: 'warn',
}

export function PolicyPremiumTab({ policyId }: { policyId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: premium, isLoading } = usePolicyPremium(policyId)
  const { data: instalments } = usePremiumInstalments(policyId)
  const { data: entries } = usePremiumEntries(policyId)
  const update = useUpdateInstalment(policyId)
  const generate = useGenerateInstalments(policyId)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!premium) return <EmptyState title={t('premium.none')} />

  const run = (p: Promise<unknown>) => {
    setError(null)
    p.catch((e: { message?: string }) => setError(e.message ?? t('common.somethingWentWrong')))
  }

  const belowMinimum = isBelowMinimum(
    Number(premium.earned_premium),
    Number(premium.minimum_premium),
  )
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs text-slate-500">{t('premium.fields.minimumPremium')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {formatAmount(Number(premium.minimum_premium), locale)} {premium.currency_code}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t(`premium.basis.${premium.premium_basis}`)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">{t('premium.fields.earnedPremium')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {formatAmount(Number(premium.earned_premium), locale)} {premium.currency_code}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t('premium.fields.rate')}: {formatPercent(Number(premium.premium_rate_pct), locale)}
          </p>
        </Card>
        <Card className={belowMinimum ? 'border-warn-500/40 bg-warn-50' : ''}>
          <p className="text-xs text-slate-500">{t('premium.fields.adjustment')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {formatAmount(Number(premium.adjustment_amount), locale)} {premium.currency_code}
          </p>
          <p className="mt-1 text-xs text-slate-700">
            {belowMinimum ? t('premium.noRefundBelowMinimum') : t('premium.adjustmentHint')}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">{t('premium.fields.dueTotal')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {formatAmount(Number(premium.premium_due_total), locale)} {premium.currency_code}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {premium.period_closed ? t('premium.periodClosed') : t('premium.periodOpen')}
          </p>
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('premium.instalments')}</h2>
          {!instalments?.length && (
            <Button size="sm" variant="secondary" onClick={() => run(generate.mutateAsync(false))}>
              {t('premium.actions.generate')}
            </Button>
          )}
        </div>
        {!instalments?.length ? (
          <EmptyState
            title={t('premium.noInstalments')}
            hint={t('premium.noInstalmentsHint')}
          />
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('premium.fields.dueDate')}</th>
                <th className="text-right">{t('premium.fields.amount')}</th>
                <th>{t('premium.fields.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {instalments.map((i) => {
                const overdue =
                  (i.status === 'pending' || i.status === 'invoiced') && i.due_date < today
                return (
                  <tr key={i.id} className={overdue ? 'bg-warn-50' : undefined}>
                    <td className="num">{i.sequence}</td>
                    <td className={overdue ? 'font-medium text-warn-500' : undefined}>
                      {i.due_date}
                    </td>
                    <td>
                      <span className="num block">{formatAmount(Number(i.amount), locale)}</span>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[i.status]}>
                        {t(`premium.instalmentStatuses.${i.status}`)}
                      </Badge>
                    </td>
                    <td className="text-right">
                      {i.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => run(update.mutateAsync({ id: i.id, status: 'invoiced' }))}
                        >
                          {t('premium.actions.invoice')}
                        </Button>
                      )}
                      {i.status === 'invoiced' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => run(update.mutateAsync({ id: i.id, status: 'paid' }))}
                        >
                          {t('premium.actions.markPaid')}
                        </Button>
                      )}
                      {!isInstalmentEditable(i.status) && i.status !== 'invoiced' && (
                        <span className="text-xs text-slate-400">{EM_DASH}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-slate-50 font-medium">
                <td colSpan={2}>{t('premium.fields.scheduleTotal')}</td>
                <td>
                  <span className="num block">
                    {formatAmount(Number(premium.instalments_total), locale)}
                  </span>
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">{t('premium.accrual')}</h2>
        {!entries?.length ? (
          <EmptyState title={t('premium.noAccrual')} hint={t('premium.noAccrualHint')} />
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('premium.fields.computedAt')}</th>
                <th className="text-right">{t('declarations.fields.coveredTurnover')}</th>
                <th className="text-right">{t('premium.fields.rateUsed')}</th>
                <th className="text-right">{t('premium.fields.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.computed_at.slice(0, 10)}</td>
                  <td>
                    <span className="num block">
                      {formatAmount(Number(e.covered_turnover), locale)}
                    </span>
                  </td>
                  <td>
                    <span className="num block">{formatPercent(Number(e.rate_used), locale)}</span>
                  </td>
                  <td>
                    <span className="num block">{formatAmount(Number(e.amount), locale)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-slate-500">{t('premium.rateRecordedHint')}</p>
      </Card>
    </div>
  )
}
