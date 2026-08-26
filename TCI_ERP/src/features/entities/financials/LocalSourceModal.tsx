/** Read-only drill-down: the original local statement exactly as entered. */

import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { Modal, Spinner } from '../../../components/ui'
import { EM_DASH, formatAmount } from '../../../lib/format'
import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import { useLocalValues, useTemplates } from './localApi'
import type { StatementTemplate, TemplateLine } from './localApi'

function templateName(t: StatementTemplate, locale: string): string {
  if (locale === 'ru') return t.name_ru
  if (locale === 'uz') return t.name_uz
  return t.name_en
}

function lineName(line: TemplateLine, locale: string): string {
  if (locale === 'ru') return line.name_ru
  if (locale === 'uz') return line.name_uz
  return line.name_en
}

interface LocalSourceModalProps {
  open: boolean
  onClose: () => void
  statement: StatementBundle
  countryCode: string
}

export function LocalSourceModal({ open, onClose, statement, countryCode }: LocalSourceModalProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: templates } = useTemplates(open ? countryCode : undefined)
  const { data: values, isLoading } = useLocalValues(open ? statement.id : undefined)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t('fin.local.sourceTitle')} — ${statementPeriodLabel(statement)}`}
      wide
    >
      {isLoading || !templates ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          {templates.map((template) => (
            <div key={template.id} className="mb-5">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                {templateName(template, locale)}
              </h3>
              <table className="w-full border-collapse text-[13px]">
                <tbody>
                  {template.statement_template_lines.map((line, idx) => {
                    const prev = template.statement_template_lines[idx - 1]
                    const showSection = !prev || prev.section !== line.section
                    const amount = values?.[line.id]
                    return (
                      <Fragment key={line.id}>
                        {showSection && (
                          <tr>
                            <td
                              colSpan={3}
                              className="px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase"
                            >
                              {t(`fin.localSections.${line.section}`)}
                            </td>
                          </tr>
                        )}
                        <tr className={line.is_subtotal ? 'bg-slate-50 font-medium' : ''}>
                          <td className="num w-11 border-t border-slate-100 px-2 py-1 text-xs text-slate-400">
                            {line.line_code}
                          </td>
                          <td
                            className="border-t border-slate-100 px-2 py-1 text-slate-700"
                            style={{ paddingLeft: `${8 + line.indent_level * 14}px` }}
                          >
                            {lineName(line, locale)}
                          </td>
                          <td className="num border-t border-slate-100 px-2 py-1">
                            {amount === null || amount === undefined ? (
                              <span className="text-slate-400">{EM_DASH}</span>
                            ) : (
                              <span className={amount < 0 ? 'text-neg-500' : ''}>
                                {formatAmount(amount, locale)}
                              </span>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
