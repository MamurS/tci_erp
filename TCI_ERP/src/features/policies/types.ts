/** Row types mirroring the `tci` schema (migration 0012). */

export const PRODUCT_STRUCTURES = ['whole_turnover', 'key_buyers', 'single_buyer'] as const
export type ProductStructure = (typeof PRODUCT_STRUCTURES)[number]

export const POLICY_STATUSES = ['draft', 'active', 'suspended', 'expired', 'cancelled', 'annulled'] as const
export type PolicyStatus = (typeof POLICY_STATUSES)[number]

export const DECLARATION_FREQUENCIES = ['monthly', 'quarterly'] as const
export type DeclarationFrequency = (typeof DECLARATION_FREQUENCIES)[number]

export interface Policy {
  id: string
  policyholder_id: string
  policy_number: string
  product_structure: ProductStructure
  status: PolicyStatus
  inception_date: string
  expiry_date: string
  currency_code: string
  insured_percentage: number
  max_liability_amount: number | null
  max_liability_premium_multiple: number | null
  nql_amount: number
  deductible_each_loss: number | null
  aggregate_first_loss: number | null
  premium_rate_pct: number
  minimum_premium: number
  estimated_annual_turnover: number | null
  discretionary_limit: number
  waiting_period_days: number
  max_extension_period_days: number
  max_payment_terms_days: number
  declaration_frequency: DeclarationFrequency
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface PolicyWithRefs extends Policy {
  policyholders: { name: string } | null
}

export interface PolicyStatusHistoryRow {
  id: string
  policy_id: string
  from_status: PolicyStatus
  to_status: PolicyStatus
  changed_by: string
  changed_at: string
  comment: string | null
}
