-- 0006_statement_templates.sql
-- What: template-driven local (statutory) statement forms + IFRS mapping.
--       Buyers report in local formats (Uzbekistan NAS first); values are
--       stored exactly as entered (tci.local_statement_values) and mapped
--       into the IFRS tables by the frontend mapping algorithm.
-- Why:  future countries must not require new tables - only new template
--       rows. Analysis views keep working unchanged on the mapped result.

create type tci.form_kind as enum ('balance_sheet', 'income_statement');
create type tci.ifrs_target_table as enum ('balance_sheet', 'income_statement');
create type tci.accounting_basis as enum ('ifrs', 'local');
create type tci.mapping_status as enum ('n/a', 'mapped', 'stale');

create table tci.statement_templates (
  id           uuid primary key default gen_random_uuid(),
  country_code char(2) not null references tci.countries (code),
  form_kind    tci.form_kind not null,
  code         text not null unique,           -- e.g. 'UZ_NAS_F1'
  name_en      text not null,
  name_ru      text not null,
  name_uz      text not null,
  version      text not null default '1',
  is_active    boolean not null default true
);

create table tci.statement_template_lines (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references tci.statement_templates (id) on delete cascade,
  line_code     text not null,                 -- official form line number, e.g. '010'
  name_en       text not null,
  name_ru       text not null,
  name_uz       text not null,
  section       text not null,                 -- grouping header key
  display_order int not null,
  is_subtotal   boolean not null default false,
  indent_level  int not null default 0,
  unique (template_id, line_code)
);

create index statement_template_lines_template_idx
  on tci.statement_template_lines (template_id, display_order);

-- Values exactly as entered from the local form.
create table tci.local_statement_values (
  statement_id     uuid not null references tci.financial_statements (id) on delete cascade,
  template_line_id uuid not null references tci.statement_template_lines (id),
  amount           numeric(18,2),
  primary key (statement_id, template_line_id)
);

-- One local line maps to exactly one IFRS column; several local lines may
-- aggregate (SUM x sign) into the same column. Subtotal lines are NOT
-- mapped - IFRS subtotals are computed by the mapping algorithm.
create table tci.ifrs_mappings (
  id               uuid primary key default gen_random_uuid(),
  template_line_id uuid not null unique references tci.statement_template_lines (id) on delete cascade,
  target_table     tci.ifrs_target_table not null,
  target_column    text not null,
  sign             int not null default 1 check (sign in (1, -1)),
  note             text
);

alter table tci.financial_statements
  add column accounting_basis tci.accounting_basis not null default 'ifrs',
  add column template_id uuid references tci.statement_templates (id),
  add column mapping_status tci.mapping_status not null default 'n/a';

alter table tci.financial_statements
  add constraint financial_statements_local_template check (
    (accounting_basis = 'ifrs' and template_id is null)
    or (accounting_basis = 'local' and template_id is not null)
  );

-- RLS ------------------------------------------------------------------

alter table tci.statement_templates enable row level security;
alter table tci.statement_template_lines enable row level security;
alter table tci.local_statement_values enable row level security;
alter table tci.ifrs_mappings enable row level security;

-- Templates / lines / mappings: staff read, admin write.
create policy "statement_templates: staff read" on tci.statement_templates for select
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));
create policy "statement_templates: admin write" on tci.statement_templates for all
  to authenticated
  using (tci.current_user_role() = 'admin')
  with check (tci.current_user_role() = 'admin');

create policy "template_lines: staff read" on tci.statement_template_lines for select
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));
create policy "template_lines: admin write" on tci.statement_template_lines for all
  to authenticated
  using (tci.current_user_role() = 'admin')
  with check (tci.current_user_role() = 'admin');

create policy "ifrs_mappings: staff read" on tci.ifrs_mappings for select
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));
create policy "ifrs_mappings: admin write" on tci.ifrs_mappings for all
  to authenticated
  using (tci.current_user_role() = 'admin')
  with check (tci.current_user_role() = 'admin');

-- Entered local values: same staff policy as other financial tables.
create policy "local_statement_values: staff all" on tci.local_statement_values for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

grant select on tci.statement_templates, tci.statement_template_lines, tci.ifrs_mappings
  to authenticated;
grant insert, update, delete on tci.statement_templates, tci.statement_template_lines, tci.ifrs_mappings
  to authenticated;  -- write still gated by RLS (admin)
grant select, insert, update, delete on tci.local_statement_values to authenticated;
grant all on tci.statement_templates, tci.statement_template_lines,
  tci.local_statement_values, tci.ifrs_mappings to service_role;
