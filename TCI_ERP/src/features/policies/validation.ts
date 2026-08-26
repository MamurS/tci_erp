/**
 * Policy form validation — pure module mirroring the DB constraints of
 * migration 0012. Blocking errors (red) match CHECK constraints / NOT NULLs;
 * warnings (amber) are advisory underwriting sanity checks that never block
 * saving (DESIGN.md: the analyst's figure is the source of truth).
 * Values are i18n keys under policies.validation.*.
 */

import type { PolicyStatus } from './types'

export interface PolicyFormValues {
  entity_id: string
  policy_number: string
  status: PolicyStatus
  inception_date: string
  expiry_date: string
  insured_percentage: number | null
  max_liability_amount: number | null
  max_liability_premium_multiple: number | null
  nql_amount: number | null
  deductible_each_loss: number | null
  aggregate_first_loss: number | null
  premium_rate_pct: number | null
  minimum_premium: number | null
  estimated_annual_turnover: number | null
  discretionary_limit: number | null
  waiting_period_days: number | null
  max_extension_period_days: number | null
  max_payment_terms_days: number | null
}

export interface PolicyValidation {
  /** field -> i18n key; presence blocks saving (mirrors DB constraints). */
  errors: Record<string, string>
  /** field -> i18n key; advisory only, never blocks. */
  warnings: Record<string, string>
}

const REQUIRED_NUMBERS = [
  'insured_percentage',
  'nql_amount',
  'premium_rate_pct',
  'minimum_premium',
  'discretionary_limit',
  'waiting_period_days',
  'max_extension_period_days',
  'max_payment_terms_days',
] as const

export function validatePolicy(values: PolicyFormValues): PolicyValidation {
  const errors: Record<string, string> = {}
  const warnings: Record<string, string> = {}

  if (!values.entity_id) errors.entity_id = 'required'
  if (!values.policy_number.trim()) errors.policy_number = 'required'
  if (!values.inception_date) errors.inception_date = 'required'
  if (!values.expiry_date) errors.expiry_date = 'required'

  // CHECK policies_period
  if (
    values.inception_date &&
    values.expiry_date &&
    values.expiry_date <= values.inception_date
  ) {
    errors.expiry_date = 'periodOrder'
  }

  for (const field of REQUIRED_NUMBERS) {
    if (values[field] === null) errors[field] = 'required'
  }

  // CHECK policies_insured_percentage (50..100)
  const pct = values.insured_percentage
  if (pct !== null && (pct < 50 || pct > 100)) {
    errors.insured_percentage = 'insuredPctRange'
  }
  // Advisory: TCI cover is typically 80-90%.
  if (pct !== null && pct >= 50 && pct <= 100 && (pct < 80 || pct > 90)) {
    warnings.insured_percentage = 'insuredPctAtypical'
  }

  // CHECK policies_max_liability_required (non-draft needs a liability cap)
  if (
    values.status !== 'draft' &&
    values.max_liability_amount === null &&
    values.max_liability_premium_multiple === null
  ) {
    errors.max_liability_amount = 'maxLiabilityRequired'
  }

  // CHECK policies_non_negative
  const nonNegative: (keyof PolicyFormValues)[] = [
    'premium_rate_pct', 'minimum_premium', 'nql_amount', 'discretionary_limit',
    'waiting_period_days', 'max_extension_period_days', 'max_payment_terms_days',
  ]
  for (const field of nonNegative) {
    const v = values[field]
    if (typeof v === 'number' && v < 0) errors[field] = 'nonNegative'
  }
  for (const field of ['max_liability_amount', 'max_liability_premium_multiple', 'deductible_each_loss', 'aggregate_first_loss', 'estimated_annual_turnover'] as const) {
    const v = values[field]
    if (v !== null && v < 0) errors[field] = 'nonNegative'
  }

  // Advisory: DL above the absolute max liability makes self-underwriting moot.
  if (
    values.discretionary_limit !== null &&
    values.max_liability_amount !== null &&
    values.discretionary_limit > values.max_liability_amount
  ) {
    warnings.discretionary_limit = 'dlAboveMaxLiability'
  }

  // Advisory: premium rate is a % of turnover; >5% is far outside TCI practice.
  if (values.premium_rate_pct !== null && values.premium_rate_pct > 5) {
    warnings.premium_rate_pct = 'premiumRateHigh'
  }

  // Advisory: minimum premium looks inconsistent with rate x estimated turnover.
  if (
    values.minimum_premium !== null &&
    values.premium_rate_pct !== null &&
    values.estimated_annual_turnover !== null &&
    values.estimated_annual_turnover > 0 &&
    values.minimum_premium > (values.premium_rate_pct / 100) * values.estimated_annual_turnover
  ) {
    warnings.minimum_premium = 'minPremiumAboveExpected'
  }

  return { errors, warnings }
}

export function isValid(validation: PolicyValidation): boolean {
  return Object.keys(validation.errors).length === 0
}
