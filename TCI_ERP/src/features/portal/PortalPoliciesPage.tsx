/** «Мои полисы» — the cover the policyholder actually has, and the wording
 * terms behind it. Read-only by construction: there is no write path for a
 * policy in the portal at all. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, PageHeader, Spinner, Table } from '../../components/ui'
import { EM_DASH, formatAmount, formatDays, formatPercent } from '../../lib/format'
import { useMyPolicies } from './api'
import type { ClientPolicy } from './types'

export function PortalPoliciesPage() {
  const { t, i18n } = useTranslation()
  const { data: policies, isLoading, isError } = useMyPolicies()
  const [openId, setOpenId] = useState<string | null>(null)

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div>
      <PageHeader title={t('portal.policies.title')} subtitle={t('portal.policies.subtitle')} />

      {isError && (
        <div
          className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500"
          role="alert"
        >
          {t('portal.loadFailed')}
        </div>
      )}

      {!policies?.length ? (
        <EmptyState
          title={t('portal.policies.empty')}
          hint={t('portal.policies.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {policies.map((policy) => (
            <Card key={policy.id} className="p-5">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                onClick={() => setOpenId(openId === policy.id ? null : policy.id)}
                aria-expanded={openId === policy.id}
              >
                <span className="flex flex-wrap items-center gap-3">
                  <span className="num text-base font-semibold text-slate-900">
                    {policy.policy_number}
                  </span>
                  <Badge tone={policy.status === 'active' ? 'pos' : 'neutral'}>
                    {t(`policies.statuses.${policy.status}`)}
                  </Badge>
                  <span className="text-[13px] text-slate-500">
                    {policy.inception_date} — {policy.expiry_date}
                  </span>
                </span>
                <span className="text-[13px] font-medium text-accent-700">
                  {openId === policy.id ? t('portal.hideTerms') : t('portal.showTerms')}
                </span>
              </button>

              {openId === policy.id && <TermsTable policy={policy} locale={i18n.language} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function TermsTable({ policy, locale }: { policy: ClientPolicy; locale: string }) {
  const { t } = useTranslation()
  const ccy = policy.currency_code

  const money = (v: number | null) =>
    v === null ? EM_DASH : `${formatAmount(v, locale)} ${ccy}`

  const rows: [string, string][] = [
    ['product_structure',
      policy.product_structure
        ? t(`policies.structures.${policy.product_structure}`)
        : EM_DASH],
    ['currency_code', ccy],
    ['insured_percentage',
      policy.insured_percentage === null
        ? EM_DASH
        : formatPercent(policy.insured_percentage / 100, locale)],
    ['premium_rate_pct',
      policy.premium_rate_pct === null
        ? EM_DASH
        : formatPercent(policy.premium_rate_pct / 100, locale, 3)],
    ['minimum_premium', money(policy.minimum_premium)],
    ['max_liability_amount',
      policy.max_liability_amount !== null
        ? money(policy.max_liability_amount)
        : policy.max_liability_premium_multiple !== null
          ? t('portal.policies.premiumMultiple', {
              value: formatAmount(policy.max_liability_premium_multiple, locale, 1),
            })
          : EM_DASH],
    ['discretionary_limit', money(policy.discretionary_limit)],
    ['nql_amount', money(policy.nql_amount)],
    ['deductible_each_loss', money(policy.deductible_each_loss)],
    ['aggregate_first_loss', money(policy.aggregate_first_loss)],
    ['waiting_period_days',
      policy.waiting_period_days === null
        ? EM_DASH
        : t('portal.days', { count: policy.waiting_period_days,
                             value: formatDays(policy.waiting_period_days, locale) })],
    ['max_extension_period_days',
      policy.max_extension_period_days === null
        ? EM_DASH
        : t('portal.days', { count: policy.max_extension_period_days,
                             value: formatDays(policy.max_extension_period_days, locale) })],
    ['max_payment_terms_days',
      policy.max_payment_terms_days === null
        ? EM_DASH
        : t('portal.days', { count: policy.max_payment_terms_days,
                             value: formatDays(policy.max_payment_terms_days, locale) })],
    ['declaration_frequency',
      policy.declaration_frequency
        ? t(`policies.frequencies.${policy.declaration_frequency}`)
        : EM_DASH],
  ]

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <Table dense>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key}>
              <td className="w-1/2 text-slate-500">{t(`requests.terms.${key}`)}</td>
              <td className="num text-right font-medium text-slate-900">{value}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
