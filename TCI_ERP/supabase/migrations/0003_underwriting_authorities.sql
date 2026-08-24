-- 0003_underwriting_authorities.sql
-- What: tci.underwriting_authorities — who may approve credit decisions up to which amount,
--       in which currency, and for which validity period.
-- Why:  decisions above a user's authority must route to a senior underwriter (workflow
--       status in later phases, not just UI hiding). Full history is kept: rows are
--       time-bounded (valid_from/valid_to), superseded by new rows rather than rewritten.

create table tci.underwriting_authorities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  max_amount    numeric(18,2) not null check (max_amount >= 0),
  currency_code char(3) not null references tci.currencies (code),
  valid_from    date not null default current_date,
  valid_to      date,
  created_by    uuid not null references auth.users (id) default auth.uid(),
  created_at    timestamptz not null default now(),

  constraint underwriting_authorities_valid_period
    check (valid_to is null or valid_to >= valid_from)
);

comment on table tci.underwriting_authorities is
  'Underwriting authority limits per user. valid_to null = open-ended; supersede with a new row instead of updating amounts in place.';

create index underwriting_authorities_user_idx on tci.underwriting_authorities (user_id);

alter table tci.underwriting_authorities enable row level security;

-- Everyone reads their own authority.
create policy "authorities: read own"
  on tci.underwriting_authorities for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Admins and senior underwriters manage authority limits (CLAUDE.md: senior_underwriter
-- "manages authority limits"; admin has full access).
create policy "authorities: admin/senior manage"
  on tci.underwriting_authorities for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter'));

grant select, insert, update, delete on tci.underwriting_authorities to authenticated;
grant all on tci.underwriting_authorities to service_role;
