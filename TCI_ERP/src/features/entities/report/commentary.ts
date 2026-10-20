/**
 * The analytical commentary under each table of the risk report.
 *
 * Deterministic, like narrative.ts: this module emits STRUCTURED sentences
 * (metric, subject, move, from, to); the page renders them through
 * report.commentary.* templates in the report language. Nothing is
 * free-form generated, and a sentence whose inputs are missing is omitted.
 *
 * One sentence per metric for the company and, when the report has combined
 * group figures, one for the group — the reference report's
 * "X of the company …; X of the Group …" pattern.
 */

import type { StatementBundle } from '../types'
import { computeRatios } from '../financials/ratios'
import type { LineDirection } from '../financials/lines'
import type { Tone } from './model'
import { debtToEquity, equityRatio, grossDebt, relativeMove, toneFor, trendOf } from './model'

export type CommentaryMetric =
  // balance sheet
  | 'grossDebt'
  | 'longTermDebt'
  | 'shortTermDebt'
  | 'debtToEquity'
  | 'equity'
  | 'equityRatio'
  | 'currentRatio'
  // profit & loss
  | 'revenue'
  | 'grossProfit'
  | 'grossMargin'
  | 'ebit'
  | 'ebitMargin'
  | 'interestCoverage'
  | 'netProfit'
  | 'netMargin'
  // turnover
  | 'ccc'
  | 'dso'
  | 'dio'
  | 'dpo'

export type CommentarySection = 'balanceSheet' | 'pnl' | 'ratios'
export type ValueFormat = 'amount' | 'percent' | 'ratio' | 'days'
export type Strength = 'slight' | 'moderate' | 'strong' | 'sharp'

/**
 * up / down     — an ordinary move of a positive (or zero-crossing-free) figure
 * lossNarrowed  — both periods negative, and the figure moved towards zero
 * lossWidened   — both periods negative, and it moved away from zero
 */
export type MoveKind = 'up' | 'down' | 'lossNarrowed' | 'lossWidened'

export type Commentary =
  | { kind: 'change'; move: MoveKind; strength: Strength; pct: number }
  | { kind: 'changeNm' }
  | { kind: 'flat' }
  | { kind: 'level' }

export interface CommentarySentence {
  metric: CommentaryMetric
  subject: 'company' | 'group'
  format: ValueFormat
  from: number | null
  to: number
  commentary: Commentary
  /** Colour of the highlighted percentage — direction-aware (DESIGN.md). */
  tone: Tone
}

export interface CommentaryParagraph {
  metric: CommentaryMetric
  sentences: CommentarySentence[]
}

interface MetricDef {
  metric: CommentaryMetric
  format: ValueFormat
  direction: LineDirection
  value: (s: StatementBundle) => number | null
}

const ratio =
  (key: Parameters<typeof pickRatio>[1]) =>
  (s: StatementBundle): number | null =>
    pickRatio(s, key)

function pickRatio(
  s: StatementBundle,
  key:
    | 'current_ratio'
    | 'gross_margin'
    | 'operating_margin'
    | 'interest_coverage'
    | 'net_margin'
    | 'working_capital_cycle'
    | 'receivables_days'
    | 'inventory_days'
    | 'payables_days',
): number | null {
  return computeRatios(s.statement_kind, s.balance_sheets, s.income_statements)[key].value
}

export const COMMENTARY_METRICS: Record<CommentarySection, MetricDef[]> = {
  balanceSheet: [
    { metric: 'grossDebt', format: 'amount', direction: 'up_bad', value: grossDebt },
    {
      metric: 'longTermDebt',
      format: 'amount',
      direction: 'up_bad',
      value: (s) => s.balance_sheets?.long_term_borrowings ?? null,
    },
    {
      metric: 'shortTermDebt',
      format: 'amount',
      direction: 'up_bad',
      value: (s) => s.balance_sheets?.short_term_borrowings ?? null,
    },
    { metric: 'debtToEquity', format: 'ratio', direction: 'up_bad', value: debtToEquity },
    {
      metric: 'equity',
      format: 'amount',
      direction: 'up_good',
      value: (s) => s.balance_sheets?.total_equity ?? null,
    },
    { metric: 'equityRatio', format: 'percent', direction: 'up_good', value: equityRatio },
    {
      metric: 'currentRatio',
      format: 'ratio',
      direction: 'up_good',
      value: ratio('current_ratio'),
    },
  ],
  pnl: [
    {
      metric: 'revenue',
      format: 'amount',
      direction: 'up_good',
      value: (s) => s.income_statements?.revenue ?? null,
    },
    {
      metric: 'grossProfit',
      format: 'amount',
      direction: 'up_good',
      value: (s) => s.income_statements?.gross_profit ?? null,
    },
    {
      metric: 'grossMargin',
      format: 'percent',
      direction: 'up_good',
      value: ratio('gross_margin'),
    },
    {
      metric: 'ebit',
      format: 'amount',
      direction: 'up_good',
      value: (s) => s.income_statements?.operating_profit ?? null,
    },
    {
      metric: 'ebitMargin',
      format: 'percent',
      direction: 'up_good',
      value: ratio('operating_margin'),
    },
    {
      metric: 'interestCoverage',
      format: 'ratio',
      direction: 'up_good',
      value: ratio('interest_coverage'),
    },
    {
      metric: 'netProfit',
      format: 'amount',
      direction: 'up_good',
      value: (s) => s.income_statements?.net_profit ?? null,
    },
    { metric: 'netMargin', format: 'percent', direction: 'up_good', value: ratio('net_margin') },
  ],
  ratios: [
    { metric: 'ccc', format: 'days', direction: 'up_bad', value: ratio('working_capital_cycle') },
    { metric: 'dso', format: 'days', direction: 'up_bad', value: ratio('receivables_days') },
    { metric: 'dio', format: 'days', direction: 'up_bad', value: ratio('inventory_days') },
    { metric: 'dpo', format: 'days', direction: 'up_good', value: ratio('payables_days') },
  ],
}

const LOSS_AWARE = new Set<CommentaryMetric>([
  'grossProfit',
  'grossMargin',
  'ebit',
  'ebitMargin',
  'netProfit',
  'netMargin',
])

/** <5% slight, <20% moderate, <50% strong, otherwise sharp. */
export function strengthOf(pct: number): Strength {
  const m = Math.abs(pct)
  if (m < 0.05) return 'slight'
  if (m < 0.2) return 'moderate'
  if (m < 0.5) return 'strong'
  return 'sharp'
}

/** Below this relative move a figure is reported as unchanged. */
const FLAT = 0.0005

/**
 * `lossAware`: for a result (profit, margin) two negative periods read as a
 * loss that narrowed or deepened. For anything else — a negative cash
 * conversion cycle, negative equity — plain up / down is the right reading.
 */
export function describeMove(from: number | null, to: number, lossAware = true): Commentary {
  if (from === null) return { kind: 'level' }
  if (to === from) return { kind: 'flat' }
  const pct = relativeMove(to, from)
  if (pct === null) return { kind: 'changeNm' }
  if (Math.abs(pct) < FLAT) return { kind: 'flat' }
  const bothNegative = lossAware && from < 0 && to < 0
  const move: MoveKind = bothNegative
    ? to > from
      ? 'lossNarrowed'
      : 'lossWidened'
    : to > from
      ? 'up'
      : 'down'
  return { kind: 'change', move, strength: strengthOf(pct), pct: Math.abs(pct) }
}

function sentenceFor(
  def: MetricDef,
  subject: CommentarySentence['subject'],
  series: StatementBundle[],
  display: StatementBundle[],
): CommentarySentence | null {
  const n = series.length
  if (n === 0) return null
  const to = def.value(series[n - 1])
  if (to === null) return null
  const prior =
    n > 1 && series[n - 2].currency_code === series[n - 1].currency_code ? series[n - 2] : null
  const from = prior ? def.value(prior) : null
  const shownTo = def.value(display[n - 1] ?? series[n - 1])
  const shownFrom = prior ? def.value(display[n - 2] ?? prior) : null
  return {
    metric: def.metric,
    subject,
    format: def.format,
    from: shownFrom,
    to: shownTo ?? to,
    commentary: describeMove(from, to, LOSS_AWARE.has(def.metric)),
    tone: toneFor(trendOf(to, from), def.direction),
  }
}

export interface CommentaryInput {
  company: StatementBundle[]
  companyDisplay?: StatementBundle[]
  group?: StatementBundle[]
  groupDisplay?: StatementBundle[]
}

/**
 * Paragraphs for one section. Series are chronological annual statements
 * in the ORIGINAL currency (changes are read from them); the `*Display`
 * series supply the amounts shown.
 */
export function buildCommentary(
  section: CommentarySection,
  input: CommentaryInput,
): CommentaryParagraph[] {
  const group = input.group ?? []
  return COMMENTARY_METRICS[section]
    .map((def) => {
      const sentences = [
        sentenceFor(def, 'company', input.company, input.companyDisplay ?? input.company),
        group.length ? sentenceFor(def, 'group', group, input.groupDisplay ?? group) : null,
      ].filter((s): s is CommentarySentence => s !== null)
      return { metric: def.metric, sentences }
    })
    .filter((p) => p.sentences.length > 0)
}
