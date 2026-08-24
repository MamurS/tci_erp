-- 0008_credit_assessments.sql
-- What: persisted results of the analytics service (rating + credit limit).
-- Why:  Phase 1c. History is preserved - rows are never updated in place;
--       each calculation inserts a new assessment.

create table tci.credit_assessments (
  id                uuid primary key default gen_random_uuid(),
  buyer_id          uuid not null references tci.buyers (id) on delete cascade,
  statement_id      uuid not null references tci.financial_statements (id) on delete cascade,
  rating_score      numeric(5,1) not null,
  rating_grade      text not null,
  suggested_limit   numeric(18,2) not null,
  limit_currency    char(3) not null references tci.currencies (code),
  inputs_snapshot   jsonb not null,
  calculation_trace jsonb not null,
  engine_version    text not null,
  created_by        uuid not null references auth.users (id) default auth.uid(),
  created_at        timestamptz not null default now()
);

create index credit_assessments_buyer_idx
  on tci.credit_assessments (buyer_id, created_at desc);

alter table tci.credit_assessments enable row level security;

create policy "credit_assessments: staff all"
  on tci.credit_assessments for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

grant select, insert, update, delete on tci.credit_assessments to authenticated;
grant all on tci.credit_assessments to service_role;
