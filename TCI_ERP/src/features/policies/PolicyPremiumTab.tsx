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
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Callout,
  EmptyState,
  KeyFigures,
  Panel,
  PanelGrid,
  Spinner,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatDate, formatRate } from '../../lib/format'
import { isBelowMinimum, isInstalmentEditable } from './premium'
import type { InstalmentStatus } from './premium'
import {
  useGenerateInstalments,
  usePolicyPremium,
  usePremiumEntries,
  usePremiumInstalments,
  useUpdateInstalment,
} from './premiumApi'
import { refusalKey } from '../../lib/refusals'
import { narrowToIds, parseIdList } from '../../lib/deepLink'
import { useDeepLinkFocus } from '../../lib/useDeepLinkFocus'

/** id of the instalment schedule — `?instalments=` lands here. */
const INSTALMENTS_ANCHOR_ID = 'premium-instalments'

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

  // ?instalments=<id>,<id> — the Agenda's «invoice» / «chase payment» link
  // names the instalments the task is about, and the schedule shows only
  // those until «Show all». Ids that are not on this schedule narrow nothing.
  const [params] = useSearchParams()
  const linkedIds = parseIdList(params.get('instalments'))
  const shown = narrowToIds(instalments ?? [], linkedIds)
  useDeepLinkFocus(shown.filtered ? INSTALMENTS_ANCHOR_ID : null, { highlight: false })
  const showAll = new URLSearchParams(params)
  showAll.delete('instalments')

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!premium) return <EmptyState title={t('premium.none')} />

  const run = (p: Promise<unknown>) => {
    setError(null)
    p.catch((e: unknown) => setError(t(refusalKey(e))))
  }

  const belowMinimum = isBelowMinimum(
    Number(premium.earned_premium),
    Number(premium.minimum_premium),
  )
  const today = new Date().toISOString().slice(0, 10)

  const cur = premium.currency_code
  const money = (v: number | string) => `${formatAmount(Number(v), locale)} ${cur}`
  const paid = (instalments ?? [])
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + Number(i.amount), 0)

  return (
    <div>
      <div className="space-y-3 empty:hidden [&:not(:empty)]:mb-6">
        {error && <Callout tone="neg" title={error} />}
        {belowMinimum && <Callout tone="warn" title={t('premium.noRefundBelowMinimum')} />}
      </div>

      <KeyFigures
        items={[
          {
            label: t('premium.fields.minimumPremium'),
            value: money(premium.minimum_premium),
            meta: t(`premium.basis.${premium.premium_basis}`),
          },
          {
            label: t('premium.fields.earnedPremium'),
            value: money(premium.earned_premium),
            meta: `${t('premium.fields.rate')} ${formatRate(premium.premium_rate_pct, locale)}`,
          },
          {
            label: t('premium.fields.adjustment'),
            value: money(premium.adjustment_amount),
            meta: t('premium.adjustmentHint'),
            tone: Number(premium.adjustment_amount) > 0 ? 'default' : 'muted',
          },
          {
            label: t('premium.fields.dueTotal'),
            value: money(premium.premium_due_total),
            meta: t('premium.paidSoFar', { amount: money(paid) }),
          },
        ]}
      />

      <PanelGrid cols="xl:grid-cols-2">
        <Panel
          title={t('premium.instalments')}
          hint={premium.period_closed ? t('premium.periodClosed') : t('premium.periodOpen')}
          actions={
            !instalments?.length && (
              <Button size="sm" variant="secondary" onClick={() => run(generate.mutateAsync(false))}>
                {t('premium.actions.generate')}
              </Button>
            )
          }
        >
          {!instalments?.length ? (
            <EmptyState title={t('premium.noInstalments')} hint={t('premium.noInstalmentsHint')} />
          ) : (
            // The target is the panel's body, so its margin also clears the
            // panel's own title and hint: the reader still sees what this is.
            <div id={INSTALMENTS_ANCHOR_ID} className="scroll-mt-40">
              {shown.filtered && (
                // One line: the way back sits next to what was narrowed.
                <Callout
                  className="mb-3"
                  title={
                    <>
                      {t('premium.linkedInstalments', { count: shown.rows.length })}
                      <Link
                        to={{ search: `?${showAll.toString()}` }}
                        replace
                        className="ml-3 font-medium whitespace-nowrap text-accent-600 hover:underline"
                      >
                        {t('premium.showAllInstalments')}
                      </Link>
                    </>
                  }
                />
              )}
              <Table dense>
                <thead>
                  <tr>
                    <th className="w-px">№</th>
                    <th>{t('premium.fields.dueDate')}</th>
                    <th className="text-right">{t('premium.fields.amount')}</th>
                    <th>{t('premium.fields.status')}</th>
                    <th className="w-px" />
                  </tr>
                </thead>
                <tbody>
                  {shown.rows.map((i) => {
                    const overdue = (i.status === 'pending' || i.status === 'invoiced') && i.due_date < today
                    return (
                      <tr key={i.id}>
                        <td className="text-slate-400 tabular-nums">{i.sequence}</td>
                        <td className={`whitespace-nowrap ${overdue ? 'font-medium text-neg-500' : ''}`}>
                          {formatDate(i.due_date, locale)}
                        </td>
                        <td className="num">{money(i.amount)}</td>
                        <td>
                          {overdue ? (
                            <Badge tone="neg">{t('premium.overdue')}</Badge>
                          ) : (
                            <Badge tone={STATUS_TONE[i.status]}>{t(`premium.instalmentStatuses.${i.status}`)}</Badge>
                          )}
                        </td>
                        <td className="text-right whitespace-nowrap">
                          {i.status === 'pending' && (
                            <RowAction onClick={() => run(update.mutateAsync({ id: i.id, status: 'invoiced' }))}>
                              {t('premium.actions.invoice')}
                            </RowAction>
                          )}
                          {i.status === 'invoiced' && (
                            <RowAction onClick={() => run(update.mutateAsync({ id: i.id, status: 'paid' }))}>
                              {t('premium.actions.markPaid')}
                            </RowAction>
                          )}
                          {!isInstalmentEditable(i.status) && i.status !== 'invoiced' && (
                            <span className="text-slate-300">{EM_DASH}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {/* The schedule's total under a narrowed list would read as
                      the sum of the rows shown; it returns with «Show all». */}
                  {!shown.filtered && (
                    <tr className="!bg-accent-50 font-semibold [&>td]:border-t [&>td]:border-accent-200">
                      <td colSpan={2}>{t('premium.fields.scheduleTotal')}</td>
                      <td className="num">{money(premium.instalments_total)}</td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          )}
        </Panel>

        <Panel title={t('premium.accrual')} hint={t('premium.rateRecordedHint')}>
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
                    <td className="whitespace-nowrap">{formatDate(e.computed_at, locale)}</td>
                    <td className="num">{formatAmount(Number(e.covered_turnover), locale)}</td>
                    <td className="num">{formatRate(e.rate_used, locale)}</td>
                    <td className="num">{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </PanelGrid>
    </div>
  )
}

/** An action inside a table row: a text button, so the rows that carry one
 * are exactly as tall as the rows that do not. */
function RowAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] font-medium text-accent-600 hover:text-accent-500 hover:underline">
      {children}
    </button>
  )
}
