/** Data rows for the two dynamics charts — pure module. */

import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import { computeRatios } from '../financials/ratios'

export function buildDynamicChartData(statements: StatementBundle[]) {
  return statements.map((s) => {
    const ratios = computeRatios(s.statement_kind, s.balance_sheets, s.income_statements)
    return {
      period: statementPeriodLabel(s),
      revenue: s.income_statements?.revenue ?? null,
      receivables: s.balance_sheets?.trade_receivables ?? null,
      payables: s.balance_sheets?.trade_payables ?? null,
      dso: ratios.receivables_days.value,
      dio: ratios.inventory_days.value,
      dpo: ratios.payables_days.value,
    }
  })
}

export type ChartRow = ReturnType<typeof buildDynamicChartData>[number]
