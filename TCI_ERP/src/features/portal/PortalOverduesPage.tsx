/**
 * «Просроченная задолженность» — the policyholder reports a buyer who has
 * stopped paying, and sees what that did.
 *
 * Two things this screen must be blunt about:
 *
 *  - the DEADLINE. A late notification can prejudice cover, so the date is
 *    computed and shown before they file, not after.
 *  - the SUSPENSION. Filing suspends the buyer's limit immediately. Hiding
 *    that would let them keep shipping on cover that no longer exists.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
} from '../../components/ui'
import { formatAmount, formatMoment } from '../../lib/format'
import { isReportedLate, noaDeadline } from '../overdue/noa'
import {
  useClientDeclarableBuyers,
  useClientFileNoa,
  useClientOverdues,
  useMyPolicies,
} from './api'
import type { ClientPolicy } from './types'

export function PortalOverduesPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: policies } = useMyPolicies()
  const { data: overdues, isLoading } = useClientOverdues()
  const file = useClientFileNoa()

  const activePolicy = useMemo(
    () => (policies ?? []).find((p: ClientPolicy) => p.status === 'active') ?? null,
    [policies],
  )
  const { data: buyers } = useClientDeclarableBuyers(activePolicy?.id)

  const [buyerId, setBuyerId] = useState('')
  const [firstDue, setFirstDue] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  // The deadline and the verdict, computed here so the warning appears while
  // they fill the form in. Mirrors tci.noa_deadline.
  const lateness = useMemo(() => {
    if (!firstDue || !activePolicy) return null
    const deadline = noaDeadline(
      firstDue,
      activePolicy.max_extension_period_days ?? 0,
      activePolicy.noa_window_days ?? 30,
    )
    return {
      deadline,
      late: isReportedLate(
        firstDue,
        activePolicy.max_extension_period_days ?? 0,
        activePolicy.noa_window_days ?? 30,
        today,
      ),
    }
  }, [firstDue, activePolicy, today])

  return (
    <div className="space-y-6">
      <PageHeader title={t('portal.overdues.title')} subtitle={t('portal.overdues.subtitle')} />

      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      {activePolicy && (
        <Card>
          <h2 className="text-sm font-semibold">{t('portal.overdues.fileTitle')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('portal.overdues.fileHint')}</p>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label={t('limits.fields.buyer')}>
              <Select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                <option value="">{t('portal.declarations.pickBuyer')}</option>
                {(buyers ?? []).map((b) => (
                  <option key={b.entity_id} value={b.entity_id}>
                    {b.entity_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('overdues.fields.firstDueDate')}>
              <Input type="date" value={firstDue} max={today} onChange={(e) => setFirstDue(e.target.value)} />
            </Field>
            <Field label={t('overdues.fields.overdueAmount')}>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Button
              disabled={!buyerId || !firstDue || !Number(amount)}
              onClick={() => {
                setError(null)
                void file
                  .mutateAsync({
                    policy_id: activePolicy.id,
                    entity_id: buyerId,
                    first_due_date: firstDue,
                    overdue_amount: Number(amount),
                  })
                  .then(() => {
                    setBuyerId('')
                    setFirstDue('')
                    setAmount('')
                  })
                  .catch((e: { message?: string }) =>
                    setError(e.message ?? t('common.somethingWentWrong')),
                  )
              }}
            >
              {t('portal.overdues.actions.file')}
            </Button>
          </div>

          {lateness && (
            <p
              className={`mt-3 rounded-md px-3 py-2 text-[13px] ${
                lateness.late
                  ? 'bg-neg-50 text-neg-500'
                  : 'bg-slate-50 text-slate-600'
              }`}
            >
              {lateness.late
                ? t('portal.overdues.lateWarning', { date: lateness.deadline })
                : t('portal.overdues.deadlineHint', { date: lateness.deadline })}
            </p>
          )}

          <p className="mt-3 rounded-md border border-warn-500/40 bg-warn-50 px-3 py-2 text-[13px] text-slate-700">
            {t('portal.overdues.suspensionWarning')}
          </p>
        </Card>
      )}

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : !overdues?.length ? (
        <EmptyState title={t('portal.overdues.empty')} hint={t('portal.overdues.emptyHint')} />
      ) : (
        <Card>
          <Table dense>
            <thead>
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th className="text-right">{t('overdues.fields.overdueAmount')}</th>
                <th className="text-right">{t('overdues.fields.daysPastDue')}</th>
                <th>{t('overdues.fields.reported')}</th>
                <th>{t('portal.overdues.cover')}</th>
                <th>{t('overdues.fields.status')}</th>
              </tr>
            </thead>
            <tbody>
              {overdues.map((n) => (
                <tr key={n.id}>
                  <td className="font-medium">{n.buyer_name}</td>
                  <td>
                    <span className="num block">
                      {formatAmount(Number(n.overdue_amount), locale)} {n.currency_code}
                    </span>
                  </td>
                  <td>
                    <span className="num block">{n.days_past_due}</span>
                  </td>
                  <td className="text-[13px]">
                    {n.reported_late ? (
                      <Badge tone="negStrong">{t('overdues.lateBy', { days: n.days_late })}</Badge>
                    ) : (
                      <span className="text-slate-500">
                        {formatMoment(n.reported_at, locale)}
                      </span>
                    )}
                  </td>
                  <td>
                    {n.limit_suspended ? (
                      <Badge tone="warn">{t('portal.overdues.suspended')}</Badge>
                    ) : (
                      <span className="text-[13px] text-slate-500">
                        {t('portal.overdues.noLimitAffected')}
                      </span>
                    )}
                  </td>
                  <td>
                    <Badge tone={n.status === 'open' ? 'warn' : 'neutral'}>
                      {t(`overdues.statuses.${n.status}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
