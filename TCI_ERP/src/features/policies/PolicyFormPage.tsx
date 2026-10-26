/**
 * Full-page policy create/edit form, grouped like the terms card.
 * Validation via validation.ts: red = blocking (mirrors DB constraints),
 * amber = advisory (never blocks). Amount inputs are currency-aware.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  AmountInput,
  Button,
  Card,
  DateInput,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  Spinner,
  SectionTitle,
} from '../../components/ui'
import { amountToPlain, parseAmount } from '../../components/ui/amount'
import { useCurrencies } from '../entities/api'
import { EntityPicker } from '../entities/EntityPicker'
import { useCreatePolicy, usePolicy, useUpdatePolicy } from './api'
import type { PolicyInput } from './api'
import { liabilityBasis, liabilityColumns } from './maxLiability'
import type { LiabilityBasis } from './maxLiability'
import { ChoiceField, MaxLiabilityField } from './termInputs'
import { validatePolicy } from './validation'
import type { PolicyFormValues } from './validation'
import { DECLARATION_FREQUENCIES, PRODUCT_STRUCTURES } from './types'
import type { DeclarationFrequency, ProductStructure } from './types'

interface FormState {
  entity_id: string
  policy_number: string
  product_structure: ProductStructure
  inception_date: string
  expiry_date: string
  currency_code: string
  insured_percentage: string
  /** One figure on one basis: the other column is saved as NULL. */
  max_liability_basis: LiabilityBasis
  max_liability_value: string
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
  max_liability_basis: 'amount',
  max_liability_value: '',
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
      const s = (v: number | null): string => amountToPlain(v)
      const basis = liabilityBasis(existing.max_liability_amount, existing.max_liability_premium_multiple)
      setForm({
        entity_id: existing.entity_id,
        policy_number: existing.policy_number,
        product_structure: existing.product_structure,
        inception_date: existing.inception_date,
        expiry_date: existing.expiry_date,
        currency_code: existing.currency_code,
        insured_percentage: s(existing.insured_percentage),
        max_liability_basis: basis,
        max_liability_value: s(
          basis === 'amount' ? existing.max_liability_amount : existing.max_liability_premium_multiple,
        ),
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
      insured_percentage: parseAmount(form.insured_percentage),
      ...liabilityColumns(form.max_liability_basis, parseAmount(form.max_liability_value)),
      nql_amount: parseAmount(form.nql_amount),
      deductible_each_loss: parseAmount(form.deductible_each_loss),
      aggregate_first_loss: parseAmount(form.aggregate_first_loss),
      premium_rate_pct: parseAmount(form.premium_rate_pct),
      minimum_premium: parseAmount(form.minimum_premium),
      estimated_annual_turnover: parseAmount(form.estimated_annual_turnover),
      discretionary_limit: parseAmount(form.discretionary_limit),
      waiting_period_days: parseAmount(form.waiting_period_days),
      max_extension_period_days: parseAmount(form.max_extension_period_days),
      max_payment_terms_days: parseAmount(form.max_payment_terms_days),
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
        <p className="mt-0.5 text-caption text-neg-500" role="alert">
          {t(`policies.validation.${error}`)}
        </p>
      )
    }
    if (warning) {
      return <p className="mt-0.5 text-caption text-warn-500">{t(`policies.validation.${warning}`)}</p>
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
  const backTo = isEdit && id ? `/policies/${id}` : '/policies?view=registry'

  return (
    <div>
      {/* Save and Cancel live once, in the bar pinned to the bottom of the
          window: the form is longer than a screen, and buttons only at its top
          meant scrolling back up after the last field. */}
      <PageHeader
        title={isEdit ? t('policies.editTitle', { number: form.policy_number }) : t('policies.newPolicy')}
        subtitle={
          <Link to={backTo} className="text-accent-700 hover:underline">
            {isEdit ? t('policies.form.backToPolicy') : t('policies.backToList')}
          </Link>
        }
      />

      <div className="flex max-w-4xl flex-col gap-5">
        {/* Contract */}
        <Card className="p-5">
          <SectionTitle className="mb-3">
            {t('policies.termGroups.contract')}
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t('policies.fields.policyholder')}>
              <EntityPicker
                value={form.entity_id || null}
                onChange={(id) => set({ entity_id: id ?? '' })}
                disabled={isEdit}
                invalid={Boolean(submitted && validation.errors.entity_id)}
                allowRequest
              />
              {message('entity_id')}
            </Field>
            <Field label={t('policies.fields.policyNumber')}>
              <Input
                value={form.policy_number}
                onChange={(e) => set({ policy_number: e.target.value })}
              />
              {message('policy_number')}
            </Field>
            <ChoiceField label={t('policies.fields.productStructure')}>
              <Segmented
                value={form.product_structure}
                ariaLabel={t('policies.fields.productStructure')}
                options={PRODUCT_STRUCTURES.map((s) => ({ key: s, label: t(`policies.structures.${s}`) }))}
                onChange={(key) => set({ product_structure: key as ProductStructure })}
              />
            </ChoiceField>
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
              <DateInput
                value={form.inception_date}
                onChange={(iso) => set({ inception_date: iso })}
                invalid={Boolean(submitted && validation.errors.inception_date)}
              />
              {message('inception_date')}
            </Field>
            <Field label={t('policies.fields.expiryDate')}>
              <DateInput
                value={form.expiry_date}
                min={form.inception_date || undefined}
                onChange={(iso) => set({ expiry_date: iso })}
                invalid={Boolean(submitted && validation.errors.expiry_date)}
              />
              {message('expiry_date')}
            </Field>
          </div>
        </Card>

        {/* Cover */}
        <Card className="p-5">
          <SectionTitle className="mb-3">
            {t('policies.termGroups.cover')}
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            <NumField
              label={t('policies.terms.insuredPercentage')}
              suffix="%"
              decimals={2}
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
            <MaxLiabilityField
              basis={form.max_liability_basis}
              onBasisChange={(basis) => set({ max_liability_basis: basis })}
              value={form.max_liability_value}
              onChange={(v) => set({ max_liability_value: v })}
              currency={ccy}
              invalid={Boolean(
                submitted && (validation.errors.max_liability_amount || validation.errors.max_liability_premium_multiple),
              )}
              message={message(
                form.max_liability_basis === 'multiple' && !validation.errors.max_liability_amount
                  ? 'max_liability_premium_multiple'
                  : 'max_liability_amount',
              )}
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
          <SectionTitle className="mb-3">
            {t('policies.termGroups.premium')}
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            <NumField
              label={t('policies.terms.premiumRate')}
              suffix="%"
              decimals={5}
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
          <SectionTitle className="mb-3">
            {t('policies.termGroups.operation')}
          </SectionTitle>
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
              decimals={0}
              value={form.waiting_period_days}
              onChange={(v) => set({ waiting_period_days: v })}
              message={message('waiting_period_days')}
            />
            <NumField
              label={t('policies.terms.maxExtensionPeriod')}
              suffix={t('policies.terms.daysSuffix')}
              decimals={0}
              value={form.max_extension_period_days}
              onChange={(v) => set({ max_extension_period_days: v })}
              message={message('max_extension_period_days')}
            />
            <NumField
              label={t('policies.terms.maxPaymentTerms')}
              suffix={t('policies.terms.daysSuffix')}
              decimals={0}
              value={form.max_payment_terms_days}
              onChange={(v) => set({ max_payment_terms_days: v })}
              message={message('max_payment_terms_days')}
            />
            <ChoiceField label={t('policies.terms.declarationFrequency')}>
              <Segmented
                value={form.declaration_frequency}
                ariaLabel={t('policies.terms.declarationFrequency')}
                options={DECLARATION_FREQUENCIES.map((f) => ({ key: f, label: t(`policies.frequencies.${f}`) }))}
                onChange={(key) => set({ declaration_frequency: key as DeclarationFrequency })}
              />
            </ChoiceField>
            <Field label={t('policies.fields.notes')}>
              <Input value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-6 -mb-6 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_-6px_rgb(0_36_60/0.12)] backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:-mb-7 lg:px-8">
        {saveError ? (
          <p className="mr-auto text-small text-neg-500" role="alert">
            {t('common.saveFailed')}
          </p>
        ) : (
          submitted &&
          blocked && (
            // Why Save is greyed out: the red messages are above, possibly
            // scrolled out of view.
            <p className="mr-auto text-small text-neg-500" role="alert">
              {t('policies.form.fixErrors')}
            </p>
          )
        )}
        <Button variant="secondary" onClick={() => void navigate(backTo)}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void handleSave()} disabled={submitted && blocked} loading={saving}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

/** Amount input with a currency/unit suffix; right-aligned, grouped numerals.
 * `decimals` defaults to money (2); `className` widens the room for a long suffix. */
function NumField({
  label,
  suffix,
  decimals = 2,
  className,
  value,
  onChange,
  message,
}: {
  label: string
  suffix: string
  decimals?: number
  className?: string
  value: string
  onChange: (value: string) => void
  message: React.ReactNode
}) {
  return (
    <Field label={label}>
      <AmountInput
        value={value}
        onChange={onChange}
        decimals={decimals}
        suffix={suffix}
        className={className}
      />
      {message}
    </Field>
  )
}
