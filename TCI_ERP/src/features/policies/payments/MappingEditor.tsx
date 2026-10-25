/** The column mapping of one bank's statement: which column is the date, the
 * amount, the purpose… with the file's own column names to choose from. */

import { useTranslation } from 'react-i18next'

import { Field, Segmented, Select } from '../../../components/ui'
import { useCurrencies } from '../../entities/api'
import { DATE_FORMATS, DECIMAL_SEPARATORS, guessColumns, headerLabels } from './bankStatement'
import type { AmountLayout, BankField, BankMapping, Cell, DateFormat, DecimalSeparator } from './bankStatement'

/** i18n ids of the date formats (a key cannot hold «.» or «/»). */
const DATE_FORMAT_KEYS: Record<DateFormat, string> = {
  'DD.MM.YYYY': 'dmyDot',
  'DD/MM/YYYY': 'dmySlash',
  'MM/DD/YYYY': 'mdySlash',
  'YYYY-MM-DD': 'iso',
}

const DECIMAL_KEYS: Record<DecimalSeparator, string> = { auto: 'auto', '.': 'point', ',': 'comma' }

/** How many rows are offered as the header row. */
const HEADER_ROWS_OFFERED = 30

function sample(cell: Cell): string {
  if (cell === null || cell === undefined) return ''
  const text = String(cell).replace(/\s+/g, ' ').trim()
  return text.length > 28 ? `${text.slice(0, 27)}…` : text
}

interface Props {
  rows: readonly (readonly Cell[])[]
  mapping: BankMapping
  onChange: (next: BankMapping) => void
}

export function MappingEditor({ rows, mapping, onChange }: Props) {
  const { t } = useTranslation()
  const { data: currencies } = useCurrencies()
  const headerIndex = mapping.header_row - 1
  const headers = headerLabels(rows[headerIndex])
  // The first data row with something in it, to show beside each column name.
  const firstData = rows.slice(headerIndex + 1).find((r) => r.some((c) => c !== null && c !== '')) ?? []

  const setColumn = (field: BankField, value: string) => {
    const columns = { ...mapping.columns }
    if (value) columns[field] = value
    else delete columns[field]
    onChange({ ...mapping, columns })
  }

  const columnSelect = (field: BankField, optional: boolean) => (
    <Field label={t(`premium.bank.fields.${field}`)}>
      <Select value={mapping.columns[field] ?? ''} onChange={(e) => setColumn(field, e.target.value)}>
        <option value="">{optional ? t('premium.bank.mapping.notInFile') : t('premium.bank.mapping.choose')}</option>
        {headers.map((h, i) => {
          const value = sample(firstData[i])
          const name = h.startsWith('#') ? t('premium.bank.mapping.unnamedColumn', { letter: h.slice(1) }) : h
          return (
            <option key={h} value={h}>
              {value ? `${name} — ${value}` : name}
            </option>
          )
        })}
      </Select>
    </Field>
  )

  const headerChoices = rows.slice(0, HEADER_ROWS_OFFERED).map((row, i) => {
    const names = row.map(sample).filter(Boolean).slice(0, 3).join(', ')
    return { row: i + 1, label: names ? `${i + 1} — ${names}` : String(i + 1) }
  })

  const currencyColumn = Boolean(mapping.columns.currency)

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label={t('premium.bank.mapping.headerRow')} className="sm:col-span-2">
        <Select
          value={mapping.header_row}
          onChange={(e) => {
            const row = Number(e.target.value)
            const columns = guessColumns(headerLabels(rows[row - 1]))
            if (mapping.amount_layout === 'split') delete columns.amount
            else {
              delete columns.credit
              delete columns.debit
            }
            onChange({ ...mapping, header_row: row, columns })
          }}
        >
          {headerChoices.map((c) => (
            <option key={c.row} value={c.row}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      {/* Not a Field: a <label> around buttons would press the first one
          when its caption is clicked. */}
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="text-[0.75rem] font-semibold tracking-wide text-slate-600 uppercase">
          {t('premium.bank.mapping.amountLayout')}
        </span>
        <Segmented
          tone="solid"
          value={mapping.amount_layout}
          ariaLabel={t('premium.bank.mapping.amountLayout')}
          options={(['signed', 'split'] as const).map((key) => ({
            key,
            label: t(`premium.bank.mapping.layouts.${key}`),
          }))}
          onChange={(key) => {
            // The other layout's columns, guessed from the names where unset.
            const guess = guessColumns(headers)
            const columns = { ...mapping.columns }
            if (key === 'split') {
              columns.credit ??= guess.credit
              columns.debit ??= guess.debit
            } else columns.amount ??= guess.amount
            onChange({ ...mapping, amount_layout: key as AmountLayout, columns })
          }}
        />
      </div>

      {columnSelect('value_date', false)}
      {mapping.amount_layout === 'signed' ? (
        <>
          {columnSelect('amount', false)}
          {/* Keeps the grid in step with the split layout's two columns. */}
          <div aria-hidden className="hidden lg:block" />
        </>
      ) : (
        <>
          {columnSelect('credit', false)}
          {columnSelect('debit', true)}
        </>
      )}
      {columnSelect('currency', true)}

      {columnSelect('purpose', true)}
      {columnSelect('reference', true)}
      {columnSelect('payer', true)}
      <Field
        label={t('premium.bank.mapping.fixedCurrency')}
        hint={currencyColumn ? t('premium.bank.mapping.fixedCurrencyUnused') : t('premium.bank.mapping.fixedCurrencyHint')}
      >
        <Select
          value={currencyColumn ? '' : (mapping.fixed_currency ?? '')}
          disabled={currencyColumn}
          onChange={(e) => onChange({ ...mapping, fixed_currency: e.target.value || null })}
        >
          <option value="">{t('premium.bank.mapping.choose')}</option>
          {(currencies ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('premium.bank.mapping.dateFormat')}>
        <Select
          value={mapping.date_format}
          onChange={(e) => onChange({ ...mapping, date_format: e.target.value as DateFormat })}
        >
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {t(`premium.bank.mapping.dateFormats.${DATE_FORMAT_KEYS[f]}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('premium.bank.mapping.decimalSeparator')}>
        <Select
          value={mapping.decimal_separator}
          onChange={(e) => onChange({ ...mapping, decimal_separator: e.target.value as DecimalSeparator })}
        >
          {DECIMAL_SEPARATORS.map((d) => (
            <option key={d} value={d}>
              {t(`premium.bank.mapping.decimals.${DECIMAL_KEYS[d]}`)}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-start gap-2.5 pt-6 text-[0.8125rem] text-slate-700 sm:col-span-2">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-accent-600"
          checked={mapping.skip_debits}
          onChange={(e) => onChange({ ...mapping, skip_debits: e.target.checked })}
        />
        <span>
          <span className="font-medium text-slate-800">{t('premium.bank.mapping.skipDebits')}</span>
          <span className="block text-xs text-slate-500">{t('premium.bank.mapping.skipDebitsHint')}</span>
        </span>
      </label>
    </div>
  )
}
