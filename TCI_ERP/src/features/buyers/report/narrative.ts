/**
 * Rule-based, deterministic conclusion narrative for the Risk Report.
 * Pure module: emits (theme, key, params) bullets; the report page renders
 * them through i18n templates under report.narrative.* — no free-form
 * generation. Sentences whose inputs are missing are omitted.
 */

import type { StatementBundle } from '../types'
import { findLikeForLikeBase, sortChronological } from '../financials/analysis'
import type { CashFlowColumn } from '../financials/cashflow'
import { hasPersistentNegativeCfo } from '../financials/cashflow'
import { computeRatios } from '../financials/ratios'
import type { RiskPeriod } from '../financials/risk'
import { RISK_ROWS } from '../financials/risk'

export interface NarrativeBullet {
  theme:
    | 'performance'
    | 'profitability'
    | 'leverage'
    | 'liquidity'
    | 'cashflow'
    | 'activity'
    | 'risk'
  /** i18n key under report.narrative.* */
  key: string
  params: Record<string, number | string>
}

const THEME_ORDER: NarrativeBullet['theme'][] = [
  'performance',
  'profitability',
  'leverage',
  'liquidity',
  'cashflow',
  'activity',
  'risk',
]

function pct(change: number): number {
  return Math.abs(change * 100)
}

export function buildNarrative(input: {
  /** Statements of ONE report_type, chronological; latest is assessed. */
  statements: StatementBundle[]
  all: StatementBundle[]
  riskPeriods: RiskPeriod[]
  cashFlowColumns: CashFlowColumn[]
}): NarrativeBullet[] {
  const bullets: NarrativeBullet[] = []
  const chronological = sortChronological(input.statements)
  const latest = chronological[chronological.length - 1]
  if (!latest) return []

  const ratios = computeRatios(
    latest.statement_kind,
    latest.balance_sheets,
    latest.income_statements,
  )
  const base = findLikeForLikeBase(latest, input.all)
  const baseRatios = base
    ? computeRatios(base.statement_kind, base.balance_sheets, base.income_statements)
    : null

  const currency = latest.currency_code

  // --- performance: revenue level and like-for-like growth ---
  const revenue = latest.income_statements?.revenue ?? null
  if (revenue !== null) {
    const prevRevenue = base?.income_statements?.revenue ?? null
    if (prevRevenue !== null && prevRevenue !== 0) {
      const change = (revenue - prevRevenue) / Math.abs(prevRevenue)
      const key =
        Math.abs(change) < 0.02
          ? 'revenue_flat'
          : change > 0
            ? 'revenue_grew'
            : 'revenue_fell'
      bullets.push({
        theme: 'performance',
        key,
        params: { amount: revenue, prev: prevRevenue, pct: pct(change), currency },
      })
    } else {
      bullets.push({
        theme: 'performance',
        key: 'revenue_level',
        params: { amount: revenue, currency },
      })
    }
  }

  // --- profitability: gross margin trend + net result ---
  const grossMargin = ratios.gross_margin.value
  const prevGrossMargin = baseRatios?.gross_margin.value ?? null
  if (grossMargin !== null && prevGrossMargin !== null) {
    const key = grossMargin >= prevGrossMargin ? 'gross_margin_up' : 'gross_margin_down'
    bullets.push({
      theme: 'profitability',
      key,
      params: { from: pct(prevGrossMargin) , to: pct(grossMargin) },
    })
  }
  const netProfit = latest.income_statements?.net_profit ?? null
  if (netProfit !== null) {
    if (netProfit >= 0) {
      bullets.push({
        theme: 'profitability',
        key: 'net_profit_positive',
        params: {
          amount: netProfit,
          currency,
          margin: ratios.net_margin.value !== null ? pct(ratios.net_margin.value) : '',
        },
      })
    } else {
      bullets.push({
        theme: 'profitability',
        key: 'net_loss',
        params: { amount: Math.abs(netProfit), currency },
      })
    }
  }

  // --- leverage: debt-to-equity band ---
  const leverage = ratios.debt_to_equity.value
  if (leverage !== null) {
    const key =
      leverage < 0.5 ? 'leverage_low' : leverage <= 1 ? 'leverage_moderate' : 'leverage_high'
    bullets.push({ theme: 'leverage', key, params: { value: leverage } })
  }

  // --- liquidity: current ratio vs norm ---
  const currentRatio = ratios.current_ratio.value
  if (currentRatio !== null) {
    bullets.push({
      theme: 'liquidity',
      key: currentRatio >= 1 ? 'liquidity_ok' : 'liquidity_breach',
      params: { value: currentRatio },
    })
  }

  // --- cash flow: CFO sign for the latest computable column ---
  const latestCfo = input.cashFlowColumns
    .filter((c) => c.statement.id === latest.id)
    .map((c) => c.cfo)
  if (latestCfo.length) {
    const cfo = latestCfo[0]
    if (hasPersistentNegativeCfo(input.cashFlowColumns)) {
      bullets.push({
        theme: 'cashflow',
        key: 'cfo_negative_persistent',
        params: { amount: Math.abs(cfo), currency },
      })
    } else {
      bullets.push({
        theme: 'cashflow',
        key: cfo >= 0 ? 'cfo_positive' : 'cfo_negative',
        params: { amount: Math.abs(cfo), currency },
      })
    }
  }

  // --- activity: DSO movement and CCC level ---
  const dso = ratios.receivables_days.value
  const prevDso = baseRatios?.receivables_days.value ?? null
  if (dso !== null && prevDso !== null && Math.abs(dso - prevDso) >= 1) {
    bullets.push({
      theme: 'activity',
      key: dso > prevDso ? 'dso_up' : 'dso_down',
      params: { from: Math.round(prevDso), to: Math.round(dso) },
    })
  }
  const ccc = ratios.working_capital_cycle.value
  if (ccc !== null) {
    bullets.push({ theme: 'activity', key: 'ccc_level', params: { days: Math.round(ccc) } })
  }

  // --- risk: Z'' zone + norm breaches ---
  const latestRisk = input.riskPeriods.find((p) => p.statement.id === latest.id)
  if (latestRisk?.zBand) {
    bullets.push({ theme: 'risk', key: `z_${latestRisk.zBand}`, params: {} })
  }
  if (latestRisk) {
    const breachedKeys = RISK_ROWS.filter((row) => latestRisk.breaches[row.key]).map(
      (row) => row.key,
    )
    if (breachedKeys.length) {
      bullets.push({
        theme: 'risk',
        key: 'norm_breaches',
        params: { count: breachedKeys.length, rows: breachedKeys.join('|') },
      })
    }
  }

  // Group by theme order, cap at 10 bullets.
  return THEME_ORDER.flatMap((theme) => bullets.filter((b) => b.theme === theme)).slice(0, 10)
}
