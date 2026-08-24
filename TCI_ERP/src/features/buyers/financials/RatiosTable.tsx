import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { EM_DASH, formatDays, formatPercent, formatRatio } from '../../../lib/format'
import { statementPeriodLabel } from '../types'
import type { StatementBundle } from '../types'
import { RATIO_DEFS, computeRatios } from './ratios'
import type { RatioSet } from './ratios'

const GROUPS = ['profitability', 'solvency', 'efficiency'] as const

export function RatiosTable({ displayed }: { displayed: StatementBundle[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const ratioSets: RatioSet[] = useMemo(
    () =>
      displayed.map((s) =>
        computeRatios(s.statement_kind, s.balance_sheets, s.income_statements),
      ),
    [displayed],
  )

  const anyAnnualized = ratioSets.some((set) =>
    Object.values(set).some((v) => v.annualized && v.value !== null),
  )

  const formatValue = (
    format: 'percent' | 'ratio' | 'days',
    value: number | null,
  ): string => {
    if (value === null) return EM_DASH
    if (format === 'percent') return formatPercent(value, locale)
    if (format === 'days') return formatDays(value, locale)
    return formatRatio(value, locale)
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-slate-200 [&>th]:bg-slate-50 [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium [&>th]:text-slate-500">
              <th className="text-left">{t('fin.ratioHeader')}</th>
              {displayed.map((s) => (
                <th key={s.id} className="border-l border-slate-200 text-right">
                  {statementPeriodLabel(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((group) => (
              <Fragment key={group}>
                <tr>
                  <td
                    colSpan={1 + displayed.length}
                    className="border-b border-slate-100 px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase"
                  >
                    {t(`fin.ratioGroups.${group}`)}
                  </td>
                </tr>
                {RATIO_DEFS.filter((def) => def.group === group).map((def) => (
                  <tr key={def.key}>
                    <td className="border-b border-slate-100 px-3 py-1.5 text-slate-700">
                      {t(`fin.ratios.${def.key}`)}
                    </td>
                    {displayed.map((s, idx) => {
                      const ratio = ratioSets[idx][def.key]
                      return (
                        <td key={s.id} className="border-b border-l border-slate-100 px-3 py-1.5">
                          <span className={`num block ${ratio.value !== null && ratio.value < 0 ? 'text-neg-500' : ''}`}>
                            {formatValue(def.format, ratio.value)}
                            {ratio.annualized && ratio.value !== null && (
                              <span className="text-slate-400">*</span>
                            )}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {anyAnnualized && (
        <p className="mt-2 text-xs text-slate-400">* {t('fin.annualizedFootnote')}</p>
      )}
    </div>
  )
}
