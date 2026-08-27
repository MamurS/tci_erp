/** Row types mirroring the `tci` schema (migrations 0019, 0020). */

import type { UserRole } from '../../lib/roles'
import type { DeclarationFrequency, ProductStructure } from '../policies/types'

export const INSURANCE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'entity_resolution',
  'underwriting',
  'commercial_review',
  'sales_confirmation',
  'client_review',
  'accepted',
  'declined',
  'withdrawn',
  'bound',
] as const
export type InsuranceRequestStatus = (typeof INSURANCE_REQUEST_STATUSES)[number]

export const BUYER_RESOLUTION_STATUSES = [
  'pending_entity',
  'ready',
  'rating_done',
  'limit_done',
] as const
export type BuyerResolutionStatus = (typeof BUYER_RESOLUTION_STATUSES)[number]

/** Proposed policy terms carried by a submission (all nullable at draft;
 * commercial underwriting fills them in). Mirrors the term columns of
 * tci.insurance_requests, which shadow tci.policies. */
export interface ProposedTerms {
  product_structure: ProductStructure | null
  currency_code: string | null
  insured_percentage: number | null
  premium_rate_pct: number | null
  minimum_premium: number | null
  max_liability_amount: number | null
  max_liability_premium_multiple: number | null
  discretionary_limit: number | null
  nql_amount: number | null
  deductible_each_loss: number | null
  aggregate_first_loss: number | null
  waiting_period_days: number | null
  max_extension_period_days: number | null
  max_payment_terms_days: number | null
  declaration_frequency: DeclarationFrequency | null
  estimated_annual_turnover: number | null
}

/** The term fields commercial underwriting may edit, in display order. */
export const PROPOSED_TERM_FIELDS = [
  'product_structure',
  'currency_code',
  'insured_percentage',
  'premium_rate_pct',
  'minimum_premium',
  'max_liability_amount',
  'max_liability_premium_multiple',
  'discretionary_limit',
  'nql_amount',
  'deductible_each_loss',
  'aggregate_first_loss',
  'waiting_period_days',
  'max_extension_period_days',
  'max_payment_terms_days',
  'declaration_frequency',
  'estimated_annual_turnover',
] as const satisfies readonly (keyof ProposedTerms)[]

export interface InsuranceRequest extends ProposedTerms {
  id: string
  entity_id: string
  request_number: string
  status: InsuranceRequestStatus
  created_by: string
  created_by_role: UserRole | null
  assigned_sales: string | null
  assigned_commercial: string | null
  assigned_credit: string | null
  submitted_at: string | null
  decided_at: string | null
  decline_reason: string | null
  bound_policy_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InsuranceRequestWithRefs extends InsuranceRequest {
  legal_entities: { name: string; country_code: string } | null
  insurance_request_buyers: { id: string }[]
}

export interface InsuranceRequestBuyer {
  id: string
  request_id: string
  entity_id: string | null
  proposed_name: string | null
  requested_amount: number
  requested_payment_terms_days: number | null
  resolution_status: BuyerResolutionStatus
  created_by: string
  created_at: string
}

export interface RequestBuyerWithRefs extends InsuranceRequestBuyer {
  legal_entities: { name: string; country_code: string } | null
}

export interface InsuranceRequestHistoryRow {
  id: string
  request_id: string
  from_status: InsuranceRequestStatus
  to_status: InsuranceRequestStatus
  changed_by: string
  changed_at: string
  comment: string | null
}

/** tci.workflow_settings (single row). */
export interface WorkflowSettings {
  id: boolean
  sales_window_hours: number
  updated_by: string | null
  updated_at: string
}

export interface RequestBuyerInput {
  entity_id: string | null
  proposed_name: string | null
  requested_amount: number
  requested_payment_terms_days: number | null
}
