-- 0009_report_type.sql
-- What: statutory vs management accounts flag on financial statements.
-- Why:  buyers often provide both official (tax) and management figures for
--       the same period; analysis must never mix the two in trend
--       computations. The unique-period constraint is extended so both
--       report types can coexist for one period.

create type tci.report_type as enum ('statutory', 'management');

alter table tci.financial_statements
  add column report_type tci.report_type not null default 'statutory';

alter table tci.financial_statements
  drop constraint financial_statements_unique_period;

alter table tci.financial_statements
  add constraint financial_statements_unique_period
  unique nulls not distinct (buyer_id, statement_kind, fiscal_year, fiscal_quarter, report_type);
