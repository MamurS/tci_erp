-- 0013_credit_limit_workflow.sql
-- What: Phase 2b - credit limit workflow. Limit requests attached to
--       (policy, buyer), immutable decisions with typed conditions,
--       authority routing with FX conversion, supersede chain, and the
--       exposure views used by the buyer dashboard.
-- Why:  the core underwriting flow. All status/authority logic lives in
--       SQL functions (SECURITY INVOKER - RLS decides visibility); the UI
--       only mirrors them. Decision rows are IMMUTABLE: column-level
--       grants allow updating ONLY the lifecycle column, and lifecycle
--       transitions happen inside the functions.
--
-- Authority conversion rule (documented for the UI mirror):
--   Amounts are compared in UZS. rate(ccy) = the tci.fx_rates row for the
--   currency with the latest rate_date <= current_date, preferring source
--   'cbu' over 'manual' on the same date; UZS itself = 1. A missing rate
--   raises P0003 telling the user to add the rate. An underwriter's
--   authority is the MAX over their currently valid underwriting_authorities
--   rows, converted the same way. admin and senior_underwriter decide
--   regardless of amount (underwriting_authorities constrains underwriters
--   only) - escalated requests therefore always terminate at a senior.
--   Declines need no amount authority (any staff member may decline).
--   Revoke: senior/admin always; an underwriter only when their authority
--   covers the CURRENT effective approved amount.

-- ---------------------------------------------------------------------------
-- FX helpers
-- ---------------------------------------------------------------------------

create or replace function tci.latest_uzs_rate(p_ccy char(3))
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when p_ccy = 'UZS' then 1::numeric
    else (
      select rate_to_uzs from tci.fx_rates
      where currency_code = p_ccy and rate_date <= current_date
      order by rate_date desc, (source = 'cbu') desc
      limit 1
    )
  end
$$;

create or replace function tci.to_uzs(p_amount numeric, p_ccy char(3))
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rate numeric;
begin
  v_rate := tci.latest_uzs_rate(p_ccy);
  if v_rate is null then
    raise exception 'no UZS rate for % - add a rate for it in fx_rates first', p_ccy
      using errcode = 'P0003';
  end if;
  return p_amount * v_rate;
end;
$$;

revoke execute on function tci.latest_uzs_rate(char), tci.to_uzs(numeric, char) from public, anon;
grant execute on function tci.latest_uzs_rate(char), tci.to_uzs(numeric, char)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Credit limit requests
-- ---------------------------------------------------------------------------

create type tci.limit_request_status as enum
  ('draft', 'submitted', 'under_review', 'escalated', 'decided', 'withdrawn');

create table tci.credit_limit_requests (
  id                           uuid primary key default gen_random_uuid(),
  policy_id                    uuid not null references tci.policies (id),
  buyer_id                     uuid not null references tci.buyers (id),
  requested_amount             numeric(18,2) not null check (requested_amount > 0),
  currency_code                char(3) not null references tci.currencies (code),
  requested_payment_terms_days int,
  justification                text,
  status                       tci.limit_request_status not null default 'draft',
  requested_by                 uuid not null references auth.users (id) default auth.uid(),
  submitted_at                 timestamptz,
  decided_at                   timestamptz,
  withdrawn_at                 timestamptz,
  withdraw_comment             text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

comment on table tci.credit_limit_requests is
  'Credit limit requests per (policy, buyer). One OPEN request per pair (partial unique index); submit requires an active policy.';

-- One OPEN request per (policy, buyer).
create unique index credit_limit_requests_open_uq
  on tci.credit_limit_requests (policy_id, buyer_id)
  where status in ('draft', 'submitted', 'under_review', 'escalated');

create index credit_limit_requests_policy_idx on tci.credit_limit_requests (policy_id);
create index credit_limit_requests_buyer_idx on tci.credit_limit_requests (buyer_id);
create index credit_limit_requests_status_idx on tci.credit_limit_requests (status);

create trigger credit_limit_requests_set_updated_at
  before update on tci.credit_limit_requests
  for each row execute function tci.set_updated_at();

alter table tci.credit_limit_requests enable row level security;

create policy "limit_requests: staff all"
  on tci.credit_limit_requests for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

-- Portal-ready: policyholder reads requests on own policies, no writes.
create policy "limit_requests: policyholder reads own"
  on tci.credit_limit_requests for select
  to authenticated
  using (
    tci.current_user_role() = 'policyholder'
    and policy_id in (
      select p.id from tci.policies p
      join tci.policyholder_users pu on pu.policyholder_id = p.policyholder_id
      where pu.user_id = (select auth.uid())
    )
  );

grant select, insert, update on tci.credit_limit_requests to authenticated;
grant all on tci.credit_limit_requests to service_role;

-- ---------------------------------------------------------------------------
-- Credit limit decisions (IMMUTABLE) + typed conditions
-- ---------------------------------------------------------------------------

create type tci.decision_outcome as enum ('approved', 'partial', 'declined', 'revoked');
create type tci.decision_lifecycle as enum ('effective', 'superseded', 'expired', 'revoked_lc');
create type tci.condition_type as enum
  ('security', 'appraisal', 'reporting', 'payment_terms', 'other');

create table tci.credit_limit_decisions (
  id                     uuid primary key default gen_random_uuid(),
  request_id             uuid not null references tci.credit_limit_requests (id),
  outcome                tci.decision_outcome not null,
  approved_amount        numeric(18,2),
  currency_code          char(3) not null references tci.currencies (code),
  valid_from             date not null default current_date,
  valid_until            date,                 -- null = until review/revocation
  based_on_assessment_id uuid references tci.credit_assessments (id),
  comment                text,
  decided_by             uuid not null references auth.users (id) default auth.uid(),
  decided_at             timestamptz not null default now(),
  lifecycle              tci.decision_lifecycle not null default 'effective',

  constraint decisions_amount_by_outcome check (
    (outcome in ('approved', 'partial') and approved_amount is not null and approved_amount > 0)
    or (outcome = 'declined' and approved_amount is null)
    or (outcome = 'revoked' and coalesce(approved_amount, 0) = 0)
  ),
  constraint decisions_validity check (valid_until is null or valid_until >= valid_from)
);

comment on table tci.credit_limit_decisions is
  'IMMUTABLE decision history. Only the lifecycle column is updatable (column-level grant); transitions happen inside tci.decide_limit_request / tci.revoke_effective_limit.';

create index credit_limit_decisions_request_idx
  on tci.credit_limit_decisions (request_id, decided_at desc);
create index credit_limit_decisions_lifecycle_idx
  on tci.credit_limit_decisions (lifecycle);

create table tci.decision_conditions (
  id             uuid primary key default gen_random_uuid(),
  decision_id    uuid not null references tci.credit_limit_decisions (id) on delete cascade,
  condition_type tci.condition_type not null,
  description    text not null
);

create index decision_conditions_decision_idx on tci.decision_conditions (decision_id);

alter table tci.credit_limit_decisions enable row level security;
alter table tci.decision_conditions enable row level security;

create policy "limit_decisions: staff all"
  on tci.credit_limit_decisions for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

create policy "limit_decisions: policyholder reads own"
  on tci.credit_limit_decisions for select
  to authenticated
  using (
    tci.current_user_role() = 'policyholder'
    and request_id in (
      select r.id from tci.credit_limit_requests r
      join tci.policies p on p.id = r.policy_id
      join tci.policyholder_users pu on pu.policyholder_id = p.policyholder_id
      where pu.user_id = (select auth.uid())
    )
  );

create policy "decision_conditions: staff all"
  on tci.decision_conditions for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

create policy "decision_conditions: policyholder reads own"
  on tci.decision_conditions for select
  to authenticated
  using (
    tci.current_user_role() = 'policyholder'
    and decision_id in (
      select d.id from tci.credit_limit_decisions d
      join tci.credit_limit_requests r on r.id = d.request_id
      join tci.policies p on p.id = r.policy_id
      join tci.policyholder_users pu on pu.policyholder_id = p.policyholder_id
      where pu.user_id = (select auth.uid())
    )
  );

-- Immutability: INSERT + SELECT only; UPDATE restricted to the lifecycle
-- column; no DELETE. Conditions: insert/select only (no edits after the fact).
grant select, insert on tci.credit_limit_decisions to authenticated;
grant update (lifecycle) on tci.credit_limit_decisions to authenticated;
grant select, insert on tci.decision_conditions to authenticated;
grant all on tci.credit_limit_decisions, tci.decision_conditions to service_role;

-- ---------------------------------------------------------------------------
-- Request lifecycle functions
-- ---------------------------------------------------------------------------

-- draft -> submitted. Requires an ACTIVE policy at submit time.
create or replace function tci.submit_limit_request(p_request_id uuid)
returns tci.credit_limit_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request tci.credit_limit_requests%rowtype;
  v_policy_status tci.policy_status;
begin
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'only draft requests can be submitted (current: %)', v_request.status
      using errcode = 'P0001';
  end if;

  select status into v_policy_status from tci.policies where id = v_request.policy_id;
  if v_policy_status is distinct from 'active' then
    raise exception 'policy is not active (current: %) - limit requests bind to active policies',
      v_policy_status using errcode = 'P0001';
  end if;

  update tci.credit_limit_requests
     set status = 'submitted', submitted_at = now()
   where id = p_request_id
   returning * into v_request;
  return v_request;
end;
$$;

-- submitted -> under_review (an underwriter takes the request into work).
create or replace function tci.start_limit_review(p_request_id uuid)
returns tci.credit_limit_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request tci.credit_limit_requests%rowtype;
begin
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status <> 'submitted' then
    raise exception 'only submitted requests can move to review (current: %)', v_request.status
      using errcode = 'P0001';
  end if;
  update tci.credit_limit_requests set status = 'under_review'
   where id = p_request_id returning * into v_request;
  return v_request;
end;
$$;

-- Any non-decided request; requester or senior/admin. History-preserving.
create or replace function tci.withdraw_limit_request(p_request_id uuid, p_comment text default null)
returns tci.credit_limit_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request tci.credit_limit_requests%rowtype;
  v_role tci.user_role;
begin
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status not in ('draft', 'submitted', 'under_review', 'escalated') then
    raise exception 'request is already % and cannot be withdrawn', v_request.status
      using errcode = 'P0001';
  end if;

  v_role := tci.current_user_role();
  if not (v_request.requested_by = (select auth.uid())
          or v_role in ('admin', 'senior_underwriter')) then
    raise exception 'only the requester or a senior underwriter may withdraw'
      using errcode = 'P0004';
  end if;

  update tci.credit_limit_requests
     set status = 'withdrawn', withdrawn_at = now(), withdraw_comment = p_comment
   where id = p_request_id
   returning * into v_request;
  return v_request;
end;
$$;

-- ---------------------------------------------------------------------------
-- Decision + authority routing
-- ---------------------------------------------------------------------------

-- Max authority of the CURRENT user in UZS (underwriters; 0 when none).
create or replace function tci.my_authority_uzs()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(max(tci.to_uzs(a.max_amount, a.currency_code)), 0)
  from tci.underwriting_authorities a
  where a.user_id = (select auth.uid())
    and a.valid_from <= current_date
    and (a.valid_to is null or a.valid_to >= current_date)
$$;

-- Decide an open request. Returns jsonb:
--   {"result":"decided","decision_id":...}                      - recorded
--   {"result":"escalated","amount_uzs":...,"authority_uzs":...} - needs senior
create or replace function tci.decide_limit_request(
  p_request_id    uuid,
  p_outcome       tci.decision_outcome,
  p_amount        numeric default null,
  p_currency      char(3) default null,
  p_valid_from    date default current_date,
  p_valid_until   date default null,
  p_conditions    jsonb default '[]'::jsonb,
  p_comment       text default null,
  p_assessment_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_role     tci.user_role;
  v_currency char(3);
  v_decision tci.credit_limit_decisions%rowtype;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_condition jsonb;
begin
  if p_outcome = 'revoked' then
    raise exception 'use tci.revoke_effective_limit to revoke an effective limit'
      using errcode = 'P0001';
  end if;

  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status not in ('submitted', 'under_review', 'escalated') then
    raise exception 'request is % and cannot be decided', v_request.status
      using errcode = 'P0001';
  end if;

  v_role := tci.current_user_role();
  if v_role not in ('admin', 'senior_underwriter', 'underwriter') then
    raise exception 'only underwriting staff may decide' using errcode = 'P0004';
  end if;

  v_currency := coalesce(p_currency, v_request.currency_code);

  if p_outcome in ('approved', 'partial') then
    if p_amount is null or p_amount <= 0 then
      raise exception 'approved/partial decisions require a positive amount'
        using errcode = 'P0001';
    end if;

    -- Authority routing: underwriting_authorities constrains underwriters;
    -- admin and senior_underwriter decide regardless of amount.
    if v_role = 'underwriter' then
      v_amount_uzs := tci.to_uzs(p_amount, v_currency);
      v_authority_uzs := tci.my_authority_uzs();
      if v_amount_uzs > v_authority_uzs then
        update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;
        return jsonb_build_object(
          'result', 'escalated',
          'amount_uzs', v_amount_uzs,
          'authority_uzs', v_authority_uzs
        );
      end if;
    end if;
  elsif p_outcome = 'declined' then
    if p_amount is not null then
      raise exception 'declined decisions carry no amount' using errcode = 'P0001';
    end if;
  end if;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code,
    valid_from, valid_until, based_on_assessment_id, comment
  ) values (
    p_request_id, p_outcome, p_amount, v_currency,
    coalesce(p_valid_from, current_date), p_valid_until, p_assessment_id, p_comment
  ) returning * into v_decision;

  for v_condition in select * from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb))
  loop
    insert into tci.decision_conditions (decision_id, condition_type, description)
    values (
      v_decision.id,
      (v_condition->>'condition_type')::tci.condition_type,
      v_condition->>'description'
    );
  end loop;

  -- Supersede the previous effective decision for the same (policy, buyer).
  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r
   where r.id = d.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and r.policy_id = v_request.policy_id
     and r.buyer_id = v_request.buyer_id;

  update tci.credit_limit_requests
     set status = 'decided', decided_at = now()
   where id = p_request_id;

  return jsonb_build_object('result', 'decided', 'decision_id', v_decision.id);
end;
$$;

-- Revoke the CURRENT effective limit on (policy, buyer): a new immutable
-- 'revoked' decision row becomes effective; the old one -> 'revoked_lc'.
-- senior/admin always; an underwriter only when their authority covers the
-- current effective approved amount.
create or replace function tci.revoke_effective_limit(
  p_policy_id uuid,
  p_buyer_id  uuid,
  p_comment   text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role tci.user_role;
  v_effective tci.credit_limit_decisions%rowtype;
  v_new tci.credit_limit_decisions%rowtype;
begin
  v_role := tci.current_user_role();
  if v_role not in ('admin', 'senior_underwriter', 'underwriter') then
    raise exception 'only underwriting staff may revoke' using errcode = 'P0004';
  end if;

  select d.* into v_effective
  from tci.credit_limit_decisions d
  join tci.credit_limit_requests r on r.id = d.request_id
  where r.policy_id = p_policy_id and r.buyer_id = p_buyer_id
    and d.lifecycle = 'effective'
    and d.outcome in ('approved', 'partial')
  order by d.decided_at desc
  limit 1
  for update of d;
  if not found then
    raise exception 'no effective approved limit for this (policy, buyer)'
      using errcode = 'P0002';
  end if;

  if v_role = 'underwriter'
     and tci.to_uzs(v_effective.approved_amount, v_effective.currency_code)
         > tci.my_authority_uzs() then
    raise exception 'revoking this limit exceeds your authority - escalate to a senior underwriter'
      using errcode = 'P0004';
  end if;

  update tci.credit_limit_decisions set lifecycle = 'revoked_lc' where id = v_effective.id;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, comment
  ) values (
    v_effective.request_id, 'revoked', 0, v_effective.currency_code, current_date, p_comment
  ) returning * into v_new;

  return jsonb_build_object('result', 'revoked', 'decision_id', v_new.id);
end;
$$;

revoke execute on function
  tci.submit_limit_request(uuid),
  tci.start_limit_review(uuid),
  tci.withdraw_limit_request(uuid, text),
  tci.my_authority_uzs(),
  tci.decide_limit_request(uuid, tci.decision_outcome, numeric, char, date, date, jsonb, text, uuid),
  tci.revoke_effective_limit(uuid, uuid, text)
from public, anon;
grant execute on function
  tci.submit_limit_request(uuid),
  tci.start_limit_review(uuid),
  tci.withdraw_limit_request(uuid, text),
  tci.my_authority_uzs(),
  tci.decide_limit_request(uuid, tci.decision_outcome, numeric, char, date, date, jsonb, text, uuid),
  tci.revoke_effective_limit(uuid, uuid, text)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Views (security_invoker: RLS of the querying user applies)
-- ---------------------------------------------------------------------------

-- Current effective decision per (policy, buyer). A decision past its
-- valid_until is treated as not effective here (lifecycle flips lazily -
-- no cron; the 'expired' lifecycle value is reserved for that transition).
create view tci.v_effective_limits
with (security_invoker = true) as
select
  d.id as decision_id,
  r.policy_id,
  r.buyer_id,
  d.request_id,
  r.requested_amount,
  d.outcome,
  d.approved_amount,
  d.currency_code,
  d.valid_from,
  d.valid_until,
  d.based_on_assessment_id,
  d.comment,
  d.decided_by,
  d.decided_at,
  (select count(*) from tci.decision_conditions c where c.decision_id = d.id)::int
    as conditions_count
from tci.credit_limit_decisions d
join tci.credit_limit_requests r on r.id = d.request_id
where d.lifecycle = 'effective'
  and (d.valid_until is null or d.valid_until >= current_date);

-- Aggregate approved exposure per buyer, converted to UZS via the latest
-- rates (same rule as authority checks). Rows whose rate is missing are
-- excluded from the sum and counted in missing_rates.
create view tci.v_buyer_exposure
with (security_invoker = true) as
select
  v.buyer_id,
  count(distinct v.policy_id)::int as policies_count,
  sum(v.approved_amount * tci.latest_uzs_rate(v.currency_code))
    filter (where tci.latest_uzs_rate(v.currency_code) is not null)
    as exposure_uzs,
  count(*) filter (where tci.latest_uzs_rate(v.currency_code) is null)::int
    as missing_rates
from tci.v_effective_limits v
where v.outcome in ('approved', 'partial')
group by v.buyer_id;

grant select on tci.v_effective_limits, tci.v_buyer_exposure to authenticated;
grant select on tci.v_effective_limits, tci.v_buyer_exposure to service_role;
