/**
 * Premium instalments in triage: one, or the several a collapsed row holds,
 * as a compact table — policy, policyholder, instalment, due date, amount,
 * lateness — with their total in UZS by the board's own rule (sumUzs over
 * latestUzsRate); an amount without a rate is counted and said, never 0.
 */

import { useTranslation } from 'react-i18next'

import { Truncate } from '../../../components/ui'
import { todayIso } from '../../../components/ui/dateEntry'
import { EM_DASH, formatAmount, formatDate } from '../../../lib/format'
import { useUzsRates } from '../../declarations/api'
import { latestUzsRate } from '../../limits/authority'
import { policyIdOf } from '../api'
import type { TaskSubjects } from '../api'
import { amountOf, dueState, sumUzs } from '../board'
import type { AgendaRow } from '../board'
import { itemMoney } from '../rowText'
import { Muted, Section } from './parts'

export function PremiumBody({ row, now, subjects }: { row: AgendaRow; now: Date; subjects: TaskSubjects | undefined }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const currencies = row.items.map((item) => amountOf(item)?.currency).filter((c): c is string => Boolean(c))
  const { data: rates, isLoading } = useUzsRates(currencies)
  const total = sumUzs([row], (ccy) => latestUzsRate(rates ?? [], ccy, todayIso()))
  const overdue = row.displayType === 'instalment_overdue'

  return (
    <Section title={t('agenda.triage.premium.title')}>
      {/* A compact table in the Agenda's sub-table style rather than the
          page Table: the panel is narrow, and five columns at page padding
          would scroll sideways. */}
      <div className="overflow-hidden rounded-md border border-slate-200">
        <table className="w-full text-small">
          <thead className="bg-slate-50 text-caption font-semibold tracking-wide text-slate-600 uppercase">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2 text-left">
                {t('agenda.triage.premium.policy')} · {t('agenda.triage.premium.policyholder')}
              </th>
              <th className="px-3 py-2 text-right">{t('agenda.triage.premium.instalment')}</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">{t('agenda.triage.premium.due')}</th>
              <th className="px-3 py-2 text-right">{t('agenda.triage.premium.amount')}</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">
                {overdue ? t('agenda.triage.premium.late') : t('agenda.triage.premium.dueIn')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {row.items.map((item) => {
              const p = item.params ?? {}
              const policyId = policyIdOf(item)
              const policy = policyId ? subjects?.policies[policyId] : undefined
              const number = policy?.number ?? (typeof p.policy_number === 'string' ? p.policy_number : null)
              const state = dueState(item.due_at, now)
              return (
                <tr key={item.id}>
                  <td className="w-full max-w-0 px-3 py-2">
                    <span className="block font-medium whitespace-nowrap text-slate-900 tabular-nums">{number ?? EM_DASH}</span>
                    <Truncate text={policy?.holder ?? EM_DASH} className="max-w-full text-small text-slate-600" />
                  </td>
                  <td className="px-3 py-2 text-right text-slate-800 tabular-nums">{String(p.sequence ?? EM_DASH)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-800 tabular-nums">
                    {typeof p.due_date === 'string' ? formatDate(p.due_date, locale) : EM_DASH}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-slate-900 tabular-nums">{itemMoney(item, locale) ?? EM_DASH}</td>
                  <td
                    className={`px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums ${
                      state.kind === 'overdue' ? 'text-neg-600' : 'text-slate-700'
                    }`}
                  >
                    {state.kind === 'overdue'
                      ? t('agenda.due.days', { count: state.days })
                      : state.kind === 'today'
                        ? t('agenda.due.today')
                        : state.kind === 'future'
                          ? t('agenda.due.inDays', { count: state.days })
                          : EM_DASH}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-body text-slate-800 tabular-nums">
        <span className="text-slate-600">{t('agenda.triage.premium.total')} </span>
        <span className="font-semibold">
          {isLoading || total.uzs === null ? EM_DASH : `${formatAmount(total.uzs, locale)} UZS`}
        </span>
      </p>
      {!isLoading && total.missingRates > 0 && (
        <Muted className="mt-1">{t('agenda.triage.missingRates', { count: total.missingRates })}</Muted>
      )}
    </Section>
  )
}
