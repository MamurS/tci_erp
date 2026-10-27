/**
 * «Действующие лимиты» — every in-force credit limit (tci.v_credit_portfolio:
 * the effective approved / partial decision on a bound policy), filterable by
 * buyer, policy, the buyer's current band, country and currency, with the
 * total in UZS. A limit in a currency with no rate is counted, never zero.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Card,
  COL,
  EmptyState,
  Highlight,
  KeyFigures,
  labelCol,
  SkeletonRows,
  Table,
  TableSettings,
  Truncate,
  ViewBar,
} from '../../../components/ui'
import { EM_DASH, formatAmount, formatCompact, formatDays } from '../../../lib/format'
import { num } from '../../portfolio/aggregate'
import { useCreditPortfolio } from '../../portfolio/api'
import { useCountryName } from '../../portfolio/useCountryName'
import { useSystemDecisionMarks } from '../adtApi'
import { uzsTotal } from './model'
import { usePageSearch } from '../../../components/layout/usePageSearch'
import { searchRows } from '../../../lib/pageSearch'
import { BandBadge, EntityLink, Uzs } from './parts'

export function InForceView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const countryName = useCountryName()
  const { data, isLoading } = useCreditPortfolio()
  // «Авторешение (ADT)» under the amount of a limit no person decided.
  const { data: marks } = useSystemDecisionMarks()
  // The one search (top bar, lib/pageSearch.ts): buyer, policy,
  // policyholder, rating band, country, currency — in order.
  const { query } = usePageSearch('limits')

  const all = useMemo(() => data ?? [], [data])
  const rows = useMemo(
    () =>
      searchRows(all, query, (r) => [
        r.buyer_name,
        r.policy_number,
        r.policyholder_name,
        r.current_band,
        r.current_band ? t(`limits.bands.${r.current_band}`) : null,
        r.buyer_country,
        r.buyer_country ? countryName(r.buyer_country) : null,
        r.currency_code,
      ]),
    [all, query, t, countryName],
  )
  const total = uzsTotal(rows)
  const buyers = new Set(rows.map((r) => r.buyer_entity_id)).size

  // Buyer + country and policy + policyholder share a cell each (a second,
  // smaller line), the names cut with an ellipsis: eleven limits used to wrap
  // onto three lines a row. Payment terms were «—» on almost every row, so
  // they sit under the amount when set.
  // The review column holds its header's longest word («CHIQISHGACHA»).
  const columns = [COL.fill, COL.fill, COL.money, COL.amount, labelCol('limitBand'), '8.5rem']
  const columnLabels = [
    t('limits.fields.buyer'),
    t('limits.fields.policyAndPolicyholder'),
    t('limits.fields.approvedAmount'),
    t('portfolio.credit.exposure'),
    t('portfolio.credit.rating'),
    t('limits.workbench.inforce.review'),
  ]
  const tableHead = (
    <thead>
      <tr>
        <th>{columnLabels[0]}</th>
        <th>{columnLabels[1]}</th>
        <th className="num">{columnLabels[2]}</th>
        <th className="num">{columnLabels[3]}</th>
        <th>{columnLabels[4]}</th>
        <th className="num">{columnLabels[5]}</th>
      </tr>
    </thead>
  )

  return (
    <div>
      <ViewBar hint={t('limits.workbench.inforce.subtitle')} />

      {isLoading ? (
        // Rows in their place while the register loads, never a spinner.
        <Table id="limits-inforce" columns={columns}>
          {tableHead}
          <tbody>
            <SkeletonRows columns={columns.length} />
          </tbody>
        </Table>
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

          <div className="flex justify-end">
            <TableSettings table="limits-inforce" columns={columnLabels} />
          </div>

          {!rows.length ? (
            <Card className="p-6">
              <EmptyState title={t('limits.workbench.inforce.noMatch')} hint={t('limits.workbench.inforce.noMatchHint')} />
            </Card>
          ) : (
            // A registry (Table v2): the person's row density and columns, a
            // head that stays in view, the buyer column frozen.
            <Table id="limits-inforce" columns={columns} stickyHead freezeFirst>
              {tableHead}
              <tbody>
                {rows.map((r) => (
                  <tr key={r.decision_id}>
                    <td>
                      <Truncate text={r.buyer_name} className="max-w-none">
                        <EntityLink id={r.buyer_entity_id} name={r.buyer_name} tab="limits">
                          <Highlight text={r.buyer_name} query={query} />
                        </EntityLink>
                      </Truncate>
                      <Truncate text={countryName(r.buyer_country)} className="max-w-none text-caption text-slate-500">
                        {countryName(r.buyer_country)}
                      </Truncate>
                    </td>
                    <td>
                      <Link to={`/limits/${r.request_id}`} className="block whitespace-nowrap text-accent-600 hover:text-accent-500">
                        <Highlight text={r.policy_number} query={query} />
                      </Link>
                      <Truncate text={r.policyholder_name} className="max-w-none text-caption text-slate-500">
                        <Highlight text={r.policyholder_name} query={query} />
                      </Truncate>
                    </td>
                    <td className="num">
                      {formatAmount(num(r.approved_amount), locale)} {r.currency_code}
                      {r.payment_terms_days != null && (
                        <span className="block text-caption text-slate-500" title={t('limits.fields.paymentTerms')}>
                          {t('limits.workbench.inforce.terms', {
                            terms: t('policies.terms.days', { count: r.payment_terms_days }),
                          })}
                        </span>
                      )}
                      {marks?.get(r.decision_id) && (
                        <span className="block text-caption text-accent-600">{t(marks.get(r.decision_id) as string)}</span>
                      )}
                    </td>
                    <td className="num">
                      <Uzs value={r.amount_uzs} />
                    </td>
                    <td>
                      <BandBadge band={r.current_band} grade={r.current_grade} />
                    </td>
                    <td
                      className={`num ${
                        r.days_to_review !== null && r.days_to_review < 0 ? 'font-semibold text-neg-500' : ''
                      }`}
                      title={
                        r.days_to_review !== null && r.days_to_review < 0
                          ? t('limits.workbench.monitoring.overdueHint')
                          : undefined
                      }
                    >
                      {r.days_to_review === null ? (
                        <span className="text-slate-500" title={t('limits.noReviewDate')}>
                          {EM_DASH}
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
