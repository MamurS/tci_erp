-- 0015_legal_entities.sql
-- What: Phase 3a - unified legal-entities registry. Merges tci.buyers and
--       tci.policyholders into tci.legal_entities; roles (buyer /
--       policyholder / prospect) are COMPUTED from relationships
--       (tci.v_entity_roles), never assigned. All child FKs are renamed to
--       entity_id and repointed; the old tables are dropped after in-
--       migration row-count assertions. pg_trgm powers add-entity dedup.
-- Why:  one organization can be a buyer under one policy and a policyholder
--       under another; a prospect is analysed with the same financial
--       screens before any contract exists. A single registry with computed
--       roles unblocks the Phase 3c insurance-request pipeline.
--
-- Merge rule: a buyer and a policyholder sharing (country_code,
-- registration_number) become ONE entity - the policyholder row wins the id,
-- fields are unioned preferring non-null (notes concatenated). At the time
-- of writing the canonical DB has no such collisions (4 entities expected,
-- 0 merges), but the rule is enforced generally.

-- ---------------------------------------------------------------------------
-- pg_trgm for fuzzy-duplicate suggestions
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- The registry
-- ---------------------------------------------------------------------------

create table tci.legal_entities (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  legal_form          text,
  country_code        char(2) not null references tci.countries (code),
  industry_id         text references tci.industries (code),
  registration_number text,          -- INN / registration no; null = not yet known
  founded_date        date,
  website             text,
  address             text,
  contact_person      text,
  contact_email       text,
  contact_phone       text,
  notes               text,
  created_by          uuid not null references auth.users (id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table tci.legal_entities is
  'Unified registry of organizations. Roles (buyer / policyholder / prospect) are computed from relationships via tci.v_entity_roles, never stored.';

create unique index legal_entities_reg_uq
  on tci.legal_entities (country_code, registration_number)
  where registration_number is not null;

create index legal_entities_name_idx on tci.legal_entities (name);
create index legal_entities_name_trgm_idx
  on tci.legal_entities using gin (name extensions.gin_trgm_ops);

create trigger legal_entities_set_updated_at
  before update on tci.legal_entities
  for each row execute function tci.set_updated_at();

alter table tci.legal_entities enable row level security;

-- Staff full access; the future `client` role gets nothing yet.
create policy "legal_entities: staff all"
  on tci.legal_entities for all
  to authenticated
  using (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'))
  with check (tci.current_user_role() in ('admin', 'senior_underwriter', 'underwriter'));

grant select, insert, update, delete on tci.legal_entities to authenticated;
grant all on tci.legal_entities to service_role;

-- ---------------------------------------------------------------------------
-- Data migration: policyholders keep their ids; buyers merge on
-- (country_code, registration_number) or keep their ids.
-- ---------------------------------------------------------------------------

create temp table entity_map (old_id uuid primary key, new_id uuid not null) on commit drop;

insert into tci.legal_entities (id, name, legal_form, country_code, industry_id,
  registration_number, address, website, contact_person, contact_email, contact_phone,
  notes, created_by, created_at, updated_at)
select id, name, legal_form, country_code, industry_id,
  registration_number, address, website, contact_person, contact_email, contact_phone,
  notes, created_by, created_at, updated_at
from tci.policyholders;

insert into entity_map select id, id from tci.policyholders;

-- Merge colliding buyers into the policyholder-derived entity (union of
-- fields, prefer non-null; notes concatenated).
update tci.legal_entities e
   set legal_form   = coalesce(e.legal_form, b.legal_form),
       industry_id  = coalesce(e.industry_id, b.industry_id),
       founded_date = coalesce(e.founded_date, b.founded_date),
       website      = coalesce(e.website, b.website),
       notes        = case
                        when e.notes is null then b.notes
                        when b.notes is null then e.notes
                        else e.notes || E'\n' || b.notes
                      end
  from tci.buyers b
 where b.country_code = e.country_code
   and b.registration_number = e.registration_number;

insert into entity_map
select b.id, e.id
from tci.buyers b
join tci.legal_entities e
  on e.country_code = b.country_code
 and e.registration_number = b.registration_number;

insert into tci.legal_entities (id, name, legal_form, country_code, industry_id,
  registration_number, founded_date, website, notes, created_by, created_at, updated_at)
select b.id, b.name, b.legal_form, b.country_code, b.industry_id,
  b.registration_number, b.founded_date, b.website, b.notes, b.created_by, b.created_at, b.updated_at
from tci.buyers b
where not exists (select 1 from entity_map m where m.old_id = b.id);

insert into entity_map
select b.id, b.id from tci.buyers b
where not exists (select 1 from entity_map m where m.old_id = b.id);

-- ---------------------------------------------------------------------------
-- FK repoint + rename to entity_id
-- ---------------------------------------------------------------------------

alter table tci.financial_statements drop constraint financial_statements_buyer_id_fkey;
update tci.financial_statements t set buyer_id = m.new_id
  from entity_map m where m.old_id = t.buyer_id and m.new_id <> m.old_id;
alter table tci.financial_statements rename column buyer_id to entity_id;
alter table tci.financial_statements
  add constraint financial_statements_entity_id_fkey
  foreign key (entity_id) references tci.legal_entities (id) on delete cascade;

alter table tci.credit_assessments drop constraint credit_assessments_buyer_id_fkey;
update tci.credit_assessments t set buyer_id = m.new_id
  from entity_map m where m.old_id = t.buyer_id and m.new_id <> m.old_id;
alter table tci.credit_assessments rename column buyer_id to entity_id;
alter table tci.credit_assessments
  add constraint credit_assessments_entity_id_fkey
  foreign key (entity_id) references tci.legal_entities (id) on delete cascade;

alter table tci.credit_limit_requests drop constraint credit_limit_requests_buyer_id_fkey;
update tci.credit_limit_requests t set buyer_id = m.new_id
  from entity_map m where m.old_id = t.buyer_id and m.new_id <> m.old_id;
alter table tci.credit_limit_requests rename column buyer_id to entity_id;
alter table tci.credit_limit_requests
  add constraint credit_limit_requests_entity_id_fkey
  foreign key (entity_id) references tci.legal_entities (id);

alter table tci.policies drop constraint policies_policyholder_id_fkey;
alter table tci.policies rename column policyholder_id to entity_id;
alter table tci.policies
  add constraint policies_entity_id_fkey
  foreign key (entity_id) references tci.legal_entities (id);

alter table tci.policyholder_users drop constraint policyholder_users_policyholder_id_fkey;
alter table tci.policyholder_users rename column policyholder_id to entity_id;
alter table tci.policyholder_users
  add constraint policyholder_users_entity_id_fkey
  foreign key (entity_id) references tci.legal_entities (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Backfill verification (abort the whole transaction on any mismatch)
-- ---------------------------------------------------------------------------

do $$
declare
  v_buyers   int;
  v_phs      int;
  v_merged   int;
  v_entities int;
  v_orphans  int;
begin
  select count(*) into v_buyers from tci.buyers;
  select count(*) into v_phs from tci.policyholders;
  select count(*) into v_merged from entity_map where old_id <> new_id;
  select count(*) into v_entities from tci.legal_entities;

  if v_entities <> v_buyers + v_phs - v_merged then
    raise exception 'entity count mismatch: % entities, expected % + % - % merged',
      v_entities, v_buyers, v_phs, v_merged;
  end if;

  select
    (select count(*) from tci.financial_statements f
      where not exists (select 1 from tci.legal_entities e where e.id = f.entity_id))
    + (select count(*) from tci.credit_assessments a
      where not exists (select 1 from tci.legal_entities e where e.id = a.entity_id))
    + (select count(*) from tci.credit_limit_requests r
      where not exists (select 1 from tci.legal_entities e where e.id = r.entity_id))
    + (select count(*) from tci.policies p
      where not exists (select 1 from tci.legal_entities e where e.id = p.entity_id))
    + (select count(*) from tci.policyholder_users u
      where not exists (select 1 from tci.legal_entities e where e.id = u.entity_id))
    into v_orphans;
  if v_orphans <> 0 then
    raise exception 'backfill left % orphaned child rows', v_orphans;
  end if;

  raise notice 'legal_entities migration ok: % entities (% buyers + % policyholders - % merged)',
    v_entities, v_buyers, v_phs, v_merged;
end $$;

-- We control all code - no compat views; drop the old tables outright.
drop table tci.buyers;
drop table tci.policyholders;

-- ---------------------------------------------------------------------------
-- Recreate the limit views/functions whose SQL text mentioned buyer_id
-- (plpgsql bodies are stored as text, so the column rename does not
-- propagate into them; views are recreated to expose entity_id cleanly).
-- ---------------------------------------------------------------------------

drop view tci.v_buyer_exposure;
drop view tci.v_effective_limits;

create view tci.v_effective_limits
with (security_invoker = true) as
select
  d.id as decision_id,
  r.policy_id,
  r.entity_id,
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

create view tci.v_buyer_exposure
with (security_invoker = true) as
select
  v.entity_id,
  count(distinct v.policy_id)::int as policies_count,
  sum(v.approved_amount * tci.latest_uzs_rate(v.currency_code))
    filter (where tci.latest_uzs_rate(v.currency_code) is not null)
    as exposure_uzs,
  count(*) filter (where tci.latest_uzs_rate(v.currency_code) is null)::int
    as missing_rates
from tci.v_effective_limits v
where v.outcome in ('approved', 'partial')
group by v.entity_id;

grant select on tci.v_effective_limits, tci.v_buyer_exposure to authenticated, service_role;

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

  -- Supersede the previous effective decision for the same (policy, entity).
  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r
   where r.id = d.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and r.policy_id = v_request.policy_id
     and r.entity_id = v_request.entity_id;

  update tci.credit_limit_requests
     set status = 'decided', decided_at = now()
   where id = p_request_id;

  return jsonb_build_object('result', 'decided', 'decision_id', v_decision.id);
end;
$$;

-- Parameter rename (p_buyer_id -> p_entity_id) requires drop + recreate.
drop function tci.revoke_effective_limit(uuid, uuid, text);

create function tci.revoke_effective_limit(
  p_policy_id uuid,
  p_entity_id uuid,
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
  where r.policy_id = p_policy_id and r.entity_id = p_entity_id
    and d.lifecycle = 'effective'
    and d.outcome in ('approved', 'partial')
  order by d.decided_at desc
  limit 1
  for update of d;
  if not found then
    raise exception 'no effective approved limit for this (policy, entity)'
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

revoke execute on function tci.revoke_effective_limit(uuid, uuid, text) from public, anon;
grant execute on function tci.revoke_effective_limit(uuid, uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Computed roles
-- ---------------------------------------------------------------------------

-- is_prospect is reserved: becomes "has insurance_request but no policy"
-- in Phase 3c.
create view tci.v_entity_roles
with (security_invoker = true) as
select
  e.id as entity_id,
  exists (select 1 from tci.policies p where p.entity_id = e.id) as is_policyholder,
  exists (select 1 from tci.credit_limit_requests r where r.entity_id = e.id)
    or exists (
      select 1 from tci.credit_limit_decisions d
      join tci.credit_limit_requests r2 on r2.id = d.request_id
      where r2.entity_id = e.id and d.lifecycle = 'effective'
    ) as is_buyer,
  false as is_prospect
from tci.legal_entities e;

grant select on tci.v_entity_roles to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fuzzy duplicate suggestions for the add-entity modal (pg_trgm)
-- ---------------------------------------------------------------------------

create function tci.similar_entities(p_name text)
returns table (
  id uuid,
  name text,
  country_code char(2),
  registration_number text,
  similarity real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.name, e.country_code, e.registration_number,
         extensions.similarity(e.name, p_name) as similarity
  from tci.legal_entities e
  where extensions.similarity(e.name, p_name) > 0.4
  order by similarity desc
  limit 5
$$;

revoke execute on function tci.similar_entities(text) from public, anon;
grant execute on function tci.similar_entities(text) to authenticated, service_role;
