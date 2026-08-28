/** Turnover declarations (migrations 0026-0030).
 *
 * A declaration is the document a whole-turnover policy is priced on: what
 * the policyholder sold, to whom, in a period. Premium is earned from it and
 * compliance is measured by it, so nothing here is cosmetic.
 */

export const DECLARATION_STATUSES = [
  'draft',
  'submitted',
  'accepted',
  'disputed',
  'corrected',
] as const
export type DeclarationStatus = (typeof DECLARATION_STATUSES)[number]

/** Why a line's turnover is (or is not) insured. */
export const COVERAGE_BASES = ['limit', 'discretionary', 'uncovered_excess'] as const
export type CoverageBasis = (typeof COVERAGE_BASES)[number]

export type DeclarationFrequency = 'monthly' | 'quarterly'

export interface Declaration {
  id: string
  policy_id: string
  period_start: string
  period_end: string
  status: DeclarationStatus
  currency_code: string
  total_insurable_turnover: number
  note: string | null
  submitted_by: string | null
  submitted_at: string | null
  accepted_by: string | null
  accepted_at: string | null
  disputed_by: string | null
  disputed_at: string | null
  dispute_note: string | null
  supersedes_id: string | null
  superseded_at: string | null
  created_at: string
  updated_at: string
}

/** A line as tci.v_declaration_lines serves it: the coverage split resolved,
 * frozen once accepted and computed live before that. */
export interface DeclarationLine {
  id: string
  declaration_id: string
  policy_id: string
  entity_id: string
  entity_name: string
  declaration_status: DeclarationStatus
  currency_code: string
  insurable_turnover: number
  /** NULL means the policyholder did not report ageing — never treat as 0. */
  overdue_amount: number | null
  line_note: string | null
  is_frozen: boolean
  coverage_basis: CoverageBasis
  covered_amount: number
  uncovered_excess: number
  created_at: string
  updated_at: string
}

/** tci.v_declaration_totals. */
export interface DeclarationTotals {
  declaration_id: string
  policy_id: string
  period_start: string
  period_end: string
  status: DeclarationStatus
  currency_code: string
  total_insurable_turnover: number
  covered_turnover: number
  uncovered_excess: number
  line_count: number
  uncovered_line_count: number
  reported_overdue: number
  split_frozen: boolean | null
}

export interface DeclarationWithTotals extends Declaration {
  policy_number?: string
  totals?: DeclarationTotals
}
