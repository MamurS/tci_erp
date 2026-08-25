/** Risk analysis view (legacy «Анализ рисков» style): rows per indicator,
 * one value column per period plus a Δ "change" column (blue positive, red
 * negative). Norm breaches render red, compliant values green. */

import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, EmptyState } from '../../../components/ui'
import { EM_DASH, formatAmount, formatDays, formatPercent, formatRatio } from '../../../lib/format'
import { statementPeriodLabel } from '../types'
import { RISK_ROWS } from './risk'
import type { RiskPeriod, RiskRowDef } from './risk'

function formatValue(row: RiskRowDef, value: number | null, locale: string): string {
  if (value === null) return EM_DASH
  switch (row.format) {
    case 'amount':
      return formatAmount(value, locale)
    case 'percent':
      return formatPercent(value, locale)
    case 'days':
      return formatDays(value, locale)
    case 'score':
      return formatRatio(value, locale)
    default:
      return formatRatio(value, locale)
  }
}

function normLabel(row: RiskRowDef): string | null {
  if (!row.norm) return null
  if (row.norm.min !== undefined) return `> ${row.norm.min}`
  if (row.norm.max !== undefined) return `< ${row.norm.max}`
  return null
}

const BAND_TONE: Record<string, 'pos' | 'warn' | 'neg'> = {
  safe: 'pos',
  grey: 'warn',
  distress: 'neg',
}

export function RiskTable({ periods }: { periods: RiskPeriod[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  if (!periods.length) {
    return <EmptyState title={t('fin.noStatements')} hint={t('fin.noStatementsHint')} />
  }

  /** Δ vs the previous displayed period of the same report_type. */
  const deltaFor = (idx: number, key: string): number | null => {
    const current = periods[idx]
    for (let i = idx - 1; i >= 0; i--) {
      if (periods[i].statement.report_type === current.statement.report_type) {
        const prev = periods[i].values[key]
        const cur = current.values[key]
        if (prev === null || cur === null) return null
        return cur - prev
      }
    }
    return null
  }

  const grouped: { group: string | null; rows: RiskRowDef[] }[] = []
  for (const row of RISK_ROWS) {
    const last = grouped[grouped.length - 1]
    if (last && last.group === row.group) last.rows.push(row)
    else grouped.push({ group: row.group, rows: [row] })
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-slate-200 [&>th]:bg-slate-50 [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium [&>th]:text-slate-500">
            <th className="sticky left-0 z-10 min-w-56 bg-slate-50 text-left">
              {t('fin.risk.header')}
            </th>
            {periods.map((period) => (
              <Fragment key={period.statement.id}>
                <th className="border-l border-slate-200 text-right">
                  {statementPeriodLabel(period.statement)}
                </th>
                <th className="text-right text-xs font-normal text-slate-400">
                  {t('fin.risk.change')}
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {grouped.map(({ group, rows }) => (
            <Fragment key={group ?? 'top'}>
              {group && (
                <tr>
                  <td
                    colSpan={1 + periods.length * 2}
                    className="border-b border-slate-100 bg-white px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase"
                  >
                    {t(`fin.risk.groups.${group}`)}
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const norm = normLabel(row)
                return (
                  <tr key={row.key}>
                    <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 text-slate-700">
                      {t(`fin.risk.rows.${row.key}`)}
                      {norm && (
                        <span className="ml-1 text-xs text-slate-400">
                          ({t('fin.risk.norm')} {norm})
                        </span>
                      )}
                    </td>
                    {periods.map((period, idx) => {
                      const value = period.values[row.key]
                      const breach = period.breaches[row.key]
                      const meets = !breach && row.norm && value !== null
                      const delta = deltaFor(idx, row.key)
                      return (
                        <Fragment key={period.statement.id}>
                          <td
                            className={`border-b border-l border-slate-100 px-3 py-1.5 ${
                              breach ? 'bg-neg-50' : meets ? 'bg-pos-50' : ''
                            }`}
                          >
                            <span
                              className={`num block ${
                                breach
                                  ? 'text-neg-500'
                                  : value !== null && value < 0 && row.format === 'amount'
                                    ? 'text-neg-500'
                                    : ''
                              }`}
                            >
                              {formatValue(row, value, locale)}
                              {row.key === 'z_score' && period.zBand && (
                                <span className="ml-1.5">
                                  <Badge tone={BAND_TONE[period.zBand]}>
                                    {t(`fin.risk.bands.${period.zBand}`)}
                                  </Badge>
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-1.5">
                            {delta === null ? (
                              <span className="num block text-slate-300">{EM_DASH}</span>
                            ) : (
                              <span
                                className={`num block ${delta > 0 ? 'text-accent-600' : delta < 0 ? 'text-neg-500' : 'text-slate-400'}`}
                              >
                                {formatValue(row, delta, locale)}
                              </span>
                            )}
                          </td>
                        </Fragment>
                      )
                    })}
                  </tr>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
