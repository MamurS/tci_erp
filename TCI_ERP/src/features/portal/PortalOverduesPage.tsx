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
  AmountInput,
  Badge,
  Button,
  Callout,
  Card,
  COL,
  Combobox,
  DateInput,
  EmptyState,
  Field,
  labelCol,
  LinkButton,
  PageHeader,
  parseAmount,
  SectionTitle,
  Spinner,
  Table,
  Truncate,
} from '../../components/ui'
import { usePageSearch } from '../../components/layout/usePageSearch'
import { formatAmount, formatDate, formatMoment } from '../../lib/format'
import { searchRows } from '../../lib/pageSearch'
import { isReportedLate, noaDeadline } from '../overdue/noa'
import {
  useClientDeclarableBuyers,
  useClientFileNoa,
  useClientOverdues,
  useMyPolicies,
} from './api'
import { PortalNoMatches, PortalSearch } from './PortalSearch'
import type { ClientPolicy } from './types'
import { refusalKey } from '../../lib/refusals'

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
  // An account can be reported only on a buyer with a credit limit in force
  // under the policy; with none the form says so and stays inactive.
  const noBuyers = buyers !== undefined && buyers.length === 0

  // The page search over the reported accounts (PortalSearch).
  const { query, setQuery } = usePageSearch('portal-overdues')
  const shown = searchRows(overdues ?? [], query, (n) => [
    n.buyer_name,
    n.overdue_amount,
    formatAmount(Number(n.overdue_amount), locale),
    n.currency_code,
    t(`overdues.statuses.${n.status}`),
    n.limit_suspended ? t('portal.overdues.suspended') : null,
  ])
  const buyerOptions = useMemo(
    () => (buyers ?? []).map((b) => ({ id: b.entity_id, label: b.entity_name })),
    [buyers],
  )

  const [buyerId, setBuyerId] = useState('')
  const [firstDue, setFirstDue] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const ready = Boolean(buyerId && firstDue && (parseAmount(amount) ?? 0) > 0)

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

      {error && <Callout tone="neg" title={error} />}

      {activePolicy && (
        <Card className="p-5">
          <SectionTitle className="mb-4" hint={t('portal.overdues.fileHint')}>
            {t('portal.overdues.fileTitle')}
          </SectionTitle>

          {noBuyers && (
            <div className="mb-4">
              <Callout
                tone="info"
                title={t('portal.overdues.noBuyers', { policy: activePolicy.policy_number })}
                action={
                  <LinkButton to="/portal/limits" variant="secondary" size="sm">
                    {t('portal.overdues.toLimits')}
                  </LinkButton>
                }
              />
            </div>
          )}
          <div className="grid items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            {/* The same search-as-you-type picker as every company picker
                in the system; the list opens on focus — a client's own
                buyers with a limit are a short list. */}
            <Field label={t('limits.fields.buyer')}>
              <Combobox
                value={buyerId || null}
                onChange={(id) => setBuyerId(id ?? '')}
                options={buyerOptions}
                openOnFocus
                disabled={noBuyers}
                placeholder={noBuyers ? t('portal.overdues.noBuyersOption') : t('portal.declarations.pickBuyer')}
              />
            </Field>
            <Field label={t('overdues.fields.firstDueDate')}>
              <DateInput value={firstDue} max={today} onChange={setFirstDue} disabled={noBuyers} />
            </Field>
            <Field label={t('overdues.fields.overdueAmount')}>
              <AmountInput value={amount} onChange={setAmount} suffix={activePolicy.currency_code} disabled={noBuyers} />
            </Field>
            <Button
              disabled={!ready}
              loading={file.isPending}
              title={ready ? undefined : t('portal.overdues.fillToFile')}
              onClick={() => {
                setError(null)
                void file
                  .mutateAsync({
                    policy_id: activePolicy.id,
                    entity_id: buyerId,
                    first_due_date: firstDue,
                    overdue_amount: parseAmount(amount) ?? 0,
                  })
                  .then(() => {
                    setBuyerId('')
                    setFirstDue('')
                    setAmount('')
                  })
                  .catch((e: unknown) => setError(t(refusalKey(e))))
              }}
            >
              {t('portal.overdues.actions.file')}
            </Button>
          </div>

          {/* What filing WILL do, said once the person is actually filing
              against a buyer — not as a standing alarm on an empty form. */}
          {(lateness || buyerId) && (
            <div className="mt-4 flex flex-col gap-3">
              {lateness && (
                <Callout
                  tone={lateness.late ? 'neg' : 'info'}
                  title={
                    lateness.late
                      ? t('portal.overdues.lateWarning', { date: formatDate(lateness.deadline, locale) })
                      : t('portal.overdues.deadlineHint', { date: formatDate(lateness.deadline, locale) })
                  }
                />
              )}
              {buyerId && (
                <Callout tone="warn" title={t('portal.overdues.suspensionTitle')}>
                  {t('portal.overdues.suspensionWarning')}
                </Callout>
              )}
            </div>
          )}
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle className="mb-3">{t('portal.overdues.listTitle')}</SectionTitle>
        {(overdues?.length ?? 0) > 0 && (
          <div className="mb-4">
            <PortalSearch query={query} onChange={setQuery} placeholder={t('portal.search.overdues')} />
          </div>
        )}
        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : !overdues?.length ? (
          <EmptyState title={t('portal.overdues.empty')} hint={t('portal.overdues.emptyHint')} />
        ) : !shown.length ? (
          <PortalNoMatches onClear={() => setQuery('')} />
        ) : (
          <Table
            columns={[COL.fill, COL.money, '7.5rem', COL.moment, labelCol('portalCover'), labelCol('overdueStatus')]}
            fillMin="5rem"
          >
            <thead>
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th className="num">{t('overdues.fields.overdueAmount')}</th>
                <th className="num">{t('overdues.fields.daysPastDue')}</th>
                <th>{t('overdues.fields.reported')}</th>
                <th>{t('portal.overdues.cover')}</th>
                <th>{t('overdues.fields.status')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((n) => (
                <tr key={n.id}>
                  <td className="font-medium">
                    <Truncate text={n.buyer_name} className="max-w-none" />
                  </td>
                  <td className="num">
                    {formatAmount(Number(n.overdue_amount), locale)} {n.currency_code}
                  </td>
                  <td className="num">{n.days_past_due}</td>
                  <td className="whitespace-nowrap text-small">
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
                      <span className="text-small text-slate-500">
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
        )}
      </Card>
    </div>
  )
}
