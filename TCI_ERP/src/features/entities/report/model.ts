/**
 * The risk report's figures — pure functions, no React.
 *
 * Everything the report prints that is a NUMBER is computed here: the
 * annual series, the company and the combined-group statement tables with
 * their shares and trend arrows, the key figures, the ratio tables, and the
 * group's key companies. The page only lays them out.
 *
 * Two rules that are easy to get wrong:
 *
 *  * UNITS. A statement is stored as entered (units / thousands /
 *    millions). Everything here is normalised to whole units first, so a
 *    company filed in thousands and a sister filed in millions can be added.
 *  * THE GROUP IS A SUM, NOT A CONSOLIDATION. The "combined" figures add the
 *    members' own statements: intra-group revenue and balances are counted
 *    twice. Only members reporting in the company's currency are added —
 *    currencies are never mixed in one column — and the count left out is
 *    returned so the page can say so.
 */

import { BALANCE_SHEET_KEYS, INCOME_STATEMENT_KEYS } from '../types'
import type {
  BalanceSheetKey,
  BalanceSheetValues,
  IncomeStatementKey,
  IncomeStatementValues,
  ReportType,
  StatementBundle,
} from '../types'
import { buildCashFlowColumns } from '../financials/cashflow'
import { computeRatios } from '../financials/ratios'
import type { LineDirection } from '../financials/lines'

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

const UNIT_FACTOR = { units: 1, thousands: 1_000, millions: 1_000_000 } as const

function scaleRecord<K extends string>(
  record: Partial<Record<K, number | null>> | null,
  keys: readonly K[],
  factor: number,
): Record<K, number | null> | null {
  if (!record) return null
  const out = {} as Record<K, number | null>
  for (const key of keys) {
    const value = record[key]
    out[key] = value === null || value === undefined ? null : Number(value) * factor
  }
  return out
}

/** The statement with every amount in whole units. */
export function normalizeBundle(s: StatementBundle): StatementBundle {
  const factor = UNIT_FACTOR[s.unit] ?? 1
  return {
    ...s,
    unit: 'units',
    balance_sheets: scaleRecord(
      s.balance_sheets,
      BALANCE_SHEET_KEYS,
      factor,
    ) as BalanceSheetValues | null,
    income_statements: scaleRecord(
      s.income_statements,
      INCOME_STATEMENT_KEYS,
      factor,
    ) as IncomeStatementValues | null,
  }
}

/**
 * Annual statements of one report type, one per fiscal year (the latest
 * period end wins), chronological, normalised to units.
 */
export function annualSeries(
  statements: StatementBundle[],
  reportType: ReportType,
): StatementBundle[] {
  const byYear = new Map<number, StatementBundle>()
  for (const s of statements) {
    if (s.statement_kind !== 'annual' || s.report_type !== reportType) continue
    const held = byYear.get(s.fiscal_year)
    if (!held || s.period_end_date > held.period_end_date) byYear.set(s.fiscal_year, s)
  }
  return [...byYear.values()].sort((a, b) => a.fiscal_year - b.fiscal_year).map(normalizeBundle)
}

function sumKeys<K extends string>(
  records: (Partial<Record<K, number | null>> | null)[],
  keys: readonly K[],
): Record<K, number | null> {
  const out = {} as Record<K, number | null>
  for (const key of keys) {
    let total: number | null = null
    for (const r of records) {
      const v = r?.[key]
      if (v !== null && v !== undefined) total = (total ?? 0) + Number(v)
    }
    out[key] = total
  }
  return out
}

export interface CombinedSeries {
  /** One synthetic annual bundle per year (entity_id = the ultimate parent). */
  series: StatementBundle[]
  /** Members whose statements were added, per fiscal year. */
  membersPerYear: Record<number, number>
  /** Members with statements in the type but another currency (left out). */
  otherCurrencyMembers: number
}

/**
 * The group's combined statements: per fiscal year, the SUM of the members'
 * annual statements of `reportType` in `currency`. See the module comment —
 * this is not a consolidation.
 */
export function combineGroupSeries(
  memberStatements: StatementBundle[],
  reportType: ReportType,
  currency: string,
  groupId: string,
): CombinedSeries {
  const perMember = new Map<string, StatementBundle[]>()
  for (const s of memberStatements) {
    const list = perMember.get(s.entity_id) ?? []
    list.push(s)
    perMember.set(s.entity_id, list)
  }

  const byYear = new Map<number, StatementBundle[]>()
  let otherCurrencyMembers = 0
  for (const statements of perMember.values()) {
    const series = annualSeries(statements, reportType)
    if (series.length === 0) continue
    const inCurrency = series.filter((s) => s.currency_code === currency)
    if (inCurrency.length === 0) {
      otherCurrencyMembers += 1
      continue
    }
    for (const s of inCurrency) {
      const list = byYear.get(s.fiscal_year) ?? []
      list.push(s)
      byYear.set(s.fiscal_year, list)
    }
  }

  const membersPerYear: Record<number, number> = {}
  const series = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, list]) => {
      membersPerYear[year] = list.length
      const first = list[0]
      return {
        ...first,
        id: `group-${groupId}-${year}`,
        entity_id: groupId,
        period_end_date: list
          .map((s) => s.period_end_date)
          .sort()
          .slice(-1)[0],
        currency_code: currency,
        unit: 'units',
        balance_sheets: sumKeys(
          list.map((s) => s.balance_sheets),
          BALANCE_SHEET_KEYS,
        ) as BalanceSheetValues,
        income_statements: sumKeys(
          list.map((s) => s.income_statements),
          INCOME_STATEMENT_KEYS,
        ) as IncomeStatementValues,
      } satisfies StatementBundle
    })

  return { series, membersPerYear, otherCurrencyMembers }
}

// ---------------------------------------------------------------------------
// Statement tables
// ---------------------------------------------------------------------------

export type RowLevel = 'line' | 'subtotal' | 'grand'

export interface ReportRowDef {
  /** i18n key under report.rows.* */
  labelKey: string
  level: RowLevel
  direction: LineDirection
  value: (s: StatementBundle) => number | null
}

const bs =
  (key: BalanceSheetKey) =>
  (s: StatementBundle): number | null =>
    s.balance_sheets?.[key] ?? null
const pl =
  (key: IncomeStatementKey) =>
  (s: StatementBundle): number | null =>
    s.income_statements?.[key] ?? null

/** The condensed balance sheet of the reference report. */
export const BS_REPORT_ROWS: ReportRowDef[] = [
  {
    labelKey: 'nonCurrentAssets',
    level: 'subtotal',
    direction: 'up_good',
    value: bs('total_non_current_assets'),
  },
  { labelKey: 'inventories', level: 'line', direction: 'up_good', value: bs('inventories') },
  {
    labelKey: 'accountsReceivable',
    level: 'line',
    direction: 'up_good',
    value: bs('trade_receivables'),
  },
  { labelKey: 'cash', level: 'line', direction: 'up_good', value: bs('cash_and_equivalents') },
  {
    labelKey: 'stInvestments',
    level: 'line',
    direction: 'up_good',
    value: bs('short_term_investments'),
  },
  {
    labelKey: 'currentAssets',
    level: 'subtotal',
    direction: 'up_good',
    value: bs('total_current_assets'),
  },
  {
    labelKey: 'retainedEarnings',
    level: 'line',
    direction: 'up_good',
    value: bs('retained_earnings'),
  },
  { labelKey: 'equity', level: 'subtotal', direction: 'up_good', value: bs('total_equity') },
  { labelKey: 'ltLoans', level: 'line', direction: 'up_bad', value: bs('long_term_borrowings') },
  { labelKey: 'stLoans', level: 'line', direction: 'up_bad', value: bs('short_term_borrowings') },
  { labelKey: 'accountsPayable', level: 'line', direction: 'up_bad', value: bs('trade_payables') },
  {
    labelKey: 'currentLiabilities',
    level: 'subtotal',
    direction: 'up_bad',
    value: bs('total_current_liabilities'),
  },
  { labelKey: 'totalAssets', level: 'grand', direction: 'up_good', value: bs('total_assets') },
]

/** The profit & loss account of the reference report. */
export const PL_REPORT_ROWS: ReportRowDef[] = [
  { labelKey: 'revenue', level: 'subtotal', direction: 'up_good', value: pl('revenue') },
  { labelKey: 'costOfSales', level: 'line', direction: 'up_bad', value: pl('cost_of_sales') },
  { labelKey: 'grossProfit', level: 'subtotal', direction: 'up_good', value: pl('gross_profit') },
  {
    labelKey: 'sellingExpenses',
    level: 'line',
    direction: 'up_bad',
    value: pl('distribution_expenses'),
  },
  {
    labelKey: 'administrativeExpenses',
    level: 'line',
    direction: 'up_bad',
    value: pl('administrative_expenses'),
  },
  {
    labelKey: 'otherOperatingIncome',
    level: 'line',
    direction: 'up_good',
    value: pl('other_operating_income'),
  },
  {
    labelKey: 'otherOperatingExpenses',
    level: 'line',
    direction: 'up_bad',
    value: pl('other_operating_expenses'),
  },
  {
    labelKey: 'operatingProfit',
    level: 'subtotal',
    direction: 'up_good',
    value: pl('operating_profit'),
  },
  { labelKey: 'interestIncome', level: 'line', direction: 'up_good', value: pl('finance_income') },
  { labelKey: 'interestExpense', level: 'line', direction: 'up_bad', value: pl('finance_costs') },
  {
    labelKey: 'profitBeforeTax',
    level: 'subtotal',
    direction: 'up_good',
    value: pl('profit_before_tax'),
  },
  { labelKey: 'incomeTax', level: 'line', direction: 'up_bad', value: pl('income_tax') },
  { labelKey: 'netProfit', level: 'grand', direction: 'up_good', value: pl('net_profit') },
]

export type Trend = 'up' | 'down' | null
export type Tone = 'pos' | 'neg' | null

/** Green = improvement, red = deterioration (DESIGN.md, direction-aware). */
export function toneFor(trend: Trend, direction: LineDirection): Tone {
  if (trend === null) return null
  const good = direction === 'up_good' ? trend === 'up' : trend === 'down'
  return good ? 'pos' : 'neg'
}

export function trendOf(current: number | null, previous: number | null): Trend {
  if (current === null || previous === null || current === previous) return null
  return current > previous ? 'up' : 'down'
}

export interface StatementCell {
  value: number | null
  /** Share of the base (total assets / revenue), as a fraction. */
  share: number | null
  trend: Trend
  tone: Tone
}

export interface StatementRow {
  def: ReportRowDef
  cells: StatementCell[]
}

/** Two periods can be compared only in the same statement currency. */
function comparable(a: StatementBundle | undefined, b: StatementBundle | undefined): boolean {
  return !!a && !!b && a.currency_code === b.currency_code
}

/**
 * One table: rows × years. `base` is the vertical-analysis denominator.
 * A row with no value in any year is dropped (an empty row on a printed
 * report reads as zero).
 *
 * `display` (same length, same order) is the series as SHOWN — converted to
 * a display currency. Trends are always read from `series`, the original
 * statement currency, so an exchange-rate move never masquerades as a
 * business one; shares are currency-invariant either way.
 */
export function statementRows(
  series: StatementBundle[],
  defs: ReportRowDef[],
  base: (s: StatementBundle) => number | null,
  display: StatementBundle[] = series,
): StatementRow[] {
  return defs
    .map((def) => ({
      def,
      cells: series.map((s, i) => {
        const original = def.value(s)
        const denominator = base(s)
        const share = original !== null && denominator ? original / denominator : null
        const trend =
          i > 0 && comparable(s, series[i - 1]) ? trendOf(original, def.value(series[i - 1])) : null
        return {
          value: display[i] ? def.value(display[i]) : original,
          share,
          trend,
          tone: toneFor(trend, def.direction),
        }
      }),
    }))
    .filter((row) => row.cells.some((c) => c.value !== null))
}

export const bsBase = bs('total_assets')
export const plBase = pl('revenue')

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

export function grossDebt(s: StatementBundle): number | null {
  const lt = s.balance_sheets?.long_term_borrowings ?? null
  const st = s.balance_sheets?.short_term_borrowings ?? null
  if (lt === null && st === null) return null
  return (lt ?? 0) + (st ?? 0)
}

export function equityRatio(s: StatementBundle): number | null {
  const equity = s.balance_sheets?.total_equity ?? null
  const assets = s.balance_sheets?.total_assets ?? null
  return equity !== null && assets ? equity / assets : null
}

export function debtToEquity(s: StatementBundle): number | null {
  const debt = grossDebt(s)
  const equity = s.balance_sheets?.total_equity ?? null
  return debt !== null && equity ? debt / equity : null
}

/**
 * Relative change against the MAGNITUDE of the base, so a loss that shrinks
 * reads as an improvement (-49.17B → -48.70B = +1.0%). Not meaningful (null)
 * when either side is missing, the base is zero, the sign flips, or the move
 * exceeds ±1 000%.
 */
export function relativeMove(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  if (Math.sign(current) !== Math.sign(previous) && current !== 0) return null
  const move = (current - previous) / Math.abs(previous)
  if (!Number.isFinite(move) || Math.abs(move) > 10) return null
  return move
}

// ---------------------------------------------------------------------------
// Key figures
// ---------------------------------------------------------------------------

export type KeyFigureKey = 'revenue' | 'netProfit' | 'equityRatio' | 'debtToEquity'
export type ChangeKind = 'pct' | 'pp' | 'x'

export interface KeyFigure {
  key: KeyFigureKey
  value: number | null
  previous: number | null
  previousYear: number | null
  change: { kind: ChangeKind; value: number } | null
  trend: Trend
  tone: Tone
  /** amount = currency figure, percent = fraction, ratio = multiple */
  format: 'amount' | 'percent' | 'ratio'
}

/** `display` as in statementRows: shown values; changes come from `series`. */
export function keyFigures(
  series: StatementBundle[],
  display: StatementBundle[] = series,
): KeyFigure[] {
  const n = series.length
  const latest = series[n - 1]
  const prior = n > 1 && comparable(series[n - 1], series[n - 2]) ? series[n - 2] : null
  const shownLatest = display[n - 1] ?? latest
  const shownPrior = prior ? (display[n - 2] ?? prior) : null
  if (!latest) return []

  const make = (
    key: KeyFigureKey,
    fn: (s: StatementBundle) => number | null,
    format: KeyFigure['format'],
    kind: ChangeKind,
    direction: LineDirection,
  ): KeyFigure => {
    const current = fn(latest)
    const before = prior ? fn(prior) : null
    let change: KeyFigure['change'] = null
    if (current !== null && before !== null) {
      if (kind === 'pct') {
        const move = relativeMove(current, before)
        change = move === null ? null : { kind, value: move }
      } else {
        change = { kind, value: current - before }
      }
    }
    const trend = trendOf(current, before)
    return {
      key,
      value: fn(shownLatest),
      previous: shownPrior ? fn(shownPrior) : null,
      previousYear: prior?.fiscal_year ?? null,
      change,
      trend,
      tone: toneFor(trend, direction),
      format,
    }
  }

  return [
    make('revenue', pl('revenue'), 'amount', 'pct', 'up_good'),
    make('netProfit', pl('net_profit'), 'amount', 'pct', 'up_good'),
    make('equityRatio', equityRatio, 'percent', 'pp', 'up_good'),
    make('debtToEquity', debtToEquity, 'ratio', 'x', 'up_bad'),
  ]
}

// ---------------------------------------------------------------------------
// Ratio tables
// ---------------------------------------------------------------------------

export type RatioTableKey = 'profitability' | 'liquidity' | 'turnover'
export type RatioFormat = 'percent' | 'amount' | 'days'

export interface RatioRowDef {
  /** i18n key under report.ratioRows.* */
  key: string
  direction: LineDirection
}

export interface RatioRow {
  key: string
  values: (number | null)[]
  /** Relative change vs the previous column (first column null). */
  changes: (number | null)[]
  tones: Tone[]
}

export interface RatioTable {
  key: RatioTableKey
  format: RatioFormat
  rows: RatioRow[]
}

const RATIO_ROWS: Record<RatioTableKey, RatioRowDef[]> = {
  profitability: [
    { key: 'grossMargin', direction: 'up_good' },
    { key: 'ebitMargin', direction: 'up_good' },
    { key: 'profitMargin', direction: 'up_good' },
  ],
  liquidity: [
    { key: 'cfo', direction: 'up_good' },
    { key: 'fcf', direction: 'up_good' },
    { key: 'nwc', direction: 'up_good' },
  ],
  turnover: [
    { key: 'dio', direction: 'up_bad' },
    // A longer DPO reduces the financing need (financials/lines.ts).
    { key: 'dpo', direction: 'up_good' },
    { key: 'dso', direction: 'up_bad' },
    { key: 'ccc', direction: 'up_bad' },
  ],
}

/**
 * Profitability, liquidity and turnover tables for the displayed years.
 * `all` is the full annual series (CFO / FCF need the year before the first
 * displayed one). `shown` / `shownAll` are the same series converted to the
 * display currency: liquidity AMOUNTS are shown from them, every change is
 * read from the original.
 */
export function ratioTables(
  displayed: StatementBundle[],
  all: StatementBundle[],
  shown: StatementBundle[] = displayed,
  shownAll: StatementBundle[] = all,
): RatioTable[] {
  const valuesFor = (columns: StatementBundle[], universe: StatementBundle[]) => {
    const cashFlow = buildCashFlowColumns(columns, universe)
    const cfOf = (s: StatementBundle) => cashFlow.find((c) => c.statement.id === s.id) ?? null
    return (key: string, s: StatementBundle) => valueOf(key, s, cfOf)
  }
  const original = valuesFor(displayed, all)
  const display = valuesFor(shown, shownAll)

  function valueOf(
    key: string,
    s: StatementBundle,
    cfOf: (s: StatementBundle) => ReturnType<typeof buildCashFlowColumns>[number] | null,
  ): number | null {
    const r = computeRatios(s.statement_kind, s.balance_sheets, s.income_statements)
    switch (key) {
      case 'grossMargin':
        return r.gross_margin.value
      case 'ebitMargin':
        return r.operating_margin.value
      case 'profitMargin':
        return r.net_margin.value
      case 'cfo':
        return cfOf(s)?.cfo ?? null
      case 'fcf': {
        const column = cfOf(s)
        if (!column) return null
        const capex = column.investing.find((l) => l.key === 'ppe_capex')?.value ?? 0
        return column.cfo + capex
      }
      case 'nwc': {
        const ca = s.balance_sheets?.total_current_assets ?? null
        const cl = s.balance_sheets?.total_current_liabilities ?? null
        return ca !== null && cl !== null ? ca - cl : null
      }
      case 'dio':
        return r.inventory_days.value
      case 'dpo':
        return r.payables_days.value
      case 'dso':
        return r.receivables_days.value
      case 'ccc':
        return r.working_capital_cycle.value
      default:
        return null
    }
  }

  const formats: Record<RatioTableKey, RatioFormat> = {
    profitability: 'percent',
    liquidity: 'amount',
    turnover: 'days',
  }

  return (Object.keys(RATIO_ROWS) as RatioTableKey[]).map((tableKey) => ({
    key: tableKey,
    format: formats[tableKey],
    rows: RATIO_ROWS[tableKey]
      .map((def) => {
        const base = displayed.map((s) => original(def.key, s))
        const values = shown.map((s, i) => (shown === displayed ? base[i] : display(def.key, s)))
        const ok = (i: number) => i > 0 && comparable(displayed[i], displayed[i - 1])
        const changes = base.map((v, i) => (ok(i) ? relativeMove(v, base[i - 1]) : null))
        const tones = base.map((v, i) =>
          ok(i) ? toneFor(trendOf(v, base[i - 1]), def.direction) : null,
        )
        return { key: def.key, values, changes, tones }
      })
      .filter((row) => row.values.some((v) => v !== null)),
  }))
}

// ---------------------------------------------------------------------------
// Group: key companies and structure
// ---------------------------------------------------------------------------

export interface MemberInfo {
  id: string
  name: string
  registration_number: string
  industry: string | null
}

export interface MemberFigures extends MemberInfo {
  year: number
  revenue: number | null
  netProfit: number | null
  totalAssets: number | null
  equity: number | null
  grossDebt: number | null
  ltAssets: number | null
}

/** The latest annual statement of each member in `currency`. */
export function memberFigures(
  members: MemberInfo[],
  memberStatements: StatementBundle[],
  reportType: ReportType,
  currency: string,
): MemberFigures[] {
  return members
    .map((m) => {
      const series = annualSeries(
        memberStatements.filter((s) => s.entity_id === m.id),
        reportType,
      ).filter((s) => s.currency_code === currency)
      const latest = series[series.length - 1]
      if (!latest) return null
      return {
        ...m,
        year: latest.fiscal_year,
        revenue: latest.income_statements?.revenue ?? null,
        netProfit: latest.income_statements?.net_profit ?? null,
        totalAssets: latest.balance_sheets?.total_assets ?? null,
        equity: latest.balance_sheets?.total_equity ?? null,
        grossDebt: grossDebt(latest),
        ltAssets: latest.balance_sheets?.total_non_current_assets ?? null,
      }
    })
    .filter((m): m is MemberFigures => m !== null)
}

export type MemberMetric =
  'revenue' | 'netProfit' | 'grossDebt' | 'ltAssets' | 'totalAssets' | 'equity'

export interface RankedMember {
  member: MemberFigures
  value: number
  /** Share of the group total of this metric (fraction), null if total 0. */
  share: number | null
}

/**
 * Top-N members by a metric, with each one's share of the group total.
 * `excludeId` leaves one member out of the ranking but not out of the total.
 */
export function topMembers(
  members: MemberFigures[],
  metric: MemberMetric,
  n = 5,
  excludeId?: string,
): RankedMember[] {
  const withValue = members.filter((m) => m[metric] !== null) as (MemberFigures &
    Record<MemberMetric, number>)[]
  const total = withValue.reduce((sum, m) => sum + m[metric], 0)
  return withValue
    .filter((m) => m.id !== excludeId)
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, n)
    .map((m) => ({ member: m, value: m[metric], share: total ? m[metric] / total : null }))
}

/** Share of the group total, per member, for the structure table. */
export function shareOf(
  members: MemberFigures[],
  metric: MemberMetric,
  member: MemberFigures,
): number | null {
  const value = member[metric]
  if (value === null) return null
  const total = members.reduce((sum, m) => sum + (m[metric] ?? 0), 0)
  return total ? value / total : null
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/** True when the latest statement ended more than 12 months before `today`. */
export function isStale(periodEnd: string | null | undefined, today: string): boolean {
  if (!periodEnd) return false
  const end = new Date(`${periodEnd}T00:00:00Z`)
  const limit = new Date(`${today}T00:00:00Z`)
  limit.setUTCFullYear(limit.getUTCFullYear() - 1)
  return end < limit
}
