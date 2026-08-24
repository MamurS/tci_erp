-- 0004_buyers.sql
-- What: minimal buyer (debtor) registry + shared updated_at trigger helper.
-- Why:  Phase 1a needs a registry to attach financial statements to; the full
--       underwriting card (limits, monitoring) comes in a later phase.

create or replace function tci.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table tci.buyers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  country_code        char(2) not null references tci.countries (code),
  industry_id         text references tci.industries (code),
  registration_number text not null,
  website             text,
  notes               text,
  created_by          uuid not null references auth.users (id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table tci.buyers is
  'Buyers (debtors) whose credit risk is insured. NOT our clients - see policyholders.';

create index buyers_name_idx on tci.buyers (name);
create index buyers_country_idx on tci.buyers (country_code);

create trigger buyers_set_updated_at
  before update on tci.buyers
  for each row execute function tci.set_updated_at();

alter table tci.buyers enable row level security;

-- Staff (admin, senior_underwriter, underwriter) have full access.
-- Policyholders: no access in this phase.
create policy "buyers: staff all"
  on tci.buyers for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

grant select, insert, update, delete on tci.buyers to authenticated;
grant all on tci.buyers to service_role;
