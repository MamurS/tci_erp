/**
 * The vocabulary of imported bank-statement lines (migration 0056) and the
 * rules the screen derives from it. Pure, contract-tested against the
 * migration text in bankStatement.test.ts.
 */

import { refusalKey } from '../../../lib/refusals'

export const BANK_LINE_STATUSES = ['matched', 'suggested', 'unmatched', 'confirmed', 'ignored', 'duplicate'] as const
export type BankLineStatus = (typeof BANK_LINE_STATUSES)[number]

/** Why a line matched, or did not (tci.match_payment_text, assign_bank_line). */
export const MATCH_REASONS = [
  'invoice_number',
  'policy_number',
  'amount_differs',
  'date_far',
  'currency',
  'exceeds_outstanding',
  'no_reference',
  'ambiguous',
  'assigned',
  'duplicate',
] as const
export type MatchReason = (typeof MATCH_REASONS)[number]

export interface BankProfile {
  id: string
  name: string
  mapping: unknown
  created_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string
}

export interface BankImport {
  id: string
  profile_id: string | null
  source: 'bank_import' | 'accounting_import'
  file_name: string | null
  line_count: number
  imported_by: string | null
  imported_at: string
}

export interface BankLine {
  id: string
  import_id: string
  line_no: number
  value_date: string
  amount: number
  currency_code: string
  purpose: string | null
  reference: string | null
  payer: string | null
  external_id: string | null
  status: BankLineStatus
  match_policy_id: string | null
  match_instalment_id: string | null
  match_reason: string
  payment_id: string | null
  resolved_by: string | null
  resolved_at: string | null
  ignore_reason: string | null
}

/** What tci.import_bank_statement answers. */
export interface ImportResult {
  import_id: string
  matched: number
  suggested: number
  unmatched: number
  duplicate: number
}

/** The sections of an import, in screen order. */
export const LINE_SECTIONS = ['matched', 'suggested', 'unmatched', 'processed'] as const
export type LineSection = (typeof LINE_SECTIONS)[number]

export function sectionOf(status: BankLineStatus): LineSection {
  return status === 'matched' || status === 'suggested' || status === 'unmatched' ? status : 'processed'
}

/** Still waiting for a person (a line the Agenda counts, plus a confident match). */
export function isOpen(status: BankLineStatus): boolean {
  return sectionOf(status) !== 'processed'
}

export type LineTone = 'accent' | 'warn' | 'neutral' | 'pos'

export function lineStatusTone(status: BankLineStatus): LineTone {
  switch (status) {
    case 'matched':
      return 'accent'
    case 'suggested':
    case 'unmatched':
      return 'warn'
    case 'confirmed':
      return 'pos'
    default:
      return 'neutral'
  }
}

/** A reason the screen has a label for, else null (shown as «—»). */
export function matchReason(value: string | null | undefined): MatchReason | null {
  return (MATCH_REASONS as readonly string[]).includes(value ?? '') ? (value as MatchReason) : null
}

/**
 * The per-line answers of tci.confirm_bank_lines that are not exceptions,
 * so refusals.ts (which maps only what a `raise exception` says) cannot hold
 * them. Everything else a line can answer is a refusal code refusals.ts maps.
 */
export const LINE_RESULT_KEYS: Record<string, string> = {
  statement_line_not_matched: 'premium.bank.errors.lineNotMatched',
}

/** The readable key for one line's answer (anything but 'recorded'). */
export function lineResultKey(code: string): string {
  return LINE_RESULT_KEYS[code] ?? refusalKey({ message: code, code: 'P0001' })
}

/** Counts per status, for the imports list and the section titles. */
export type StatusCounts = Record<BankLineStatus, number>

export function emptyCounts(): StatusCounts {
  return { matched: 0, suggested: 0, unmatched: 0, confirmed: 0, ignored: 0, duplicate: 0 }
}

export function countStatuses(lines: readonly { status: BankLineStatus }[]): StatusCounts {
  const out = emptyCounts()
  for (const l of lines) out[l.status] += 1
  return out
}

/** The import to show: the one the address names (`?import=`, the Agenda's
 * link), else the newest that still has lines to work, else the newest. A
 * stale or unknown id falls back rather than emptying the screen. */
export function pickImport<T extends { id: string; counts: StatusCounts }>(
  imports: readonly T[],
  requested: string | null,
): T | null {
  if (!imports.length) return null
  return (
    imports.find((i) => i.id === requested) ??
    imports.find((i) => i.counts.matched + i.counts.suggested + i.counts.unmatched > 0) ??
    imports[0]!
  )
}
