/** Row types mirroring the `tci` schema (migrations 0004-0005). */

export type StatementKind = 'annual' | 'quarterly'
export type StatementUnit = 'units' | 'thousands' | 'millions'

export interface Buyer {
  id: string
  name: string
  country_code: string
  industry_id: string | null
  registration_number: string
  website: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface BuyerWithRefs extends Buyer {
  countries: { name_en: string; name_ru: string; name_uz: string } | null
  industries: { name_en: string; name_ru: string; name_uz: string } | null
  financial_statements: { period_end_date: string }[]
}

export const BALANCE_SHEET_KEYS = [
  'property_plant_equipment',
  'intangible_assets',
  'goodwill',
  'investment_property',
  'long_term_investments',
  'deferred_tax_assets',
  'other_non_current_assets',
  'total_non_current_assets',
  'inventories',
  'trade_receivables',
  'other_receivables',
  'short_term_investments',
  'cash_and_equivalents',
  'other_current_assets',
  'total_current_assets',
  'total_assets',
  'share_capital',
  'retained_earnings',
  'other_reserves',
  'non_controlling_interests',
  'total_equity',
  'long_term_borrowings',
  'deferred_tax_liabilities',
  'long_term_provisions',
  'other_non_current_liabilities',
  'total_non_current_liabilities',
  'short_term_borrowings',
  'trade_payables',
  'other_payables',
  'current_tax_liabilities',
  'short_term_provisions',
  'other_current_liabilities',
  'total_current_liabilities',
  'total_liabilities',
  'total_equity_and_liabilities',
] as const

export type BalanceSheetKey = (typeof BALANCE_SHEET_KEYS)[number]

export const INCOME_STATEMENT_KEYS = [
  'revenue',
  'cost_of_sales',
  'gross_profit',
  'distribution_expenses',
  'administrative_expenses',
  'other_operating_income',
  'other_operating_expenses',
  'operating_profit',
  'finance_income',
  'finance_costs',
  'other_non_operating',
  'profit_before_tax',
  'income_tax',
  'net_profit',
  'depreciation_amortization',
] as const

export type IncomeStatementKey = (typeof INCOME_STATEMENT_KEYS)[number]

export type BalanceSheetValues = Record<BalanceSheetKey, number | null>
export type IncomeStatementValues = Record<IncomeStatementKey, number | null>

export type AccountingBasis = 'ifrs' | 'local'
export type MappingStatus = 'n/a' | 'mapped' | 'stale'
export type ReportType = 'statutory' | 'management'

export interface FinancialStatement {
  id: string
  buyer_id: string
  statement_kind: StatementKind
  fiscal_year: number
  fiscal_quarter: number | null
  period_end_date: string
  currency_code: string
  unit: StatementUnit
  audited: boolean
  source: string | null
  accounting_basis: AccountingBasis
  template_id: string | null
  mapping_status: MappingStatus
  report_type: ReportType
  created_at: string
  updated_at: string
}

/** Statement with its (possibly missing) balance sheet and P&L rows. */
export interface StatementBundle extends FinancialStatement {
  balance_sheets: BalanceSheetValues | null
  income_statements: IncomeStatementValues | null
}

/** Compact period notation (legacy style): "2024" annual, "2024 (2)" for Q2. */
export function statementPeriodLabel(s: {
  statement_kind: StatementKind
  fiscal_year: number
  fiscal_quarter: number | null
}): string {
  if (s.statement_kind === 'annual') return String(s.fiscal_year)
  return `${s.fiscal_year} (${s.fiscal_quarter})`
}

export function emptyBalanceSheet(): BalanceSheetValues {
  return Object.fromEntries(BALANCE_SHEET_KEYS.map((k) => [k, null])) as BalanceSheetValues
}

export function emptyIncomeStatement(): IncomeStatementValues {
  return Object.fromEntries(INCOME_STATEMENT_KEYS.map((k) => [k, null])) as IncomeStatementValues
}
