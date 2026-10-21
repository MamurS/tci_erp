/**
 * «Действующие лимиты» — every in-force credit limit (tci.v_credit_portfolio:
 * the effective approved / partial decision on a bound policy), filterable by
 * buyer, policy, the buyer's current band, country and currency, with the
 * total in UZS. A limit in a currency with no rate is counted, never zero.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Card, EmptyState, Input, KeyFigures, ViewBar, Select, Spinner, Table } from '../../../components/ui'
import { formatAmount, formatCompact, formatDays } from '../../../lib/format'
import { GRADE_BANDS, num } from '../../portfolio/aggregate'
import { useCreditPortfolio } from '../../portfolio/api'
import { useCountryName } from '../../portfolio/useCountryName'
import { filterInForce, uzsTotal } from './model'
import { BandBadge, EntityLink, Uzs } from './parts'

export function InForceView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const countryName = useCountryName()
  const { data, isLoading } = useCreditPortfolio()
  const [query, setQuery] = useState('')
  const [band, setBand] = useState('')
  const [country, setCountry] = useState('')
  const [currency, setCurrency] = useState('')

  const all = useMemo(() => data ?? [], [data])
  const rows = useMemo(
    () => filterInForce(all, { query, band, country, currency }),
    [all, query, band, country, currency],
  )
  const total = uzsTotal(rows)
  const countries = [...new Set(all.map((r) => r.buyer_country).filter((c): c is string => Boolean(c)))].sort()
  const currencies = [...new Set(all.map((r) => r.currency_code))].sort()
  const buyers = new Set(rows.map((r) => r.buyer_entity_id)).size

  return (
    <div>
      <ViewBar hint={t('limits.workbench.inforce.subtitle')} />

      {isLoading ? (
        <Spinner />
      ) : !all.length ? (
        <Card className="p-6">
          <EmptyState title={t('portfolio.credit.empty')} hint={t('portfolio.credit.emptyHint')} />
        </Card>
      ) : (
        <div className="grid gap-4">
          <KeyFigures
            className=""
            items={[
              { label: t('portfolio.credit.limits'), value: formatAmount(rows.length, locale) },
              { label: t('portfolio.credit.buyers'), value: formatAmount(buyers, locale) },
              {
                label: t('portfolio.credit.exposure'),
                value: `${formatCompact(total.uzs, locale)} UZS`,
                meta: total.missing > 0 ? t('portfolio.credit.exposureMissing', { count: total.missing }) : undefined,
              },
            ]}
          />

          <div className="flex flex-wrap gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('limits.searchPlaceholder')}
              className="max-w-xs"
              aria-label={t('limits.searchPlaceholder')}
            />
            <Select value={band} onChange={(e) => setBand(e.target.value)} className="max-w-44" aria-label={t('portfolio.credit.band')}>
              <option value="">{t('limits.workbench.inforce.allBands')}</option>
              {GRADE_BANDS.map((b) => (
                <option key={b} value={b}>
                  {t(`limits.bands.${b}`)}
                </option>
              ))}
            </Select>
            <Select value={country} onChange={(e) => setCountry(e.target.value)} className="max-w-52" aria-label={t('portfolio.credit.country')}>
              <option value="">{t('limits.workbench.inforce.allCountries')}</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
            </Select>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="max-w-36" aria-label={t('policies.fields.currency')}>
              <option value="">{t('limits.workbench.inforce.allCurrencies')}</option>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>

          {!rows.length ? (
            <Card className="p-6">
              <EmptyState title={t('limits.workbench.inforce.noMatch')} hint={t('limits.workbench.inforce.noMatchHint')} />
            </Card>
          ) : (
            <Table dense>
              <thead>
                <tr>
                  <th>{t('limits.fields.buyer')}</th>
                  <th>{t('portfolio.credit.country')}</th>
                  <th>{t('policies.fields.policyNumber')}</th>
                  <th>{t('policies.fields.policyholder')}</th>
                  <th className="text-right">{t('limits.fields.approvedAmount')}</th>
                  <th className="text-right">{t('portfolio.credit.exposure')}</th>
                  <th className="text-right">{t('limits.fields.paymentTerms')}</th>
                  <th>{t('portfolio.credit.rating')}</th>
                  <th className="text-right">{t('limits.workbench.inforce.review')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.decision_id}>
                    <td>
                      <EntityLink id={r.buyer_entity_id} name={r.buyer_name} tab="limits" />
                    </td>
                    <td className="text-slate-600">{countryName(r.buyer_country)}</td>
                    <td className="whitespace-nowrap">
                      <Link to={`/limits/${r.request_id}`} className="text-accent-600 hover:text-accent-500">
                        {r.policy_number}
                      </Link>
                    </td>
                    <td className="text-slate-600">{r.policyholder_name}</td>
                    <td className="num text-right whitespace-nowrap">
                      {formatAmount(num(r.approved_amount), locale)} {r.currency_code}
                    </td>
                    <td className="num text-right">
                      <Uzs value={r.amount_uzs} />
                    </td>
                    <td className="num text-right">
                      {formatDays(r.payment_terms_days, locale)}
                    </td>
                    <td>
                      <BandBadge band={r.current_band} grade={r.current_grade} />
                    </td>
                    <td
                      className={`num text-right ${
                        r.days_to_review !== null && r.days_to_review < 0 ? 'font-semibold text-neg-500' : ''
                      }`}
                    >
                      {r.days_to_review === null ? (
                        <span className="text-slate-400" title={t('limits.noReviewDate')}>
                          —
                        </span>
                      ) : (
                        formatDays(r.days_to_review, locale)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </div>
  )
}
