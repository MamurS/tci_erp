/** What a declaration write is certain to change, painted before the answer.
 *
 * A transition's target status and its moment are fixed by the state machine
 * (0026): submitted / accepted / disputed, stamped now. The coverage split of
 * a line is computed by `classifyLine`, the contract-tested mirror of
 * tci.classify_declaration_line, so a line the policyholder adds can be shown
 * with its split at once. A correction creates a NEW declaration, which the
 * screen cannot know before the server answers: it is not painted. */

import type { CoverageSplit } from './coverage'
import type { DeclarationStatus } from './types'

type Stamped = {
  status: DeclarationStatus
  submitted_at: string | null
  accepted_at: string | null
  disputed_at: string | null
  dispute_note: string | null
}

/** The declaration after a transition to `status` at `at`. */
export function transitioned<T extends Stamped>(
  declaration: T,
  status: 'submitted' | 'accepted' | 'disputed',
  at: string,
  note?: string,
): T {
  switch (status) {
    case 'submitted':
      return { ...declaration, status, submitted_at: at }
    case 'accepted':
      return { ...declaration, status, accepted_at: at }
    case 'disputed':
      return { ...declaration, status, disputed_at: at, dispute_note: note ?? declaration.dispute_note }
  }
}

/** The fields a line shares across the staff and portal views. */
export interface LineShape {
  id: string
  declaration_id: string
  entity_id: string
  entity_name: string
  insurable_turnover: number
  overdue_amount: number | null
  line_note: string | null
  coverage_basis: CoverageSplit['basis']
  covered_amount: number
  uncovered_excess: number
  is_frozen: boolean
}

export interface LineInput {
  declaration_id: string
  entity_id: string
  turnover: number
  overdue_amount?: number | null
  line_note?: string | null
}

/** A line saved for a buyer: replaces that buyer's line (one per buyer and
 * declaration — the upsert key), or is added with its split. Without a known
 * split a NEW line is not painted: its coverage is not certain. */
export function savedLine<L extends LineShape>(
  lines: readonly L[],
  input: LineInput,
  known: { entity_name: string; split: CoverageSplit; id: string } | null,
): L[] {
  const existing = lines.find((l) => l.entity_id === input.entity_id)
  const figures = {
    insurable_turnover: input.turnover,
    overdue_amount: input.overdue_amount ?? null,
    line_note: input.line_note ?? null,
    ...(known
      ? { coverage_basis: known.split.basis, covered_amount: known.split.covered, uncovered_excess: known.split.uncovered }
      : {}),
  }
  if (existing) return lines.map((l) => (l === existing ? { ...l, ...figures } : l))
  if (!known) return [...lines]
  const added = {
    id: known.id,
    declaration_id: input.declaration_id,
    entity_id: input.entity_id,
    entity_name: known.entity_name,
    is_frozen: false,
    ...figures,
  } as L
  // The view orders by buyer name; so does the pending row.
  return [...lines, added].sort((a, b) => a.entity_name.localeCompare(b.entity_name))
}

/** The declaration's total and line count after a line changed from
 * `before` to `after` turnover (null: no line). */
export function retotalled<T extends { total_insurable_turnover: number; line_count?: number | null }>(
  declaration: T,
  before: number | null,
  after: number | null,
): T {
  const total = Number(declaration.total_insurable_turnover) - (before ?? 0) + (after ?? 0)
  const lineCount =
    declaration.line_count === undefined || declaration.line_count === null
      ? declaration.line_count
      : declaration.line_count + (after === null ? 0 : 1) - (before === null ? 0 : 1)
  return { ...declaration, total_insurable_turnover: total, line_count: lineCount }
}
