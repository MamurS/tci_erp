/**
 * Full-page spreadsheet-like entry form for one financial statement:
 * header fields + balance sheet + P&L, keyboard-friendly, with live
 * non-blocking (amber) accounting-equation warnings.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, Card, DateInput, Field, Input, PageHeader, PanelGrid, Segmented, Select, Spinner, LinkButton } from '../../../components/ui'
import { amountToPlain, parseAmount } from '../../../components/ui/amount'
import { formatAmount } from '../../../lib/format'
import {
  useEntity,
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
import { defaultStatementCurrency } from './countryCurrency'
import { frameworkShort, localName, templateName } from './frameworkText'
import {
  useCountryFramework,
  useCreateLocalStatement,
  useFrameworkTemplates,
  useTemplateFrameworkIndex,
  useUpdateLocalStatement,
} from './localApi'

/** Permissive numeric parsing: "1 234,56" and "1234.56" both accepted. */
export function StatementFormPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { id: entityId = '', statementId } = useParams()
  const isEdit = Boolean(statementId)

  const { data: buyer } = useEntity(entityId)
  const { data: statements, isLoading } = useStatements(entityId)
  const { data: currencies } = useCurrencies()
  const createStatement = useCreateStatement(entityId)
  const updateStatement = useUpdateStatement(entityId, statementId ?? '')

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
  const [basisTouched, setBasisTouched] = useState(false)
  const [localState, setLocalState] = useState<LocalFormState | null>(null)
  // The form follows the buyer's country (0049). A statement already saved
  // keeps the forms it was entered on, whatever the country points at now.
  const { data: countryFramework } = useCountryFramework(buyer?.country_code)
  const { data: templateIndex } = useTemplateFrameworkIndex()
  const frameworkCode = existing?.template_id
    ? templateIndex?.[existing.template_id]
    : countryFramework && countryFramework.kind !== 'ifrs'
      ? countryFramework.code
      : undefined
  const { data: templates } = useFrameworkTemplates(frameworkCode)
  const createLocalStatement = useCreateLocalStatement(entityId)
  const updateLocalStatement = useUpdateLocalStatement(entityId, statementId ?? '')
  const localAvailable = Boolean(templates?.length)
  const frameworkLabel = countryFramework ? frameworkShort(countryFramework, locale) : ''

  // A new statement opens on the country's own form when there is one; the
  // analyst can still switch to IFRS (a buyer that files IFRS accounts).
  useEffect(() => {
    if (!isEdit && !basisTouched && localAvailable) setBasis('local')
  }, [isEdit, basisTouched, localAvailable])

  // ...and in the country's currency, when the reference table has it.
  const [currencyTouched, setCurrencyTouched] = useState(false)
  useEffect(() => {
    if (isEdit || currencyTouched) return
    const preset = defaultStatementCurrency(buyer?.country_code, (currencies ?? []).map((c) => c.code))
    if (preset) setCurrency(preset)
  }, [isEdit, currencyTouched, buyer?.country_code, currencies])

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
      entity_id: entityId,
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
      void navigate(`/buyers/${entityId}?tab=financials`)
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
    <div>
      <PageHeader
        title={isEdit && existing ? `${t('fin.editStatement')} — ${statementPeriodLabel(existing)}` : t('fin.addStatement')}
        subtitle={
          <Link to={`/buyers/${entityId}?tab=financials`} className="text-accent-700 hover:underline">
            ← {buyer?.name ?? t('nav.buyers')}
          </Link>
        }
        actions={
          <>
            <LinkButton variant="secondary" to={`/buyers/${entityId}?tab=financials`}>
              {t('common.cancel')}
            </LinkButton>
            <Button onClick={() => void handleSave()} loading={saving}>
              {t('common.save')}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-3 text-small text-neg-500" role="alert">
          {error}
        </div>
      )}

      {/* Accounting basis (fixed after creation) */}
      <Card className="mb-5 flex flex-wrap items-center gap-4 p-5">
        <span className="text-small font-medium text-slate-600">{t('fin.local.basis')}</span>
        <Segmented
          value={basis}
          onChange={(key) => {
            setBasisTouched(true)
            setBasis(key as 'ifrs' | 'local')
          }}
          options={[
            { key: 'ifrs', label: t('fin.local.basisIfrs'), disabled: isEdit },
            {
              key: 'local',
              label: localAvailable && frameworkLabel
                ? t('fin.local.basisLocalNamed', { framework: frameworkLabel })
                : t('fin.local.basisLocal'),
              disabled: isEdit || !localAvailable,
            },
          ]}
        />
        <div className="basis-full text-small text-slate-500">
          {basis === 'local' && templates?.length ? (
            <>
              {templates.map((x) => templateName(x, locale)).join(' + ')}
              {countryFramework?.legal_basis && (
                <span className="block text-caption text-slate-500">{countryFramework.legal_basis}</span>
              )}
            </>
          ) : countryFramework?.kind === 'ifrs' ? (
            t('fin.local.ifrsFramework', { framework: localName(countryFramework, locale) })
          ) : countryFramework && localAvailable ? (
            t('fin.local.ifrsInsteadOfLocal', { framework: localName(countryFramework, locale) })
          ) : (
            !isEdit && t('fin.local.noFrameworkForCountry')
          )}
        </div>
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
          <DateInput value={periodEnd} onChange={setPeriodEnd} required />
        </Field>
        <Field label={t('fin.fields.currency')}>
          <Select
            value={currency}
            onChange={(e) => {
              setCurrencyTouched(true)
              setCurrency(e.target.value)
            }}
          >
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
        <label className="flex items-center gap-2 self-end pb-2 text-body text-slate-700">
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
          frameworkCode={frameworkCode ?? ''}
          existing={existing}
          onStateChange={setLocalState}
        />
      ) : (
        <PanelGrid cols="xl:grid-cols-2">
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
        </PanelGrid>
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
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="text-body font-semibold text-slate-900">{title}</h2>
        {hint && <p className="text-caption text-slate-500">{hint}</p>}
      </div>
      <div>
        {sections.map((section) => (
          <div key={section.sectionKey}>
            {sections.length > 1 && (
              <div className="bg-white px-4 pt-3 pb-1 text-caption font-semibold tracking-wide text-slate-500 uppercase">
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
        <div className="border-t border-warn-500/30 bg-warn-50 px-4 py-2 text-small text-warn-500">
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
  const [raw, setRaw] = useState(amountToPlain(value))

  // Sync external resets (e.g. loading an existing statement).
  useEffect(() => {
    setRaw(amountToPlain(value))
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
        <span className="text-small text-slate-700">{t(`fin.lines.${line.key}`)}</span>
        {warning && warning.totalKey !== 'balance_equation' && (
          <span className="ml-2 text-caption text-warn-500">
            {t('fin.warnings.subtotalMismatch', {
              expected: formatAmount(warning.expected, locale),
            })}
          </span>
        )}
      </div>
      <AmountInput
        allowNegative
        value={raw}
        onChange={(plain) => {
          setRaw(plain)
          onChange(parseAmount(plain))
        }}
        className={`h-7! rounded! px-2! py-1! text-small! ${
          warning ? 'border-warn-500/50! bg-warn-50!' : 'border-slate-200!'
        }`}
      />
    </div>
  )
}
