/**
 * «Премия» — the policy premium picture in one place (migrations 0027, 0056).
 *
 * A whole-turnover policy is priced twice: a minimum paid in instalments, and
 * an adjustment once real turnover is known. Both are shown side by side,
 * with the rule that decides the adjustment stated in words rather than left
 * for the reader to infer from a zero: there is NO refund below the minimum.
 *
 * The schedule is a record of money: each instalment shows what was paid
 * against it and what is still owed, and its status is DERIVED from the
 * payments (oldest first) and the date — never set by hand. Payments are
 * append-only; a mistake is corrected by a reversal.
 */

import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  ActionsMenu,
  Badge,
  Button,
  COL,
  Callout,
  EmptyState,
  KeyFigures,
  Panel,
  PanelGrid,
  RowActions,
  Spinner,
  Table,
  actionsCol,
  labelCol,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatDate, formatRate } from '../../lib/format'
import { hasRole } from '../../lib/roles'
import { useAuth } from '../../auth/AuthContext'
import { refusalKey } from '../../lib/refusals'
import { narrowToIds, parseIdList } from '../../lib/deepLink'
import { useDeepLinkFocus } from '../../lib/useDeepLinkFocus'
import { instalmentActions, isBelowMinimum, isReversible, outstandingTotal, primaryAction } from './premium'
import type { DerivedStatus, InstalmentAction, PremiumInstalment, PremiumPayment } from './premium'
import {
  useGenerateInstalments,
  usePolicyPremium,
  usePremiumEntries,
  usePremiumInstalments,
  usePremiumPayments,
} from './premiumApi'
import { InvoiceDialog, PaymentDialog, ReverseDialog } from './PremiumDialogs'

/** id of the instalment schedule — `?instalments=` lands here. */
const INSTALMENTS_ANCHOR_ID = 'premium-instalments'

const STATUS_TONE: Record<DerivedStatus, 'neutral' | 'accent' | 'pos' | 'warn' | 'neg'> = {
  pending: 'neutral',
  invoiced: 'accent',
  partially_paid: 'warn',
  paid: 'pos',
  overdue: 'neg',
  cancelled: 'neutral',
}

/** № · Due · Amount · Paid · Outstanding · Status · Actions (fixed). */
const SCHEDULE_COLUMNS = [
  '3.5rem',
  COL.date,
  COL.money,
  COL.money,
  COL.money,
  labelCol('instalmentStatus'),
  actionsCol(['premiumAction'], 1),
] as const
const SCHEDULE_COLUMNS_READONLY = SCHEDULE_COLUMNS.slice(0, 6)

/** Date · Amount · Reference / source · ⋯ */
const PAYMENT_COLUMNS = [COL.date, COL.money, COL.fill, COL.icon] as const

type Dialog =
  | { kind: 'invoice'; instalment: PremiumInstalment }
  | { kind: 'payment'; suggested: number }
  | { kind: 'reverse'; payment: PremiumPayment }
  | null

export function PolicyPremiumTab({ policyId }: { policyId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { roles } = useAuth()
  const canWrite = hasRole(roles, 'commercial_underwriter')
  const { data: premium, isLoading } = usePolicyPremium(policyId)
  const { data: instalments } = usePremiumInstalments(policyId)
  const { data: payments } = usePremiumPayments(policyId)
  const { data: entries } = usePremiumEntries(policyId)
  const generate = useGenerateInstalments(policyId)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

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

  const cur = premium.currency_code
  const money = (v: number | string) => `${formatAmount(Number(v), locale)} ${cur}`
  const belowMinimum = isBelowMinimum(Number(premium.earned_premium), Number(premium.minimum_premium))
  const owed = outstandingTotal(instalments ?? [])
  const paymentRows = (payments ?? []).filter((p) => p.kind === 'payment')
  const received = Number(premium.payments_total) - Number(premium.reversals_total)

  const act = (action: InstalmentAction, i: PremiumInstalment) =>
    setDialog(action === 'invoice' ? { kind: 'invoice', instalment: i } : { kind: 'payment', suggested: Number(i.outstanding) })

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
            label: t('premium.fields.received'),
            value: money(received),
            meta: paymentRows.length
              ? t('premium.figures.receivedMeta', { count: paymentRows.length })
              : t('premium.figures.noPayments'),
          },
          {
            label: t('premium.fields.outstanding'),
            value: money(premium.instalments_outstanding),
            meta:
              Number(premium.instalments_overdue) > 0
                ? t('premium.figures.overdueMeta', { amount: money(premium.instalments_overdue) })
                : t('premium.figures.nothingOverdue'),
            tone: Number(premium.instalments_overdue) > 0 ? 'neg' : 'default',
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
        ]}
      />

      <Panel
        title={t('premium.instalments')}
        hint={premium.period_closed ? t('premium.periodClosed') : t('premium.periodOpen')}
        actions={
          canWrite &&
          (!instalments?.length ? (
            <Button
              size="sm"
              variant="secondary"
              loading={generate.isPending}
              onClick={() => generate.mutateAsync(false).catch((e: unknown) => setError(t(refusalKey(e))))}
            >
              {t('premium.actions.generate')}
            </Button>
          ) : (
            owed > 0 && (
              <Button size="sm" title={t('premium.tooltips.recordPayment')} onClick={() => setDialog({ kind: 'payment', suggested: 0 })}>
                {t('premium.actions.recordPayment')}
              </Button>
            )
          ))
        }
      >
        {!instalments?.length ? (
          <EmptyState title={t('premium.noInstalments')} hint={t('premium.noInstalmentsHint')} />
        ) : (
          <div id={INSTALMENTS_ANCHOR_ID} className="scroll-mt-40">
            {shown.filtered && (
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
            <Table dense columns={canWrite ? SCHEDULE_COLUMNS : SCHEDULE_COLUMNS_READONLY}>
              <thead>
                <tr>
                  <th>{t('premium.fields.sequence')}</th>
                  <th>{t('premium.fields.dueDate')}</th>
                  <th className="text-right">{t('premium.fields.amount')}</th>
                  <th className="text-right">{t('premium.fields.paid')}</th>
                  <th className="text-right">{t('premium.fields.outstanding')}</th>
                  <th>{t('premium.fields.status')}</th>
                  {canWrite && <th className="text-right">{t('premium.fields.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((i) => (
                  <ScheduleRow key={i.id} instalment={i} money={money} canWrite={canWrite} onAction={act} />
                ))}
                {/* The schedule's total under a narrowed list would read as
                    the sum of the rows shown; it returns with «Show all». */}
                {!shown.filtered && (
                  <tr className="!bg-accent-50 font-semibold [&>td]:border-t [&>td]:border-accent-200">
                    <td colSpan={2}>{t('premium.fields.scheduleTotal')}</td>
                    <td className="num">{money(premium.instalments_total)}</td>
                    <td className="num">{money(premium.instalments_paid)}</td>
                    <td className="num">{money(premium.instalments_outstanding)}</td>
                    <td colSpan={canWrite ? 2 : 1} />
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      <PanelGrid cols="xl:grid-cols-2" className="mt-6">
        <Panel title={t('premium.payments.title')} hint={t('premium.payments.hint')}>
          {!payments?.length ? (
            <EmptyState title={t('premium.payments.empty')} hint={t('premium.payments.emptyHint')} />
          ) : (
            <Table dense columns={canWrite ? PAYMENT_COLUMNS : PAYMENT_COLUMNS.slice(0, 3)}>
              <thead>
                <tr>
                  <th>{t('premium.fields.date')}</th>
                  <th className="text-right">{t('premium.fields.amount')}</th>
                  <th>
                    {t('premium.fields.reference')} · {t('premium.fields.source')}
                  </th>
                  {canWrite && <th />}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <PaymentRow
                    key={p.id}
                    payment={p}
                    all={payments}
                    money={money}
                    canWrite={canWrite}
                    onReverse={() => setDialog({ kind: 'reverse', payment: p })}
                  />
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title={t('premium.accrual')} hint={t('premium.rateRecordedHint')}>
          {!entries?.length ? (
            <EmptyState title={t('premium.noAccrual')} hint={t('premium.noAccrualHint')} />
          ) : (
            <Table dense columns={[COL.date, COL.fill, COL.pct, COL.money]}>
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
                    <td>{formatDate(e.computed_at, locale)}</td>
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

      {dialog?.kind === 'invoice' && (
        <InvoiceDialog
          policyId={policyId}
          policyNumber={premium.policy_number}
          currency={cur}
          instalment={dialog.instalment}
          onClose={() => setDialog(null)}
          onError={setError}
        />
      )}
      {dialog?.kind === 'payment' && (
        <PaymentDialog
          policyId={policyId}
          currency={cur}
          outstanding={owed}
          suggested={dialog.suggested}
          onClose={() => setDialog(null)}
          onError={setError}
        />
      )}
      {dialog?.kind === 'reverse' && (
        <ReverseDialog
          policyId={policyId}
          currency={cur}
          payment={dialog.payment}
          onClose={() => setDialog(null)}
          onError={setError}
        />
      )}
    </div>
  )
}

/** One instalment: the money in three columns, the derived status, and its
 * next step as a real button with the rest in ⋯. Every cell keeps its width
 * whatever the status or a pending write (fixed table, reserved labels). */
function ScheduleRow({
  instalment: i,
  money,
  canWrite,
  onAction,
}: {
  instalment: PremiumInstalment
  money: (v: number | string) => string
  canWrite: boolean
  onAction: (action: InstalmentAction, i: PremiumInstalment) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const primary = primaryAction(i)
  const others = instalmentActions(i).filter((a) => a !== primary)
  const overdue = i.derived_status === 'overdue'
  const statusTitle =
    i.derived_status === 'paid' && i.settled_on
      ? t('premium.tooltips.settled', { date: formatDate(i.settled_on, locale) })
      : i.invoice_number
        ? t('premium.tooltips.invoiced', { number: i.invoice_number, date: formatDate(i.invoice_date ?? i.invoiced_at ?? '', locale) })
        : undefined
  const tooltip = (action: InstalmentAction) =>
    action === 'invoice'
      ? t('premium.tooltips.invoice', { sequence: i.sequence, amount: money(i.amount) })
      : t('premium.tooltips.recordPayment')

  return (
    <tr>
      <td className="text-slate-500 tabular-nums">{i.sequence}</td>
      <td className={overdue ? 'font-medium text-neg-600' : ''}>{formatDate(i.due_date, locale)}</td>
      <td className="num">{money(i.amount)}</td>
      <td className="num">{Number(i.paid_amount) > 0 ? money(i.paid_amount) : EM_DASH}</td>
      <td className={`num ${overdue ? 'font-semibold text-neg-600' : ''}`}>
        {Number(i.outstanding) > 0 ? money(i.outstanding) : EM_DASH}
      </td>
      <td title={statusTitle}>
        <Badge tone={STATUS_TONE[i.derived_status]}>{t(`premium.instalmentStatuses.${i.derived_status}`)}</Badge>
      </td>
      {canWrite && (
        <RowActions>
          {primary && (
            <Button size="sm" variant="secondary" title={tooltip(primary)} onClick={() => onAction(primary, i)}>
              {t(`premium.actions.${primary}`)}
            </Button>
          )}
          <span className={others.length ? '' : 'invisible'}>
            <ActionsMenu
              trigger="icon"
              size="sm"
              label={t('premium.actions.more', { sequence: i.sequence })}
              disabled={!others.length}
              actions={others.map((a) => ({ key: a, label: t(`premium.actions.${a}`), onSelect: () => onAction(a, i) }))}
            />
          </span>
        </RowActions>
      )}
    </tr>
  )
}

function PaymentRow({
  payment: p,
  all,
  money,
  canWrite,
  onReverse,
}: {
  payment: PremiumPayment
  all: readonly PremiumPayment[]
  money: (v: number | string) => string
  canWrite: boolean
  onReverse: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const reversal = p.kind === 'reversal'
  const reversed = !reversal && all.some((x) => x.reverses_id === p.id)
  const original = reversal ? all.find((x) => x.id === p.reverses_id) : undefined
  const describe = reversal
    ? [original ? t('premium.payments.reversalOf', { date: formatDate(original.payment_date, locale) }) : t('premium.payments.reversal'), p.note]
    : [p.reference === 'MIGRATION-0056' ? t('premium.payments.migrated') : p.reference, t(`premium.sources.${p.source}`)]

  return (
    <tr className={reversed ? 'text-slate-500' : ''}>
      <td>{formatDate(p.payment_date, locale)}</td>
      <td className={`num ${reversal ? 'text-neg-600' : ''} ${reversed ? 'line-through' : ''}`}>
        {reversal ? `−${money(p.amount)}` : money(p.amount)}
      </td>
      <td>
        {reversed && <Badge tone="neutral">{t('premium.payments.reversed')}</Badge>}{' '}
        {describe.filter(Boolean).join(' · ')}
      </td>
      {canWrite && (
        <RowActions>
          <span className={isReversible(p, all) ? '' : 'invisible'}>
            <ActionsMenu
              trigger="icon"
              size="sm"
              label={t('premium.actions.paymentMore')}
              disabled={!isReversible(p, all)}
              actions={[{ key: 'reverse', label: t('premium.actions.reverse'), danger: true, onSelect: onReverse }]}
            />
          </span>
        </RowActions>
      )}
    </tr>
  )
}
