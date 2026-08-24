-- 0005_financial_statements.sql
-- What: IFRS financial statement spreading - statement header + balance sheet
--       + income statement, one row per statement.
-- Why:  Phase 1a buyer financial analysis (vertical/horizontal analysis and
--       ratios). Totals are ENTERED values, not generated columns: the UI
--       shows non-blocking warnings when accounting equations do not hold,
--       but the analyst's figure is the source of truth.

create type tci.statement_kind as enum ('annual', 'quarterly');
create type tci.statement_unit as enum ('units', 'thousands', 'millions');

create table tci.financial_statements (
  id              uuid primary key default gen_random_uuid(),
  buyer_id        uuid not null references tci.buyers (id) on delete cascade,
  statement_kind  tci.statement_kind not null,
  fiscal_year     int not null check (fiscal_year between 1990 and 2100),
  fiscal_quarter  int check (fiscal_quarter between 1 and 4),
  period_end_date date not null,
  currency_code   char(3) not null references tci.currencies (code),
  unit            tci.statement_unit not null default 'units',
  audited         boolean not null default false,
  source          text,
  created_by      uuid not null references auth.users (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint financial_statements_quarter_consistency check (
    (statement_kind = 'annual' and fiscal_quarter is null)
    or (statement_kind = 'quarterly' and fiscal_quarter is not null)
  ),
  constraint financial_statements_unique_period
    unique nulls not distinct (buyer_id, statement_kind, fiscal_year, fiscal_quarter)
);

create index financial_statements_buyer_idx
  on tci.financial_statements (buyer_id, period_end_date desc);

create trigger financial_statements_set_updated_at
  before update on tci.financial_statements
  for each row execute function tci.set_updated_at();

-- Balance sheet: standard IFRS lines, numeric(18,2), all nullable
-- (absent lines are NULL, never 0).
create table tci.balance_sheets (
  statement_id uuid primary key references tci.financial_statements (id) on delete cascade,

  -- Non-current assets
  property_plant_equipment   numeric(18,2),
  intangible_assets          numeric(18,2),
  goodwill                   numeric(18,2),
  investment_property        numeric(18,2),
  long_term_investments      numeric(18,2),
  deferred_tax_assets        numeric(18,2),
  other_non_current_assets   numeric(18,2),
  total_non_current_assets   numeric(18,2),

  -- Current assets
  inventories                numeric(18,2),
  trade_receivables          numeric(18,2),
  other_receivables          numeric(18,2),
  short_term_investments     numeric(18,2),
  cash_and_equivalents       numeric(18,2),
  other_current_assets       numeric(18,2),
  total_current_assets       numeric(18,2),

  total_assets               numeric(18,2),

  -- Equity
  share_capital              numeric(18,2),
  retained_earnings          numeric(18,2),
  other_reserves             numeric(18,2),
  non_controlling_interests  numeric(18,2),
  total_equity               numeric(18,2),

  -- Non-current liabilities
  long_term_borrowings           numeric(18,2),
  deferred_tax_liabilities       numeric(18,2),
  long_term_provisions           numeric(18,2),
  other_non_current_liabilities  numeric(18,2),
  total_non_current_liabilities  numeric(18,2),

  -- Current liabilities
  short_term_borrowings      numeric(18,2),
  trade_payables             numeric(18,2),
  other_payables             numeric(18,2),
  current_tax_liabilities    numeric(18,2),
  short_term_provisions      numeric(18,2),
  other_current_liabilities  numeric(18,2),
  total_current_liabilities  numeric(18,2),

  total_liabilities            numeric(18,2),
  total_equity_and_liabilities numeric(18,2)
);

-- Income statement. Expenses are entered as positive numbers.
-- depreciation_amortization is a memo line used for EBITDA.
create table tci.income_statements (
  statement_id uuid primary key references tci.financial_statements (id) on delete cascade,

  revenue                    numeric(18,2),
  cost_of_sales              numeric(18,2),
  gross_profit               numeric(18,2),
  distribution_expenses      numeric(18,2),
  administrative_expenses    numeric(18,2),
  other_operating_income     numeric(18,2),
  other_operating_expenses   numeric(18,2),
  operating_profit           numeric(18,2),
  finance_income             numeric(18,2),
  finance_costs              numeric(18,2),
  other_non_operating        numeric(18,2),
  profit_before_tax          numeric(18,2),
  income_tax                 numeric(18,2),
  net_profit                 numeric(18,2),
  depreciation_amortization  numeric(18,2)
);

alter table tci.financial_statements enable row level security;
alter table tci.balance_sheets enable row level security;
alter table tci.income_statements enable row level security;

create policy "financial_statements: staff all"
  on tci.financial_statements for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

create policy "balance_sheets: staff all"
  on tci.balance_sheets for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

create policy "income_statements: staff all"
  on tci.income_statements for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

grant select, insert, update, delete
  on tci.financial_statements, tci.balance_sheets, tci.income_statements
  to authenticated;
grant all
  on tci.financial_statements, tci.balance_sheets, tci.income_statements
  to service_role;
