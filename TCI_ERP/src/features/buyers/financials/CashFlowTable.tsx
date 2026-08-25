/** Derived cash flow statement view (indirect method), legacy-style layout:
 * three sections with subtotal rows, one column per period pair, "OK" badge
 * when the reconciliation passes. */

import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, EmptyState } from '../../../components/ui'
import { EM_DASH, formatAmount } from '../../../lib/format'
import { statementPeriodLabel } from '../types'
import type { CashFlowColumn, CashFlowLine, CashFlowSection } from './cashflow'
import { hasPersistentNegativeCfo } from './cashflow'

function Amount({ value, locale }: { value: number; locale: string }) {
  return (
    <span className={`num block ${value < 0 ? 'text-neg-500' : ''}`}>
      {formatAmount(value, locale)}
    </span>
  )
}

const SECTIONS: { key: CashFlowSection; subtotalKey: 'cfo' | 'cfi' | 'cff' }[] = [
  { key: 'operating', subtotalKey: 'cfo' },
  { key: 'investing', subtotalKey: 'cfi' },
  { key: 'financing', subtotalKey: 'cff' },
]

export function CashFlowTable({ columns }: { columns: CashFlowColumn[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  if (!columns.length) {
    return <EmptyState title={t('fin.cashflow.needsPair')} hint={t('fin.cashflow.needsPairHint')} />
  }

  // Union of line keys per section (all columns share the same shape).
  const linesOf = (section: CashFlowSection): string[] =>
    columns[0][section].map((l: CashFlowLine) => l.key)

  const lineOf = (
    column: CashFlowColumn,
    section: CashFlowSection,
    key: string,
  ): CashFlowLine | undefined => column[section].find((l) => l.key === key)

  return (
    <div>
      {hasPersistentNegativeCfo(columns) && (
        <div className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] font-medium text-neg-500">
          {t('fin.cashflow.negativeCfoWarning')}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-slate-200 [&>th]:bg-slate-50 [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium [&>th]:text-slate-500">
              <th className="sticky left-0 z-10 bg-slate-50 text-left">
                {t('fin.cashflow.header')}
              </th>
              {columns.map((column) => (
                <th key={column.statement.id} className="border-l border-slate-200 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span title={`${statementPeriodLabel(column.previous)} → ${statementPeriodLabel(column.statement)}`}>
                      {statementPeriodLabel(column.statement)}
                    </span>
                    {column.reconciled !== null &&
                      (column.reconciled ? (
                        <Badge tone="pos">{t('fin.cashflow.ok')}</Badge>
                      ) : (
                        <Badge tone="warn">Δ</Badge>
                      ))}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((section) => (
              <Fragment key={section.key}>
                <tr>
                  <td
                    colSpan={1 + columns.length}
                    className="border-b border-slate-100 bg-white px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase"
                  >
                    {t(`fin.cashflow.sections.${section.key}`)}
                  </td>
                </tr>
                {linesOf(section.key).map((lineKey) => (
                  <tr key={lineKey}>
                    <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 text-slate-700">
                      {t(`fin.cashflow.lines.${lineKey}`)}
                    </td>
                    {columns.map((column) => {
                      const cell = lineOf(column, section.key, lineKey)
                      return (
                        <td
                          key={column.statement.id}
                          className="border-b border-l border-slate-100 px-3 py-1.5"
                        >
                          {cell?.hasData ? (
                            <Amount value={cell.value} locale={locale} />
                          ) : (
                            <span className="num block text-slate-400">{EM_DASH}</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-800">
                    {t(`fin.cashflow.subtotals.${section.subtotalKey}`)}
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.statement.id}
                      className="border-b border-l border-slate-200 px-3 py-1.5"
                    >
                      <Amount value={column[section.subtotalKey]} locale={locale} />
                    </td>
                  ))}
                </tr>
              </Fragment>
            ))}

            <tr className="bg-slate-100 font-semibold [&>td]:border-t [&>td]:border-slate-300">
              <td className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5">
                {t('fin.cashflow.netChange')}
              </td>
              {columns.map((column) => (
                <td key={column.statement.id} className="border-l border-slate-200 px-3 py-1.5">
                  <Amount value={column.netChange} locale={locale} />
                </td>
              ))}
            </tr>
            <tr>
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-slate-500">
                {t('fin.cashflow.deltaCash')}
              </td>
              {columns.map((column) => (
                <td key={column.statement.id} className="border-l border-slate-100 px-3 py-1.5">
                  {column.deltaCash === null ? (
                    <span className="num block text-slate-400">{EM_DASH}</span>
                  ) : (
                    <Amount value={column.deltaCash} locale={locale} />
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-slate-500">
                {t('fin.cashflow.reconciliation')}
              </td>
              {columns.map((column) => (
                <td key={column.statement.id} className="border-l border-slate-100 px-3 py-1.5 text-right">
                  {column.reconciled === null ? (
                    <span className="text-slate-400">{EM_DASH}</span>
                  ) : column.reconciled ? (
                    <span className="text-pos-500">{t('fin.cashflow.ok')}</span>
                  ) : (
                    <span className="num block text-warn-500">
                      {formatAmount(column.reconciliationDiff ?? 0, locale)}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
