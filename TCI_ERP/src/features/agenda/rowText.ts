/**
 * How a row READS (pure; takes the translator so it is testable without a
 * component tree): its title («5 premium instalments overdue · 3,184,000,000
 * UZS», «Claim can be filed · TOO Almaty Trade Center»), the company it is
 * about, the facts on its context line, and the rendered system note. Raw
 * values come from the database; every one is formatted here in the
 * viewer's language (format.ts), never stored as text.
 */

import type { TFunction } from 'i18next'

import { formatAmount, formatDate, formatPeriod } from '../../lib/format'
import type { StaffMember } from '../data/types'
import { policyIdOf } from './api'
import type { TaskSubjects } from './api'
import { amountOf } from './board'
import type { AgendaRow } from './board'
import type { SystemNote } from './notes'
import type { Task } from './types'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function money(amount: unknown, currency: unknown, locale: string): string | null {
  const n = num(amount)
  const ccy = str(currency)
  return n === null || !ccy ? null : `${formatAmount(n, locale)} ${ccy}`
}

/** The company a row is about: the buyer of a limit, a rating or an overdue
 * notice; the policyholder of premium and declarations; the applicant of a
 * submission; the name a data request carries. */
export function companyOf(task: Task, subjects: TaskSubjects | undefined): string | null {
  const s = subjects
  const p = task.params ?? {}
  switch (task.object_type) {
    case 'legal_entity':
      return s?.entities[task.object_id] ?? str(p.group_name)
    case 'credit_limit_request':
      return s?.limitRequests[task.object_id] ?? null
    case 'credit_limit_decision':
      return str(p.request_id) ? (s?.limitRequests[p.request_id as string] ?? null) : null
    case 'insurance_request':
      return s?.requestApplicants[task.object_id] ?? null
    case 'overdue_notification':
      return (str(p.entity_id) ? s?.entities[p.entity_id as string] : null) ?? str(p.buyer_name)
    case 'claim':
      return s?.claims[task.object_id]?.holder ?? null
    case 'entity_request':
    case 'client_buyer_proposal':
      return str(p.name)
    default: {
      const policyId = policyIdOf(task)
      return policyId ? (s?.policies[policyId]?.holder ?? null) : null
    }
  }
}

/** A number the breadcrumb and the context line can name. */
export function referenceOf(task: Task, subjects: TaskSubjects | undefined): string | null {
  const p = task.params ?? {}
  const policyId = policyIdOf(task)
  return (
    str(p.claim_number) ??
    str(p.request_number) ??
    str(p.policy_number) ??
    (policyId ? (subjects?.policies[policyId]?.number ?? null) : null) ??
    (task.object_type === 'insurance_request' ? (subjects?.requests[task.object_id] ?? null) : null)
  )
}

/** «Rating review — new financial statements · Samsung Electronics». */
export function rowTitle(
  row: AgendaRow,
  t: TFunction,
  locale: string,
  subjects: TaskSubjects | undefined,
  collapsedSumUzs: number | null,
): string {
  const lead = row.lead
  const p = lead.params ?? {}
  if (row.kind === 'collapsed') {
    const what = t(`agenda.row.collapsed.${row.displayType}`, { count: row.items.length })
    return collapsedSumUzs === null ? what : `${what} · ${formatAmount(collapsedSumUzs, locale)} UZS`
  }
  const period =
    str(p.period_start) && str(p.period_end)
      ? formatPeriod(p.period_start as string, p.period_end as string, locale)
      : str(p.period_start)
        ? formatDate(p.period_start as string, locale)
        : ''
  const key =
    lead.task_type === 'limit_escalated' && p.reason === 'group_limit'
      ? 'agenda.row.limit_escalated_group'
      : lead.object_type === 'client_buyer_proposal'
        ? 'agenda.row.buyer_proposed'
        : `agenda.row.${row.displayType}`
  const what = t(key, {
    sequence: p.sequence ?? '',
    period,
    pct: num(p.utilisation_pct) === null ? '' : formatAmount(num(p.utilisation_pct), locale, 1),
    date: str(p.valid_until) ? formatDate(p.valid_until as string, locale) : '',
    name: str(p.name) ?? '',
    // a count only where the task carries one, so other titles never pluralise
    ...(num(p.count) === null ? {} : { count: num(p.count) }),
  })
  const company = companyOf(lead, subjects)
  return company && !what.includes(company) ? `${what} · ${company}` : what
}

/** The facts on the context line, in tabular order: number, key facts,
 * amounts. The snippet (comment or note) is rendered separately. */
export function rowFacts(
  row: AgendaRow,
  t: TFunction,
  locale: string,
  subjects: TaskSubjects | undefined,
): string[] {
  const lead = row.lead
  const p = lead.params ?? {}
  const facts: (string | null)[] = []
  const ref = referenceOf(lead, subjects)

  if (row.kind === 'collapsed') {
    const policies = new Set(row.items.map((i) => policyIdOf(i)).filter(Boolean))
    facts.push(
      policies.size > 1 ? t('agenda.facts.policies', { count: policies.size }) : ref,
      row.dueAt ? t('agenda.facts.oldest', { date: formatDate(row.dueAt, locale) }) : null,
    )
    return facts.filter((f): f is string => Boolean(f))
  }

  switch (row.displayType) {
    case 'instalment_due':
    case 'instalment_overdue':
      facts.push(ref, str(p.due_date) ? t('agenda.facts.due', { date: formatDate(p.due_date as string, locale) }) : null, money(p.amount, p.currency, locale))
      break
    case 'noa_matured_to_claim':
    case 'claim_ready_to_file':
    case 'noa_credit_review':
      facts.push(
        ref,
        str(p.claimable_from) ? t('agenda.facts.waitingOver', { date: formatDate(p.claimable_from as string, locale) }) : null,
        money(p.amount ?? p.overdue_amount, p.currency, locale)
          ? t('agenda.facts.unpaid', { amount: money(p.amount ?? p.overdue_amount, p.currency, locale) })
          : null,
      )
      break
    case 'declaration_due':
    case 'declaration_overdue':
      facts.push(ref)
      break
    case 'limit_needs_decision':
      facts.push(money(p.amount, p.currency, locale) ? t('agenda.facts.requested', { amount: money(p.amount, p.currency, locale) }) : null)
      break
    case 'limit_escalated':
      facts.push(
        money(p.amount, p.currency, locale),
        num(p.authority_uzs) !== null
          ? t('agenda.facts.vsAuthority', { amount: formatAmount(num(p.authority_uzs), locale) })
          : null,
      )
      break
    case 'limit_review_due':
      facts.push(ref, money(p.amount, p.currency, locale))
      break
    case 'group_exposure_near_limit':
    case 'group_limit_missing':
      // Their system note already states the exposure and the members.
      break
    case 'claim_submitted':
    case 'claim_awaiting_payment':
      facts.push(ref, money(p.amount, p.currency, locale))
      break
    case 'entity_requested':
    case 'statements_requested':
      facts.push(ref, str(p.country))
      break
    case 'premium_payment_unmatched':
      facts.push(str(p.file_name), str(p.source) ? t(`premium.sources.${p.source as string}`) : null)
      break
    case 'offer_viewed':
    case 'offer_expiring':
    case 'offer_expired':
      facts.push(str(p.offer_number), str(p.request_number))
      break
    default:
      facts.push(ref)
  }
  return facts.filter((f): f is string => Boolean(f))
}

/** A colleague as the thread names them. */
export function personName(id: unknown, staff: Map<string, StaffMember> | undefined): string | null {
  if (typeof id !== 'string') return null
  const member = staff?.get(id)
  return member ? (member.full_name?.trim() || member.email) : null
}

/** «FY2025» / «2025 г.» / «Q3 2025». */
export function periodLabel(t: TFunction, year: unknown, quarter: unknown, kind: unknown): string {
  if (year === null || year === undefined) return ''
  return kind === 'quarterly' && quarter
    ? t('agenda.note.periodQuarter', { quarter, year })
    : t('agenda.note.periodAnnual', { year })
}

/** The system note rendered in the viewer's language. */
export function renderNote(
  note: SystemNote,
  t: TFunction,
  locale: string,
  staff: Map<string, StaffMember> | undefined,
): string {
  const v = note.values
  const date = (x: unknown) => (str(x) ? formatDate(x as string, locale) : '—')
  const amount = (x: unknown) => (num(x) === null ? '—' : formatAmount(num(x), locale))
  return t(note.key, {
    period: periodLabel(t, v.fiscalYear, v.fiscalQuarter, v.statementKind),
    user: personName(v.addedBy ?? v.user, staff) ?? t('agenda.note.someone'),
    date: date(v.addedAt ?? v.validUntil ?? v.dueDate ?? v.claimableFrom),
    grade: str(v.grade) ?? '—',
    score: num(v.score) === null ? '—' : formatAmount(num(v.score), locale, 1),
    ratedPeriod: str(v.ratedPeriodEnd) ? formatDate(v.ratedPeriodEnd as string, locale) : '—',
    count: num(v.limits) ?? num(v.members) ?? num(v.lines) ?? 0,
    file: str(v.file) ?? '—',
    amount: money(v.amount, v.currency, locale) ?? amount(v.amountUzs),
    amountUzs: amount(v.amountUzs),
    authority: amount(v.authority),
    band: str(v.band) ?? '—',
    sequence: v.sequence ?? '',
    periodRange:
      str(v.periodStart) && str(v.periodEnd) ? formatPeriod(v.periodStart as string, v.periodEnd as string, locale) : '—',
    exposure: amount(v.exposure),
    limit: amount(v.limit),
    cap: amount(v.cap),
    pct: num(v.pct) === null ? '—' : formatAmount(num(v.pct), locale, 1),
  })
}

/** The amount a single row shows in its sub-table (an instalment). */
export function itemMoney(task: Task, locale: string): string | null {
  const m = amountOf(task)
  return m ? `${formatAmount(m.amount, locale)} ${m.currency}` : null
}
