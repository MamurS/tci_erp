-- 0016_department_roles.sql
-- What: Phase 3b (part 1) - department role model. Recreates the
--       tci.user_role enum with the final department set, makes roles
--       MULTI-VALUED per user, replaces the single-role helper
--       tci.current_user_role() with tci.current_user_roles() / has_role() /
--       is_staff(), and restates the whole RLS model on top of them.
-- Why:  the target workflow (Phase 3c) routes work by department, not by
--       seniority: sales resolve entities, information_manager fills data,
--       credit_underwriter rates and sets limits, commercial_underwriter
--       owns policy terms, claims handle losses. One person can hold
--       several of these hats, so one row per (user, role).
--
-- Enum migration approach: Postgres cannot drop values from an enum in
-- place, so the type is recreated. Every policy and function that mentions
-- the old type is dropped first, the column is cast through text with an
-- explicit value mapping, the old type is dropped, and the access model is
-- recreated below. Mapping:
--     underwriter        -> credit_underwriter
--     senior_underwriter -> credit_underwriter   (seniority now lives in
--                           the authority matrix - migration 0017)
--     policyholder       -> client
--     admin              -> admin
--
-- RLS visibility mapping (staff = any role except 'client'):
--   read  (all staff):  every operational table below
--   write:
--     reference data (countries/industries/currencies/templates/mappings)
--                                  admin
--     legal_entities               admin, sales, information_manager,
--                                  credit_underwriter, commercial_underwriter
--     statements + lines + local   admin, information_manager, credit_underwriter
--     credit_assessments, fx_rates admin, credit_underwriter
--     policies + status history    admin, commercial_underwriter
--     credit_limit_requests        admin, sales, commercial_underwriter,
--                                  credit_underwriter
--     credit_limit_decisions       admin, credit_underwriter  (the decision
--                                  function additionally enforces authority)
--     user_roles, policyholder_users, authorities   admin
--   client: unchanged portal-ready reads of OWN policies / limit requests /
--   decisions (the old 'policyholder' policies, renamed).

-- ---------------------------------------------------------------------------
-- 1. Drop every policy in the schema (they are all restated below) and the
--    functions whose signatures or bodies depend on the old enum type.
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'tci'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

drop function if exists tci.withdraw_limit_request(uuid, text);
drop function if exists tci.decide_limit_request(
  uuid, tci.decision_outcome, numeric, char, date, date, jsonb, text, uuid);
drop function if exists tci.revoke_effective_limit(uuid, uuid, text);
drop function tci.current_user_role();

-- ---------------------------------------------------------------------------
-- 2. Recreate the enum and migrate tci.user_roles (now multi-row per user)
-- ---------------------------------------------------------------------------

alter type tci.user_role rename to user_role_old;

create type tci.user_role as enum (
  'admin',
  'sales',
  'commercial_underwriter',
  'credit_underwriter',
  'claims',
  'information_manager',
  'client'
);

alter table tci.user_roles
  alter column role type tci.user_role
  using (case role::text
           when 'underwriter'        then 'credit_underwriter'
           when 'senior_underwriter' then 'credit_underwriter'
           when 'policyholder'       then 'client'
           else role::text
         end)::tci.user_role;

drop type tci.user_role_old;

-- Multi-role: the PK was user_id alone. Collapse any duplicate rows the
-- mapping may have produced (an ex-underwriter cannot also be an ex-senior
-- on the same user today, but the migration must be general), then widen
-- the key.
alter table tci.user_roles drop constraint user_roles_pkey;

delete from tci.user_roles a
 using tci.user_roles b
 where a.user_id = b.user_id and a.role = b.role and a.ctid > b.ctid;

alter table tci.user_roles add primary key (user_id, role);

comment on table tci.user_roles is
  'Department roles. MULTIPLE rows per user allowed - one per role held.';

-- ---------------------------------------------------------------------------
-- 3. Role helpers (SECURITY DEFINER so policies on user_roles do not recurse)
-- ---------------------------------------------------------------------------

create function tci.current_user_roles()
returns setof tci.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from tci.user_roles where user_id = (select auth.uid())
$$;

create function tci.has_role(variadic p_roles tci.user_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from tci.user_roles
    where user_id = (select auth.uid()) and role = any(p_roles)
  )
$$;

-- Any department role; 'client' (portal) is not staff.
create function tci.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from tci.user_roles
    where user_id = (select auth.uid()) and role <> 'client'
  )
$$;

revoke execute on function tci.current_user_roles(), tci.has_role(variadic tci.user_role[]),
  tci.is_staff() from public, anon;
grant execute on function tci.current_user_roles(), tci.has_role(variadic tci.user_role[]),
  tci.is_staff() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Access model, restated
-- ---------------------------------------------------------------------------

-- 4.1 Role administration
create policy "user_roles: read own"
  on tci.user_roles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "user_roles: admin all"
  on tci.user_roles for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

create policy "authorities: read own"
  on tci.underwriting_authorities for select to authenticated
  using (user_id = (select auth.uid()));
create policy "authorities: admin manage"
  on tci.underwriting_authorities for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

create policy "policyholder_users: own mapping"
  on tci.policyholder_users for select to authenticated
  using (user_id = (select auth.uid()));
create policy "policyholder_users: staff read"
  on tci.policyholder_users for select to authenticated
  using (tci.is_staff());
create policy "policyholder_users: admin manage"
  on tci.policyholder_users for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

-- 4.2 Reference data: everyone signed in reads, admin writes
create policy "countries: authenticated read"
  on tci.countries for select to authenticated using (true);
create policy "countries: admin write"
  on tci.countries for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

create policy "industries: authenticated read"
  on tci.industries for select to authenticated using (true);
create policy "industries: admin write"
  on tci.industries for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

create policy "currencies: authenticated read"
  on tci.currencies for select to authenticated using (true);
create policy "currencies: admin write"
  on tci.currencies for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

create policy "statement_templates: staff read"
  on tci.statement_templates for select to authenticated using (tci.is_staff());
create policy "statement_templates: admin write"
  on tci.statement_templates for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

create policy "template_lines: staff read"
  on tci.statement_template_lines for select to authenticated using (tci.is_staff());
create policy "template_lines: admin write"
  on tci.statement_template_lines for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

create policy "ifrs_mappings: staff read"
  on tci.ifrs_mappings for select to authenticated using (tci.is_staff());
create policy "ifrs_mappings: admin write"
  on tci.ifrs_mappings for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

-- 4.3 Registry: every staff role reads; claims are read-only here
create policy "legal_entities: staff read"
  on tci.legal_entities for select to authenticated using (tci.is_staff());
create policy "legal_entities: staff write"
  on tci.legal_entities for all to authenticated
  using (tci.has_role('admin', 'sales', 'information_manager',
                      'credit_underwriter', 'commercial_underwriter'))
  with check (tci.has_role('admin', 'sales', 'information_manager',
                           'credit_underwriter', 'commercial_underwriter'));

-- 4.4 Financials: entered by information_manager / credit_underwriter
create policy "financial_statements: staff read"
  on tci.financial_statements for select to authenticated using (tci.is_staff());
create policy "financial_statements: data write"
  on tci.financial_statements for all to authenticated
  using (tci.has_role('admin', 'information_manager', 'credit_underwriter'))
  with check (tci.has_role('admin', 'information_manager', 'credit_underwriter'));

create policy "balance_sheets: staff read"
  on tci.balance_sheets for select to authenticated using (tci.is_staff());
create policy "balance_sheets: data write"
  on tci.balance_sheets for all to authenticated
  using (tci.has_role('admin', 'information_manager', 'credit_underwriter'))
  with check (tci.has_role('admin', 'information_manager', 'credit_underwriter'));

create policy "income_statements: staff read"
  on tci.income_statements for select to authenticated using (tci.is_staff());
create policy "income_statements: data write"
  on tci.income_statements for all to authenticated
  using (tci.has_role('admin', 'information_manager', 'credit_underwriter'))
  with check (tci.has_role('admin', 'information_manager', 'credit_underwriter'));

create policy "local_statement_values: staff read"
  on tci.local_statement_values for select to authenticated using (tci.is_staff());
create policy "local_statement_values: data write"
  on tci.local_statement_values for all to authenticated
  using (tci.has_role('admin', 'information_manager', 'credit_underwriter'))
  with check (tci.has_role('admin', 'information_manager', 'credit_underwriter'));

-- 4.5 Rating & fx: credit underwriting owns them
create policy "credit_assessments: staff read"
  on tci.credit_assessments for select to authenticated using (tci.is_staff());
create policy "credit_assessments: credit write"
  on tci.credit_assessments for all to authenticated
  using (tci.has_role('admin', 'credit_underwriter'))
  with check (tci.has_role('admin', 'credit_underwriter'));

create policy "fx_rates: staff read"
  on tci.fx_rates for select to authenticated using (tci.is_staff());
create policy "fx_rates: credit write"
  on tci.fx_rates for all to authenticated
  using (tci.has_role('admin', 'credit_underwriter'))
  with check (tci.has_role('admin', 'credit_underwriter'));

-- 4.6 Policies: commercial underwriting owns terms; client reads own
create policy "policies: staff read"
  on tci.policies for select to authenticated using (tci.is_staff());
create policy "policies: commercial write"
  on tci.policies for all to authenticated
  using (tci.has_role('admin', 'commercial_underwriter'))
  with check (tci.has_role('admin', 'commercial_underwriter'));
create policy "policies: client reads own"
  on tci.policies for select to authenticated
  using (
    tci.has_role('client')
    and entity_id in (
      select pu.entity_id from tci.policyholder_users pu
      where pu.user_id = (select auth.uid())
    )
  );

create policy "policy_status_history: staff read"
  on tci.policy_status_history for select to authenticated using (tci.is_staff());
create policy "policy_status_history: commercial write"
  on tci.policy_status_history for all to authenticated
  using (tci.has_role('admin', 'commercial_underwriter'))
  with check (tci.has_role('admin', 'commercial_underwriter'));

-- 4.7 Limit workflow: sales/commercial/credit raise requests, credit decides
create policy "limit_requests: staff read"
  on tci.credit_limit_requests for select to authenticated using (tci.is_staff());
create policy "limit_requests: workflow write"
  on tci.credit_limit_requests for all to authenticated
  using (tci.has_role('admin', 'sales', 'commercial_underwriter', 'credit_underwriter'))
  with check (tci.has_role('admin', 'sales', 'commercial_underwriter', 'credit_underwriter'));
create policy "limit_requests: client reads own"
  on tci.credit_limit_requests for select to authenticated
  using (
    tci.has_role('client')
    and policy_id in (
      select p.id from tci.policies p
      join tci.policyholder_users pu on pu.entity_id = p.entity_id
      where pu.user_id = (select auth.uid())
    )
  );

create policy "limit_decisions: staff read"
  on tci.credit_limit_decisions for select to authenticated using (tci.is_staff());
create policy "limit_decisions: credit write"
  on tci.credit_limit_decisions for all to authenticated
  using (tci.has_role('admin', 'credit_underwriter'))
  with check (tci.has_role('admin', 'credit_underwriter'));
create policy "limit_decisions: client reads own"
  on tci.credit_limit_decisions for select to authenticated
  using (
    tci.has_role('client')
    and request_id in (
      select r.id from tci.credit_limit_requests r
      join tci.policies p on p.id = r.policy_id
      join tci.policyholder_users pu on pu.entity_id = p.entity_id
      where pu.user_id = (select auth.uid())
    )
  );

create policy "decision_conditions: staff read"
  on tci.decision_conditions for select to authenticated using (tci.is_staff());
create policy "decision_conditions: credit write"
  on tci.decision_conditions for all to authenticated
  using (tci.has_role('admin', 'credit_underwriter'))
  with check (tci.has_role('admin', 'credit_underwriter'));
create policy "decision_conditions: client reads own"
  on tci.decision_conditions for select to authenticated
  using (
    tci.has_role('client')
    and decision_id in (
      select d.id from tci.credit_limit_decisions d
      join tci.credit_limit_requests r on r.id = d.request_id
      join tci.policies p on p.id = r.policy_id
      join tci.policyholder_users pu on pu.entity_id = p.entity_id
      where pu.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Recreate the workflow functions on the new role helpers. decide/revoke
--    are replaced again in 0017 with band-aware authority; recreating them
--    here keeps THIS migration self-consistent (no broken intermediate DB).
-- ---------------------------------------------------------------------------

create function tci.withdraw_limit_request(p_request_id uuid, p_comment text default null)
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
  if v_request.status not in ('draft', 'submitted', 'under_review', 'escalated') then
    raise exception 'request is already % and cannot be withdrawn', v_request.status
      using errcode = 'P0001';
  end if;

  -- The requester, or anyone who may decide (credit underwriting / admin).
  if not (v_request.requested_by = (select auth.uid())
          or tci.has_role('admin', 'credit_underwriter')) then
    raise exception 'only the requester or credit underwriting may withdraw'
      using errcode = 'P0004';
  end if;

  update tci.credit_limit_requests
     set status = 'withdrawn', withdrawn_at = now(), withdraw_comment = p_comment
   where id = p_request_id
   returning * into v_request;
  return v_request;
end;
$$;

create function tci.decide_limit_request(
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

  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may decide' using errcode = 'P0004';
  end if;

  v_currency := coalesce(p_currency, v_request.currency_code);

  if p_outcome in ('approved', 'partial') then
    if p_amount is null or p_amount <= 0 then
      raise exception 'approved/partial decisions require a positive amount'
        using errcode = 'P0001';
    end if;
    if not tci.has_role('admin') then
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
  v_effective tci.credit_limit_decisions%rowtype;
  v_new tci.credit_limit_decisions%rowtype;
begin
  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may revoke' using errcode = 'P0004';
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

  if not tci.has_role('admin')
     and tci.to_uzs(v_effective.approved_amount, v_effective.currency_code)
         > tci.my_authority_uzs() then
    raise exception 'revoking this limit exceeds your authority'
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
  tci.withdraw_limit_request(uuid, text),
  tci.decide_limit_request(uuid, tci.decision_outcome, numeric, char, date, date, jsonb, text, uuid),
  tci.revoke_effective_limit(uuid, uuid, text)
from public, anon;
grant execute on function
  tci.withdraw_limit_request(uuid, text),
  tci.decide_limit_request(uuid, tci.decision_outcome, numeric, char, date, date, jsonb, text, uuid),
  tci.revoke_effective_limit(uuid, uuid, text)
to authenticated, service_role;
