/** Constraint validation: red mirrors DB CHECKs (blocking), amber advises. */

import { describe, expect, it } from 'vitest'

import { isValid, validatePolicy } from './validation'
import type { PolicyFormValues } from './validation'

const VALID: PolicyFormValues = {
  entity_id: 'ph-1',
  policy_number: 'MIG-TCI-2026-001',
  status: 'draft',
  inception_date: '2026-01-01',
  expiry_date: '2026-12-31',
  insured_percentage: 85,
  max_liability_amount: 5_000_000_000,
  max_liability_premium_multiple: null,
  nql_amount: 20_000_000,
  deductible_each_loss: null,
  aggregate_first_loss: null,
  premium_rate_pct: 0.35,
  minimum_premium: 100_000_000,
  estimated_annual_turnover: 60_000_000_000,
  discretionary_limit: 500_000_000,
  waiting_period_days: 180,
  max_extension_period_days: 60,
  max_payment_terms_days: 90,
}

describe('validatePolicy — blocking errors (DB constraint mirrors)', () => {
  it('accepts a complete, consistent policy', () => {
    const v = validatePolicy(VALID)
    expect(v.errors).toEqual({})
    expect(isValid(v)).toBe(true)
  })

  it('requires the identity fields and all mandatory numbers', () => {
    const v = validatePolicy({
      ...VALID,
      entity_id: '',
      policy_number: '  ',
      insured_percentage: null,
      nql_amount: null,
      premium_rate_pct: null,
      minimum_premium: null,
      discretionary_limit: null,
      waiting_period_days: null,
      max_extension_period_days: null,
      max_payment_terms_days: null,
    })
    for (const field of [
      'entity_id', 'policy_number', 'insured_percentage', 'nql_amount',
      'premium_rate_pct', 'minimum_premium', 'discretionary_limit',
      'waiting_period_days', 'max_extension_period_days', 'max_payment_terms_days',
    ]) {
      expect(v.errors[field]).toBe('required')
    }
  })

  it('enforces expiry after inception (policies_period)', () => {
    const v = validatePolicy({ ...VALID, expiry_date: '2026-01-01' })
    expect(v.errors.expiry_date).toBe('periodOrder')
  })

  it('enforces insured percentage 50–100 (policies_insured_percentage)', () => {
    expect(validatePolicy({ ...VALID, insured_percentage: 49 }).errors.insured_percentage).toBe('insuredPctRange')
    expect(validatePolicy({ ...VALID, insured_percentage: 101 }).errors.insured_percentage).toBe('insuredPctRange')
    expect(validatePolicy({ ...VALID, insured_percentage: 50 }).errors.insured_percentage).toBeUndefined()
  })

  it('requires a liability cap for non-draft statuses only (policies_max_liability_required)', () => {
    const uncapped = { ...VALID, max_liability_amount: null, max_liability_premium_multiple: null }
    expect(validatePolicy({ ...uncapped, status: 'draft' }).errors.max_liability_amount).toBeUndefined()
    expect(validatePolicy({ ...uncapped, status: 'active' }).errors.max_liability_amount).toBe('maxLiabilityRequired')
    // Either cap alone satisfies the constraint.
    expect(
      validatePolicy({ ...uncapped, status: 'active', max_liability_premium_multiple: 30 })
        .errors.max_liability_amount,
    ).toBeUndefined()
  })

  it('rejects negative amounts (policies_non_negative)', () => {
    const v = validatePolicy({ ...VALID, minimum_premium: -1, deductible_each_loss: -5 })
    expect(v.errors.minimum_premium).toBe('nonNegative')
    expect(v.errors.deductible_each_loss).toBe('nonNegative')
  })
})

describe('validatePolicy — advisory warnings (amber, never blocking)', () => {
  it('warns on cover outside the typical 80–90% band without blocking', () => {
    const v = validatePolicy({ ...VALID, insured_percentage: 70 })
    expect(v.warnings.insured_percentage).toBe('insuredPctAtypical')
    expect(isValid(v)).toBe(true)
  })

  it('warns when the discretionary limit exceeds the max liability', () => {
    const v = validatePolicy({ ...VALID, discretionary_limit: 6_000_000_000 })
    expect(v.warnings.discretionary_limit).toBe('dlAboveMaxLiability')
    expect(isValid(v)).toBe(true)
  })

  it('warns on premium rate above 5% of turnover', () => {
    const v = validatePolicy({ ...VALID, premium_rate_pct: 7 })
    expect(v.warnings.premium_rate_pct).toBe('premiumRateHigh')
    expect(isValid(v)).toBe(true)
  })

  it('warns when minimum premium exceeds rate × estimated turnover', () => {
    const v = validatePolicy({ ...VALID, minimum_premium: 300_000_000 })
    expect(v.warnings.minimum_premium).toBe('minPremiumAboveExpected')
    expect(isValid(v)).toBe(true)
  })
})

describe('i18n coverage for validation messages', () => {
  it.each(['en', 'ru', 'uz'])('every emitted key exists in %s', async (lang) => {
    const catalog = (await import(`../../i18n/locales/${lang}.json`)) as {
      default: { policies: { validation: Record<string, string> } }
    }
    const keys = [
      'required', 'periodOrder', 'insuredPctRange', 'insuredPctAtypical',
      'maxLiabilityRequired', 'nonNegative', 'dlAboveMaxLiability',
      'premiumRateHigh', 'minPremiumAboveExpected',
    ]
    for (const key of keys) {
      expect(catalog.default.policies.validation[key], `missing ${lang}:${key}`).toBeTruthy()
    }
  })
})
