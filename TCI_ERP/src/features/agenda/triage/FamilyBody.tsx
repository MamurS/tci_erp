/**
 * The middle of the triage panel: what is needed to understand the task —
 * a three-figure strip, the object's key facts, blocking warnings. Per
 * family; anything without a panel of its own gets the generic one. Reuses
 * the feature hooks; computes nothing new.
 *
 * A body whose read fails falls back to the generic panel by itself; a body
 * that throws while rendering is caught here and does the same, so the panel
 * around it (title, destination, thread, history) never breaks.
 */

import { Component } from 'react'
import type { ReactNode } from 'react'

import type { TaskSubjects } from '../api'
import type { AgendaRow } from '../board'
import type { TaskType } from '../types'
import { ClaimBody } from './ClaimBody'
import { DataBody } from './DataBody'
import { DeclarationBody } from './DeclarationBody'
import { GenericBody } from './GenericBody'
import { GroupBody } from './GroupBody'
import { LimitBody } from './LimitBody'
import { NoticeBody } from './NoticeBody'
import { PremiumBody } from './PremiumBody'
import { RatingBody } from './RatingBody'
import { SubmissionBody } from './SubmissionBody'

interface BodyProps {
  row: AgendaRow
  now: Date
  subjects: TaskSubjects | undefined
}

type Body = (props: BodyProps) => ReactNode

/** Which body renders which task type. A type missing here gets the generic
 * panel — on purpose, so a new task type never breaks triage. */
const BODIES: Readonly<Partial<Record<TaskType, Body>>> = {
  limit_needs_decision: LimitBody,
  limit_escalated: LimitBody,
  limit_held: LimitBody,
  limit_review_due: LimitBody,
  limit_validation: LimitBody,
  limit_validation_result: LimitBody,

  rating_new_statements: RatingBody,
  rating_stale: RatingBody,
  buyer_needs_rating: RatingBody,

  instalment_due: PremiumBody,
  instalment_overdue: PremiumBody,

  noa_matured_to_claim: NoticeBody,
  claim_ready_to_file: NoticeBody,
  noa_credit_review: NoticeBody,

  claim_submitted: ClaimBody,
  claim_info_requested: ClaimBody,
  claim_awaiting_payment: ClaimBody,
  claim_limit_reinstatement: ClaimBody,
  claim_declined_review: ClaimBody,

  declaration_due: DeclarationBody,
  declaration_overdue: DeclarationBody,
  declaration_awaiting_acceptance: DeclarationBody,
  uncovered_excess_review: DeclarationBody,

  group_exposure_near_limit: GroupBody,
  group_limit_missing: GroupBody,

  submission_commercial_review: SubmissionBody,
  submission_sales_confirmation: SubmissionBody,
  submission_accepted: SubmissionBody,
  submission_declined: SubmissionBody,
  buyer_needs_entity: SubmissionBody,

  entity_requested: DataBody,
  statements_requested: DataBody,
  entity_request_resolved: DataBody,
}

export function FamilyBody({ row, now, subjects }: BodyProps) {
  const Body = BODIES[row.displayType] ?? GenericBody
  // Keyed by the row, so a body that failed on one task does not stay failed
  // for the next one selected.
  return (
    <Fallback key={row.key} fallback={<GenericBody row={row} now={now} subjects={subjects} />}>
      <Body row={row} now={now} subjects={subjects} />
    </Fallback>
  )
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
