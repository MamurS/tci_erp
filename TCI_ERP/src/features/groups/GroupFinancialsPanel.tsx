/** The combined financial picture.
 *
 * A SIMPLE SUM of the latest statements of the members we hold statements for.
 * NOT an IFRS consolidation: there are no intra-group eliminations, so
 * inter-company revenue and balances are counted twice, and the currencies are
 * added as reported. The screen says all of that rather than implying a
 * precision that is not there, and how many members are missing is part of the
 * answer, not a footnote.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Card, Segmented, Table } from '../../components/ui'
import { formatAmount } from '../../lib/format'
import { rankMembers, type RankableFigure } from './group'
import type { GroupFinancials, GroupMemberFinancials } from './types'

const RANKABLE: RankableFigure[] = [
  'revenue',
  'net_profit',
  'total_non_current_assets',
  'gross_debt',
]

interface GroupFinancialsPanelProps {
  totals: GroupFinancials | null
  members: GroupMemberFinancials[]
}

export function GroupFinancialsPanel({ totals, members }: GroupFinancialsPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [rankBy, setRankBy] = useState<RankableFigure>('revenue')

  const ranked = rankMembers(members, rankBy)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{t('groups.financials.title')}</h3>
        <p className="mt-1 text-[13px] text-slate-500">{t('groups.financials.simpleSum')}</p>
      </div>

      {!totals || totals.members_with_statements === 0 ? (
        <p className="text-[13px] text-slate-500">{t('groups.financials.empty')}</p>
      ) : (
        <>
          {totals.members_missing_statements > 0 && (
            <p className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
              {t('groups.financials.missing', {
                missing: totals.members_missing_statements,
                total: totals.members_total,
              })}
            </p>
          )}
          {totals.currencies > 1 && (
            <p className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
              {t('groups.financials.mixedCurrencies', { count: totals.currencies })}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Figure label={t('groups.financials.revenue')} value={totals.revenue} locale={locale} />
            <Figure
              label={t('groups.financials.netProfit')}
              value={totals.net_profit}
              locale={locale}
            />
            <Figure
              label={t('groups.financials.totalAssets')}
              value={totals.total_assets}
              locale={locale}
            />
            <Figure
              label={t('groups.financials.totalEquity')}
              value={totals.total_equity}
              locale={locale}
            />
            <Figure
              label={t('groups.financials.longTermAssets')}
              value={totals.long_term_assets}
              locale={locale}
            />
            <Figure
              label={t('groups.financials.grossDebt')}
              value={totals.gross_debt}
              locale={locale}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-slate-500">{t('groups.financials.rankBy')}</span>
            <Segmented
              value={rankBy}
              onChange={(key) => setRankBy(key as RankableFigure)}
              ariaLabel={t('groups.financials.rankBy')}
              options={RANKABLE.map((f) => ({ key: f, label: t(`groups.financials.${camel(f)}`) }))}
            />
          </div>

          <Table dense>
            <thead>
              <tr>
                <th className="text-left">{t('groups.members.company')}</th>
                <th className="text-right">{t('groups.financials.fiscalYear')}</th>
                <th className="text-left">{t('groups.fields.currency')}</th>
                <th className="text-right">{t(`groups.financials.${camel(rankBy)}`)}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((m) => (
                <tr key={m.member_id}>
                  <td>
                    <Link to={`/entities/${m.member_id}`} className="text-accent-700 hover:underline">
                      {m.member_name}
                    </Link>
                  </td>
                  <td className="num text-right">{m.fiscal_year}</td>
                  <td>{m.currency_code}</td>
                  <td className="num text-right">
                    {formatAmount(Number(m[rankBy]), locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Card>
  )
}

/** The view's snake_case column names map to the i18n keys used above. */
function camel(figure: RankableFigure): string {
  return figure.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function Figure({
  label,
  value,
  locale,
}: {
  label: string
  value: number | null
  locale: string
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="text-[12px] text-slate-500">{label}</p>
      {/* Null is "—", never 0: absent is not nil (DESIGN.md). */}
      <p className="num mt-0.5 text-sm font-semibold text-slate-900">
        {value === null || value === undefined ? '—' : formatAmount(Number(value), locale)}
      </p>
    </div>
  )
}
