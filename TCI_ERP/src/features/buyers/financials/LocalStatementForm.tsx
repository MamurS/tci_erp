/**
 * Entry form for a local (UZ NAS) statement: renders both forms from
 * template lines exactly as officially structured, with live amber checks
 * on the local form's own subtotals and a live IFRS mapping preview with
 * cross-check warnings. Values are stored exactly as entered.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Card } from '../../../components/ui'
import { formatAmount } from '../../../lib/format'
import type { StatementBundle } from '../types'
import {
  useLocalValues,
  useTemplateMappings,
  useTemplates,
  valueKey,
} from './localApi'
import type { LocalStatementSaveInput, StatementTemplate, TemplateLine } from './localApi'
import { mapLocalStatement, validateLocalStatement } from './mapping'

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

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.')
  if (cleaned === '' || cleaned === '-') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

interface LocalStatementFormProps {
  countryCode: string
  existing: StatementBundle | null
  /** Called on every change so the parent Save button can persist. */
  onStateChange: (state: LocalFormState) => void
}

export interface LocalFormState {
  ready: boolean
  buildInput: () => Omit<LocalStatementSaveInput, 'header'>
}

export function LocalStatementForm({ countryCode, existing, onStateChange }: LocalStatementFormProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const { data: templates } = useTemplates(countryCode)
  const templateIds = useMemo(() => (templates ?? []).map((x) => x.id), [templates])
  const { data: mappings } = useTemplateMappings(templateIds)
  const { data: existingValues } = useLocalValues(existing?.id)

  /** valueKey(templateCode, lineCode) -> amount */
  const [values, setValues] = useState<Record<string, number | null>>({})
  const [loaded, setLoaded] = useState(false)

  // Load existing values (keyed by template_line_id -> translate to keys).
  useEffect(() => {
    if (!existing || !templates || !existingValues || loaded) return
    const next: Record<string, number | null> = {}
    for (const template of templates) {
      for (const line of template.statement_template_lines) {
        if (line.id in existingValues) {
          next[valueKey(template.code, line.line_code)] = existingValues[line.id]
        }
      }
    }
    setValues(next)
    setLoaded(true)
  }, [existing, templates, existingValues, loaded])

  // Per-template value maps and warnings.
  const perTemplate = useMemo(() => {
    return (templates ?? []).map((template) => {
      const localValues: Record<string, number | null> = {}
      for (const line of template.statement_template_lines) {
        const v = values[valueKey(template.code, line.line_code)]
        if (v !== null && v !== undefined) localValues[line.line_code] = v
      }
      const subtotalWarnings = validateLocalStatement(template.code, localValues)
      const lineIdSet = new Set(template.statement_template_lines.map((l) => l.id))
      const templateMappings = (mappings ?? []).filter((m) => lineIdSet.has(m.template_line_id))
      const mapped = mapLocalStatement(template.code, localValues, templateMappings)
      return { template, localValues, subtotalWarnings, crossChecks: mapped.warnings }
    })
  }, [templates, values, mappings])

  // Expose state to the parent (save handler).
  useEffect(() => {
    const ready = Boolean(templates?.length && mappings)
    onStateChange({
      ready,
      buildInput: () => ({
        templates: templates ?? [],
        values,
        mappings: mappings ?? [],
      }),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, mappings, values])

  if (!templates?.length) {
    return (
      <Card className="p-5 text-sm text-slate-500">{t('fin.local.noTemplates')}</Card>
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {perTemplate.map(({ template, subtotalWarnings, crossChecks }) => (
        <Card key={template.id} className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">
              {templateName(template, locale)}
            </h2>
            <p className="text-xs text-slate-500">{t('fin.local.enterAsReported')}</p>
          </div>

          <div>
            {template.statement_template_lines.map((line, idx) => {
              const prev = template.statement_template_lines[idx - 1]
              const showSection = !prev || prev.section !== line.section
              const key = valueKey(template.code, line.line_code)
              const warning = subtotalWarnings.find((w) => w.lineCode === line.line_code)
              const emphasis = line.is_subtotal ? 'font-medium bg-slate-50' : ''
              return (
                <Fragment key={line.id}>
                  {showSection && (
                    <div className="bg-white px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                      {t(`fin.localSections.${line.section}`)}
                    </div>
                  )}
                  <div
                    className={`grid grid-cols-[44px_1fr_150px] items-center gap-2 border-t border-slate-100 px-4 py-1 ${emphasis}`}
                  >
                    <span className="num text-xs text-slate-400">{line.line_code}</span>
                    <div style={{ paddingLeft: `${line.indent_level * 14}px` }}>
                      <span className="text-[13px] text-slate-700">{lineName(line, locale)}</span>
                      {warning && (
                        <span className="ml-2 text-xs text-warn-500">
                          {t('fin.warnings.subtotalMismatch', {
                            expected: formatAmount(warning.expected, locale),
                          })}
                        </span>
                      )}
                    </div>
                    <LocalLineInput
                      value={values[key] ?? null}
                      hasWarning={Boolean(warning)}
                      onChange={(v) =>
                        setValues((prevValues) => ({ ...prevValues, [key]: v }))
                      }
                    />
                  </div>
                </Fragment>
              )
            })}
          </div>

          {crossChecks.length > 0 && (
            <div className="border-t border-warn-500/30 bg-warn-50 px-4 py-2 text-[13px] text-warn-500">
              <p className="font-medium">{t('fin.local.crossCheckTitle')}</p>
              <ul className="mt-0.5 list-inside list-disc">
                {crossChecks.map((w) => (
                  <li key={w.lineCode}>
                    {t('fin.local.crossCheckItem', {
                      line: w.lineCode,
                      local: formatAmount(w.localValue, locale),
                      computed: formatAmount(w.computedValue, locale),
                      column: t(`fin.lines.${w.ifrsColumn}`),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

function LocalLineInput({
  value,
  hasWarning,
  onChange,
}: {
  value: number | null
  hasWarning: boolean
  onChange: (value: number | null) => void
}) {
  const [raw, setRaw] = useState(value === null ? '' : String(value))

  useEffect(() => {
    setRaw(value === null ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === null ? '' : String(value)])

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={(e) => {
        setRaw(e.target.value)
        onChange(parseAmount(e.target.value))
      }}
      className={`num rounded border px-2 py-1 text-[13px] focus:outline-2 focus:outline-accent-600 focus:-outline-offset-1 ${
        hasWarning ? 'border-warn-500/50 bg-warn-50' : 'border-slate-200 bg-white'
      }`}
    />
  )
}
