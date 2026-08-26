/**
 * Full-page policy create/edit form, grouped like the terms card.
 * Validation via validation.ts: red = blocking (mirrors DB constraints),
 * amber = advisory (never blocks). Amount inputs are currency-aware.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Card, Field, Input, PageHeader, Select, Spinner } from '../../components/ui'
import { useCurrencies, useEntities } from '../entities/api'
import { useCreatePolicy, usePolicy, useUpdatePolicy } from './api'
import type { PolicyInput } from './api'
import { validatePolicy } from './validation'
import type { PolicyFormValues } from './validation'
import { DECLARATION_FREQUENCIES, PRODUCT_STRUCTURES } from './types'
import type { DeclarationFrequency, ProductStructure } from './types'

/** Tolerant numeric parsing: spaces as group separators, comma or dot decimals. */
function parseNum(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

interface FormState {
  entity_id: string
  policy_number: string
  product_structure: ProductStructure
  inception_date: string
  expiry_date: string
  currency_code: string
  insured_percentage: string
  max_liability_amount: string
  max_liability_premium_multiple: string
  nql_amount: string
  deductible_each_loss: string
  aggregate_first_loss: string
  premium_rate_pct: string
  minimum_premium: string
  estimated_annual_turnover: string
  discretionary_limit: string
  waiting_period_days: string
  max_extension_period_days: string
  max_payment_terms_days: string
  declaration_frequency: DeclarationFrequency
  notes: string
}

const EMPTY: FormState = {
  entity_id: '',
  policy_number: '',
  product_structure: 'whole_turnover',
  inception_date: '',
  expiry_date: '',
  currency_code: 'UZS',
  insured_percentage: '85',
  max_liability_amount: '',
  max_liability_premium_multiple: '',
  nql_amount: '',
  deductible_each_loss: '',
  aggregate_first_loss: '',
  premium_rate_pct: '',
  minimum_premium: '',
  estimated_annual_turnover: '',
  discretionary_limit: '',
  waiting_period_days: '180',
  max_extension_period_days: '60',
  max_payment_terms_days: '90',
  declaration_frequency: 'monthly',
  notes: '',
}

export function PolicyFormPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const isEdit = Boolean(id)

  const { data: existing, isLoading } = usePolicy(id ?? '')
  const { data: policyholders } = useEntities()
  const { data: currencies } = useCurrencies()
  const createPolicy = useCreatePolicy()
  const updatePolicy = useUpdatePolicy(id ?? '')

  const [form, setForm] = useState<FormState>({
    ...EMPTY,
    entity_id: searchParams.get('entity') ?? searchParams.get('policyholder') ?? '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    if (isEdit && existing) {
      const s = (v: number | null): string => (v === null ? '' : String(v))
      setForm({
        entity_id: existing.entity_id,
        policy_number: existing.policy_number,
        product_structure: existing.product_structure,
        inception_date: existing.inception_date,
        expiry_date: existing.expiry_date,
        currency_code: existing.currency_code,
        insured_percentage: s(existing.insured_percentage),
        max_liability_amount: s(existing.max_liability_amount),
        max_liability_premium_multiple: s(existing.max_liability_premium_multiple),
        nql_amount: s(existing.nql_amount),
        deductible_each_loss: s(existing.deductible_each_loss),
        aggregate_first_loss: s(existing.aggregate_first_loss),
        premium_rate_pct: s(existing.premium_rate_pct),
        minimum_premium: s(existing.minimum_premium),
        estimated_annual_turnover: s(existing.estimated_annual_turnover),
        discretionary_limit: s(existing.discretionary_limit),
        waiting_period_days: s(existing.waiting_period_days),
        max_extension_period_days: s(existing.max_extension_period_days),
        max_payment_terms_days: s(existing.max_payment_terms_days),
        declaration_frequency: existing.declaration_frequency,
        notes: existing.notes ?? '',
      })
    }
  }, [isEdit, existing])

  const values: PolicyFormValues = useMemo(
    () => ({
      entity_id: form.entity_id,
      policy_number: form.policy_number,
      status: isEdit ? (existing?.status ?? 'draft') : 'draft',
      inception_date: form.inception_date,
      expiry_date: form.expiry_date,
      insured_percentage: parseNum(form.insured_percentage),
      max_liability_amount: parseNum(form.max_liability_amount),
      max_liability_premium_multiple: parseNum(form.max_liability_premium_multiple),
      nql_amount: parseNum(form.nql_amount),
      deductible_each_loss: parseNum(form.deductible_each_loss),
      aggregate_first_loss: parseNum(form.aggregate_first_loss),
      premium_rate_pct: parseNum(form.premium_rate_pct),
      minimum_premium: parseNum(form.minimum_premium),
      estimated_annual_turnover: parseNum(form.estimated_annual_turnover),
      discretionary_limit: parseNum(form.discretionary_limit),
      waiting_period_days: parseNum(form.waiting_period_days),
      max_extension_period_days: parseNum(form.max_extension_period_days),
      max_payment_terms_days: parseNum(form.max_payment_terms_days),
    }),
    [form, isEdit, existing],
  )
  const validation = useMemo(() => validatePolicy(values), [values])
  const blocked = Object.keys(validation.errors).length > 0

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const message = (field: string): React.ReactNode => {
    const error = submitted && validation.errors[field]
    const warning = validation.warnings[field]
    if (error) {
      return (
        <p className="mt-0.5 text-xs text-neg-500" role="alert">
          {t(`policies.validation.${error}`)}
        </p>
      )
    }
    if (warning) {
      return <p className="mt-0.5 text-xs text-warn-500">{t(`policies.validation.${warning}`)}</p>
    }
    return null
  }

  const handleSave = async () => {
    setSubmitted(true)
    setSaveError(false)
    if (blocked) return
    const input: PolicyInput = {
      entity_id: values.entity_id,
      policy_number: form.policy_number.trim(),
      product_structure: form.product_structure,
      inception_date: form.inception_date,
      expiry_date: form.expiry_date,
      currency_code: form.currency_code,
      insured_percentage: values.insured_percentage as number,
      max_liability_amount: values.max_liability_amount,
      max_liability_premium_multiple: values.max_liability_premium_multiple,
      nql_amount: values.nql_amount as number,
      deductible_each_loss: values.deductible_each_loss,
      aggregate_first_loss: values.aggregate_first_loss,
      premium_rate_pct: values.premium_rate_pct as number,
      minimum_premium: values.minimum_premium as number,
      estimated_annual_turnover: values.estimated_annual_turnover,
      discretionary_limit: values.discretionary_limit as number,
      waiting_period_days: values.waiting_period_days as number,
      max_extension_period_days: values.max_extension_period_days as number,
      max_payment_terms_days: values.max_payment_terms_days as number,
      declaration_frequency: form.declaration_frequency,
      notes: form.notes.trim() || null,
    }
    try {
      if (isEdit && id) {
        await updatePolicy.mutateAsync(input)
        void navigate(`/policies/${id}`)
      } else {
        const created = await createPolicy.mutateAsync(input)
        void navigate(`/policies/${created.id}`)
      }
    } catch {
      setSaveError(true)
    }
  }

  if (isEdit && isLoading) return <Spinner label={t('common.loading')} />

  const ccy = form.currency_code
  const saving = createPolicy.isPending || updatePolicy.isPending

  return (
    <div>
      <PageHeader
        title={isEdit ? t('policies.editTitle', { number: form.policy_number }) : t('policies.newPolicy')}
        subtitle={
          <Link to={isEdit && id ? `/policies/${id}` : '/policies'} className="text-accent-700 hover:underline">
            {t('policies.backToList')}
          </Link>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => void navigate(isEdit && id ? `/policies/${id}` : '/policies')}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || (submitted && blocked)}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        }
      />

      {saveError && (
        <div className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500" role="alert">
          {t('common.saveFailed')}
        </div>
      )}

      <div className="flex max-w-4xl flex-col gap-5">
        {/* Contract */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            {t('policies.termGroups.contract')}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t('policies.fields.policyholder')}>
              <Select
                value={form.entity_id}
                onChange={(e) => set({ entity_id: e.target.value })}
                disabled={isEdit}
              >
                <option value="">{t('common.notSelected')}</option>
                {(policyholders ?? []).map((ph) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.name}
                  </option>
                ))}
              </Select>
              {message('entity_id')}
            </Field>
            <Field label={t('policies.fields.policyNumber')}>
              <Input
                value={form.policy_number}
                onChange={(e) => set({ policy_number: e.target.value })}
              />
              {message('policy_number')}
            </Field>
            <Field label={t('policies.fields.productStructure')}>
              <Select
                value={form.product_structure}
                onChange={(e) => set({ product_structure: e.target.value as ProductStructure })}
              >
                {PRODUCT_STRUCTURES.map((s) => (
                  <option key={s} value={s}>
                    {t(`policies.structures.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('policies.fields.currency')}>
              <Select
                value={form.currency_code}
                onChange={(e) => set({ currency_code: e.target.value })}
              >
                {(currencies ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('policies.fields.inceptionDate')}>
              <Input
                type="date"
                value={form.inception_date}
                onChange={(e) => set({ inception_date: e.target.value })}
              />
              {message('inception_date')}
            </Field>
            <Field label={t('policies.fields.expiryDate')}>
              <Input
                type="date"
                value={form.expiry_date}
                onChange={(e) => set({ expiry_date: e.target.value })}
              />
              {message('expiry_date')}
            </Field>
          </div>
        </Card>

        {/* Cover */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            {t('policies.termGroups.cover')}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <NumField
              label={t('policies.terms.insuredPercentage')}
              suffix="%"
              value={form.insured_percentage}
              onChange={(v) => set({ insured_percentage: v })}
              message={message('insured_percentage')}
            />
            <NumField
              label={t('policies.terms.nql')}
              suffix={ccy}
              value={form.nql_amount}
              onChange={(v) => set({ nql_amount: v })}
              message={message('nql_amount')}
            />
            <NumField
              label={t('policies.terms.maxLiabilityAmount')}
              suffix={ccy}
              value={form.max_liability_amount}
              onChange={(v) => set({ max_liability_amount: v })}
              message={message('max_liability_amount')}
            />
            <NumField
              label={t('policies.terms.maxLiabilityMultiple')}
              suffix={t('policies.terms.timesPremium')}
              value={form.max_liability_premium_multiple}
              onChange={(v) => set({ max_liability_premium_multiple: v })}
              message={message('max_liability_premium_multiple')}
            />
            <NumField
              label={t('policies.terms.deductibleEachLoss')}
              suffix={ccy}
              value={form.deductible_each_loss}
              onChange={(v) => set({ deductible_each_loss: v })}
              message={message('deductible_each_loss')}
            />
            <NumField
              label={t('policies.terms.aggregateFirstLoss')}
              suffix={ccy}
              value={form.aggregate_first_loss}
              onChange={(v) => set({ aggregate_first_loss: v })}
              message={message('aggregate_first_loss')}
            />
          </div>
        </Card>

        {/* Premium */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            {t('policies.termGroups.premium')}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <NumField
              label={t('policies.terms.premiumRate')}
              suffix="%"
              value={form.premium_rate_pct}
              onChange={(v) => set({ premium_rate_pct: v })}
              message={message('premium_rate_pct')}
            />
            <NumField
              label={t('policies.terms.minimumPremium')}
              suffix={ccy}
              value={form.minimum_premium}
              onChange={(v) => set({ minimum_premium: v })}
              message={message('minimum_premium')}
            />
            <NumField
              label={t('policies.terms.estimatedTurnover')}
              suffix={ccy}
              value={form.estimated_annual_turnover}
              onChange={(v) => set({ estimated_annual_turnover: v })}
              message={message('estimated_annual_turnover')}
            />
          </div>
        </Card>

        {/* Operation */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            {t('policies.termGroups.operation')}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <NumField
              label={t('policies.terms.discretionaryLimit')}
              suffix={ccy}
              value={form.discretionary_limit}
              onChange={(v) => set({ discretionary_limit: v })}
              message={message('discretionary_limit')}
            />
            <NumField
              label={t('policies.terms.waitingPeriod')}
              suffix={t('policies.terms.daysSuffix')}
              value={form.waiting_period_days}
              onChange={(v) => set({ waiting_period_days: v })}
              message={message('waiting_period_days')}
            />
            <NumField
              label={t('policies.terms.maxExtensionPeriod')}
              suffix={t('policies.terms.daysSuffix')}
              value={form.max_extension_period_days}
              onChange={(v) => set({ max_extension_period_days: v })}
              message={message('max_extension_period_days')}
            />
            <NumField
              label={t('policies.terms.maxPaymentTerms')}
              suffix={t('policies.terms.daysSuffix')}
              value={form.max_payment_terms_days}
              onChange={(v) => set({ max_payment_terms_days: v })}
              message={message('max_payment_terms_days')}
            />
            <Field label={t('policies.terms.declarationFrequency')}>
              <Select
                value={form.declaration_frequency}
                onChange={(e) =>
                  set({ declaration_frequency: e.target.value as DeclarationFrequency })
                }
              >
                {DECLARATION_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {t(`policies.frequencies.${f}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('policies.fields.notes')}>
              <Input value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
        </Card>
      </div>
    </div>
  )
}

/** Amount input with a currency/unit suffix; right-aligned numerals. */
function NumField({
  label,
  suffix,
  value,
  onChange,
  message,
}: {
  label: string
  suffix: string
  value: string
  onChange: (value: string) => void
  message: React.ReactNode
}) {
  return (
    <Field label={label}>
      <div className="relative">
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="num pr-16"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[12px] text-slate-400">
          {suffix}
        </span>
      </div>
      {message}
    </Field>
  )
}
