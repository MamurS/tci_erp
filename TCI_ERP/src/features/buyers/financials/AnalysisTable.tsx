/**
 * Generic 3-period analysis table for balance sheet and P&L.
 *
 * Per period: Amount | % of base (vertical) | Δ% (horizontal). The Δ%
 * sub-column is not rendered when a period has no comparison base. Lines
 * where all displayed periods are null are hidden by default.
 */

import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { statementPeriodLabel } from '../types'
import type { StatementBundle } from '../types'
import type { PeriodColumn } from './analysis'
import { relativeChange, verticalShare } from './analysis'
import { AmountCell, DeltaCell, ShareCell } from './cells'
import type { LineDef, SectionDef } from './lines'

type Values = Partial<Record<string, number | null>> | null

interface AnalysisTableProps<K extends string> {
  columns: PeriodColumn[]
  sections: SectionDef<K>[]
  getValues: (statement: StatementBundle) => Values
  /** Which line of the same statement is the vertical-analysis base. */
  verticalBaseFor: (key: K) => string
  /** stock: label "Δ%"; like_for_like: label "Δ% vs <base period>". */
  deltaMode: 'stock' | 'like_for_like'
}

export function AnalysisTable<K extends string>({
  columns,
  sections,
  getValues,
  verticalBaseFor,
  deltaMode,
}: AnalysisTableProps<K>) {
  const { t } = useTranslation()
  const [showEmpty, setShowEmpty] = useState(false)

  const valueOf = (statement: StatementBundle | null, key: K): number | null => {
    if (!statement) return null
    return (getValues(statement)?.[key] as number | null | undefined) ?? null
  }

  const isLineEmpty = (line: LineDef<K>): boolean =>
    columns.every((col) => valueOf(col.statement, line.key) === null)

  const rowClasses = (line: LineDef<K>): string => {
    if (line.level === 'grand') return 'font-semibold [&>td]:border-t [&>td]:border-slate-300 bg-slate-50'
    if (line.level === 'subtotal') return 'font-medium bg-slate-50'
    return ''
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-slate-500">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
            className="accent-accent-600"
          />
          {t('fin.showEmptyLines')}
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-slate-200 [&>th]:bg-slate-50 [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium [&>th]:text-slate-500">
              <th className="sticky left-0 z-10 min-w-64 bg-slate-50 text-left">{t('fin.lineHeader')}</th>
              {columns.map((col) => (
                <th
                  key={col.statement.id}
                  colSpan={col.deltaBaseLabel ? 3 : 2}
                  className="border-l border-slate-200 text-center"
                  title={t(`fin.periodTooltip.${col.statement.statement_kind}`, {
                    year: col.statement.fiscal_year,
                    quarter: col.statement.fiscal_quarter,
                  })}
                >
                  {statementPeriodLabel(col.statement)}
                  <span className="ml-1.5 font-normal text-slate-400">
                    {col.statement.currency_code} · {t(`fin.unitsShort.${col.statement.unit}`)}
                  </span>
                </th>
              ))}
            </tr>
            <tr className="[&>th]:border-b [&>th]:border-slate-200 [&>th]:bg-slate-50 [&>th]:px-3 [&>th]:py-1.5 [&>th]:text-right [&>th]:text-xs [&>th]:font-normal [&>th]:text-slate-400">
              <th />
              {columns.map((col) => (
                <Fragment key={col.statement.id}>
                  <th className="border-l border-slate-200">{t('fin.amount')}</th>
                  <th>{t('fin.shareOfBase')}</th>
                  {col.deltaBaseLabel && (
                    <th>
                      {deltaMode === 'like_for_like'
                        ? t('fin.deltaVs', { period: col.deltaBaseLabel })
                        : 'Δ%'}
                    </th>
                  )}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              const visible = section.lines.filter((line) => showEmpty || !isLineEmpty(line))
              if (visible.length === 0) return null
              return (
                <Fragment key={section.sectionKey}>
                  <tr>
                    <td
                      colSpan={1 + columns.reduce((n, c) => n + (c.deltaBaseLabel ? 3 : 2), 0)}
                      className="border-b border-slate-100 bg-white px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase"
                    >
                      {t(`fin.sections.${section.sectionKey}`)}
                    </td>
                  </tr>
                  {visible.map((line) => (
                    <tr key={line.key} className={rowClasses(line)}>
                      <td
                        className={`sticky left-0 z-10 border-b border-slate-100 px-3 py-1.5 text-slate-700 ${
                          line.level === 'line' ? 'bg-white' : 'bg-slate-50'
                        }`}
                      >
                        {t(`fin.lines.${line.key}`)}
                      </td>
                      {columns.map((col) => {
                        const value = valueOf(col.statement, line.key)
                        const base = valueOf(
                          col.statement,
                          verticalBaseFor(line.key) as K,
                        )
                        // Δ% from ORIGINAL statement-currency values (deltaCurrent),
                        // never from converted levels.
                        const deltaValue = valueOf(col.deltaCurrent, line.key)
                        const deltaBaseValue = col.deltaBase
                          ? valueOf(col.deltaBase, line.key)
                          : null
                        return (
                          <Fragment key={col.statement.id}>
                            <td className="border-b border-l border-slate-100 px-3 py-1.5">
                              <AmountCell value={value} />
                            </td>
                            <td className="border-b border-slate-100 px-3 py-1.5">
                              <ShareCell value={verticalShare(value, base)} />
                            </td>
                            {col.deltaBaseLabel && (
                              <td className="border-b border-slate-100 px-3 py-1.5">
                                <DeltaCell
                                  value={relativeChange(deltaValue, deltaBaseValue)}
                                  direction={line.direction}
                                />
                              </td>
                            )}
                          </Fragment>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
