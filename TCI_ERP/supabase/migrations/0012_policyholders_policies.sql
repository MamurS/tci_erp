-- 0012_policyholders_policies.sql
-- What: commercial underwriting foundation (Phase 2a) - policyholder
--       registry, TCI policies with wording terms, status machine
--       (tci.change_policy_status + tci.policy_status_history), and the
--       portal-ready tci.policyholder_users mapping stub.
-- Why:  Phase 2b will attach credit limit requests to (policy, buyer);
--       policies and their RLS must exist first. Policy RLS is portal-ready
--       NOW: the future `policyholder` role reads own policies through the
--       policyholder_users mapping even though the portal comes later.

-- ---------------------------------------------------------------------------
-- Policyholders (our insured clients - the sellers; NOT buyers/debtors)
-- ---------------------------------------------------------------------------

create table tci.policyholders (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  legal_form          text,
  country_code        char(2) not null references tci.countries (code),
  industry_id         text references tci.industries (code),
  registration_number text not null,
  address             text,
  website             text,
  contact_person      text,
  contact_email       text,
  contact_phone       text,
  notes               text,
  created_by          uuid not null references auth.users (id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table tci.policyholders is
  'Policyholders - our insured clients (sellers). Buyers (debtors) live in tci.buyers.';

create index policyholders_name_idx on tci.policyholders (name);

create trigger policyholders_set_updated_at
  before update on tci.policyholders
  for each row execute function tci.set_updated_at();

alter table tci.policyholders enable row level security;

create policy "policyholders: staff all"
  on tci.policyholders for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

grant select, insert, update, delete on tci.policyholders to authenticated;
grant all on tci.policyholders to service_role;

-- ---------------------------------------------------------------------------
-- Policyholder portal users (stub - empty until the portal phase)
-- ---------------------------------------------------------------------------

create table tci.policyholder_users (
  policyholder_id uuid not null references tci.policyholders (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  created_by      uuid not null references auth.users (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  primary key (policyholder_id, user_id)
);

comment on table tci.policyholder_users is
  'Maps portal auth users to their policyholder. Drives the `policyholder` role RLS (own policies only).';

alter table tci.policyholder_users enable row level security;

create policy "policyholder_users: staff read"
  on tci.policyholder_users for select
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

create policy "policyholder_users: admin manage"
  on tci.policyholder_users for all
  to authenticated
  using (tci.current_user_role() = 'admin')
  with check (tci.current_user_role() = 'admin');

-- Portal users can see their own mapping (needed to resolve "my policyholder").
create policy "policyholder_users: own mapping"
  on tci.policyholder_users for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on tci.policyholder_users to authenticated;
grant all on tci.policyholder_users to service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create type tci.product_structure as enum ('whole_turnover', 'key_buyers', 'single_buyer');
create type tci.policy_status as enum ('draft', 'active', 'suspended', 'expired', 'cancelled');
create type tci.declaration_frequency as enum ('monthly', 'quarterly');

create table tci.policies (
  id                            uuid primary key default gen_random_uuid(),
  policyholder_id               uuid not null references tci.policyholders (id),
  policy_number                 text not null unique,   -- MIG numbering, entered manually
  product_structure             tci.product_structure not null,
  status                        tci.policy_status not null default 'draft',
  inception_date                date not null,
  expiry_date                   date not null,
  currency_code                 char(3) not null references tci.currencies (code),

  -- Cover terms
  insured_percentage            numeric(5,2) not null,
  max_liability_amount          numeric(18,2),
  max_liability_premium_multiple numeric(6,2),
  nql_amount                    numeric(18,2) not null,
  deductible_each_loss          numeric(18,2),
  aggregate_first_loss          numeric(18,2),

  -- Premium terms
  premium_rate_pct              numeric(8,5) not null,  -- % of declared turnover
  minimum_premium               numeric(18,2) not null,
  estimated_annual_turnover     numeric(18,2),

  -- Operational terms
  discretionary_limit           numeric(18,2) not null,
  waiting_period_days           int not null,
  max_extension_period_days     int not null,
  max_payment_terms_days        int not null,
  declaration_frequency         tci.declaration_frequency not null,

  notes                         text,
  created_by                    uuid not null references auth.users (id) default auth.uid(),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint policies_period check (expiry_date > inception_date),
  constraint policies_insured_percentage check (insured_percentage between 50 and 100),
  -- Draft policies may be incomplete; any other status needs a liability cap.
  constraint policies_max_liability_required check (
    status = 'draft'
    or max_liability_amount is not null
    or max_liability_premium_multiple is not null
  ),
  constraint policies_non_negative check (
    premium_rate_pct >= 0 and minimum_premium >= 0 and nql_amount >= 0
    and discretionary_limit >= 0
    and waiting_period_days >= 0 and max_extension_period_days >= 0
    and max_payment_terms_days >= 0
  )
);

comment on table tci.policies is
  'TCI policies (existing contracts entered directly; quotations deferred). Phase 2b attaches credit limit requests to (policy, buyer).';

create index policies_policyholder_idx on tci.policies (policyholder_id);
create index policies_status_idx on tci.policies (status);

create trigger policies_set_updated_at
  before update on tci.policies
  for each row execute function tci.set_updated_at();

alter table tci.policies enable row level security;

create policy "policies: staff all"
  on tci.policies for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

-- Portal-ready NOW: policyholder-role users read ONLY their own policies.
create policy "policies: policyholder reads own"
  on tci.policies for select
  to authenticated
  using (
    tci.current_user_role() = 'policyholder'
    and policyholder_id in (
      select pu.policyholder_id from tci.policyholder_users pu
      where pu.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on tci.policies to authenticated;
grant all on tci.policies to service_role;

-- ---------------------------------------------------------------------------
-- Status machine
-- ---------------------------------------------------------------------------

create table tci.policy_status_history (
  id          uuid primary key default gen_random_uuid(),
  policy_id   uuid not null references tci.policies (id) on delete cascade,
  from_status tci.policy_status not null,
  to_status   tci.policy_status not null,
  changed_by  uuid not null references auth.users (id) default auth.uid(),
  changed_at  timestamptz not null default now(),
  comment     text
);

create index policy_status_history_policy_idx
  on tci.policy_status_history (policy_id, changed_at desc);

alter table tci.policy_status_history enable row level security;

create policy "policy_status_history: staff all"
  on tci.policy_status_history for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

grant select, insert on tci.policy_status_history to authenticated;
grant all on tci.policy_status_history to service_role;

-- Single entry point for status changes. SECURITY INVOKER: RLS on
-- tci.policies/tci.policy_status_history decides who may transition.
-- Allowed: draft->active; active->suspended; suspended->active;
-- active|suspended->cancelled; active->expired (a policy past its expiry
-- date stays 'active' until this explicit transition - no cron).
create or replace function tci.change_policy_status(
  p_policy_id uuid,
  p_to_status tci.policy_status,
  p_comment   text default null
)
returns tci.policies
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_policy tci.policies%rowtype;
  v_from   tci.policy_status;
begin
  select * into v_policy from tci.policies where id = p_policy_id for update;
  if not found then
    raise exception 'policy % not found or not accessible', p_policy_id
      using errcode = 'P0002';
  end if;

  if not (
    (v_policy.status = 'draft'     and p_to_status = 'active')
    or (v_policy.status = 'active'    and p_to_status in ('suspended', 'cancelled', 'expired'))
    or (v_policy.status = 'suspended' and p_to_status in ('active', 'cancelled'))
  ) then
    raise exception 'invalid policy status transition: % -> %', v_policy.status, p_to_status
      using errcode = 'P0001';
  end if;

  v_from := v_policy.status;

  update tci.policies
     set status = p_to_status
   where id = p_policy_id
   returning * into v_policy;

  insert into tci.policy_status_history (policy_id, from_status, to_status, comment)
  values (p_policy_id, v_from, p_to_status, p_comment);

  return v_policy;
end;
$$;

revoke execute on function tci.change_policy_status(uuid, tci.policy_status, text) from public, anon;
grant execute on function tci.change_policy_status(uuid, tci.policy_status, text)
  to authenticated, service_role;
