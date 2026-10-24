/**
 * What a task SAYS beyond its title (pure).
 *
 *  * Origin comments — the human text that already lives on the task's
 *    source object: a request's justification, the policyholder's portal
 *    comment, a hold comment, a decline reason. They are SHOWN from where
 *    they are, never copied into the task (ORIGIN_SOURCES says where, per
 *    task type).
 *  * The system note of an automatic task — rendered from task_type + params
 *    as an i18n key, never stored as text (systemNote).
 *  * Whether a task is automatic: generated on read by refresh_agenda (no
 *    source event), as opposed to opened by someone's action (isAutomatic).
 */

import type { Task, TaskType } from './types'

/** Who wrote an origin comment, as the thread labels them. */
export type OriginAuthor =
  | 'policyholder'
  | 'requester'
  | 'sales'
  | 'claims'
  | 'informationManager'
  | 'validationAuthor'
  | 'validator'

export type OriginSource =
  /** Carried in the task's own params (copied there by the event mapping). */
  | { kind: 'param'; param: string; author: OriginAuthor }
  /** credit_limit_requests.justification — the requester's, or the
   * policyholder's when it came from the portal. */
  | { kind: 'limitJustification' }
  /** client_buyer_proposals.justification. */
  | { kind: 'proposalJustification' }
  /** entity_requests.note — what the requester wrote. */
  | { kind: 'entityRequestNote' }
  /** limit_validations.comment — what the decision's author asked the
   * validator (0060). */
  | { kind: 'validationComment' }
  /** limit_validations.resolution_comment — the validator's answer (0060). */
  | { kind: 'validationResolution' }

export const ORIGIN_SOURCES: Readonly<Partial<Record<TaskType, readonly OriginSource[]>>> = {
  limit_needs_decision: [{ kind: 'limitJustification' }],
  limit_escalated: [{ kind: 'limitJustification' }],
  limit_held: [{ kind: 'param', param: 'comment', author: 'sales' }],
  submission_sales_confirmation: [{ kind: 'param', param: 'client_comment', author: 'policyholder' }],
  submission_declined: [{ kind: 'param', param: 'reason', author: 'policyholder' }],
  claim_info_requested: [{ kind: 'param', param: 'comment', author: 'claims' }],
  claim_declined_review: [{ kind: 'param', param: 'reason', author: 'claims' }],
  entity_request_resolved: [{ kind: 'param', param: 'note', author: 'informationManager' }],
  entity_requested: [{ kind: 'entityRequestNote' }],
  statements_requested: [{ kind: 'entityRequestNote' }],
  buyer_needs_entity: [{ kind: 'proposalJustification' }],
  // 0060: the task carries neither comment; both live on the step
  limit_validation: [{ kind: 'validationComment' }],
  limit_validation_result: [{ kind: 'validationResolution' }],
  limit_validation_fyi: [{ kind: 'validationComment' }],
  // 0073: the proposal's reason and the answer ride on the task
  rating_proposal: [{ kind: 'param', param: 'reason', author: 'validationAuthor' }],
  rating_proposal_result: [{ kind: 'param', param: 'comment', author: 'validator' }],
  // 0057: the policyholder's latest portal comment and the note the draft
  // was sent for review with, both carried on the task by the mapping
  contract_review: [
    { kind: 'param', param: 'client_comment', author: 'policyholder' },
    { kind: 'param', param: 'comment', author: 'requester' },
  ],
}

/** Origin comments carried in params, ready to show without a fetch. */
export function paramComments(task: Pick<Task, 'task_type' | 'params' | 'created_at'>): {
  author: OriginAuthor
  body: string
  at: string
}[] {
  return (ORIGIN_SOURCES[task.task_type] ?? []).flatMap((source) => {
    if (source.kind !== 'param') return []
    const body = task.params?.[source.param]
    return typeof body === 'string' && body.trim() !== ''
      ? [{ author: source.author, body: body.trim(), at: task.created_at }]
      : []
  })
}

/** Generated on read (refresh_agenda) rather than opened by someone's
 * action: the ⚡ marker and the system note in place of a person. */
export function isAutomatic(task: Pick<Task, 'source_event_id'>): boolean {
  return task.source_event_id === null
}

/** A note as data: the key and RAW values (ISO dates, numbers, user ids).
 * The screen formats them in the viewer's language. */
export interface SystemNote {
  key: string
  values: Record<string, unknown>
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The system note of a task, or null. Automatic tasks always have one; an
 * escalation has one too, because the person it names did not write it —
 * the authority rule did.
 */
export function systemNote(task: Pick<Task, 'task_type' | 'params' | 'source_event_id'>): SystemNote | null {
  const p = task.params ?? {}
  switch (task.task_type) {
    case 'rating_new_statements':
      return {
        key: 'agenda.note.rating_new_statements',
        values: {
          fiscalYear: p.fiscal_year,
          fiscalQuarter: p.fiscal_quarter,
          statementKind: p.statement_kind,
          addedBy: p.added_by,
          addedAt: p.added_at,
          grade: p.grade,
          score: p.score,
          ratedPeriodEnd: p.rated_period_end,
          limits: num(p.limits_in_force) ?? 0,
        },
      }
    case 'rating_stale':
      return { key: 'agenda.note.rating_stale', values: {} }
    case 'buyer_needs_rating':
      return { key: 'agenda.note.buyer_needs_rating', values: {} }
    case 'limit_review_due':
      return {
        key: 'agenda.note.limit_review_due',
        values: { validUntil: p.valid_until, amount: p.amount, currency: p.currency },
      }
    case 'instalment_due':
    case 'instalment_overdue':
      return {
        key: task.task_type === 'instalment_due' ? 'agenda.note.instalment_due' : 'agenda.note.instalment',
        values: { sequence: p.sequence, dueDate: p.due_date, amount: p.amount, currency: p.currency },
      }
    case 'declaration_due':
    case 'declaration_overdue':
      return { key: 'agenda.note.declaration_due', values: { periodStart: p.period_start, periodEnd: p.period_end } }
    case 'noa_matured_to_claim':
    case 'claim_ready_to_file':
      return {
        key: 'agenda.note.noa_matured',
        values: { claimableFrom: p.claimable_from, amount: p.amount, currency: p.currency },
      }
    case 'group_exposure_near_limit':
      return {
        key: 'agenda.note.group_exposure_near_limit',
        values: { exposure: p.exposure_uzs, limit: p.limit_uzs, pct: p.utilisation_pct },
      }
    case 'offer_expiring':
    case 'offer_expired':
      return {
        key: `agenda.note.${task.task_type}`,
        values: { number: p.offer_number, validUntil: p.valid_until },
      }
    case 'premium_payment_unmatched':
      return {
        key: 'agenda.note.premium_payment_unmatched',
        values: { lines: num(p.count) ?? 0, file: p.file_name },
      }
    case 'group_limit_missing':
      return {
        key: 'agenda.note.group_limit_missing',
        values: { members: num(p.members_with_limits) ?? 0, exposure: p.exposure_uzs },
      }
    case 'limit_escalated':
      if (p.reason === 'group_limit') {
        return {
          key: 'agenda.note.limit_escalated_group',
          values: { exposure: p.exposure_after_uzs, cap: p.group_limit_uzs, user: p.escalated_by },
        }
      }
      return {
        key: num(p.authority_uzs) === null ? 'agenda.note.limit_escalated_noAuthority' : 'agenda.note.limit_escalated',
        values: {
          amount: p.amount,
          currency: p.currency,
          amountUzs: p.amount_uzs,
          band: p.grade_band,
          user: p.escalated_by,
          authority: p.authority_uzs,
        },
      }
    default:
      return null
  }
}
