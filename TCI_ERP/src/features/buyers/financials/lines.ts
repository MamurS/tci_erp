/**
 * IFRS statement line structure: grouping, subtotal levels and dynamics
 * direction (DESIGN.md: green = improvement, red = deterioration; for
 * expense / liability / debt lines an increase is deterioration).
 */

import type { BalanceSheetKey, IncomeStatementKey } from '../types'

/** 'up_good': growth is green. 'up_bad': growth is red (expenses, debt). */
export type LineDirection = 'up_good' | 'up_bad'

export type LineLevel = 'line' | 'subtotal' | 'grand'

export interface LineDef<K extends string> {
  key: K
  level: LineLevel
  direction: LineDirection
}

export interface SectionDef<K extends string> {
  /** i18n key under fin.sections.* */
  sectionKey: string
  lines: LineDef<K>[]
}

const line = <K extends string>(
  key: K,
  direction: LineDirection,
  level: LineLevel = 'line',
): LineDef<K> => ({ key, level, direction })

/** Vertical-analysis base for a balance sheet line. */
export function bsVerticalBase(key: BalanceSheetKey): 'total_assets' | 'total_equity_and_liabilities' {
  const assetSide: BalanceSheetKey[] = [
    'property_plant_equipment', 'intangible_assets', 'goodwill', 'investment_property',
    'long_term_investments', 'deferred_tax_assets', 'other_non_current_assets',
    'total_non_current_assets', 'inventories', 'trade_receivables', 'other_receivables',
    'short_term_investments', 'cash_and_equivalents', 'other_current_assets',
    'total_current_assets', 'total_assets',
  ]
  return assetSide.includes(key) ? 'total_assets' : 'total_equity_and_liabilities'
}

export const BALANCE_SHEET_SECTIONS: SectionDef<BalanceSheetKey>[] = [
  {
    sectionKey: 'nonCurrentAssets',
    lines: [
      line('property_plant_equipment', 'up_good'),
      line('intangible_assets', 'up_good'),
      line('goodwill', 'up_good'),
      line('investment_property', 'up_good'),
      line('long_term_investments', 'up_good'),
      line('deferred_tax_assets', 'up_good'),
      line('other_non_current_assets', 'up_good'),
      line('total_non_current_assets', 'up_good', 'subtotal'),
    ],
  },
  {
    sectionKey: 'currentAssets',
    lines: [
      line('inventories', 'up_good'),
      line('trade_receivables', 'up_good'),
      line('other_receivables', 'up_good'),
      line('short_term_investments', 'up_good'),
      line('cash_and_equivalents', 'up_good'),
      line('other_current_assets', 'up_good'),
      line('total_current_assets', 'up_good', 'subtotal'),
    ],
  },
  {
    sectionKey: 'totalAssets',
    lines: [line('total_assets', 'up_good', 'grand')],
  },
  {
    sectionKey: 'equity',
    lines: [
      line('share_capital', 'up_good'),
      line('retained_earnings', 'up_good'),
      line('other_reserves', 'up_good'),
      line('non_controlling_interests', 'up_good'),
      line('total_equity', 'up_good', 'subtotal'),
    ],
  },
  {
    sectionKey: 'nonCurrentLiabilities',
    lines: [
      line('long_term_borrowings', 'up_bad'),
      line('deferred_tax_liabilities', 'up_bad'),
      line('long_term_provisions', 'up_bad'),
      line('other_non_current_liabilities', 'up_bad'),
      line('total_non_current_liabilities', 'up_bad', 'subtotal'),
    ],
  },
  {
    sectionKey: 'currentLiabilities',
    lines: [
      line('short_term_borrowings', 'up_bad'),
      line('trade_payables', 'up_bad'),
      line('other_payables', 'up_bad'),
      line('current_tax_liabilities', 'up_bad'),
      line('short_term_provisions', 'up_bad'),
      line('other_current_liabilities', 'up_bad'),
      line('total_current_liabilities', 'up_bad', 'subtotal'),
    ],
  },
  {
    sectionKey: 'totalLiabilities',
    lines: [
      line('total_liabilities', 'up_bad', 'subtotal'),
      line('total_equity_and_liabilities', 'up_good', 'grand'),
    ],
  },
]

/** P&L is flat (no side split); expenses are entered as positive numbers. */
export const INCOME_STATEMENT_SECTIONS: SectionDef<IncomeStatementKey>[] = [
  {
    sectionKey: 'profitAndLoss',
    lines: [
      line('revenue', 'up_good'),
      line('cost_of_sales', 'up_bad'),
      line('gross_profit', 'up_good', 'subtotal'),
      line('distribution_expenses', 'up_bad'),
      line('administrative_expenses', 'up_bad'),
      line('other_operating_income', 'up_good'),
      line('other_operating_expenses', 'up_bad'),
      line('operating_profit', 'up_good', 'subtotal'),
      line('finance_income', 'up_good'),
      line('finance_costs', 'up_bad'),
      line('other_non_operating', 'up_good'),
      line('profit_before_tax', 'up_good', 'subtotal'),
      line('income_tax', 'up_bad'),
      line('net_profit', 'up_good', 'grand'),
      line('depreciation_amortization', 'up_bad'),
    ],
  },
]
