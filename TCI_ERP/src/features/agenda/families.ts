/**
 * Task families and type tags (pure). A family is what the filter chips
 * offer — derived from the task-type catalogue, so a new type cannot be
 * forgotten: TASK_FAMILY is a Record over every TaskType and the compiler
 * refuses a missing one. A tag is the small label on a row; it is the only
 * colour a row carries besides its due label and its left stripe.
 */

import type { TaskType } from './types'

export const FAMILIES = ['premium', 'limits', 'claims', 'declarations', 'groups', 'submissions', 'contracts', 'data'] as const
export type Family = (typeof FAMILIES)[number]

export const TASK_FAMILY: Readonly<Record<TaskType, Family>> = {
  instalment_due: 'premium',
  instalment_overdue: 'premium',
  premium_payment_unmatched: 'premium',

  limit_needs_decision: 'limits',
  limit_escalated: 'limits',
  limit_held: 'limits',
  limit_review_due: 'limits',
  rating_stale: 'limits',
  rating_new_statements: 'limits',
  buyer_needs_rating: 'limits',
  noa_credit_review: 'limits',
  limit_validation: 'limits',
  limit_validation_result: 'limits',
  adt_review: 'limits',

  noa_matured_to_claim: 'claims',
  claim_ready_to_file: 'claims',
  claim_submitted: 'claims',
  claim_info_requested: 'claims',
  claim_awaiting_payment: 'claims',
  claim_limit_reinstatement: 'claims',
  claim_declined_review: 'claims',

  declaration_due: 'declarations',
  declaration_overdue: 'declarations',
  declaration_awaiting_acceptance: 'declarations',
  uncovered_excess_review: 'declarations',

  group_exposure_near_limit: 'groups',
  group_limit_missing: 'groups',

  submission_commercial_review: 'submissions',
  submission_sales_confirmation: 'submissions',
  submission_accepted: 'submissions',
  submission_declined: 'submissions',
  buyer_needs_entity: 'submissions',

  entity_requested: 'data',
  statements_requested: 'data',
  entity_request_resolved: 'data',
  limit_information_needed: 'data',

  contract_review: 'contracts',

  offer_viewed: 'submissions',
  offer_expiring: 'submissions',
  offer_expired: 'submissions',
}

export const TAGS = [
  'premium',
  'limit',
  'escalated',
  'validation',
  'adt',
  'rating',
  'claim',
  'declaration',
  'group',
  'submission',
  'contract',
  'data',
] as const
export type Tag = (typeof TAGS)[number]

export const TASK_TAG: Readonly<Record<TaskType, Tag>> = {
  instalment_due: 'premium',
  instalment_overdue: 'premium',
  premium_payment_unmatched: 'premium',
  limit_needs_decision: 'limit',
  limit_escalated: 'escalated',
  limit_held: 'limit',
  limit_review_due: 'limit',
  noa_credit_review: 'limit',
  limit_validation: 'validation',
  limit_validation_result: 'validation',
  adt_review: 'adt',
  rating_stale: 'rating',
  rating_new_statements: 'rating',
  buyer_needs_rating: 'rating',
  noa_matured_to_claim: 'claim',
  claim_ready_to_file: 'claim',
  claim_submitted: 'claim',
  claim_info_requested: 'claim',
  claim_awaiting_payment: 'claim',
  claim_limit_reinstatement: 'claim',
  claim_declined_review: 'claim',
  declaration_due: 'declaration',
  declaration_overdue: 'declaration',
  declaration_awaiting_acceptance: 'declaration',
  uncovered_excess_review: 'declaration',
  group_exposure_near_limit: 'group',
  group_limit_missing: 'group',
  submission_commercial_review: 'submission',
  submission_sales_confirmation: 'submission',
  submission_accepted: 'submission',
  submission_declined: 'submission',
  buyer_needs_entity: 'submission',
  entity_requested: 'data',
  statements_requested: 'data',
  entity_request_resolved: 'data',
  limit_information_needed: 'data',
  contract_review: 'contract',
  offer_viewed: 'submission',
  offer_expiring: 'submission',
  offer_expired: 'submission',
}

/** Badge tone per tag: an escalation is amber and a claim red, as on the
 * owner's mockup; everything else neutral, so colour keeps its meaning. */
export const TAG_TONE: Readonly<Record<Tag, 'neutral' | 'warn' | 'neg'>> = {
  premium: 'neutral',
  limit: 'neutral',
  escalated: 'warn',
  // a decision nobody may finalise until it is validated
  validation: 'warn',
  // the buyer's auto decision threshold (0061): suspended or used up
  adt: 'neutral',
  rating: 'neutral',
  claim: 'neg',
  declaration: 'neutral',
  group: 'neutral',
  submission: 'neutral',
  contract: 'neutral',
  data: 'neutral',
}

/** Families present on the board, in display order, with their counts. */
export function familyCounts<T extends { task_type: TaskType }>(
  tasks: readonly T[],
): { family: Family; count: number }[] {
  const counts = new Map<Family, number>()
  for (const task of tasks) {
    const family = TASK_FAMILY[task.task_type]
    counts.set(family, (counts.get(family) ?? 0) + 1)
  }
  return FAMILIES.filter((f) => counts.has(f)).map((family) => ({ family, count: counts.get(family) ?? 0 }))
}
