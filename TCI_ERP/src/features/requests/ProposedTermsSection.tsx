/** Proposed policy terms of a submission. Read-only for everyone except
 * commercial underwriting, which shapes them during commercial_review;
 * they become the wording of the policy at bind. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, Card, Field, Segmented, Select, SectionTitle } from '../../components/ui'
import { refusalOr } from '../../lib/optimistic'
import { amountToPlain, parseAmount } from '../../components/ui/amount'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH, formatAmount, formatPercent } from '../../lib/format'
import { useCurrencies } from '../entities/api'
import { liabilityBasis, liabilityColumns } from '../policies/maxLiability'
import type { LiabilityBasis } from '../policies/maxLiability'
import { ChoiceField, MaxLiabilityField } from '../policies/termInputs'
import { DECLARATION_FREQUENCIES, PRODUCT_STRUCTURES } from '../policies/types'
import { useUpdateProposedTerms } from './api'
import { canEditTerms } from './machine'
import { PROPOSED_TERM_FIELDS } from './types'
import type { InsuranceRequestWithRefs, ProposedTerms } from './types'

/** How each term renders and parses. Money and percentages are numeric;
 * the two enums and the currency are selects; the rest are day counts. */
const FIELD_KIND: Record<keyof ProposedTerms, 'money' | 'percent' | 'rate' | 'days' | 'enum'> = {
  product_structure: 'enum',
  currency_code: 'enum',
  insured_percentage: 'percent',
  premium_rate_pct: 'rate',
  minimum_premium: 'money',
  max_liability_amount: 'money',
  max_liability_premium_multiple: 'rate',
  discretionary_limit: 'money',
  nql_amount: 'money',
  deductible_each_loss: 'money',
  aggregate_first_loss: 'money',
  waiting_period_days: 'days',
  max_extension_period_days: 'days',
  max_payment_terms_days: 'days',
  declaration_frequency: 'enum',
  estimated_annual_turnover: 'money',
}

type Draft = Record<string, string>

/** The draft keeps the liability as ONE figure on one basis (maxLiability.ts). */
const BASIS = '__liability_basis'
const LIABILITY = '__liability_value'

export function ProposedTermsSection({ request }: { request: InsuranceRequestWithRefs }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { roles } = useAuth()
  const { data: currencies } = useCurrencies()
  const update = useUpdateProposedTerms(request.id)

  const editable = canEditTerms(request.status, roles)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) return
    const next: Draft = {}
    for (const key of PROPOSED_TERM_FIELDS) {
      const value = request[key]
      next[key] = FIELD_KIND[key] === 'enum' ? (value ?? '').toString() : amountToPlain(value)
    }
    const basis = liabilityBasis(request.max_liability_amount, request.max_liability_premium_multiple)
    next[BASIS] = basis
    next[LIABILITY] = basis === 'amount' ? next.max_liability_amount : next.max_liability_premium_multiple
    setDraft(next)
  }, [editing, request])

  const save = async () => {
    setError(null)
    const patch: Record<string, unknown> = {}
    for (const key of PROPOSED_TERM_FIELDS) {
      const raw = (draft[key] ?? '').trim()
      if (FIELD_KIND[key] === 'enum') {
        patch[key] = raw || null
      } else {
        patch[key] = parseAmount(raw)
      }
    }
    Object.assign(patch, liabilityColumns((draft[BASIS] ?? 'amount') as LiabilityBasis, parseAmount(draft[LIABILITY] ?? '')))
    try {
      await update.mutateAsync(patch as Partial<ProposedTerms>)
      setEditing(false)
    } catch (failure) {
      setError(t(refusalOr(failure, 'common.saveFailed')))
    }
  }

  const currency = request.currency_code ?? ''

  /** Places and unit of a numeric term while it is being edited. */
  const entry = (key: keyof ProposedTerms): { decimals: number; suffix?: string } => {
    switch (FIELD_KIND[key]) {
      case 'money':
        return { decimals: 2, suffix: draft.currency_code || currency || undefined }
      case 'percent':
        return { decimals: 2, suffix: '%' }
      case 'rate':
        // numeric(8,5) for the premium rate, numeric(6,2) for the multiple.
        return key === 'premium_rate_pct' ? { decimals: 5, suffix: '%' } : { decimals: 2 }
      case 'days':
        return { decimals: 0, suffix: t('policies.terms.daysSuffix') }
      case 'enum':
        return { decimals: 0 }
    }
  }

  const display = (key: keyof ProposedTerms): string => {
    if (key === 'max_liability_amount') {
      // The basis that is stated, never an empty «× premium —» row beside it.
      const parts = [
        request.max_liability_amount !== null
          ? `${formatAmount(Number(request.max_liability_amount), locale)} ${currency}`.trim()
          : null,
        request.max_liability_premium_multiple !== null
          ? t('policies.terms.premiumMultiple', {
              value: formatAmount(Number(request.max_liability_premium_multiple), locale, 1),
            })
          : null,
      ].filter(Boolean)
      return parts.length ? parts.join(' / ') : EM_DASH
    }
    const value = request[key]
    if (value === null || value === undefined || value === '') return EM_DASH
    switch (FIELD_KIND[key]) {
      case 'enum':
        if (key === 'currency_code') return String(value)
        if (key === 'product_structure') return t(`policies.structures.${String(value)}`)
        return t(`policies.frequencies.${String(value)}`)
      case 'percent':
        return formatPercent(Number(value) / 100, locale)
      case 'rate':
        return formatAmount(Number(value), locale, 2)
      case 'days':
        return t('policies.terms.days', { count: Number(value) })
      case 'money':
        return `${formatAmount(Number(value), locale)} ${currency}`.trim()
    }
  }

  return (
    <Card className="p-5">
      <SectionTitle
        className="mb-3"
        actions={
          editable &&
          (editing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => void save()} loading={update.isPending}>
                {t('common.save')}
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          ))
        }
      >
        {t('requests.proposedTerms')}
      </SectionTitle>

      {!editable && !editing && (
        <p className="mb-3 text-xs text-slate-400">{t('requests.termsReadOnly')}</p>
      )}

      {editing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {PROPOSED_TERM_FIELDS.map((key) =>
            key === 'max_liability_premium_multiple' ? null : key === 'max_liability_amount' ? (
              <div key={key} className="sm:col-span-2">
                <MaxLiabilityField
                  basis={(draft[BASIS] ?? 'amount') as LiabilityBasis}
                  onBasisChange={(basis) => setDraft((d) => ({ ...d, [BASIS]: basis }))}
                  value={draft[LIABILITY] ?? ''}
                  onChange={(plain) => setDraft((d) => ({ ...d, [LIABILITY]: plain }))}
                  currency={draft.currency_code || currency || undefined}
                  label={t('requests.terms.max_liability_amount')}
                />
              </div>
            ) : key === 'product_structure' || key === 'declaration_frequency' ? (
              // Two or three fixed choices: a switch, not a dropdown.
              <ChoiceField
                key={key}
                label={t(`requests.terms.${key}`)}
                className={key === 'product_structure' ? 'sm:col-span-2' : ''}
              >
                <Segmented
                  value={draft[key] ?? ''}
                  ariaLabel={t(`requests.terms.${key}`)}
                  options={(key === 'product_structure' ? PRODUCT_STRUCTURES : DECLARATION_FREQUENCIES).map((v) => ({
                    key: v,
                    label: t(`policies.${key === 'product_structure' ? 'structures' : 'frequencies'}.${v}`),
                  }))}
                  onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                />
              </ChoiceField>
            ) : (
            <Field key={key} label={t(`requests.terms.${key}`)}>
              {key === 'currency_code' ? (
                <Select
                  value={draft[key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                >
                  <option value="">{t('common.notSelected')}</option>
                  {(currencies ?? []).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              ) : (
                <AmountInput
                  {...entry(key)}
                  value={draft[key] ?? ''}
                  onChange={(plain) => setDraft((d) => ({ ...d, [key]: plain }))}
                />
              )}
            </Field>
            ),
          )}
        </div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[13px]">
          {PROPOSED_TERM_FIELDS.filter((key) => key !== 'max_liability_premium_multiple').map((key) => (
            <div key={key} className="contents">
              <dt className="text-slate-500">{t(`requests.terms.${key}`)}</dt>
              <dd className="num text-right text-slate-800">{display(key)}</dd>
            </div>
          ))}
        </dl>
      )}

      {error && (
        <p className="mt-2 text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Card>
  )
}
