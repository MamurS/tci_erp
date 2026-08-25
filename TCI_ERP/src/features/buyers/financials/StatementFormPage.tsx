/**
 * Full-page spreadsheet-like entry form for one financial statement:
 * header fields + balance sheet + P&L, keyboard-friendly, with live
 * non-blocking (amber) accounting-equation warnings.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Card, Field, Input, PageHeader, Select, Spinner } from '../../../components/ui'
import { formatAmount } from '../../../lib/format'
import {
  useBuyer,
  useCreateStatement,
  useCurrencies,
  useStatements,
  useUpdateStatement,
} from '../api'
import type { StatementHeaderInput } from '../api'
import {
  emptyBalanceSheet,
  emptyIncomeStatement,
  statementPeriodLabel,
} from '../types'
import type {
  BalanceSheetValues,
  IncomeStatementValues,
  StatementKind,
  StatementUnit,
} from '../types'
import { BALANCE_SHEET_SECTIONS, INCOME_STATEMENT_SECTIONS } from './lines'
import type { LineDef, SectionDef } from './lines'
import { validateBalanceSheet, validateIncomeStatement } from './validation'
import type { ValidationWarning } from './validation'
import { LocalStatementForm } from './LocalStatementForm'
import type { LocalFormState } from './LocalStatementForm'
import { useCreateLocalStatement, useTemplates, useUpdateLocalStatement } from './localApi'

/** Permissive numeric parsing: "1 234,56" and "1234.56" both accepted. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.')
  if (cleaned === '' || cleaned === '-') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

export function StatementFormPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id: buyerId = '', statementId } = useParams()
  const isEdit = Boolean(statementId)

  const { data: buyer } = useBuyer(buyerId)
  const { data: statements, isLoading } = useStatements(buyerId)
  const { data: currencies } = useCurrencies()
  const createStatement = useCreateStatement(buyerId)
  const updateStatement = useUpdateStatement(buyerId, statementId ?? '')

  const existing = useMemo(
    () => statements?.find((s) => s.id === statementId) ?? null,
    [statements, statementId],
  )

  const [kind, setKind] = useState<StatementKind>('annual')
  const [reportType, setReportType] = useState<'statutory' | 'management'>('statutory')
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear() - 1)
  const [fiscalQuarter, setFiscalQuarter] = useState(1)
  const [periodEnd, setPeriodEnd] = useState('')
  const [currency, setCurrency] = useState('UZS')
  const [unit, setUnit] = useState<StatementUnit>('thousands')
  const [audited, setAudited] = useState(false)
  const [source, setSource] = useState('')
  const [bs, setBs] = useState<BalanceSheetValues>(emptyBalanceSheet())
  const [pnl, setPnl] = useState<IncomeStatementValues>(emptyIncomeStatement())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [basis, setBasis] = useState<'ifrs' | 'local'>('ifrs')
  const [localState, setLocalState] = useState<LocalFormState | null>(null)
  const { data: templates } = useTemplates(buyer?.country_code)
  const createLocalStatement = useCreateLocalStatement(buyerId)
  const updateLocalStatement = useUpdateLocalStatement(buyerId, statementId ?? '')
  const localAvailable = Boolean(templates?.length)

  useEffect(() => {
    if (existing) {
      setKind(existing.statement_kind)
      setFiscalYear(existing.fiscal_year)
      setFiscalQuarter(existing.fiscal_quarter ?? 1)
      setPeriodEnd(existing.period_end_date)
      setCurrency(existing.currency_code)
      setUnit(existing.unit)
      setAudited(existing.audited)
      setSource(existing.source ?? '')
      setBasis(existing.accounting_basis)
      setReportType(existing.report_type)
      setBs({ ...emptyBalanceSheet(), ...existing.balance_sheets })
      setPnl({ ...emptyIncomeStatement(), ...existing.income_statements })
    }
  }, [existing])

  const bsWarnings = useMemo(() => validateBalanceSheet(bs), [bs])
  const pnlWarnings = useMemo(() => validateIncomeStatement(pnl), [pnl])

  const handleSave = async () => {
    if (!periodEnd) {
      setError(t('fin.form.periodEndRequired'))
      return
    }
    setSaving(true)
    setError(null)
    const primaryTemplate = templates?.find((x) => x.form_kind === 'balance_sheet')
    const header: StatementHeaderInput = {
      buyer_id: buyerId,
      statement_kind: kind,
      fiscal_year: fiscalYear,
      fiscal_quarter: kind === 'quarterly' ? fiscalQuarter : null,
      period_end_date: periodEnd,
      currency_code: currency,
      unit,
      audited,
      source: source.trim() || null,
      report_type: reportType,
      accounting_basis: basis,
      template_id: basis === 'local' ? (primaryTemplate?.id ?? null) : null,
      mapping_status: basis === 'local' ? 'stale' : 'n/a',
    }
    try {
      if (basis === 'local') {
        if (!localState?.ready) return
        const input = { header, ...localState.buildInput() }
        if (isEdit) {
          await updateLocalStatement.mutateAsync(input)
        } else {
          await createLocalStatement.mutateAsync(input)
        }
      } else if (isEdit) {
        await updateStatement.mutateAsync({ header, balanceSheet: bs, incomeStatement: pnl })
      } else {
        await createStatement.mutateAsync({ header, balanceSheet: bs, incomeStatement: pnl })
      }
      void navigate(`/buyers/${buyerId}?tab=financials`)
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      setError(
        message.includes('financial_statements_unique_period')
          ? t('fin.form.duplicatePeriod')
          : t('common.saveFailed'),
      )
      setSaving(false)
    }
  }

  if (isEdit && isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={isEdit && existing ? `${t('fin.editStatement')} — ${statementPeriodLabel(existing)}` : t('fin.addStatement')}
        subtitle={
          <Link to={`/buyers/${buyerId}?tab=financials`} className="text-accent-700 hover:underline">
            ← {buyer?.name ?? t('nav.buyers')}
          </Link>
        }
        actions={
          <>
            <Link to={`/buyers/${buyerId}?tab=financials`}>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </Link>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500" role="alert">
          {error}
        </div>
      )}

      {/* Accounting basis (fixed after creation) */}
      <Card className="mb-5 flex flex-wrap items-center gap-4 p-5">
        <span className="text-[13px] font-medium text-slate-600">{t('fin.local.basis')}</span>
        <div className="flex gap-1.5">
          {(['ifrs', 'local'] as const).map((b) => (
            <button
              key={b}
              type="button"
              disabled={isEdit || (b === 'local' && !localAvailable)}
              onClick={() => setBasis(b)}
              className={`rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                basis === b
                  ? 'border-accent-600 bg-accent-50 text-accent-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
              } ${isEdit || (b === 'local' && !localAvailable) ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {b === 'ifrs' ? t('fin.local.basisIfrs') : t('fin.local.basisLocal')}
            </button>
          ))}
        </div>
        {basis === 'local' && (
          <span className="text-[13px] text-slate-500">
            {(templates ?? []).map((x) => x.code).join(' + ')}
          </span>
        )}
        {!localAvailable && !isEdit && (
          <span className="text-xs text-slate-400">{t('fin.local.noTemplatesForCountry')}</span>
        )}
      </Card>

      {/* Header fields */}
      <Card className="mb-5 grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
        <Field label={t('fin.fields.kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as StatementKind)}>
            <option value="annual">{t('fin.kinds.annual')}</option>
            <option value="quarterly">{t('fin.kinds.quarterly')}</option>
          </Select>
        </Field>
        <Field label={t('fin.fields.reportType')}>
          <Select
            value={reportType}
            onChange={(e) => setReportType(e.target.value as 'statutory' | 'management')}
          >
            <option value="statutory">{t('fin.reportTypes.statutory')}</option>
            <option value="management">{t('fin.reportTypes.management')}</option>
          </Select>
        </Field>
        <Field label={t('fin.fields.fiscalYear')}>
          <Input
            type="number"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            min={1990}
            max={2100}
          />
        </Field>
        {kind === 'quarterly' && (
          <Field label={t('fin.fields.fiscalQuarter')}>
            <Select value={fiscalQuarter} onChange={(e) => setFiscalQuarter(Number(e.target.value))}>
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('fin.fields.periodEnd')}>
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
        </Field>
        <Field label={t('fin.fields.currency')}>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {(currencies ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('fin.fields.unit')}>
          <Select value={unit} onChange={(e) => setUnit(e.target.value as StatementUnit)}>
            <option value="units">{t('fin.units.units')}</option>
            <option value="thousands">{t('fin.units.thousands')}</option>
            <option value="millions">{t('fin.units.millions')}</option>
          </Select>
        </Field>
        <Field label={t('fin.fields.source')}>
          <Input value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={audited}
            onChange={(e) => setAudited(e.target.checked)}
            className="accent-accent-600"
          />
          {t('fin.fields.audited')}
        </label>
      </Card>

      {basis === 'local' ? (
        <LocalStatementForm
          countryCode={buyer?.country_code ?? ''}
          existing={existing}
          onStateChange={setLocalState}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <StatementSectionGrid
            title={t('fin.balanceSheetTitle')}
            sections={BALANCE_SHEET_SECTIONS}
            values={bs}
            warnings={bsWarnings}
            onChange={(key, value) => setBs((prev) => ({ ...prev, [key]: value }))}
          />
          <StatementSectionGrid
            title={t('fin.incomeStatementTitle')}
            sections={INCOME_STATEMENT_SECTIONS}
            values={pnl}
            warnings={pnlWarnings}
            onChange={(key, value) => setPnl((prev) => ({ ...prev, [key]: value }))}
            hint={t('fin.form.expensesPositiveHint')}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Spreadsheet-like section grid
// ---------------------------------------------------------------------------

function StatementSectionGrid<K extends string>({
  title,
  sections,
  values,
  warnings,
  onChange,
  hint,
}: {
  title: string
  sections: SectionDef<K>[]
  values: Record<K, number | null>
  warnings: ValidationWarning[]
  onChange: (key: K, value: number | null) => void
  hint?: string
}) {
  const { t } = useTranslation()
  const warningFor = (key: K) => warnings.find((w) => w.totalKey === key)

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <div>
        {sections.map((section) => (
          <div key={section.sectionKey}>
            {sections.length > 1 && (
              <div className="bg-white px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {t(`fin.sections.${section.sectionKey}`)}
              </div>
            )}
            {section.lines.map((line) => (
              <LineInput
                key={line.key}
                line={line}
                value={values[line.key]}
                warning={warningFor(line.key)}
                onChange={(v) => onChange(line.key, v)}
              />
            ))}
          </div>
        ))}
      </div>
      {warnings.some((w) => w.totalKey === 'balance_equation') && (
        <div className="border-t border-warn-500/30 bg-warn-50 px-4 py-2 text-[13px] text-warn-500">
          {t('fin.warnings.balanceEquation')}
        </div>
      )}
    </Card>
  )
}

function LineInput<K extends string>({
  line,
  value,
  warning,
  onChange,
}: {
  line: LineDef<K>
  value: number | null
  warning: ValidationWarning | undefined
  onChange: (value: number | null) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [raw, setRaw] = useState(value === null ? '' : String(value))

  // Sync external resets (e.g. loading an existing statement).
  useEffect(() => {
    setRaw(value === null ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === null ? '' : String(value)])

  const emphasis =
    line.level === 'grand'
      ? 'font-semibold bg-slate-50'
      : line.level === 'subtotal'
        ? 'font-medium bg-slate-50'
        : ''

  return (
    <div className={`grid grid-cols-[1fr_170px] items-center gap-2 border-t border-slate-100 px-4 py-1 ${emphasis}`}>
      <div>
        <span className="text-[13px] text-slate-700">{t(`fin.lines.${line.key}`)}</span>
        {warning && warning.totalKey !== 'balance_equation' && (
          <span className="ml-2 text-xs text-warn-500">
            {t('fin.warnings.subtotalMismatch', {
              expected: formatAmount(warning.expected, locale),
            })}
          </span>
        )}
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value)
          onChange(parseAmount(e.target.value))
        }}
        className={`num rounded border px-2 py-1 text-[13px] focus:outline-2 focus:outline-accent-600 focus:-outline-offset-1 ${
          warning ? 'border-warn-500/50 bg-warn-50' : 'border-slate-200 bg-white'
        }`}
      />
    </div>
  )
}
