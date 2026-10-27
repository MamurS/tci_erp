/**
 * Where each task is DONE (pure). The Agenda never performs a task itself:
 * its primary button goes to the working screen, deep-linked with the
 * context the task carries, and the breadcrumb under the button says where
 * («Opens Credit limits › TOO Almaty Trade Center › Decision»).
 *
 * DESTINATIONS is a Record over every TaskType — the compiler refuses a
 * missing type, and destinations.test.ts checks every one produces a path.
 * The query parameters are the contract the destination screens honour:
 *
 *   /limits/:id?focus=decision|commercial         the decision / commercial form
 *   /limits/:id?focus=validation                  the validator's panel (0060)
 *   /entities/:id?tab=rating&statement=<id>       Rating & limit, statement preselected
 *   /entities/:id?tab=rating&focus=adt            the buyer's ADT block (0061)
 *   /entities/:id?tab=group|limits                the group / limits tab
 *   /policies/:id?tab=premium&instalments=a,b     the Premium tab, those instalments only
 *   /overdues/:id?action=open-claim               the notice, the open-claim dialog open
 *   /declarations?policy=<id>&period=<date>       that period's declaration
 *   /requests/:id?focus=sales-window|buyers       the submission, at that section
 *
 * The row itself links to the OBJECT (catalogue.taskLink); this is the
 * screen the work is done on, which is often more precise.
 */

import type { AgendaRow } from './board'
import type { Task, TaskType } from './types'

/** The primary button's verb (agenda.actions.*). */
export const ACTIONS = [
  'decide',
  'rate',
  'review',
  'openClaim',
  'assess',
  'confirm',
  'issuePolicy',
  'resolve',
  'chasePremium',
  'open',
] as const
export type ActionKey = (typeof ACTIONS)[number]

/** A breadcrumb step: an i18n key, or text (a name, a number). */
export type Crumb = { key: string; params?: Record<string, string | number> } | { text: string }

export interface Destination {
  path: string
  action: ActionKey
  crumbs: Crumb[]
  /** What the screen opens with (agenda.dest.with.*), when anything. */
  context?: { key: string; params?: Record<string, string | number> }
}

/** Names a breadcrumb can use; any of them may be unknown. */
export interface DestinationNames {
  /** The company the task is about. */
  subject?: string | null
  /** A number: policy, submission, claim, request. */
  reference?: string | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function named(names: DestinationNames, fallbackKey: string): Crumb {
  const text = names.reference ?? names.subject
  return text ? { text } : { key: fallbackKey }
}

type Builder = (row: AgendaRow, lead: Task, names: DestinationNames) => Destination

const limitDecision: Builder = (_row, lead, names) => ({
  path: `/limits/${lead.object_id}?focus=decision`,
  action: 'decide',
  crumbs: [{ key: 'nav.limits' }, named({ subject: names.subject }, 'agenda.dest.request'), { key: 'agenda.dest.place.decision' }],
  context: { key: 'agenda.dest.with.task' },
})

/** A validation step lives on its limit request (0060): the validator answers
 * on their panel; the author is told the result and, when it came back to
 * them, lands on the form to work it again. */
const validation: Builder = (_row, lead, names) => {
  const requestId = str(lead.params?.request_id)
  const crumbs = (place: string | null): Crumb[] => [
    { key: 'nav.limits' },
    named({ subject: names.subject ?? str(lead.params?.entity_name) }, 'agenda.dest.request'),
    ...(place ? [{ key: place }] : []),
  ]
  if (!requestId) return { path: '/limits', action: 'open', crumbs: crumbs(null) }
  // 0071: a skipped rank is told on the same panel it would have answered on.
  if (lead.task_type === 'limit_validation' || lead.task_type === 'limit_validation_fyi') {
    return {
      path: `/limits/${requestId}?focus=validation`,
      action: 'review',
      crumbs: crumbs('agenda.dest.place.validation'),
    }
  }
  if (lead.params?.status === 'returned') {
    const commercial = lead.params?.stream === 'commercial'
    return {
      path: `/limits/${requestId}?focus=${commercial ? 'commercial' : 'decision'}`,
      action: 'review',
      crumbs: crumbs(commercial ? 'agenda.dest.place.commercial' : 'agenda.dest.place.decision'),
    }
  }
  return { path: `/limits/${requestId}`, action: 'open', crumbs: crumbs(null) }
}

/** A sector (0085): its page, where the review is written, approved, or the
 * buyers of a downgrade are listed. */
const sector =
  (action: ActionKey): Builder =>
  (_row, lead) => ({
    path: `/sectors/${lead.object_id}`,
    action,
    crumbs: [
      { key: 'nav.sectors' },
      str(lead.params?.industry) ? { key: `industries.${String(lead.params?.industry)}` } : { key: 'agenda.dest.sector' },
    ],
  })

const rating: Builder = (_row, lead, names) => {
  const statement = str(lead.params?.statement_id)
  const year = lead.params?.fiscal_year
  return {
    path: `/entities/${lead.object_id}?tab=rating${statement ? `&statement=${statement}` : ''}`,
    action: 'rate',
    crumbs: [{ key: 'nav.entities' }, named({ subject: names.subject }, 'agenda.dest.company'), { key: 'agenda.dest.place.rating' }],
    context:
      statement && year !== undefined && year !== null
        ? { key: 'agenda.dest.with.statement', params: { period: String(year) } }
        : undefined,
  }
}

/** A rating proposal (0073) lives on the buyer's rating tab: the answerer
 * lands on its panel, the proposer is told the result there. */
const ratingProposal: Builder = (_row, lead, names) => ({
  path: `/entities/${str(lead.params?.entity_id) ?? lead.object_id}?tab=rating&focus=rating-proposal`,
  action: lead.task_type === 'rating_proposal' ? 'review' : 'open',
  crumbs: [
    { key: 'nav.entities' },
    named({ subject: names.subject ?? str(lead.params?.entity_name) }, 'agenda.dest.company'),
    { key: 'agenda.dest.place.rating' },
  ],
})

/** «Пересмотр байера / обновить ADT» (0061): the ADT block on the rating
 * tab, where the ADT is set again or disabled — either closes the task. */
const adtReview: Builder = (_row, lead, names) => ({
  path: `/entities/${str(lead.params?.entity_id) ?? lead.object_id}?tab=rating&focus=adt`,
  action: 'review',
  crumbs: [
    { key: 'nav.entities' },
    named({ subject: names.subject ?? str(lead.params?.entity_name) }, 'agenda.dest.company'),
    { key: 'agenda.dest.place.adt' },
  ],
})

const entityTab =
  (tab: 'group' | 'limits', action: ActionKey): Builder =>
  (_row, lead, names) => {
    const id = str(lead.params?.entity_id) ?? lead.object_id
    return {
      path: `/entities/${id}?tab=${tab}`,
      action,
      crumbs: [{ key: 'nav.entities' }, named({ subject: names.subject }, 'agenda.dest.company'), { key: `agenda.dest.place.${tab}` }],
    }
  }

const submission =
  (action: ActionKey, focus?: 'sales-window' | 'buyers'): Builder =>
  (_row, lead, names) => ({
    path: `/requests/${lead.object_id}${focus ? `?focus=${focus}` : ''}`,
    action,
    crumbs: [
      { key: 'nav.requests' },
      named({ reference: names.reference ?? str(lead.params?.request_number) }, 'agenda.dest.submission'),
      ...(focus ? [{ key: focus === 'sales-window' ? 'agenda.dest.place.salesWindow' : 'agenda.dest.place.buyers' }] : []),
    ],
  })

/** A commercial offer is worked from its submission (0058). */
const offer =
  (action: ActionKey): Builder =>
  (_row, lead, names) => ({
    path: `/requests/${str(lead.params?.request_id) ?? ''}?focus=offer`,
    action,
    crumbs: [
      { key: 'nav.requests' },
      named({ reference: names.reference ?? str(lead.params?.request_number) }, 'agenda.dest.submission'),
      { key: 'agenda.dest.place.offer' },
    ],
  })

const premium: Builder = (row, lead) => {
  const policyId = str(lead.params?.policy_id)
  const ids = row.items.filter((i) => str(i.params?.policy_id) === policyId).map((i) => i.object_id)
  // A collapsed row across several policies opens the oldest one's tab; its
  // sub-table opens each instalment on its own policy.
  return {
    path: policyId ? `/policies/${policyId}?tab=premium&instalments=${ids.join(',')}` : '/policies',
    action: 'chasePremium',
    crumbs: [
      { key: 'nav.policies' },
      named({ reference: str(lead.params?.policy_number) }, 'agenda.dest.policy'),
      { key: 'agenda.dest.place.premium' },
    ],
    context: { key: 'agenda.dest.with.instalments', params: { count: ids.length } },
  }
}

/** One instalment of a collapsed row: its own policy's Premium tab. */
export function instalmentDestination(item: Task): string | null {
  const policyId = str(item.params?.policy_id)
  return policyId ? `/policies/${policyId}?tab=premium&instalments=${item.object_id}` : null
}

const declarationPeriod: Builder = (_row, lead, names) => {
  const policyId = str(lead.params?.policy_id) ?? lead.object_id
  const period = str(lead.params?.period_start)
  return {
    path: `/declarations?policy=${policyId}${period ? `&period=${period}` : ''}`,
    action: 'open',
    crumbs: [{ key: 'nav.declarations' }, named({ reference: str(lead.params?.policy_number) ?? names.reference }, 'agenda.dest.policy')],
  }
}

const declaration: Builder = (_row, lead) => ({
  path: `/declarations/${lead.object_id}`,
  action: 'review',
  crumbs: [{ key: 'nav.declarations' }, { key: 'agenda.dest.declaration' }],
})

const noaClaim: Builder = (_row, lead, names) => ({
  path: `/overdues/${lead.object_id}?action=open-claim`,
  action: 'openClaim',
  crumbs: [{ key: 'nav.overdues' }, named({ subject: names.subject }, 'agenda.dest.notice'), { key: 'agenda.dest.place.openClaim' }],
  context: { key: 'agenda.dest.with.notice' },
})

const noa: Builder = (_row, lead, names) => ({
  path: `/overdues/${lead.object_id}`,
  action: 'review',
  crumbs: [{ key: 'nav.overdues' }, named({ subject: names.subject }, 'agenda.dest.notice')],
})

const claim =
  (action: ActionKey): Builder =>
  (_row, lead) => ({
    path: `/claims/${lead.object_id}`,
    action,
    crumbs: [{ key: 'nav.claims' }, str(lead.params?.claim_number) ? { text: String(lead.params?.claim_number) } : { key: 'agenda.dest.claim' }],
  })

const dataRequest: Builder = (_row, lead) => ({
  path: `/data/requests/${lead.object_id}`,
  action: 'resolve',
  crumbs: [{ key: 'nav.data' }, str(lead.params?.request_number) ? { text: String(lead.params?.request_number) } : { key: 'agenda.dest.dataRequest' }],
})

/** «Собрать информацию по байеру» (0067): the buyer's card — the statements
 * tab when statements are what is missing, the card itself for the registry
 * data. Saving either releases the limit request by itself. */
const informationNeeded: Builder = (_row, lead, names) => {
  const id = str(lead.params?.entity_id) ?? lead.object_id
  const gaps = Array.isArray(lead.params?.gaps) ? (lead.params?.gaps as unknown[]) : []
  const statements = gaps.includes('no_statements') || gaps.includes('stale_statements')
  return {
    path: statements ? `/entities/${id}?tab=financials` : `/entities/${id}`,
    action: 'resolve',
    crumbs: [
      { key: 'nav.entities' },
      named({ subject: names.subject ?? str(lead.params?.entity_name) }, 'agenda.dest.company'),
      { key: statements ? 'agenda.dest.place.financials' : 'agenda.dest.place.card' },
    ],
  }
}

export const DESTINATIONS: Readonly<Record<TaskType, Builder>> = {
  buyer_needs_entity: (row, lead, names) =>
    lead.object_type === 'client_buyer_proposal'
      ? { path: '/data?view=proposals', action: 'resolve', crumbs: [{ key: 'nav.data' }, { key: 'agenda.dest.place.proposals' }] }
      : submission('resolve', 'buyers')(row, lead, names),
  buyer_needs_rating: rating,
  rating_stale: rating,
  rating_new_statements: rating,
  limit_needs_decision: limitDecision,
  limit_escalated: limitDecision,
  limit_held: (_row, lead, names) => {
    const requestId = str(lead.params?.request_id)
    return {
      path: requestId ? `/limits/${requestId}?focus=commercial` : '/limits',
      action: 'review',
      crumbs: [{ key: 'nav.limits' }, named({ subject: names.subject }, 'agenda.dest.request'), { key: 'agenda.dest.place.commercial' }],
    }
  },
  limit_review_due: entityTab('limits', 'review'),
  noa_credit_review: noa,
  submission_commercial_review: submission('review'),
  submission_sales_confirmation: submission('confirm', 'sales-window'),
  submission_accepted: submission('issuePolicy'),
  submission_declined: submission('open'),
  declaration_due: declarationPeriod,
  declaration_overdue: declarationPeriod,
  declaration_awaiting_acceptance: declaration,
  uncovered_excess_review: declaration,
  instalment_due: premium,
  instalment_overdue: premium,
  premium_payment_unmatched: (_row, lead) => ({
    path: `/policies?view=payments&import=${lead.object_id}`,
    action: 'resolve',
    crumbs: [
      { key: 'nav.policies' },
      { key: 'agenda.dest.place.payments' },
      str(lead.params?.file_name) ? { text: String(lead.params?.file_name) } : { key: 'agenda.dest.statement' },
    ],
  }),
  noa_matured_to_claim: noaClaim,
  claim_ready_to_file: noaClaim,
  claim_submitted: claim('assess'),
  claim_info_requested: claim('open'),
  claim_awaiting_payment: claim('open'),
  claim_limit_reinstatement: claim('review'),
  claim_declined_review: claim('open'),
  group_exposure_near_limit: entityTab('group', 'review'),
  group_limit_missing: entityTab('group', 'review'),
  entity_requested: dataRequest,
  statements_requested: dataRequest,
  contract_review: (_row, lead) => ({
    path: `/policies/contracts/${lead.object_id}`,
    action: 'review',
    crumbs: [
      { key: 'nav.policies' },
      str(lead.params?.draft_number) ? { text: String(lead.params?.draft_number) } : { key: 'agenda.dest.contract' },
    ],
  }),
  offer_viewed: offer('open'),
  offer_expiring: offer('review'),
  offer_expired: offer('review'),
  limit_validation: validation,
  limit_validation_result: validation,
  limit_validation_fyi: validation,
  rating_proposal: ratingProposal,
  rating_proposal_result: ratingProposal,
  adt_review: adtReview,
  limit_information_needed: informationNeeded,
  sector_review_due: sector('review'),
  sector_review_approval: sector('review'),
  sector_downgrade_review: sector('review'),
  sanctions_limit_review: (_row, lead, names) => ({
    path: `/limits/${lead.object_id}`,
    action: 'review',
    crumbs: [{ key: 'nav.limits' }, named({ subject: names.subject }, 'agenda.dest.request')],
  }),
  oecd_review_due: () => ({
    path: '/admin?tab=risk&focus=oecd',
    action: 'open',
    crumbs: [{ key: 'nav.admin' }, { key: 'agenda.dest.place.oecd' }],
  }),
  country_downgrade_review: () => ({
    path: '/sectors?view=countries',
    action: 'review',
    crumbs: [{ key: 'nav.sectors' }, { key: 'agenda.dest.place.countries' }],
  }),
  country_override_approval: (_row, lead) => ({
    path: `/sectors?view=countries&override=${lead.object_id}`,
    action: 'review',
    crumbs: [
      { key: 'nav.sectors' },
      { key: 'agenda.dest.place.countries' },
      ...(str(lead.params?.country) ? [{ text: String(lead.params?.country) }] : []),
    ],
  }),
  entity_request_resolved: (row, lead, names) => {
    const entityId = str(lead.params?.entity_id)
    return entityId
      ? { path: `/entities/${entityId}`, action: 'open', crumbs: [{ key: 'nav.entities' }, named({ subject: names.subject ?? str(lead.params?.name) }, 'agenda.dest.company')] }
      : dataRequest(row, lead, names)
  },
}

export function destinationFor(row: AgendaRow, names: DestinationNames = {}): Destination {
  return DESTINATIONS[row.displayType](row, row.lead, names)
}
