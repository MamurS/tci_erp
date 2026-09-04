-- What: security closure (audit Phase A, findings S-1, S-2, S-3, S-4, S-5).
--       Every SECURITY DEFINER function reachable by `authenticated` now
--       carries an explicit gate; an unforgeable per-transaction token marks
--       trusted workflow code; permission refusals raise 42501 instead of
--       P0004; the forced password rotation is enforced in the database; the
--       residual PUBLIC grants on definer functions are revoked.
-- Why:  The September 2026 audit verified, with a client-only login on the
--       canonical project, that internal helpers such as
--       file_overdue_notification, generate_premium_instalments,
--       suspend_limit_for_claim, open_task and emit_workflow_event could be
--       called on ANOTHER policyholder's policy: an NOA filed and a limit
--       revoked, a premium schedule regenerated, an urgent task and a
--       workflow event forged. They had been granted to `authenticated`
--       because their SECURITY INVOKER callers execute as the caller and need
--       the grant, and no gate had been written inside them.
--
-- THE RULE THIS MIGRATION ESTABLISHES (also in CLAUDE.md):
--
--   Every SECURITY DEFINER function executable by `authenticated` MUST begin
--   with one of
--     perform tci.require_staff();                -- staff only
--     perform tci.require_role('...');            -- one department
--     perform tci.require_claim_access(claim);    -- staff, or own policyholder
--     perform tci.require_staff_or_internal();    -- staff, or trusted code
--     perform tci.require_internal_call();        -- trusted code ONLY
--   or appear on the allow-list at the end of this file with a one-line
--   justification. The assertion at the end fails the migration otherwise,
--   tests/db/definer_gates.sql fails the replay, and
--   src/lib/securityContract.test.ts fails CI.
--
-- THE INTERNAL-CALL TOKEN. Trusted code marks the transaction:
--     perform tci.begin_internal_call();   -- from SECURITY INVOKER workflow
--                                          -- functions; refuses non-staff
--     perform tci.begin_trusted_call();    -- from SECURITY DEFINER code
--                                          -- (client entry points, triggers);
--                                          -- NOT executable by authenticated
-- and a helper checks `current_setting('tci.internal_call')` against
-- md5(current transaction id || a salt stored in a table no API role can
-- read). A caller cannot forge the token: it cannot read the salt, cannot
-- call set_config through PostgREST, and a REST call is a single-statement
-- transaction anyway. Two entry points exist because inside a SECURITY
-- DEFINER function `current_user` is the owner, so "am I being called from
-- trusted code" cannot be detected from within - the GRANT is the proof.
--
-- ERROR CODES. P0004 is `assert_failure`, which `exception when others`
-- does NOT catch (two probes in the audit aborted on it). Permission refusals
-- now raise 42501 (insufficient_privilege); the two state refusals that had
-- borrowed P0004 raise P0001; the two not-found refusals raise P0002. Message
-- fragments are unchanged, so src/features/*/errors.ts keep mapping.
--
-- PASSWORD ROTATION. tci.has_role and tci.is_staff return false while
-- user_profiles.must_change_password is set, so every staff policy, every
-- client view and every gate closes until tci.complete_password_change runs.
-- The profile read (own row, by uid) and user_roles (own rows, by uid) are
-- not touched, so the change-password screen still works.

-- ---------------------------------------------------------------------------
-- 1. The token
-- ---------------------------------------------------------------------------

create table tci.internal_secrets (
  id   boolean primary key default true check (id),
  salt text not null
);
insert into tci.internal_secrets (salt) values (encode(gen_random_bytes(32), 'hex'));
comment on table tci.internal_secrets is
  'One row: the salt behind the internal-call token. No API role may read it; only SECURITY DEFINER code (owner) can.';
alter table tci.internal_secrets enable row level security;
revoke all on tci.internal_secrets from public, anon, authenticated, service_role;

create function tci.internal_call_token()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(pg_current_xact_id()::text || (select salt from tci.internal_secrets))
$$;
revoke execute on function tci.internal_call_token() from public, anon, authenticated;

create function tci.internal_call_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(current_setting('tci.internal_call', true), '') <> ''
     and current_setting('tci.internal_call', true) = tci.internal_call_token()
$$;
revoke execute on function tci.internal_call_ok() from public, anon, authenticated;

-- From SECURITY INVOKER workflow functions (decide_limit_request, ...): the
-- caller is a staff user, and the grant to authenticated is what lets an
-- invoker function reach it. A client calling it directly gets 42501, and a
-- staff user calling it directly gains nothing: the token dies with the
-- single-statement REST transaction.
create function tci.begin_internal_call()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not tci.is_staff() then
    raise exception 'not permitted to enter internal workflow code' using errcode = '42501';
  end if;
  perform set_config('tci.internal_call', tci.internal_call_token(), true);
end;
$$;
revoke execute on function tci.begin_internal_call() from public, anon;
grant execute on function tci.begin_internal_call() to authenticated, service_role;

-- From SECURITY DEFINER code only (client_* entry points, triggers): it has
-- NO grant to authenticated, so the only way to reach it is to already be
-- executing as the owner - which is exactly what "trusted code" means.
create function tci.begin_trusted_call()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform set_config('tci.internal_call', tci.internal_call_token(), true);
end;
$$;
revoke execute on function tci.begin_trusted_call() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The gates
-- ---------------------------------------------------------------------------

create function tci.require_internal_call()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not tci.internal_call_ok() then
    raise exception 'not permitted: internal workflow code only' using errcode = '42501';
  end if;
end;
$$;

create function tci.require_staff()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not tci.is_staff() then
    raise exception 'not permitted: staff only' using errcode = '42501';
  end if;
end;
$$;

create function tci.require_role(variadic p_roles tci.user_role[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not tci.has_role(variadic p_roles) then
    raise exception 'not permitted for your role' using errcode = '42501';
  end if;
end;
$$;

create function tci.require_staff_or_internal()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (tci.is_staff() or tci.internal_call_ok()) then
    raise exception 'not permitted: staff or internal workflow code only' using errcode = '42501';
  end if;
end;
$$;

create function tci.require_claim_access(p_claim_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not tci.may_access_claim(p_claim_id) then
    raise exception 'not permitted to read this claim' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function tci.require_internal_call(), tci.require_staff(),
  tci.require_role(variadic tci.user_role[]), tci.require_staff_or_internal(),
  tci.require_claim_access(uuid) from public, anon;
grant execute on function tci.require_staff(), tci.require_role(variadic tci.user_role[]),
  tci.require_claim_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The forced password rotation, enforced where every policy looks
-- ---------------------------------------------------------------------------

create function tci.password_rotation_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select must_change_password from tci.user_profiles where user_id = (select auth.uid())),
    false)
$$;
revoke execute on function tci.password_rotation_pending() from public, anon;
grant execute on function tci.password_rotation_pending() to authenticated, service_role;

create or replace function tci.has_role(variadic p_roles tci.user_role[])
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
  and not tci.password_rotation_pending()
$$;

create or replace function tci.is_staff()
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
  and not tci.password_rotation_pending()
$$;

comment on function tci.has_role(variadic tci.user_role[]) is
  'True when the caller holds any of the roles AND has no password rotation outstanding. Every RLS policy, client view and gate reads this, so a temporary password opens nothing.';
comment on function tci.is_staff() is
  'True when the caller holds any role but client AND has no password rotation outstanding.';

-- ---------------------------------------------------------------------------
-- 3. SQL-language helpers rewritten in plpgsql so they can carry a gate
-- ---------------------------------------------------------------------------
-- A SQL-language function cannot raise before it selects, so each of these
-- keeps its exact signature and body and gains one `perform tci.require_*()`
-- line. `#variable_conflict use_column` keeps OUT-column names from shadowing
-- the columns of the same name inside the query.

-- The three Agenda/event primitives: INTERNAL ONLY. Nothing outside trusted
-- workflow code may open a task, close one, or write an event.
create or replace function tci.open_task(p_task_type tci.task_type, p_object_type text, p_object_id uuid, p_title_key text, p_params jsonb default '{}'::jsonb, p_target_role tci.user_role default null::tci.user_role, p_target_user uuid default null::uuid, p_due_at timestamp with time zone default null::timestamp with time zone, p_priority tci.task_priority default 'normal'::tci.task_priority, p_event_id uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_internal_call();
  insert into tci.tasks (
    task_type, object_type, object_id, title_key, params,
    target_role, target_user, due_at, priority, source_event_id
  ) values (
    p_task_type, p_object_type, p_object_id, p_title_key, coalesce(p_params, '{}'::jsonb),
    p_target_role, p_target_user, p_due_at, p_priority, p_event_id
  )
  on conflict do nothing;
end;
$$;

create or replace function tci.close_tasks(p_task_types tci.task_type[], p_object_id uuid, p_status tci.task_status default 'done'::tci.task_status)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  perform tci.require_internal_call();
  with closed as (
    update tci.tasks
       set status = p_status, completed_at = now()
     where object_id = p_object_id
       and task_type = any(p_task_types)
       and status = 'open'
     returning 1
  )
  select count(*)::int into v_n from closed;
  return v_n;
end;
$$;

create or replace function tci.emit_workflow_event(p_event_type text, p_object_type text, p_object_id uuid, p_payload jsonb default '{}'::jsonb, p_target_role tci.user_role default null::tci.user_role, p_target_user uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_internal_call();
  insert into tci.workflow_events
    (event_type, object_type, object_id, actor, target_role, target_user, payload)
  values
    (p_event_type, p_object_type, p_object_id, (select auth.uid()), p_target_role,
     p_target_user, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- Readers a client must never reach directly: staff, or trusted code.
create or replace function tci.buyer_has_effective_limit(p_policy_id uuid, p_entity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return exists (
    select 1
      from tci.v_effective_limits v
     where v.policy_id = p_policy_id
       and v.entity_id = p_entity_id
       and v.outcome in ('approved', 'partial')
       and v.client_visible
       and coalesce(v.approved_amount, 0) > 0
  );
end;
$$;

create or replace function tci.policy_afl_consumed(p_policy_id uuid, p_except_claim uuid default null::uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return (
    select coalesce(sum(c.afl_consumed), 0)
      from tci.claims c
     where c.policy_id = p_policy_id
       and c.afl_consumed is not null
       and (p_except_claim is null or c.id <> p_except_claim)
       and c.status not in ('withdrawn', 'declined'));
end;
$$;

create or replace function tci.policy_liability_consumed(p_policy_id uuid, p_except_claim uuid default null::uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return (
    select coalesce(sum(c.approved_indemnity), 0)
      from tci.claims c
     where c.policy_id = p_policy_id
       and c.approved_indemnity is not null
       and (p_except_claim is null or c.id <> p_except_claim)
       and c.status not in ('withdrawn', 'declined'));
end;
$$;

create or replace function tci.limit_in_force_at(p_policy_id uuid, p_entity_id uuid, p_on date)
returns table(decision_id uuid, request_id uuid, outcome tci.decision_outcome, approved_amount numeric, currency_code character, payment_terms_days integer, stage tci.decision_stage, effective_from timestamp with time zone, valid_from date, valid_until date, system_generated boolean, system_reason_key text, within_validity boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform tci.require_staff_or_internal();
  return query
  select
    d.id, d.request_id, d.outcome, d.approved_amount, d.currency_code,
    d.payment_terms_days, d.stage,
    tci.decision_effective_from(d.released_at, d.decided_at, d.held),
    d.valid_from, d.valid_until, d.system_generated, d.system_reason_key,
    (d.valid_from <= p_on and (d.valid_until is null or d.valid_until >= p_on))
  from tci.credit_limit_decisions d
  join tci.credit_limit_requests r on r.id = d.request_id
  where r.entity_id = p_entity_id
    and r.policy_id = p_policy_id
    and tci.decision_effective_from(d.released_at, d.decided_at, d.held) is not null
    and tci.decision_effective_from(d.released_at, d.decided_at, d.held)::date <= p_on
  order by tci.decision_effective_from(d.released_at, d.decided_at, d.held) desc,
           (d.stage = 'commercial') desc,
           d.decided_at desc
  limit 1;
end;
$$;

create or replace function tci.policyholder_user_ids(p_policy_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return query
  select pu.user_id
    from tci.policyholder_users pu
    join tci.policies p on p.entity_id = pu.entity_id
   where p.id = p_policy_id;
end;
$$;

create or replace function tci.underwriters_covering(p_band tci.grade_band, p_amount numeric, p_currency character)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return query
  select g.user_id
  from tci.authority_grants g
  join tci.user_roles ur on ur.user_id = g.user_id and ur.role = 'credit_underwriter'
  where g.applies_to = 'credit'
    and g.grade_band = p_band
    and g.valid_from <= current_date
    and (g.valid_to is null or g.valid_to >= current_date)
    and tci.latest_uzs_rate(p_currency) is not null
    and tci.latest_uzs_rate(g.currency_code) is not null
  group by g.user_id
  having max(g.max_amount * tci.latest_uzs_rate(g.currency_code))
         >= p_amount * tci.latest_uzs_rate(p_currency);
end;
$$;

create or replace function tci.entity_group(p_entity_id uuid)
returns table(entity_id uuid, depth integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform tci.require_staff_or_internal();
  return query
  with recursive edges as (
    select parent_entity_id as a, child_entity_id as b
      from tci.entity_relationships
     where tci.relationship_is_live(valid_from, valid_to)
    union all
    select child_entity_id, parent_entity_id
      from tci.entity_relationships
     where tci.relationship_is_live(valid_from, valid_to)
  ),
  walk (node, depth, path) as (
    select p_entity_id, 0, array[p_entity_id]
    union all
    select e.b, w.depth + 1, w.path || e.b
      from walk w
      join edges e on e.a = w.node
     where not (e.b = any (w.path))
       and w.depth < tci.group_depth_cap()
  )
  select node, min(walk.depth)::int from walk group by node;
end;
$$;

create or replace function tci.ultimate_parent(p_entity_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return (
    with members as (select entity_id from tci.entity_group(p_entity_id)),
    owned as (
      select distinct r.child_entity_id as id
        from tci.entity_relationships r
       where tci.relationship_is_live(r.valid_from, r.valid_to)
         and r.relationship_type in ('ownership', 'control')
         and r.child_entity_id in (select entity_id from members)
         and r.parent_entity_id in (select entity_id from members)
    )
    select coalesce(
      (select m.entity_id from members m
        where m.entity_id not in (select id from owned)
        order by m.entity_id limit 1),
      (select m.entity_id from members m order by m.entity_id limit 1)));
end;
$$;

create or replace function tci.current_group_limit(p_ultimate_parent_id uuid)
returns tci.group_limits
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_row tci.group_limits%rowtype;
begin
  perform tci.require_staff_or_internal();
  select * into v_row from tci.group_limits
   where ultimate_parent_entity_id = p_ultimate_parent_id
     and valid_from <= current_date
     and (valid_to is null or valid_to >= current_date)
   order by valid_from desc, created_at desc
   limit 1;
  return v_row;
end;
$$;

create or replace function tci.relationship_signals(p_a uuid, p_b uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return (
  with a as (select * from tci.legal_entities where id = p_a),
       b as (select * from tci.legal_entities where id = p_b),
  s as (
    select
      case when tci.email_domain(a.contact_email) is not null
            and tci.email_domain(a.contact_email) = tci.email_domain(b.contact_email)
            and not tci.is_free_email_domain(tci.email_domain(a.contact_email))
           then jsonb_build_object('email_domain', jsonb_build_object(
                  'score', 0.60, 'value', tci.email_domain(a.contact_email)))
           else '{}'::jsonb end
      ||
      case when tci.normalise_for_match(a.address) is not null
            and tci.normalise_for_match(a.address) = tci.normalise_for_match(b.address)
           then jsonb_build_object('address', jsonb_build_object(
                  'score', 0.35, 'value', a.address))
           else '{}'::jsonb end
      ||
      case when tci.normalise_for_match(a.contact_person) is not null
            and tci.normalise_for_match(a.contact_person) = tci.normalise_for_match(b.contact_person)
           then jsonb_build_object('contact_person', jsonb_build_object(
                  'score', 0.35, 'value', a.contact_person))
           else '{}'::jsonb end
      ||
      case when extensions.similarity(a.name, b.name) > 0.45
           then jsonb_build_object('name_similarity', jsonb_build_object(
                  'score', round(extensions.similarity(a.name, b.name)::numeric, 2),
                  'value', b.name))
           else '{}'::jsonb end
      ||
      case when a.country_code = b.country_code
            and length(coalesce(a.registration_number, '')) >= 9
            and length(coalesce(b.registration_number, '')) >= 9
            and left(a.registration_number, 5) = left(b.registration_number, 5)
           then jsonb_build_object('registration_prefix', jsonb_build_object(
                  'score', 0.20, 'value', left(a.registration_number, 5)))
           else '{}'::jsonb end
      as signals
    from a, b
  )
  select signals from s);
end;
$$;

-- Claim readers: staff, or the policyholder on their OWN claim (may_access_claim).
create or replace function tci.claim_covered_totals(p_claim_id uuid)
returns table(claimed_amount numeric, claimable_amount numeric, disputed_amount numeric, covered_amount numeric, uncovered_amount numeric, invoice_count integer, overridden_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform tci.require_claim_access(p_claim_id);
  return query
  select
    coalesce(sum(i.outstanding_amount), 0),
    coalesce(sum(i.claimable_amount), 0),
    coalesce(sum(i.disputed_amount), 0),
    coalesce(sum(v.effective_covered_amount), 0),
    coalesce(sum(i.claimable_amount), 0) - coalesce(sum(v.effective_covered_amount), 0),
    count(*)::int,
    count(v.override_verdict)::int
  from tci.claim_invoices i
  left join tci.claim_invoice_verdicts v on v.claim_invoice_id = i.id
  where i.claim_id = p_claim_id;
end;
$$;

create or replace function tci.claim_eligible_from(p_claim_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_claim_access(p_claim_id);
  return (
    select case
      when c.cause_of_loss = 'insolvency' then null
      else coalesce(
        (select n.first_due_date from tci.overdue_notifications n
          where n.id = c.overdue_notification_id),
        (select min(i.due_date) from tci.claim_invoices i where i.claim_id = c.id)
      ) + p.waiting_period_days
    end
    from tci.claims c
    join tci.policies p on p.id = c.policy_id
    where c.id = p_claim_id);
end;
$$;

create or replace function tci.missing_claim_documents(p_claim_id uuid)
returns tci.claim_document_type[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_claim_access(p_claim_id);
  return (
    select coalesce(array_agg(t order by t), '{}'::tci.claim_document_type[])
      from tci.claims c
      cross join lateral unnest(tci.required_claim_documents(c.cause_of_loss)) as t
     where c.id = p_claim_id
       and not exists (
         select 1 from tci.claim_documents d
          where d.claim_id = p_claim_id and d.document_type = t));
end;
$$;

-- The two portal readers that reach v_declaration_lines, whose column
-- expression calls buyer_has_effective_limit: trusted code, so they hold the
-- token before the view is evaluated on the client's behalf.
create or replace function tci.client_declaration_lines_all()
returns setof tci.v_declaration_lines
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.begin_trusted_call();
  return query
  select l.* from tci.v_declaration_lines l
   where tci.has_role('client')
     and l.policy_id in (
       select p.id from tci.policies p
        where p.entity_id in (select tci.my_client_entities()));
end;
$$;

create or replace function tci.client_declaration_totals()
returns setof tci.v_declaration_totals
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.begin_trusted_call();
  return query
  select t.* from tci.v_declaration_totals t
   where tci.has_role('client')
     and t.policy_id in (
       select p.id from tci.policies p
        where p.entity_id in (select tci.my_client_entities()));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Gates and tokens applied to the existing functions
-- ---------------------------------------------------------------------------
-- Generated from the catalog of the replayed chain (pg_get_functiondef), so
-- no body was transcribed by hand. Each function below is its previous
-- definition plus, in this order after `begin`: the gate line, then the
-- token line; and every P0004 errcode re-classified (42501, P0001 or P0002).

-- accept_declaration: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.accept_declaration(p_declaration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dec tci.declarations%rowtype;
  v_policy tci.policies%rowtype;
  v_covered numeric(18,2);
  v_amount numeric(18,2);
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('commercial_underwriter', 'admin') then
    raise exception 'only commercial underwriting may accept a declaration'
      using errcode = '42501';
  end if;

  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  if not tci.declaration_transition_allowed(v_dec.status, 'accepted') then
    raise exception 'a declaration cannot go from % to accepted', v_dec.status
      using errcode = 'P0001';
  end if;

  select * into v_policy from tci.policies where id = v_dec.policy_id;

  -- Freeze the split exactly as it stands now.
  -- The classification is computed in a subquery over its OWN alias and then
  -- joined back by id: an UPDATE ... FROM LATERAL cannot reference the row
  -- being updated, which is what a lateral over `l` would need.
  update tci.declaration_lines l
     set coverage_basis   = c.coverage_basis,
         covered_amount   = c.covered_amount,
         uncovered_excess = c.uncovered_excess,
         updated_at       = now()
    from (
      select src.id,
             cl.coverage_basis,
             cl.covered_amount,
             cl.uncovered_excess
        from tci.declaration_lines src
        cross join lateral tci.classify_declaration_line(
               tci.buyer_has_effective_limit(v_dec.policy_id, src.entity_id),
               src.insurable_turnover,
               v_policy.discretionary_limit
             ) cl
       where src.declaration_id = p_declaration_id
    ) c
   where l.id = c.id;

  update tci.declarations
     set status = 'accepted',
         accepted_by = (select auth.uid()),
         accepted_at = now(),
         updated_at = now()
   where id = p_declaration_id
   returning * into v_dec;

  -- ---- new in 0027: earn the premium -------------------------------------
  -- Premium is earned on COVERED turnover only. Uncovered excess was never
  -- insured, so charging for it would be charging for nothing.
  select coalesce(sum(covered_amount), 0) into v_covered
    from tci.declaration_lines where declaration_id = p_declaration_id;

  v_amount := round(v_covered * v_policy.premium_rate_pct / 100.0, 2);

  insert into tci.premium_entries (
    declaration_id, policy_id, covered_turnover, rate_used, amount, currency_code
  ) values (
    p_declaration_id, v_dec.policy_id, v_covered,
    v_policy.premium_rate_pct, v_amount, v_dec.currency_code
  );
  -- ------------------------------------------------------------------------

  perform tci.emit_workflow_event(
    'declaration.accepted', 'declaration', v_dec.id,
    jsonb_build_object(
      'policy_id', v_dec.policy_id,
      'period_start', v_dec.period_start,
      'premium', v_amount),
    'sales'::tci.user_role);

  -- Shipping outside cover is a commercial conversation, so it is reported
  -- as its own event rather than buried in the acceptance.
  if exists (
    select 1 from tci.v_declaration_lines v
     where v.declaration_id = p_declaration_id
       and v.coverage_basis = 'uncovered_excess'
  ) then
    perform tci.emit_workflow_event(
      'declaration.uncovered_excess', 'declaration', v_dec.id,
      jsonb_build_object(
        'policy_id', v_dec.policy_id,
        'uncovered_excess', (select uncovered_excess from tci.v_declaration_totals
                              where declaration_id = p_declaration_id)),
      'commercial_underwriter'::tci.user_role);
  end if;

  return jsonb_build_object(
    'result', 'accepted', 'declaration_id', v_dec.id, 'premium', v_amount);
end;
$function$;

-- accept_relationship_suggestion: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.accept_relationship_suggestion(p_suggestion_id uuid, p_parent_entity_id uuid, p_relationship_type tci.relationship_type, p_ownership_pct numeric DEFAULT NULL::numeric)
 RETURNS tci.entity_relationships
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_s tci.entity_relationship_suggestions%rowtype;
  v_child uuid;
  v_row tci.entity_relationships%rowtype;
begin
  if not tci.may_edit_relationships() then
    raise exception 'not permitted to record corporate relationships' using errcode = '42501';
  end if;
  select * into v_s from tci.entity_relationship_suggestions where id = p_suggestion_id for update;
  if not found then
    raise exception 'suggestion not found' using errcode = 'P0002';
  end if;
  if v_s.status <> 'open' then
    raise exception 'this suggestion is already %', v_s.status using errcode = 'P0001';
  end if;
  if p_parent_entity_id not in (v_s.entity_a, v_s.entity_b) then
    raise exception 'the parent must be one of the two suggested companies'
      using errcode = 'P0001';
  end if;
  v_child := case when p_parent_entity_id = v_s.entity_a then v_s.entity_b else v_s.entity_a end;

  v_row := tci.save_entity_relationship(
    p_parent_entity_id, v_child, p_relationship_type, p_ownership_pct,
    current_date, null, 'suggested_accepted',
    'accepted from suggestion ' || p_suggestion_id::text, null);

  update tci.entity_relationship_suggestions
     set status = 'accepted', reviewed_by = (select auth.uid()),
         reviewed_at = now(), updated_at = now()
   where id = p_suggestion_id;

  return v_row;
end;
$function$;

-- adjust_limit_commercial: 3 errcodes P0004 -> 42501/P0001/P0002; sets the internal-call token (staff, invoker)
create or replace function tci.adjust_limit_commercial(p_decision_id uuid, p_new_amount numeric, p_new_payment_terms integer DEFAULT NULL::integer, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_credit   tci.credit_limit_decisions%rowtype;
  v_new      tci.credit_limit_decisions%rowtype;
  v_request  tci.credit_limit_requests%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_is_reduction boolean;
  v_group    jsonb;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('admin', 'commercial_underwriter') then
    raise exception 'only commercial underwriting may adjust a limit'
      using errcode = '42501';
  end if;

  select * into v_credit from tci.credit_limit_decisions where id = p_decision_id;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;
  if v_credit.stage <> 'credit' then
    raise exception 'only a credit-stage decision can be adjusted commercially'
      using errcode = 'P0001';
  end if;
  if v_credit.lifecycle <> 'effective' then
    raise exception 'decision is % and can no longer be adjusted', v_credit.lifecycle
      using errcode = 'P0001';
  end if;
  if v_credit.outcome not in ('approved', 'partial') then
    raise exception 'only an approved or partial limit can be adjusted'
      using errcode = 'P0001';
  end if;
  if p_new_amount is null or p_new_amount <= 0 then
    raise exception 'the adjusted amount must be positive' using errcode = 'P0001';
  end if;

  select * into v_request from tci.credit_limit_requests where id = v_credit.request_id;
  v_is_reduction := p_new_amount < v_credit.approved_amount;

  v_band := tci.grade_band_for_assessment(v_credit.based_on_assessment_id);
  if not tci.has_role('admin') then
    v_amount_uzs := tci.to_uzs(p_new_amount, v_credit.currency_code);
    select coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0)
      into v_authority_uzs
      from tci.authority_grants g
     where g.user_id = (select auth.uid())
       and g.applies_to = 'commercial'
       and g.grade_band = v_band
       and g.valid_from <= current_date
       and (g.valid_to is null or g.valid_to >= current_date);
    if v_amount_uzs > v_authority_uzs then
      raise exception 'adjustment exceeds your commercial authority for grade band % (% > %)',
        v_band, v_amount_uzs, v_authority_uzs using errcode = '42501';
    end if;

    -- PHASE 6: the group control, on INCREASES only. A reduction lowers the
    -- group's exposure; blocking it because the group is over its limit would
    -- keep the insurer at the higher number.
    if not v_is_reduction then
      v_group := tci.group_exposure_preflight(
        v_request.entity_id, p_new_amount, v_credit.currency_code,
        tci.limit_scope(v_request.policy_id, v_request.insurance_request_id));
      if (v_group ->> 'over_limit')::boolean then
        raise exception 'this adjustment would take the group to % against a group limit of % (UZS)',
          v_group ->> 'exposure_after_uzs', v_group ->> 'group_limit_uzs'
          using errcode = 'P0001', detail = 'limits.errors.groupLimitExceeded';
      end if;
    end if;
  end if;

  update tci.credit_limit_decisions
     set lifecycle = 'superseded'
   where adjusts_decision_id = p_decision_id
     and lifecycle = 'effective';

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, valid_until,
    based_on_assessment_id, comment, stage, adjusts_decision_id, payment_terms_days,
    released_at, release_kind
  ) values (
    v_credit.request_id, v_credit.outcome, p_new_amount, v_credit.currency_code,
    v_credit.valid_from, v_credit.valid_until,
    v_credit.based_on_assessment_id, p_comment, 'commercial', p_decision_id,
    coalesce(p_new_payment_terms, v_credit.payment_terms_days),
    case when v_is_reduction then now() else null end,
    case when v_is_reduction then 'immediate'::tci.release_kind else null end
  ) returning * into v_new;

  perform tci.emit_workflow_event(
    'limit.commercial_adjusted', 'credit_limit_decision', v_new.id,
    jsonb_build_object(
      'credit_decision_id', p_decision_id,
      'from_amount', v_credit.approved_amount,
      'to_amount', p_new_amount,
      'grade_band', v_band,
      'is_reduction', v_is_reduction
    ),
    case when v_is_reduction then 'client'::tci.user_role else 'sales'::tci.user_role end
  );

  return jsonb_build_object(
    'result', 'adjusted',
    'decision_id', v_new.id,
    'grade_band', v_band,
    'is_reduction', v_is_reduction,
    'released_immediately', v_is_reduction
  );
end;
$function$;

-- advance_insurance_request: 6 errcodes P0004 -> 42501/P0001/P0002; sets the internal-call token (staff, invoker)
create or replace function tci.advance_insurance_request(p_request_id uuid, p_to_status tci.insurance_request_status, p_comment text DEFAULT NULL::text)
 RETURNS tci.insurance_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request tci.insurance_requests%rowtype;
  v_from    tci.insurance_request_status;
  v_ok      boolean := false;
begin
  perform tci.begin_internal_call();
  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found then
    raise exception 'insurance request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  v_from := v_request.status;

  v_ok := case
    when v_from = 'draft'              and p_to_status in ('submitted', 'withdrawn') then true
    when v_from = 'submitted'          and p_to_status in ('entity_resolution', 'underwriting', 'withdrawn') then true
    when v_from = 'entity_resolution'  and p_to_status in ('underwriting', 'withdrawn') then true
    when v_from = 'underwriting'       and p_to_status in ('commercial_review', 'withdrawn') then true
    when v_from = 'commercial_review'  and p_to_status in ('sales_confirmation', 'withdrawn') then true
    when v_from = 'sales_confirmation' and p_to_status in ('client_review', 'withdrawn') then true
    -- NEW in 0025: the client can hand it back to sales instead of answering.
    when v_from = 'client_review'      and p_to_status in ('accepted', 'declined', 'sales_confirmation', 'withdrawn') then true
    when v_from = 'accepted'           and p_to_status = 'bound' then true
    else false
  end;
  if not v_ok then
    raise exception 'invalid insurance request transition: % -> %', v_from, p_to_status
      using errcode = 'P0001';
  end if;

  if p_to_status = 'withdrawn' then
    if not (v_request.created_by = (select auth.uid()) or tci.has_role('admin')) then
      raise exception 'only the creator or an admin may withdraw a submission'
        using errcode = '42501';
    end if;
  elsif p_to_status in ('accepted', 'declined') then
    if not tci.has_role('client', 'admin', 'sales') then
      raise exception 'only the client (or sales/admin on its behalf) may accept or decline'
        using errcode = '42501';
    end if;
  elsif p_to_status = 'client_review' then
    if not tci.has_role('admin', 'sales') then
      raise exception 'only sales may release a submission to the client'
        using errcode = '42501';
    end if;
  elsif p_to_status = 'sales_confirmation' then
    -- Two ways in, two different gates: commercial underwriting finishing the
    -- review, or the client returning the file for changes.
    if v_from = 'client_review' then
      if not tci.has_role('client', 'admin', 'sales') then
        raise exception 'only the client (or sales/admin on its behalf) may ask for changes'
          using errcode = '42501';
      end if;
      if coalesce(btrim(p_comment), '') = '' then
        raise exception 'say what should change' using errcode = 'P0001';
      end if;
    elsif not tci.has_role('admin', 'commercial_underwriter') then
      raise exception 'only commercial underwriting may finish the commercial review'
        using errcode = '42501';
    end if;
  elsif not tci.is_staff() then
    raise exception 'only staff may move a submission' using errcode = '42501';
  end if;

  if p_to_status = 'underwriting' and not tci.request_entities_resolved(p_request_id) then
    raise exception 'every buyer must be resolved to a company before underwriting'
      using errcode = 'P0001';
  end if;
  if p_to_status = 'commercial_review' and not tci.request_credit_complete(p_request_id) then
    raise exception 'every buyer needs a credit decision before the commercial review'
      using errcode = 'P0001';
  end if;
  if p_to_status = 'declined' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'a decline needs a reason' using errcode = 'P0001';
  end if;

  update tci.insurance_requests
     set status = p_to_status,
         submitted_at = case when p_to_status = 'submitted' then now() else submitted_at end,
         decided_at = case when p_to_status in ('accepted', 'declined') then now() else decided_at end,
         decline_reason = case when p_to_status = 'declined' then p_comment else decline_reason end
   where id = p_request_id
   returning * into v_request;

  insert into tci.insurance_request_history (request_id, from_status, to_status, comment)
  values (p_request_id, v_from, p_to_status, p_comment);

  perform tci.emit_workflow_event(
    'request.status_changed', 'insurance_request', p_request_id,
    jsonb_build_object('from', v_from, 'to', p_to_status, 'comment', p_comment),
    case p_to_status
      when 'entity_resolution'  then 'sales'::tci.user_role
      when 'underwriting'       then 'credit_underwriter'::tci.user_role
      when 'commercial_review'  then 'commercial_underwriter'::tci.user_role
      when 'sales_confirmation' then 'sales'::tci.user_role
      when 'client_review'      then 'client'::tci.user_role
      else null
    end
  );

  return v_request;
end;
$function$;

-- approve_claim: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.approve_claim(p_claim_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim  tci.claims%rowtype;
  v_calc   jsonb;
  v_payable numeric(18,2);
  v_to     tci.claim_status;
  v_suspension uuid;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may approve a claim' using errcode = '42501';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if v_claim.status not in ('submitted', 'under_assessment', 'info_requested') then
    raise exception 'a % claim cannot be approved', v_claim.status using errcode = 'P0001';
  end if;

  -- Always assess against fresh verdicts: an invoice added or edited since the
  -- last recompute must not be approved on stale coverage.
  perform tci.verify_claim_coverage(p_claim_id);
  v_calc := tci.calculate_indemnity(p_claim_id);
  v_payable := (v_calc ->> 'payable')::numeric;

  -- Nothing covered at all, and a covered loss too small to qualify, are
  -- different facts. Say which.
  if coalesce((v_calc ->> 'covered_amount')::numeric, 0) <= 0 then
    raise exception 'this claim computes to nothing payable - decline it with a reason instead'
      using errcode = 'P0001';
  end if;
  if not (v_calc ->> 'nql_met')::boolean then
    raise exception 'the covered loss (%) is below the non-qualifying loss threshold (%) - this claim is not indemnifiable',
      (v_calc ->> 'covered_amount'), (v_calc ->> 'nql_amount')
      using errcode = 'P0001', detail = 'claims.indemnity.belowNql';
  end if;
  if coalesce(v_payable, 0) <= 0 then
    raise exception 'this claim computes to nothing payable - decline it with a reason instead'
      using errcode = 'P0001';
  end if;

  v_to := case when (v_calc ->> 'fully_covered')::boolean
               then 'approved'::tci.claim_status
               else 'partially_approved'::tci.claim_status end;

  update tci.claims
     set approved_indemnity = v_payable,
         afl_consumed = (v_calc ->> 'afl_consumed')::numeric,
         indemnity_trace = v_calc,
         updated_at = now()
   where id = p_claim_id;

  -- An approved claim means the buyer did not pay. The limit stays down;
  -- reinstating it is a fresh credit decision, and 0036 raises the task for it.
  v_suspension := tci.suspend_limit_for_claim(p_claim_id);

  v_claim := tci.change_claim_status(p_claim_id, v_to, p_comment);

  perform tci.emit_workflow_event(
    'claim.approved', 'claim', p_claim_id,
    jsonb_build_object(
      'claim_number', v_claim.claim_number,
      'policy_id', v_claim.policy_id,
      'entity_id', v_claim.entity_id,
      'status', v_to,
      'indemnity', v_payable,
      'currency', v_claim.currency_code,
      'suspension_decision_id', v_suspension),
    'credit_underwriter'::tci.user_role);

  return v_claim;
end;
$function$;

-- bind_insurance_request: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (staff, invoker)
create or replace function tci.bind_insurance_request(p_request_id uuid, p_policy_number text, p_inception_date date, p_expiry_date date)
 RETURNS tci.policies
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request tci.insurance_requests%rowtype;
  v_policy  tci.policies%rowtype;
  v_missing text[];
  v_adopted int;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('admin', 'commercial_underwriter') then
    raise exception 'only commercial underwriting may issue a policy'
      using errcode = '42501';
  end if;

  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found then
    raise exception 'submission % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;

  -- Idempotency guard: an explicit refusal, never a second policy.
  if v_request.bound_policy_id is not null then
    raise exception 'submission % is already bound to policy %',
      v_request.request_number, v_request.bound_policy_id using errcode = 'P0001';
  end if;
  if v_request.status <> 'accepted' then
    raise exception 'only an accepted submission can be bound (current: %)', v_request.status
      using errcode = 'P0001';
  end if;

  -- Every term the policy table requires must have been agreed. Naming the
  -- missing ones beats a bare not-null violation from the insert.
  v_missing := array_remove(array[
    case when v_request.product_structure is null then 'product_structure' end,
    case when v_request.currency_code is null then 'currency_code' end,
    case when v_request.insured_percentage is null then 'insured_percentage' end,
    case when v_request.nql_amount is null then 'nql_amount' end,
    case when v_request.premium_rate_pct is null then 'premium_rate_pct' end,
    case when v_request.minimum_premium is null then 'minimum_premium' end,
    case when v_request.discretionary_limit is null then 'discretionary_limit' end,
    case when v_request.waiting_period_days is null then 'waiting_period_days' end,
    case when v_request.max_extension_period_days is null then 'max_extension_period_days' end,
    case when v_request.max_payment_terms_days is null then 'max_payment_terms_days' end,
    case when v_request.declaration_frequency is null then 'declaration_frequency' end
  ], null);
  if array_length(v_missing, 1) > 0 then
    raise exception 'the submission is missing agreed terms: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_policy_number), '') = '' then
    raise exception 'a policy needs a number' using errcode = 'P0001';
  end if;
  if p_expiry_date <= p_inception_date then
    raise exception 'the expiry date must be after the inception date'
      using errcode = 'P0001';
  end if;

  insert into tci.policies (
    entity_id, policy_number, product_structure, status,
    inception_date, expiry_date, currency_code, insured_percentage,
    max_liability_amount, max_liability_premium_multiple, nql_amount,
    deductible_each_loss, aggregate_first_loss, premium_rate_pct,
    minimum_premium, estimated_annual_turnover, discretionary_limit,
    waiting_period_days, max_extension_period_days, max_payment_terms_days,
    declaration_frequency, notes
  ) values (
    v_request.entity_id, btrim(p_policy_number), v_request.product_structure, 'draft',
    p_inception_date, p_expiry_date, v_request.currency_code, v_request.insured_percentage,
    v_request.max_liability_amount, v_request.max_liability_premium_multiple, v_request.nql_amount,
    v_request.deductible_each_loss, v_request.aggregate_first_loss, v_request.premium_rate_pct,
    v_request.minimum_premium, v_request.estimated_annual_turnover, v_request.discretionary_limit,
    v_request.waiting_period_days, v_request.max_extension_period_days, v_request.max_payment_terms_days,
    v_request.declaration_frequency,
    -- notes stays the user's field. Provenance is structural - the submission
    -- carries bound_policy_id - and the UI renders it translated; writing an
    -- English sentence in here would leak untranslatable text onto the policy.
    null
  ) returning * into v_policy;

  -- Adopt the package's limits. Their scope moves from the submission to the
  -- policy, which is exactly what the coalesce() key is built to allow.
  update tci.credit_limit_requests
     set policy_id = v_policy.id
   where insurance_request_id = p_request_id
     and policy_id is null;
  get diagnostics v_adopted = row_count;

  update tci.insurance_requests
     set bound_policy_id = v_policy.id
   where id = p_request_id;

  -- The status machine owns the transition, its history row and its event.
  -- No comment: the history row already says `bound`, and a rendered English
  -- sentence would show up untranslated in every locale's timeline. The
  -- policy number travels on the request.bound payload below instead.
  perform tci.advance_insurance_request(p_request_id, 'bound', null);

  perform tci.emit_workflow_event(
    'request.bound', 'insurance_request', p_request_id,
    jsonb_build_object(
      'policy_id', v_policy.id,
      'policy_number', v_policy.policy_number,
      'limits_adopted', v_adopted),
    'sales'::tci.user_role);

  return v_policy;
end;
$function$;

-- calculate_indemnity: sets the internal-call token (trusted, definer); gate: perform tci.require_claim_access(p_claim_id);
create or replace function tci.calculate_indemnity(p_claim_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim   tci.claims%rowtype;
  v_policy  tci.policies%rowtype;
  v_tot     record;
  v_steps   jsonb := '[]'::jsonb;
  v_running numeric(18,2);
  v_covered numeric(18,2);
  v_nql     numeric(18,2);
  v_nql_met boolean;
  v_ded     numeric(18,2);
  v_afl_total     numeric(18,2);
  v_afl_used      numeric(18,2);
  v_afl_available numeric(18,2);
  v_afl_applied   numeric(18,2);
  v_liab_total    numeric(18,2);
  v_liab_used     numeric(18,2);
  v_liab_available numeric(18,2);
  v_capped  numeric(18,2);
begin
  perform tci.require_claim_access(p_claim_id);
  perform tci.begin_trusted_call();
  select * into v_claim from tci.claims where id = p_claim_id;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  select * into v_policy from tci.policies where id = v_claim.policy_id;
  select * into v_tot from tci.claim_covered_totals(p_claim_id);

  -- 1. Covered debt
  v_covered := round(coalesce(v_tot.covered_amount, 0), 2);
  v_running := v_covered;
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.coveredDebt',
    'amount', v_running,
    'detail', jsonb_build_object(
      'claimed', v_tot.claimed_amount,
      'claimable', v_tot.claimable_amount,
      'disputed', v_tot.disputed_amount,
      'uncovered', v_tot.uncovered_amount,
      'invoices', v_tot.invoice_count,
      'overridden', v_tot.overridden_count));

  -- 2. The non-qualifying loss threshold. A gate, not a haircut: at or above
  --    it the full covered loss goes forward untouched; below it nothing is
  --    payable at all. Equal qualifies.
  v_nql     := round(coalesce(v_policy.nql_amount, 0), 2);
  v_nql_met := (v_covered >= v_nql);
  if not v_nql_met then
    v_running := 0;
  end if;
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.nqlThreshold',
    'amount', v_running,
    'detail', jsonb_build_object(
      'nql_amount', v_nql,
      'covered_loss', v_covered,
      'met', v_nql_met,
      'shortfall', case when v_nql_met then 0 else round(v_nql - v_covered, 2) end));

  -- 3. Insured percentage
  v_running := round(v_running * v_policy.insured_percentage / 100.0, 2);
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.insuredPercentage',
    'amount', v_running,
    'detail', jsonb_build_object('insured_percentage', v_policy.insured_percentage));

  -- 4. Deductible for this loss
  v_ded := least(round(coalesce(v_policy.deductible_each_loss, 0), 2), v_running);
  v_running := round(v_running - v_ded, 2);
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.deductible',
    'amount', v_running,
    'detail', jsonb_build_object(
      'deductible_each_loss', coalesce(v_policy.deductible_each_loss, 0), 'applied', v_ded));

  -- 5. Aggregate first loss, what is left of it
  v_afl_total     := round(coalesce(v_policy.aggregate_first_loss, 0), 2);
  v_afl_used      := round(tci.policy_afl_consumed(v_claim.policy_id, p_claim_id), 2);
  v_afl_available := greatest(v_afl_total - v_afl_used, 0);
  v_afl_applied   := least(v_afl_available, v_running);
  v_running := round(v_running - v_afl_applied, 2);
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.aggregateFirstLoss',
    'amount', v_running,
    'detail', jsonb_build_object(
      'aggregate_first_loss', v_afl_total,
      'already_consumed', v_afl_used,
      'available', v_afl_available,
      'applied', v_afl_applied));

  -- 6. Remaining maximum liability
  v_liab_total := v_policy.max_liability_amount;
  v_liab_used  := round(tci.policy_liability_consumed(v_claim.policy_id, p_claim_id), 2);
  if v_liab_total is null then
    v_liab_available := null;
    v_capped := v_running;
  else
    v_liab_available := greatest(round(v_liab_total, 2) - v_liab_used, 0);
    v_capped := least(v_running, v_liab_available);
  end if;
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.maxLiability',
    'amount', v_capped,
    'detail', jsonb_build_object(
      'max_liability_amount', v_liab_total,
      'already_consumed', v_liab_used,
      'available', v_liab_available,
      'capped', (v_liab_available is not null and v_running > v_liab_available)));

  return jsonb_build_object(
    'claim_id', p_claim_id,
    'currency', v_claim.currency_code,
    'computed_at', now(),
    'claimed_amount', v_tot.claimed_amount,
    'claimable_amount', v_tot.claimable_amount,
    'disputed_amount', v_tot.disputed_amount,
    'covered_amount', v_tot.covered_amount,
    'uncovered_amount', v_tot.uncovered_amount,
    'nql_amount', v_nql,
    'nql_met', v_nql_met,
    -- An i18n KEY, never rendered text: the UI owns the wording in three
    -- languages. Null when the claim is indemnifiable.
    'not_indemnifiable_reason',
      case when v_nql_met then null else 'claims.indemnity.belowNql' end,
    'afl_consumed', v_afl_applied,
    'payable', v_capped,
    'fully_covered', (coalesce(v_tot.uncovered_amount, 0) <= 0),
    'steps', v_steps);
end;
$function$;

-- change_claim_status: 5 errcodes P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.change_claim_status(p_claim_id uuid, p_to tci.claim_status, p_comment text DEFAULT NULL::text)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim tci.claims%rowtype;
  v_from  tci.claim_status;
  v_ok    boolean := false;
  v_blockers text[];
begin
  perform tci.begin_trusted_call();
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  -- A client may only ever see its own claim; refusing with "not found"
  -- rather than "forbidden" keeps other policyholders' claim ids private.
  if tci.has_role('client') and not tci.claim_actor_may_act(v_claim, true) then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if not tci.is_staff() and not tci.has_role('client') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  v_from := v_claim.status;

  v_ok := case
    when v_from = 'draft'              and p_to in ('submitted', 'withdrawn') then true
    when v_from = 'submitted'          and p_to in ('under_assessment', 'info_requested', 'declined', 'withdrawn') then true
    when v_from = 'under_assessment'   and p_to in ('info_requested', 'approved', 'partially_approved', 'declined') then true
    when v_from = 'info_requested'     and p_to in ('under_assessment', 'declined', 'withdrawn') then true
    when v_from in ('approved', 'partially_approved') and p_to in ('paid', 'closed') then true
    when v_from = 'paid'               and p_to = 'closed' then true
    when v_from = 'declined'           and p_to = 'closed' then true
    when v_from = 'withdrawn'          and p_to = 'closed' then true
    else false
  end;
  if not v_ok then
    raise exception 'invalid claim transition: % -> %', v_from, p_to
      using errcode = 'P0001';
  end if;

  -- Who may drive which transition
  if p_to = 'submitted' then
    -- The policyholder files. Sales files on their behalf when they phone in;
    -- claims can too, to enter a paper filing.
    if not (tci.claim_actor_may_act(v_claim, true) or tci.has_role('sales')) then
      raise exception 'only the policyholder, sales or claims may file a claim'
        using errcode = '42501';
    end if;
    v_blockers := tci.claim_submission_blockers(p_claim_id);
    if array_length(v_blockers, 1) > 0 then
      raise exception 'this claim is not ready to be filed: %', array_to_string(v_blockers, ', ')
        using errcode = 'P0001', detail = array_to_string(v_blockers, ',');
    end if;
  elsif p_to = 'withdrawn' then
    if not (tci.claim_actor_may_act(v_claim, true) or tci.has_role('sales')) then
      raise exception 'only the policyholder, sales or claims may withdraw a claim'
        using errcode = '42501';
    end if;
  elsif p_to = 'under_assessment' and v_from = 'info_requested' then
    -- Answering an information request is the policyholder's move; claims may
    -- also resume assessment itself when the answer arrives another way.
    if not tci.claim_actor_may_act(v_claim, true) then
      raise exception 'only the policyholder or claims may resume assessment'
        using errcode = '42501';
    end if;
  else
    if not tci.has_role('claims', 'admin') then
      raise exception 'only the claims department may move a claim to %', p_to
        using errcode = '42501';
    end if;
  end if;

  -- A refusal needs a reason on the record. A PARTIAL approval does not: its
  -- justification is the coverage verdicts and the indemnity trace, which are
  -- richer than any sentence and are frozen onto the claim by 0034.
  if p_to = 'declined'
     and coalesce(trim(coalesce(p_comment, v_claim.decision_reason)), '') = '' then
    raise exception 'declining a claim requires a reason' using errcode = 'P0001';
  end if;

  update tci.claims
     set status = p_to,
         filed_at = case when p_to = 'submitted' then now() else filed_at end,
         filed_by = case when p_to = 'submitted' then coalesce(filed_by, (select auth.uid())) else filed_by end,
         assessed_by = case when p_to in ('approved', 'partially_approved', 'declined')
                            then (select auth.uid()) else assessed_by end,
         assessed_at = case when p_to in ('approved', 'partially_approved', 'declined')
                            then now() else assessed_at end,
         decision_reason = case when p_to in ('approved', 'partially_approved', 'declined')
                                then coalesce(p_comment, decision_reason) else decision_reason end,
         -- The ageing clock: opening a pause stamps it, closing one banks it.
         info_requested_at = case when p_to = 'info_requested' then now() else null end,
         assessment_paused = case
           when v_from = 'info_requested' and info_requested_at is not null
             then assessment_paused + (now() - info_requested_at)
           else assessment_paused
         end,
         updated_at = now()
   where id = p_claim_id
   returning * into v_claim;

  insert into tci.claim_status_history (claim_id, from_status, to_status, changed_by, comment)
  values (p_claim_id, v_from, p_to, (select auth.uid()), p_comment);

  perform tci.emit_workflow_event(
    'claim.status_changed', 'claim', p_claim_id,
    jsonb_build_object(
      'from', v_from, 'to', p_to, 'comment', p_comment,
      'claim_number', v_claim.claim_number,
      'policy_id', v_claim.policy_id,
      'entity_id', v_claim.entity_id,
      'claimed_amount', v_claim.claimed_amount,
      'currency', v_claim.currency_code),
    case
      when p_to in ('submitted', 'under_assessment') then 'claims'::tci.user_role
      when p_to in ('info_requested', 'approved', 'partially_approved', 'declined', 'paid')
        then 'client'::tci.user_role
      else null
    end);

  return v_claim;
end;
$function$;

-- claim_submission_blockers: gate: perform tci.require_claim_access(p_claim_id);
create or replace function tci.claim_submission_blockers(p_claim_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim    tci.claims%rowtype;
  v_blockers text[] := '{}';
  v_from     date;
  v_missing  tci.claim_document_type[];
  v_type     tci.claim_document_type;
begin
  perform tci.require_claim_access(p_claim_id);
  select * into v_claim from tci.claims where id = p_claim_id;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from tci.claim_invoices where claim_id = p_claim_id) then
    v_blockers := v_blockers || 'claims.blocker.noInvoices'::text;
  end if;

  if exists (
    select 1 from tci.claim_invoices
     where claim_id = p_claim_id and currency_code <> v_claim.currency_code
  ) then
    v_blockers := v_blockers || 'claims.blocker.currencyMismatch'::text;
  end if;

  if coalesce(v_claim.claimed_amount, 0) <= 0 then
    v_blockers := v_blockers || 'claims.blocker.nothingOutstanding'::text;
  end if;

  if v_claim.cause_of_loss = 'insolvency'
     and coalesce(trim(v_claim.insolvency_reference), '') = '' then
    v_blockers := v_blockers || 'claims.blocker.insolvencyReference'::text;
  end if;

  v_from := tci.claim_eligible_from(p_claim_id);
  if v_from is not null and current_date < v_from then
    v_blockers := v_blockers || 'claims.blocker.waitingPeriod'::text;
  end if;

  v_missing := tci.missing_claim_documents(p_claim_id);
  foreach v_type in array v_missing loop
    v_blockers := v_blockers || ('claims.blocker.missingDocument.' || v_type::text)::text;
  end loop;

  return v_blockers;
end;
$function$;

-- clear_claim_verdict_override: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.clear_claim_verdict_override(p_claim_invoice_id uuid)
 RETURNS tci.claim_invoice_verdicts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row tci.claim_invoice_verdicts%rowtype;
begin
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may clear an override'
      using errcode = '42501';
  end if;
  update tci.claim_invoice_verdicts
     set override_verdict = null, override_covered_amount = null,
         override_justification = null, overridden_by = null, overridden_at = null
   where claim_invoice_id = p_claim_invoice_id
   returning * into v_row;
  if not found then
    raise exception 'verdict not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$function$;

-- client_file_noa: sets the internal-call token (trusted, definer)
create or replace function tci.client_file_noa(p_policy_id uuid, p_entity_id uuid, p_first_due_date date, p_overdue_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.begin_trusted_call();
  perform tci.client_policy_guard(p_policy_id);
  -- Same entry point staff use: same validation, same suspension, same event.
  return tci.file_overdue_notification(
    p_policy_id, p_entity_id, p_first_due_date, p_overdue_amount, null);
end;
$function$;

-- client_open_claim: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.client_open_claim(p_policy_id uuid, p_entity_id uuid, p_cause tci.claim_cause_of_loss DEFAULT 'protracted_default'::tci.claim_cause_of_loss, p_noa_id uuid DEFAULT NULL::uuid, p_insolvency_reference text DEFAULT NULL::text)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = '42501';
  end if;
  return tci.open_claim(p_policy_id, p_entity_id, p_cause, p_noa_id, p_insolvency_reference);
end;
$function$;

-- client_policy_guard: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.client_policy_guard(p_policy_id uuid)
 RETURNS tci.policies
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_policy tci.policies%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = '42501';
  end if;
  select * into v_policy from tci.policies where id = p_policy_id;
  if not found or v_policy.entity_id not in (select tci.my_client_entities()) then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  return v_policy;
end;
$function$;

-- client_request_limit: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.client_request_limit(p_policy_id uuid, p_entity_id uuid, p_proposed_name text, p_registration_number text, p_country_code character, p_amount numeric, p_currency character, p_payment_terms_days integer, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy tci.policies%rowtype;
  v_request tci.credit_limit_requests%rowtype;
  v_proposal tci.client_buyer_proposals%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('client') then
    raise exception 'only a portal user may raise a limit request this way'
      using errcode = '42501';
  end if;

  select * into v_policy from tci.policies where id = p_policy_id;
  if not found or v_policy.entity_id not in (select tci.my_client_entities()) then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  -- Same rule the staff path enforces in tci.submit_limit_request.
  if v_policy.status <> 'active' then
    raise exception 'limits can only be requested under an active policy (this one is %)',
      v_policy.status using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'a limit request needs a positive amount' using errcode = 'P0001';
  end if;
  if coalesce(p_currency, '') = '' then
    raise exception 'a limit request needs a currency' using errcode = 'P0001';
  end if;

  -- Path 1: a company we already know.
  if p_entity_id is not null then
    if not exists (select 1 from tci.legal_entities where id = p_entity_id) then
      raise exception 'company not found' using errcode = 'P0002';
    end if;
    if exists (
      select 1 from tci.credit_limit_requests r
       where tci.limit_scope(r.policy_id, r.insurance_request_id) = p_policy_id
         and r.entity_id = p_entity_id
         and r.status in ('draft', 'submitted', 'under_review', 'escalated')
    ) then
      raise exception 'there is already an open limit request for this buyer'
        using errcode = 'P0001';
    end if;

    insert into tci.credit_limit_requests (
      policy_id, entity_id, requested_amount, currency_code,
      requested_payment_terms_days, justification, status, submitted_at
    ) values (
      p_policy_id, p_entity_id, p_amount, p_currency,
      p_payment_terms_days, p_justification, 'submitted', now()
    ) returning * into v_request;

    -- The same event the staff path emits, so the Agenda opens the same task
    -- for the same people. The portal does not get a private workflow.
    perform tci.emit_workflow_event(
      'limit.request_submitted', 'credit_limit_request', v_request.id,
      jsonb_build_object(
        'entity_id', v_request.entity_id,
        'amount', v_request.requested_amount,
        'currency', v_request.currency_code,
        'from_client', true),
      'credit_underwriter'::tci.user_role);

    return jsonb_build_object('kind', 'request', 'id', v_request.id);
  end if;

  -- Path 2: a company we do not have.
  if coalesce(btrim(p_proposed_name), '') = '' then
    raise exception 'name the buyer, or pick one from the registry'
      using errcode = 'P0001';
  end if;

  insert into tci.client_buyer_proposals (
    policy_id, proposed_name, proposed_registration_number, proposed_country_code,
    requested_amount, currency_code, requested_payment_terms_days, justification
  ) values (
    p_policy_id, btrim(p_proposed_name), nullif(btrim(coalesce(p_registration_number,'')), ''),
    p_country_code, p_amount, p_currency, p_payment_terms_days, p_justification
  ) returning * into v_proposal;

  perform tci.emit_workflow_event(
    'client.buyer_proposed', 'client_buyer_proposal', v_proposal.id,
    jsonb_build_object(
      'name', v_proposal.proposed_name,
      'registration_number', v_proposal.proposed_registration_number,
      'policy_id', v_proposal.policy_id),
    'information_manager'::tci.user_role);

  return jsonb_build_object('kind', 'proposal', 'id', v_proposal.id);
end;
$function$;

-- client_respond_to_info_request: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.client_respond_to_info_request(p_claim_id uuid, p_comment text)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = '42501';
  end if;
  if coalesce(trim(coalesce(p_comment, '')), '') = '' then
    raise exception 'say what you are sending back' using errcode = 'P0001';
  end if;
  return tci.change_claim_status(p_claim_id, 'under_assessment', p_comment);
end;
$function$;

-- client_respond_to_submission: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.client_respond_to_submission(p_request_id uuid, p_action text, p_comment text DEFAULT NULL::text)
 RETURNS tci.insurance_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request tci.insurance_requests%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'only a portal user may answer a submission this way'
      using errcode = '42501';
  end if;

  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found or v_request.entity_id not in (select tci.my_client_entities()) then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'client_review' then
    raise exception 'this submission is not with you (it is %)', v_request.status
      using errcode = 'P0001';
  end if;

  if p_action = 'accept' then
    return tci.advance_insurance_request(p_request_id, 'accepted', null);

  elsif p_action = 'decline' then
    if coalesce(btrim(p_comment), '') = '' then
      raise exception 'a decline needs a reason' using errcode = 'P0001';
    end if;
    return tci.advance_insurance_request(p_request_id, 'declined', btrim(p_comment));

  elsif p_action = 'request_changes' then
    if coalesce(btrim(p_comment), '') = '' then
      raise exception 'say what should change' using errcode = 'P0001';
    end if;
    -- Back to sales, not a decline: the client still wants the cover, on
    -- different terms. The status machine gained this transition below.
    return tci.advance_insurance_request(p_request_id, 'sales_confirmation', btrim(p_comment));
  end if;

  raise exception 'unknown action %', p_action using errcode = 'P0001';
end;
$function$;

-- client_submit_claim: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.client_submit_claim(p_claim_id uuid)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = '42501';
  end if;
  return tci.change_claim_status(p_claim_id, 'submitted', null);
end;
$function$;

-- client_submit_declaration: sets the internal-call token (trusted, definer)
create or replace function tci.client_submit_declaration(p_declaration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dec tci.declarations%rowtype;
begin
  perform tci.begin_trusted_call();
  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  perform tci.client_policy_guard(v_dec.policy_id);
  -- The staff path owns the transition, the guards and the event, so the
  -- portal does not get a private workflow.
  return tci.submit_declaration(p_declaration_id);
end;
$function$;

-- client_withdraw_claim: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.client_withdraw_claim(p_claim_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = '42501';
  end if;
  return tci.change_claim_status(p_claim_id, 'withdrawn', p_comment);
end;
$function$;

-- complete_password_change: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.complete_password_change()
 RETURNS tci.user_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row tci.user_profiles%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into tci.user_profiles (user_id, must_change_password, password_changed_at)
  values ((select auth.uid()), false, now())
  on conflict (user_id) do update
    set must_change_password = false,
        password_changed_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

-- correct_declaration: sets the internal-call token (trusted, definer); gate: perform tci.require_staff_or_internal();
create or replace function tci.correct_declaration(p_declaration_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old tci.declarations%rowtype;
  v_new tci.declarations%rowtype;
begin
  perform tci.require_staff_or_internal();
  perform tci.begin_trusted_call();
  select * into v_old from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  if not tci.declaration_transition_allowed(v_old.status, 'corrected') then
    raise exception 'only an accepted or disputed declaration can be corrected (this one is %)',
      v_old.status using errcode = 'P0001';
  end if;

  -- Supersede FIRST. declarations_live_period_uq allows one non-corrected row
  -- per (policy, period), so inserting the correction while the original is
  -- still live violates it and no declaration could ever be corrected.
  update tci.declarations
     set status = 'corrected', superseded_at = now(), updated_at = now()
   where id = v_old.id;

  insert into tci.declarations (
    policy_id, period_start, period_end, status, currency_code,
    note, supersedes_id
  ) values (
    v_old.policy_id, v_old.period_start, v_old.period_end, 'draft',
    v_old.currency_code, p_note, v_old.id
  ) returning * into v_new;

  -- Carry the lines over so the correction starts from what was declared,
  -- WITHOUT the frozen split: the new declaration will be classified on its
  -- own facts when it is accepted.
  insert into tci.declaration_lines (
    declaration_id, entity_id, insurable_turnover, overdue_amount, line_note
  )
  select v_new.id, l.entity_id, l.insurable_turnover, l.overdue_amount, l.line_note
    from tci.declaration_lines l
   where l.declaration_id = v_old.id;

  perform tci.emit_workflow_event(
    'declaration.corrected', 'declaration', v_new.id,
    jsonb_build_object('policy_id', v_new.policy_id, 'supersedes', v_old.id),
    'commercial_underwriter'::tci.user_role);

  return jsonb_build_object(
    'result', 'corrected', 'declaration_id', v_new.id, 'supersedes', v_old.id);
end;
$function$;

-- decide_limit_request: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (staff, invoker)
create or replace function tci.decide_limit_request(p_request_id uuid, p_outcome tci.decision_outcome, p_amount numeric DEFAULT NULL::numeric, p_currency character DEFAULT NULL::bpchar, p_valid_from date DEFAULT CURRENT_DATE, p_valid_until date DEFAULT NULL::date, p_conditions jsonb DEFAULT '[]'::jsonb, p_comment text DEFAULT NULL::text, p_assessment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_currency char(3);
  v_decision tci.credit_limit_decisions%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_condition jsonb;
  v_group    jsonb;
begin
  perform tci.begin_internal_call();
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
    raise exception 'only credit underwriting may decide' using errcode = '42501';
  end if;

  v_currency := coalesce(p_currency, v_request.currency_code);
  v_band := tci.grade_band_for_assessment(p_assessment_id);

  if p_outcome in ('approved', 'partial') then
    if p_amount is null or p_amount <= 0 then
      raise exception 'approved/partial decisions require a positive amount'
        using errcode = 'P0001';
    end if;

    if not tci.has_role('admin') then
      v_amount_uzs := tci.to_uzs(p_amount, v_currency);
      v_authority_uzs := tci.my_authority_uzs(v_band);
      if v_amount_uzs > v_authority_uzs then
        update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

        perform tci.emit_workflow_event(
          'limit.request_escalated', 'credit_limit_request', p_request_id,
          jsonb_build_object(
            'entity_id', v_request.entity_id,
            'amount', p_amount,
            'currency', v_currency,
            'grade_band', v_band,
            'amount_uzs', v_amount_uzs),
          'credit_underwriter'::tci.user_role);

        return jsonb_build_object(
          'result', 'escalated',
          'grade_band', v_band,
          'amount_uzs', v_amount_uzs,
          'authority_uzs', v_authority_uzs
        );
      end if;

      -- PHASE 6: the group control. Blocking, and it escalates rather than
      -- simply failing, so the request reaches someone who can weigh the whole
      -- group. Admin is exempt (documented at the top of this migration).
      v_group := tci.group_exposure_preflight(
        v_request.entity_id, p_amount, v_currency,
        tci.limit_scope(v_request.policy_id, v_request.insurance_request_id));

      if (v_group ->> 'over_limit')::boolean then
        update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

        perform tci.emit_workflow_event(
          'limit.group_limit_breached', 'credit_limit_request', p_request_id,
          jsonb_build_object(
            'entity_id', v_request.entity_id,
            'ultimate_parent_id', v_group ->> 'ultimate_parent_id',
            'amount', p_amount,
            'currency', v_currency,
            'exposure_after_uzs', v_group ->> 'exposure_after_uzs',
            'group_limit_uzs', v_group ->> 'group_limit_uzs'),
          'credit_underwriter'::tci.user_role);

        return jsonb_build_object(
          'result', 'group_limit_exceeded',
          'grade_band', v_band,
          'group', v_group
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
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(v_request.policy_id, v_request.insurance_request_id)
     and r.entity_id = v_request.entity_id;

  update tci.credit_limit_requests
     set status = 'decided', decided_at = now()
   where id = p_request_id;

  return jsonb_build_object(
    'result', 'decided', 'decision_id', v_decision.id, 'grade_band', v_band);
end;
$function$;

-- delete_claim_document: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.delete_claim_document(p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_doc tci.claim_documents%rowtype;
begin
  select * into v_doc from tci.claim_documents where id = p_document_id;
  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  -- The uploader may take back their own file while the claim is still theirs
  -- to assemble; claims may remove anything.
  if not (tci.has_role('claims', 'admin')
          or (v_doc.uploaded_by = (select auth.uid())
              and tci.may_upload_to_claim(v_doc.claim_id))) then
    raise exception 'not permitted to remove this document' using errcode = '42501';
  end if;
  delete from tci.claim_documents where id = p_document_id;
end;
$function$;

-- delete_claim_invoice: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.delete_claim_invoice(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_claim uuid;
begin
  perform tci.begin_trusted_call();
  select claim_id into v_claim from tci.claim_invoices where id = p_invoice_id;
  if v_claim is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if not tci.may_edit_claim_content(v_claim) then
    raise exception 'this claim can no longer be edited' using errcode = 'P0001';
  end if;
  delete from tci.claim_invoices where id = p_invoice_id;
  if exists (select 1 from tci.claim_invoice_verdicts where claim_id = v_claim) then
    perform tci.verify_claim_coverage(v_claim);
  end if;
end;
$function$;

-- dispute_declaration: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.dispute_declaration(p_declaration_id uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dec tci.declarations%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('commercial_underwriter', 'sales', 'admin') then
    raise exception 'not allowed to dispute a declaration' using errcode = '42501';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'a dispute needs a reason the policyholder can act on'
      using errcode = 'P0001';
  end if;

  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  if not tci.declaration_transition_allowed(v_dec.status, 'disputed') then
    raise exception 'a declaration cannot go from % to disputed', v_dec.status
      using errcode = 'P0001';
  end if;

  update tci.declarations
     set status = 'disputed',
         disputed_by = (select auth.uid()),
         disputed_at = now(),
         dispute_note = p_note,
         updated_at = now()
   where id = p_declaration_id
   returning * into v_dec;

  perform tci.emit_workflow_event(
    'declaration.disputed', 'declaration', v_dec.id,
    jsonb_build_object('policy_id', v_dec.policy_id, 'note', p_note),
    'client'::tci.user_role);

  return jsonb_build_object('result', 'disputed', 'declaration_id', v_dec.id);
end;
$function$;

-- emit_assessment_event: sets the internal-call token (trusted, definer)
create or replace function tci.emit_assessment_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event(
    'rating.created', 'credit_assessment', new.id,
    jsonb_build_object(
      'entity_id', new.entity_id,
      'grade', new.rating_grade),
    'credit_underwriter'::tci.user_role);
  return new;
end;
$function$;

-- emit_credit_decision_event: sets the internal-call token (trusted, definer)
create or replace function tci.emit_credit_decision_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event(
    case when new.stage = 'commercial' then 'limit.commercial_adjusted'
         else 'limit.credit_decided' end,
    'credit_limit_decision', new.id,
    jsonb_build_object(
      'outcome', new.outcome,
      'amount', new.approved_amount,
      'stage', new.stage,
      'release_kind', new.release_kind
    ),
    case when new.release_kind = 'immediate' then 'client'::tci.user_role
         else 'sales'::tci.user_role end
  );
  return new;
end;
$function$;

-- emit_request_buyer_event: sets the internal-call token (trusted, definer)
create or replace function tci.emit_request_buyer_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event(
    'request.buyer_added', 'insurance_request', new.request_id,
    jsonb_build_object(
      'buyer_row_id', new.id,
      'name', new.proposed_name,
      'entity_id', new.entity_id),
    'sales'::tci.user_role);
  return new;
end;
$function$;

-- end_entity_relationship: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.end_entity_relationship(p_relationship_id uuid, p_valid_to date DEFAULT CURRENT_DATE)
 RETURNS tci.entity_relationships
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row tci.entity_relationships%rowtype;
begin
  if not tci.may_edit_relationships() then
    raise exception 'not permitted to record corporate relationships' using errcode = '42501';
  end if;
  update tci.entity_relationships
     set valid_to = coalesce(p_valid_to, current_date), updated_at = now()
   where id = p_relationship_id
   returning * into v_row;
  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$function$;

-- end_group_limit: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.end_group_limit(p_ultimate_parent_id uuid, p_valid_to date DEFAULT NULL::date)
 RETURNS tci.group_limits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row tci.group_limits%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may remove a group limit' using errcode = '42501';
  end if;
  update tci.group_limits
     set valid_to = greatest(coalesce(p_valid_to, current_date - 1), valid_from - 1)
   where ultimate_parent_entity_id = p_ultimate_parent_id
     and valid_to is null
   returning * into v_row;
  if not found then
    raise exception 'this group has no limit in force' using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'group.limit_removed', 'legal_entity', p_ultimate_parent_id,
    jsonb_build_object('group_limit_id', v_row.id, 'valid_to', v_row.valid_to),
    'credit_underwriter'::tci.user_role);

  return v_row;
end;
$function$;

-- file_overdue_notification: sets the internal-call token (trusted, definer); gate: perform tci.require_staff_or_internal();
create or replace function tci.file_overdue_notification(p_policy_id uuid, p_entity_id uuid, p_first_due_date date, p_overdue_amount numeric, p_currency character DEFAULT NULL::bpchar)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy tci.policies%rowtype;
  v_noa    tci.overdue_notifications%rowtype;
  v_suspension uuid;
  v_late   boolean;
begin
  perform tci.require_staff_or_internal();
  perform tci.begin_trusted_call();
  select * into v_policy from tci.policies where id = p_policy_id;
  if not found then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  if v_policy.status <> 'active' then
    raise exception 'overdue accounts can only be notified under an active policy (this one is %)',
      v_policy.status using errcode = 'P0001';
  end if;
  if p_first_due_date is null or p_first_due_date > current_date then
    raise exception 'the first due date must be in the past' using errcode = 'P0001';
  end if;
  if coalesce(p_overdue_amount, 0) <= 0 then
    raise exception 'an overdue notification needs a positive amount' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_entity_id) then
    raise exception 'buyer not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from tci.overdue_notifications
     where policy_id = p_policy_id and entity_id = p_entity_id and status = 'open'
  ) then
    raise exception 'this buyer already has an open overdue notification on this policy'
      using errcode = 'P0001';
  end if;

  insert into tci.overdue_notifications (
    policy_id, entity_id, first_due_date, overdue_amount, currency_code, reported_by
  ) values (
    p_policy_id, p_entity_id, p_first_due_date, p_overdue_amount,
    coalesce(p_currency, v_policy.currency_code), (select auth.uid())
  ) returning * into v_noa;

  v_suspension := tci.suspend_limit_for_noa(v_noa.id);

  select reported_late into v_late
    from tci.v_overdue_notifications where id = v_noa.id;

  perform tci.emit_workflow_event(
    'noa.filed', 'overdue_notification', v_noa.id,
    jsonb_build_object(
      'policy_id', p_policy_id,
      'entity_id', p_entity_id,
      'overdue_amount', p_overdue_amount,
      'currency', coalesce(p_currency, v_policy.currency_code),
      'reported_late', v_late,
      'limit_suspended', (v_suspension is not null)),
    'credit_underwriter'::tci.user_role);

  return jsonb_build_object(
    'result', 'filed',
    'noa_id', v_noa.id,
    'reported_late', v_late,
    'suspension_decision_id', v_suspension);
end;
$function$;

-- generate_instalments_on_policy: sets the internal-call token (trusted, definer)
create or replace function tci.generate_instalments_on_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.begin_trusted_call();
  perform tci.generate_premium_instalments(new.id, false);
  return null;
end;
$function$;

-- generate_premium_instalments: gate: perform tci.require_staff_or_internal();
create or replace function tci.generate_premium_instalments(p_policy_id uuid, p_replace boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy   tci.policies%rowtype;
  v_count    int;
  v_each     numeric(18,2);
  v_running  numeric(18,2) := 0;
  v_amount   numeric(18,2);
  v_due      date;
  i          int;
begin
  perform tci.require_staff_or_internal();
  select * into v_policy from tci.policies where id = p_policy_id;
  if not found then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from tci.premium_instalments where policy_id = p_policy_id) then
    if not p_replace then
      return 0;
    end if;
    -- Only ever discard what has not been billed. An invoiced or paid
    -- instalment is a fact about money and is never regenerated away.
    if exists (
      select 1 from tci.premium_instalments
       where policy_id = p_policy_id and status in ('invoiced', 'paid')
    ) then
      raise exception 'this policy already has invoiced or paid instalments'
        using errcode = 'P0001';
    end if;
    delete from tci.premium_instalments where policy_id = p_policy_id;
  end if;

  v_count := tci.premium_instalment_count(
    v_policy.inception_date, v_policy.expiry_date, v_policy.declaration_frequency);
  v_each := round(v_policy.minimum_premium / v_count, 2);

  for i in 1 .. v_count loop
    v_due := case v_policy.declaration_frequency
               when 'monthly'   then v_policy.inception_date + make_interval(months => i)
               when 'quarterly' then v_policy.inception_date + make_interval(months => i * 3)
             end;
    -- Never bill past the end of the policy period.
    if v_due > v_policy.expiry_date then
      v_due := v_policy.expiry_date;
    end if;

    if i = v_count then
      v_amount := v_policy.minimum_premium - v_running;
    else
      v_amount := v_each;
    end if;
    v_running := v_running + v_amount;

    insert into tci.premium_instalments (policy_id, sequence, due_date, amount)
    values (p_policy_id, i, v_due, v_amount);
  end loop;

  return v_count;
end;
$function$;

-- group_exposure_preflight: gate: perform tci.require_staff_or_internal();
create or replace function tci.group_exposure_preflight(p_entity_id uuid, p_new_amount numeric DEFAULT NULL::numeric, p_currency character DEFAULT NULL::bpchar, p_exclude_scope uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_parent   uuid;
  v_exp      record;
  v_limit    tci.group_limits%rowtype;
  v_current  numeric;
  v_replaced numeric := 0;
  v_added    numeric := 0;
  v_after    numeric;
  v_limit_uzs numeric;
begin
  perform tci.require_staff_or_internal();
  v_parent := tci.ultimate_parent(p_entity_id);

  select coalesce(exposure_uzs, 0) as exposure_uzs, coalesce(missing_rates, 0) as missing_rates
    into v_exp
    from tci.v_group_exposure where ultimate_parent_id = v_parent;
  v_current := coalesce(v_exp.exposure_uzs, 0);

  -- What this buyer already contributes under the scope being decided, which
  -- the new decision will supersede. v_effective_limits already carries the
  -- scope key, so this is a plain filter rather than a walk back through the
  -- decision to its request.
  if p_exclude_scope is not null then
    select coalesce(sum(l.amount_uzs) filter (where not l.rate_missing), 0)
      into v_replaced
      from tci.v_group_exposure_lines l
     where l.ultimate_parent_id = v_parent
       and l.member_id = p_entity_id
       and l.scope_id = p_exclude_scope;
  end if;

  if p_new_amount is not null then
    v_added := coalesce(tci.to_uzs(p_new_amount, p_currency), 0);
  end if;

  v_after := greatest(v_current - v_replaced, 0) + v_added;

  select * into v_limit from tci.current_group_limit(v_parent);
  v_limit_uzs := case when v_limit.id is null then null
                      else tci.to_uzs(v_limit.max_amount, v_limit.currency_code) end;

  return jsonb_build_object(
    'ultimate_parent_id', v_parent,
    'group_size', (select count(*) from tci.entity_group(p_entity_id)),
    'has_group_limit', (v_limit.id is not null),
    'group_limit_id', v_limit.id,
    'group_limit_amount', v_limit.max_amount,
    'group_limit_currency', v_limit.currency_code,
    'group_limit_uzs', v_limit_uzs,
    'exposure_uzs', v_current,
    'replaced_uzs', v_replaced,
    'added_uzs', v_added,
    'exposure_after_uzs', v_after,
    'headroom_uzs', case when v_limit_uzs is null then null else v_limit_uzs - v_after end,
    'over_limit', (v_limit_uzs is not null and v_after > v_limit_uzs),
    'utilisation_pct', case when coalesce(v_limit_uzs, 0) <= 0 then null
                            else round(v_after * 100 / v_limit_uzs, 2) end,
    'missing_rates', coalesce(v_exp.missing_rates, 0));
end;
$function$;

-- handle_phase4_event: sets the internal-call token (trusted, definer)
create or replace function tci.handle_phase4_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dec tci.declarations%rowtype;
  v_noa record;
begin
  perform tci.begin_trusted_call();
  case new.event_type

    -- A declaration is with the insurer: commercial underwriting has to
    -- accept or dispute it. The chasing task, if one was open, is answered.
    when 'declaration.submitted' then
      select * into v_dec from tci.declarations where id = new.object_id;
      if found then
        perform tci.close_tasks(
          array['declaration_due', 'declaration_overdue']::tci.task_type[],
          v_dec.policy_id);
        perform tci.open_task(
          'declaration_awaiting_acceptance', 'declaration', new.object_id,
          'agenda.tasks.declaration_awaiting_acceptance',
          jsonb_build_object(
            'policy_id', v_dec.policy_id,
            'period_start', v_dec.period_start,
            'total', v_dec.total_insurable_turnover),
          'commercial_underwriter'::tci.user_role, null, null, 'normal', new.id);
      end if;

    -- Accepted or disputed: either way it is no longer awaiting acceptance.
    when 'declaration.accepted', 'declaration.disputed' then
      perform tci.close_tasks(
        array['declaration_awaiting_acceptance']::tci.task_type[], new.object_id);

    -- A correction is a new declaration in draft; the old one's task is moot.
    when 'declaration.corrected' then
      perform tci.close_tasks(
        array['declaration_awaiting_acceptance']::tci.task_type[],
        (new.payload->>'supersedes')::uuid, 'cancelled');

    -- Turnover shipped outside cover. Nothing downstream resolves this on its
    -- own - it is a conversation with the policyholder - so it is the one
    -- Phase 4 task a human closes by hand.
    when 'declaration.uncovered_excess' then
      perform tci.open_task(
        'uncovered_excess_review', 'declaration', new.object_id,
        'agenda.tasks.uncovered_excess_review',
        jsonb_build_object(
          'policy_id', new.payload->>'policy_id',
          'uncovered_excess', new.payload->>'uncovered_excess'),
        'commercial_underwriter'::tci.user_role, null, null, 'high', new.id);

    -- A buyer has stopped paying. Credit underwriting reviews them, and it is
    -- urgent: the limit is already suspended and somebody has to decide what
    -- happens next.
    when 'noa.filed' then
      select * into v_noa from tci.v_overdue_notifications where id = new.object_id;
      if found then
        perform tci.open_task(
          'noa_credit_review', 'overdue_notification', new.object_id,
          'agenda.tasks.noa_credit_review',
          jsonb_build_object(
            'policy_id', v_noa.policy_id,
            'entity_id', v_noa.buyer_entity_id,
            'buyer_name', v_noa.buyer_name,
            'overdue_amount', v_noa.overdue_amount,
            'currency', v_noa.currency_code,
            'reported_late', v_noa.reported_late,
            'limit_suspended', v_noa.limit_suspended),
          'credit_underwriter'::tci.user_role, null, null, 'urgent', new.id);
      end if;

    when 'noa.resolved' then
      perform tci.close_tasks(
        array['noa_credit_review']::tci.task_type[], new.object_id);

    else
      -- Every other event belongs to tci.handle_workflow_event.
      null;
  end case;

  return null;
end;
$function$;

-- handle_phase5_event: sets the internal-call token (trusted, definer)
create or replace function tci.handle_phase5_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim  tci.claims%rowtype;
  v_user   uuid;
begin
  perform tci.begin_trusted_call();
  if new.object_type <> 'claim' then
    return null;
  end if;
  select * into v_claim from tci.claims where id = new.object_id;
  if not found then
    return null;
  end if;

  if new.event_type = 'claim.status_changed' then
    -- Whatever the target, the tasks that were waiting on this claim to move
    -- have stopped being relevant.
    if (new.payload ->> 'to') <> 'submitted' then
      perform tci.close_tasks(array['claim_submitted']::tci.task_type[], new.object_id, 'done');
    end if;
    if (new.payload ->> 'to') <> 'info_requested' then
      perform tci.close_tasks(array['claim_info_requested']::tci.task_type[], new.object_id, 'done');
    end if;

    if (new.payload ->> 'to') = 'submitted' then
      -- Filed: claims picks it up, and the "you can claim this" nudge on the
      -- NOA behind it has served its purpose.
      perform tci.open_task(
        'claim_submitted', 'claim', new.object_id,
        'agenda.tasks.claim_submitted',
        jsonb_build_object(
          'claim_id', new.object_id,
          'claim_number', v_claim.claim_number,
          'amount', v_claim.claimed_amount,
          'currency', v_claim.currency_code),
        'claims'::tci.user_role, null, null, 'high', new.id);
      if v_claim.overdue_notification_id is not null then
        perform tci.close_tasks(
          array['noa_matured_to_claim', 'claim_ready_to_file']::tci.task_type[],
          v_claim.overdue_notification_id, 'done');
      end if;

    elsif (new.payload ->> 'to') = 'info_requested' then
      for v_user in select tci.policyholder_user_ids(v_claim.policy_id) loop
        perform tci.open_task(
          'claim_info_requested', 'claim', new.object_id,
          'agenda.tasks.claim_info_requested',
          jsonb_build_object(
            'claim_id', new.object_id,
            'claim_number', v_claim.claim_number,
            'comment', new.payload ->> 'comment'),
          null, v_user, null, 'high', new.id);
      end loop;

    elsif (new.payload ->> 'to') in ('approved', 'partially_approved') then
      perform tci.open_task(
        'claim_awaiting_payment', 'claim', new.object_id,
        'agenda.tasks.claim_awaiting_payment',
        jsonb_build_object(
          'claim_id', new.object_id,
          'claim_number', v_claim.claim_number,
          'amount', v_claim.approved_indemnity,
          'currency', v_claim.currency_code),
        'claims'::tci.user_role, null, null, 'high', new.id);

    elsif (new.payload ->> 'to') = 'declined' then
      -- Nothing downstream happens on its own once a claim is refused: sales
      -- has to tell the policyholder. Closed by hand, like submission_declined.
      perform tci.open_task(
        'claim_declined_review', 'claim', new.object_id,
        'agenda.tasks.claim_declined_review',
        jsonb_build_object(
          'claim_id', new.object_id,
          'claim_number', v_claim.claim_number,
          'reason', new.payload ->> 'comment'),
        'sales'::tci.user_role, null, null, 'normal', new.id);

    elsif (new.payload ->> 'to') = 'paid' then
      perform tci.close_tasks(
        array['claim_awaiting_payment']::tci.task_type[], new.object_id, 'done');

    elsif (new.payload ->> 'to') in ('closed', 'withdrawn') then
      perform tci.close_tasks(
        array['claim_submitted', 'claim_info_requested', 'claim_awaiting_payment',
              'claim_declined_review', 'claim_limit_reinstatement']::tci.task_type[],
        new.object_id, 'cancelled');
    end if;

  elsif new.event_type = 'claim.approved' then
    -- The buyer's limit went down with the approval. Putting it back is a
    -- credit decision, not an administrative consequence.
    perform tci.open_task(
      'claim_limit_reinstatement', 'claim', new.object_id,
      'agenda.tasks.claim_limit_reinstatement',
      jsonb_build_object(
        'claim_id', new.object_id,
        'claim_number', v_claim.claim_number,
        'policy_id', v_claim.policy_id,
        'entity_id', v_claim.entity_id),
      'credit_underwriter'::tci.user_role, null, null, 'normal', new.id);
  end if;

  return null;
end;
$function$;

-- handle_workflow_event: sets the internal-call token (trusted, definer)
create or replace function tci.handle_workflow_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer     tci.insurance_request_buyers%rowtype;
  v_request   tci.insurance_requests%rowtype;
  v_decision  tci.credit_limit_decisions%rowtype;
  v_limit_req tci.credit_limit_requests%rowtype;
  v_entity_id uuid;
  v_targeted  boolean := false;
  v_user      uuid;
  v_band      tci.grade_band;
  v_due       timestamptz;
  v_from      text;
  v_to        text;
begin
  perform tci.begin_trusted_call();
  case new.event_type

  -- A buyer entered the package by name: somebody must identify the company.
  when 'request.buyer_added' then
    select * into v_buyer from tci.insurance_request_buyers
     where id = (new.payload->>'buyer_row_id')::uuid;
    if found and v_buyer.entity_id is null then
      select * into v_request from tci.insurance_requests where id = new.object_id;
      perform tci.open_task(
        'buyer_needs_entity', 'insurance_request', new.object_id,
        'agenda.tasks.buyer_needs_entity',
        -- request_number so the Agenda row reads as a whole sentence without
        -- a second lookup: information_manager may not see the submission.
        jsonb_build_object('buyer_row_id', v_buyer.id, 'name', v_buyer.proposed_name,
                           'request_number', v_request.request_number),
        'information_manager'::tci.user_role, null, null, 'high', new.id);
    end if;

  -- NEW in 0025: the same job, arriving from the portal instead.
  when 'client.buyer_proposed' then
    perform tci.open_task(
      'buyer_needs_entity', 'client_buyer_proposal', new.object_id,
      'agenda.tasks.buyer_proposed',
      jsonb_build_object(
        'name', new.payload->>'name',
        'registration_number', new.payload->>'registration_number'),
      'information_manager'::tci.user_role, null, null, 'high', new.id);

  when 'client.buyer_proposal_resolved' then
    perform tci.close_tasks(array['buyer_needs_entity']::tci.task_type[], new.object_id);

  -- Identified: that task is done, and the buyer may now need a rating.
  when 'request.buyer_resolved' then
    perform tci.close_tasks(array['buyer_needs_entity']::tci.task_type[], new.object_id);
    v_entity_id := (new.payload->>'entity_id')::uuid;
    if v_entity_id is not null and not exists (
      select 1 from tci.credit_assessments a
       where a.entity_id = v_entity_id
         and a.created_at > now() - interval '12 months'
    ) then
      perform tci.open_task(
        'buyer_needs_rating', 'legal_entity', v_entity_id,
        'agenda.tasks.buyer_needs_rating',
        jsonb_build_object('entity_id', v_entity_id, 'request_id', new.object_id),
        'credit_underwriter'::tci.user_role, null, null, 'normal', new.id);
    end if;

  -- A rating arrived: both rating tasks for that company are answered.
  when 'rating.created' then
    v_entity_id := (new.payload->>'entity_id')::uuid;
    perform tci.close_tasks(
      array['buyer_needs_rating', 'rating_stale']::tci.task_type[], v_entity_id);

  -- A decision is owed. Band-aware: address the underwriters who can actually
  -- take it, and fall back to the department when that cannot be resolved.
  when 'limit.request_submitted', 'limit.request_escalated' then
    select * into v_limit_req from tci.credit_limit_requests where id = new.object_id;
    v_band := coalesce((new.payload->>'grade_band')::tci.grade_band, 'unrated');
    for v_user in
      select * from tci.underwriters_covering(
        v_band, v_limit_req.requested_amount, v_limit_req.currency_code)
    loop
      v_targeted := true;
      perform tci.open_task(
        case when new.event_type = 'limit.request_escalated'
             then 'limit_escalated' else 'limit_needs_decision' end::tci.task_type,
        'credit_limit_request', new.object_id,
        case when new.event_type = 'limit.request_escalated'
             then 'agenda.tasks.limit_escalated' else 'agenda.tasks.limit_needs_decision' end,
        new.payload, null, v_user, null,
        case when new.event_type = 'limit.request_escalated'
             then 'urgent' else 'normal' end::tci.task_priority, new.id);
    end loop;
    if not v_targeted then
      perform tci.open_task(
        case when new.event_type = 'limit.request_escalated'
             then 'limit_escalated' else 'limit_needs_decision' end::tci.task_type,
        'credit_limit_request', new.object_id,
        case when new.event_type = 'limit.request_escalated'
             then 'agenda.tasks.limit_escalated' else 'agenda.tasks.limit_needs_decision' end,
        new.payload, 'credit_underwriter'::tci.user_role, null, null,
        case when new.event_type = 'limit.request_escalated'
             then 'urgent' else 'normal' end::tci.task_priority, new.id);
    end if;

  -- Decided: every task on that request is answered, however it was targeted.
  when 'limit.credit_decided' then
    select * into v_decision from tci.credit_limit_decisions where id = new.object_id;
    if found then
      perform tci.close_tasks(
        array['limit_needs_decision', 'limit_escalated']::tci.task_type[],
        v_decision.request_id);
      -- A fresh decision also retires any review task on the superseded one.
      select * into v_limit_req from tci.credit_limit_requests where id = v_decision.request_id;
      perform tci.close_tasks(
        array['limit_review_due']::tci.task_type[], v_limit_req.entity_id, 'cancelled');
    end if;

  -- Sales put a decision on hold: the decider has to answer it.
  when 'limit.held' then
    select * into v_decision from tci.credit_limit_decisions where id = new.object_id;
    if found then
      perform tci.open_task(
        'limit_held', 'credit_limit_decision', new.object_id,
        'agenda.tasks.limit_held',
        -- request_id so the Agenda row can deep-link: a decision has no page
        -- of its own, its limit request does.
        jsonb_build_object('comment', new.payload->>'comment',
                           'request_id', v_decision.request_id),
        null, v_decision.decided_by, null, 'high', new.id);
    end if;

  -- Released or re-shaped: the hold is resolved either way.
  when 'limit.released', 'limit.commercial_adjusted' then
    perform tci.close_tasks(array['limit_held']::tci.task_type[], new.object_id);
    if new.event_type = 'limit.commercial_adjusted' then
      perform tci.close_tasks(
        array['limit_held']::tci.task_type[],
        (new.payload->>'credit_decision_id')::uuid);
    end if;

  -- The submission pipeline. Each stage closes the previous stage's task, so
  -- a task cannot survive the status that raised it.
  when 'request.status_changed' then
    v_from := new.payload->>'from';
    v_to   := new.payload->>'to';
    select * into v_request from tci.insurance_requests where id = new.object_id;

    if v_from = 'commercial_review' then
      perform tci.close_tasks(
        array['submission_commercial_review']::tci.task_type[], new.object_id);
    end if;
    if v_from = 'sales_confirmation' then
      perform tci.close_tasks(
        array['submission_sales_confirmation']::tci.task_type[], new.object_id);
    end if;

    if v_to = 'commercial_review' then
      perform tci.open_task(
        'submission_commercial_review', 'insurance_request', new.object_id,
        'agenda.tasks.submission_commercial_review',
        jsonb_build_object('request_number', v_request.request_number),
        'commercial_underwriter'::tci.user_role, null, null, 'normal', new.id);

    elsif v_to = 'sales_confirmation' then
      -- due_at is the silent-consent clock made visible: the EARLIEST moment
      -- one of the package's decisions reaches the client on its own.
      select min(d.decided_at) + make_interval(hours => tci.sales_window_hours())
        into v_due
        from tci.credit_limit_decisions d
        join tci.credit_limit_requests r on r.id = d.request_id
       where r.insurance_request_id = new.object_id
         and d.lifecycle = 'effective'
         and d.released_at is null
         and not d.held;
      perform tci.open_task(
        'submission_sales_confirmation', 'insurance_request', new.object_id,
        'agenda.tasks.submission_sales_confirmation',
        -- A submission arriving here FROM client_review is the client asking
        -- for changes; the comment is what they asked for, so sales can see
        -- it on the task without opening the file.
        jsonb_build_object('request_number', v_request.request_number,
                           'client_comment',
                           case when v_from = 'client_review'
                                then new.payload->>'comment' end),
        'sales'::tci.user_role, null,
        coalesce(v_due, now() + make_interval(hours => tci.sales_window_hours())),
        'high', new.id);

    elsif v_to = 'accepted' then
      perform tci.open_task(
        'submission_accepted', 'insurance_request', new.object_id,
        'agenda.tasks.submission_accepted',
        jsonb_build_object('request_number', v_request.request_number),
        'sales'::tci.user_role, null, null, 'high', new.id);

    elsif v_to = 'declined' then
      -- The only manual one: nothing downstream happens, a human closes it.
      perform tci.open_task(
        'submission_declined', 'insurance_request', new.object_id,
        'agenda.tasks.submission_declined',
        jsonb_build_object('request_number', v_request.request_number,
                           'reason', new.payload->>'comment'),
        'sales'::tci.user_role, null, null, 'normal', new.id);

    elsif v_to = 'withdrawn' then
      -- Abandoned: nothing on it was achieved, so everything is cancelled.
      perform tci.close_tasks(
        array['submission_commercial_review', 'submission_sales_confirmation',
              'submission_accepted', 'buyer_needs_entity']::tci.task_type[],
        new.object_id, 'cancelled');

    elsif v_to = 'bound' then
      -- Off the board too, but not abandoned. Only the stage tasks are moot;
      -- submission_accepted was genuinely ANSWERED by the policy, and the
      -- request.bound arm below is what records it as done. Cancelling it here
      -- would beat that arm to the row and mislabel a completed task.
      perform tci.close_tasks(
        array['submission_commercial_review', 'submission_sales_confirmation',
              'buyer_needs_entity']::tci.task_type[],
        new.object_id, 'cancelled');
    end if;

  -- Bound: the accepted-submission task is answered by the policy existing.
  when 'request.bound' then
    perform tci.close_tasks(
      array['submission_accepted']::tci.task_type[], new.object_id);

  else
    null;  -- events with no Agenda meaning (request.created, request.assigned)
  end case;

  return new;
end;
$function$;

-- hold_decision: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (staff, invoker)
create or replace function tci.hold_decision(p_decision_id uuid, p_comment text)
 RETURNS tci.credit_limit_decisions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_row tci.credit_limit_decisions%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('admin', 'sales') then
    raise exception 'only sales may hold a decision' using errcode = '42501';
  end if;
  if coalesce(btrim(p_comment), '') = '' then
    raise exception 'a hold needs a comment saying what must be discussed'
      using errcode = 'P0001';
  end if;

  select * into v_row from tci.credit_limit_decisions where id = p_decision_id;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;
  if v_row.released_at is not null then
    raise exception 'the client has already seen this decision - it cannot be held'
      using errcode = 'P0001';
  end if;

  update tci.credit_limit_decisions
     set held = true, hold_comment = p_comment
   where id = p_decision_id
   returning * into v_row;

  perform tci.emit_workflow_event(
    'limit.held', 'credit_limit_decision', p_decision_id,
    jsonb_build_object('comment', p_comment),
    'commercial_underwriter'::tci.user_role
  );
  return v_row;
end;
$function$;

-- open_claim: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.open_claim(p_policy_id uuid, p_entity_id uuid, p_cause tci.claim_cause_of_loss DEFAULT 'protracted_default'::tci.claim_cause_of_loss, p_noa_id uuid DEFAULT NULL::uuid, p_insolvency_reference text DEFAULT NULL::text)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy tci.policies%rowtype;
  v_claim  tci.claims%rowtype;
  v_noa    tci.overdue_notifications%rowtype;
begin
  perform tci.begin_trusted_call();
  if not (tci.has_role('claims', 'sales', 'admin') or tci.has_role('client')) then
    raise exception 'not permitted to open a claim' using errcode = '42501';
  end if;

  select * into v_policy from tci.policies where id = p_policy_id;
  if not found then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  if tci.has_role('client')
     and v_policy.entity_id not in (select tci.my_client_entities()) then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  -- Cover has to have existed. A claim under a draft policy is nonsense; a
  -- claim under an expired or cancelled one is normal - the loss happened
  -- while it was in force.
  if v_policy.status = 'draft' then
    raise exception 'a claim needs a policy that was in force' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_entity_id) then
    raise exception 'buyer not found' using errcode = 'P0002';
  end if;

  if p_noa_id is not null then
    select * into v_noa from tci.overdue_notifications where id = p_noa_id;
    if not found then
      raise exception 'overdue notification not found' using errcode = 'P0002';
    end if;
    if v_noa.policy_id <> p_policy_id or v_noa.entity_id <> p_entity_id then
      raise exception 'that overdue notification belongs to a different policy or buyer'
        using errcode = 'P0001';
    end if;
  end if;

  insert into tci.claims (
    policy_id, entity_id, overdue_notification_id, cause_of_loss,
    insolvency_reference, currency_code
  ) values (
    p_policy_id, p_entity_id, p_noa_id, p_cause,
    nullif(trim(coalesce(p_insolvency_reference, '')), ''), v_policy.currency_code
  ) returning * into v_claim;

  perform tci.emit_workflow_event(
    'claim.created', 'claim', v_claim.id,
    jsonb_build_object(
      'claim_number', v_claim.claim_number,
      'policy_id', p_policy_id, 'entity_id', p_entity_id,
      'cause_of_loss', p_cause, 'noa_id', p_noa_id),
    null);

  return v_claim;
end;
$function$;

-- override_claim_verdict: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.override_claim_verdict(p_claim_invoice_id uuid, p_verdict tci.coverage_verdict, p_covered_amount numeric, p_justification text)
 RETURNS tci.claim_invoice_verdicts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row tci.claim_invoice_verdicts%rowtype;
  v_inv tci.claim_invoices%rowtype;
  v_claim tci.claims%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may override a coverage verdict'
      using errcode = '42501';
  end if;
  if coalesce(trim(coalesce(p_justification, '')), '') = '' then
    raise exception 'an override needs a justification on the record'
      using errcode = 'P0001';
  end if;

  select * into v_inv from tci.claim_invoices where id = p_claim_invoice_id;
  if not found then
    raise exception 'claim invoice not found' using errcode = 'P0002';
  end if;
  select * into v_claim from tci.claims where id = v_inv.claim_id;
  if v_claim.status in ('paid', 'closed', 'withdrawn') then
    raise exception 'this claim is % and can no longer be reassessed', v_claim.status
      using errcode = 'P0001';
  end if;
  if coalesce(p_covered_amount, 0) > coalesce(v_inv.claimable_amount, 0) then
    raise exception 'the covered amount cannot exceed what is claimable on the invoice'
      using errcode = 'P0001';
  end if;
  if p_verdict = 'not_covered' and coalesce(p_covered_amount, 0) <> 0 then
    raise exception 'a not_covered verdict covers nothing' using errcode = 'P0001';
  end if;

  update tci.claim_invoice_verdicts
     set override_verdict = p_verdict,
         override_covered_amount = coalesce(p_covered_amount, 0),
         override_justification = trim(p_justification),
         overridden_by = (select auth.uid()),
         overridden_at = now()
   where claim_invoice_id = p_claim_invoice_id
   returning * into v_row;
  if not found then
    raise exception 'this invoice has no verdict yet - verify the claim first'
      using errcode = 'P0001';
  end if;

  perform tci.emit_workflow_event(
    'claim.verdict_overridden', 'claim', v_inv.claim_id,
    jsonb_build_object(
      'claim_invoice_id', p_claim_invoice_id,
      'invoice_number', v_inv.invoice_number,
      'system_verdict', v_row.system_verdict,
      'system_covered_amount', v_row.system_covered_amount,
      'override_verdict', p_verdict,
      'override_covered_amount', coalesce(p_covered_amount, 0)),
    'claims'::tci.user_role);

  return v_row;
end;
$function$;

-- record_claim_payment: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.record_claim_payment(p_claim_id uuid, p_amount numeric, p_paid_at date DEFAULT CURRENT_DATE, p_reference text DEFAULT NULL::text)
 RETURNS tci.claim_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim tci.claims%rowtype;
  v_paid  numeric(18,2);
  v_row   tci.claim_payments%rowtype;
begin
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may record an indemnity payment'
      using errcode = '42501';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if v_claim.status not in ('approved', 'partially_approved', 'paid') then
    raise exception 'nothing has been approved on this claim yet' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'a payment needs a positive amount' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from tci.claim_payments where claim_id = p_claim_id;
  if v_paid + p_amount > v_claim.approved_indemnity + 0.005 then
    raise exception 'this payment would exceed the approved indemnity (% already paid of %)',
      v_paid, v_claim.approved_indemnity using errcode = 'P0001';
  end if;

  insert into tci.claim_payments (claim_id, amount, currency_code, paid_at, reference)
  values (p_claim_id, p_amount, v_claim.currency_code, coalesce(p_paid_at, current_date), p_reference)
  returning * into v_row;

  -- Settled in full: the claim moves itself, so `paid` can never disagree with
  -- the payments behind it.
  if v_paid + p_amount >= v_claim.approved_indemnity - 0.005
     and v_claim.status <> 'paid' then
    perform tci.change_claim_status(p_claim_id, 'paid', null);
  end if;

  return v_row;
end;
$function$;

-- record_recovery: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.record_recovery(p_claim_id uuid, p_gross numeric, p_costs numeric DEFAULT 0, p_received_at date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL::text)
 RETURNS tci.recoveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim   tci.claims%rowtype;
  v_tot     record;
  v_paid    numeric(18,2);
  v_ins_borne numeric(18,2);
  v_ph_borne  numeric(18,2);
  v_total_borne numeric(18,2);
  v_net     numeric(18,2);
  v_ins     numeric(18,2);
  v_row     tci.recoveries%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may record a recovery' using errcode = '42501';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if coalesce(p_gross, 0) <= 0 then
    raise exception 'a recovery needs a positive gross amount' using errcode = 'P0001';
  end if;
  if coalesce(p_costs, 0) < 0 or coalesce(p_costs, 0) > p_gross then
    raise exception 'recovery costs must be between zero and the gross amount'
      using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from tci.claim_payments where claim_id = p_claim_id;
  select * into v_tot from tci.claim_covered_totals(p_claim_id);

  v_ins_borne   := round(v_paid, 2);
  v_ph_borne    := greatest(round(coalesce(v_tot.claimable_amount, 0) - v_paid, 2), 0);
  v_total_borne := v_ins_borne + v_ph_borne;
  v_net := round(p_gross - coalesce(p_costs, 0), 2);

  if v_total_borne <= 0 or v_ins_borne <= 0 then
    -- The insurer carried none of this loss - it paid nothing - so it takes
    -- none of the recovery.
    v_ins := 0;
  else
    v_ins := round(v_net * v_ins_borne / v_total_borne, 2);
    v_ins := least(v_ins, v_net);
  end if;

  insert into tci.recoveries (
    claim_id, received_at, gross_amount, recovery_costs,
    insurer_share, policyholder_share, insurer_borne, policyholder_borne,
    currency_code, note
  ) values (
    p_claim_id, coalesce(p_received_at, current_date), p_gross, coalesce(p_costs, 0),
    v_ins, v_net - v_ins, v_ins_borne, v_ph_borne,
    v_claim.currency_code, p_note
  ) returning * into v_row;

  perform tci.emit_workflow_event(
    'claim.recovery_recorded', 'claim', p_claim_id,
    jsonb_build_object(
      'claim_number', v_claim.claim_number,
      'gross', p_gross, 'costs', coalesce(p_costs, 0), 'net', v_net,
      'insurer_share', v_ins, 'policyholder_share', v_net - v_ins,
      'currency', v_claim.currency_code),
    'claims'::tci.user_role);

  return v_row;
end;
$function$;

-- refresh_agenda: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.refresh_agenda()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_opened int := 0;
  v_row record;
  v_client uuid;
begin
  perform tci.begin_trusted_call();
  if not tci.is_staff() then
    raise exception 'only staff have an agenda' using errcode = '42501';
  end if;

  -- (1) Effective limits expiring within 30 days need a review decision.
  for v_row in
    select v.entity_id, v.policy_id, v.valid_until, v.approved_amount, v.currency_code
    from tci.v_effective_limits v
    where v.valid_until is not null
      and v.valid_until <= current_date + 30
      and v.outcome in ('approved', 'partial')
  loop
    perform tci.open_task(
      'limit_review_due', 'legal_entity', v_row.entity_id,
      'agenda.tasks.limit_review_due',
      jsonb_build_object(
        'entity_id', v_row.entity_id,
        'policy_id', v_row.policy_id,
        'valid_until', v_row.valid_until,
        'amount', v_row.approved_amount,
        'currency', v_row.currency_code),
      'credit_underwriter'::tci.user_role, null,
      v_row.valid_until::timestamptz,
      case when v_row.valid_until <= current_date + 7 then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'limit_review_due'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_effective_limits v
        where v.entity_id = t.object_id
          and v.valid_until is not null
          and v.valid_until <= current_date + 30
          and v.outcome in ('approved', 'partial')
     );

  -- (2) A company carrying an effective limit on a rating older than a year.
  for v_row in
    select distinct v.entity_id
    from tci.v_effective_limits v
    where v.outcome in ('approved', 'partial')
      and not exists (
        select 1 from tci.credit_assessments a
         where a.entity_id = v.entity_id
           and a.created_at > now() - interval '12 months'
      )
  loop
    perform tci.open_task(
      'rating_stale', 'legal_entity', v_row.entity_id,
      'agenda.tasks.rating_stale',
      jsonb_build_object('entity_id', v_row.entity_id),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'rating_stale'
     and t.status = 'open'
     and exists (
       select 1 from tci.credit_assessments a
        where a.entity_id = t.object_id
          and a.created_at > now() - interval '12 months'
     );

  -- (3) NEW: the declaration period that has CLOSED and has not been declared.
  -- Keyed on the policy, not on a declaration row, because the whole point is
  -- that the declaration does not exist yet.
  for v_row in
    select p.id as policy_id,
           p.policy_number,
           p.declaration_frequency,
           tci.declaration_period_start(
             (tci.declaration_period_start(current_date, p.declaration_frequency)
              - interval '1 day')::date,
             p.declaration_frequency) as period_start
    from tci.policies p
    where p.status = 'active'
      -- Only chase a period the policy was actually live for: a policy
      -- incepted this month owes nothing for last month.
      and tci.declaration_period_start(
            (tci.declaration_period_start(current_date, p.declaration_frequency)
             - interval '1 day')::date,
            p.declaration_frequency)
          >= tci.declaration_period_start(p.inception_date, p.declaration_frequency)
  loop
    if not exists (
      select 1 from tci.declarations d
       where d.policy_id = v_row.policy_id
         and d.period_start = v_row.period_start
         and d.status <> 'corrected'
    ) then
      perform tci.open_task(
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'declaration_overdue' else 'declaration_due' end::tci.task_type,
        'policy', v_row.policy_id,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'agenda.tasks.declaration_overdue' else 'agenda.tasks.declaration_due' end,
        jsonb_build_object(
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'period_start', v_row.period_start,
          'period_end', tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency)),
        'sales'::tci.user_role, null,
        (tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30)::timestamptz,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'high' else 'normal' end::tci.task_priority,
        null);
      v_opened := v_opened + 1;
    end if;
  end loop;

  -- Retire chasing tasks once the period HAS been declared, or the policy
  -- stopped being active.
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('declaration_due', 'declaration_overdue')
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.declarations d
          where d.policy_id = t.object_id
            and d.period_start = (t.params->>'period_start')::date
            and d.status <> 'corrected'
       )
       or not exists (
         select 1 from tci.policies p where p.id = t.object_id and p.status = 'active'
       )
     );

  -- (4) NEW: instalments falling due, and instalments already past due.
  for v_row in
    select pi.id, pi.policy_id, pi.sequence, pi.due_date, pi.amount, p.policy_number,
           p.currency_code
    from tci.premium_instalments pi
    join tci.policies p on p.id = pi.policy_id
    where pi.status in ('pending', 'invoiced')
      and pi.due_date <= current_date + 14
  loop
    perform tci.open_task(
      case when v_row.due_date < current_date
           then 'instalment_overdue' else 'instalment_due' end::tci.task_type,
      'premium_instalment', v_row.id,
      case when v_row.due_date < current_date
           then 'agenda.tasks.instalment_overdue' else 'agenda.tasks.instalment_due' end,
      jsonb_build_object(
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'sequence', v_row.sequence,
        'due_date', v_row.due_date,
        'amount', v_row.amount,
        'currency', v_row.currency_code),
      'commercial_underwriter'::tci.user_role, null,
      v_row.due_date::timestamptz,
      case when v_row.due_date < current_date then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and not exists (
       select 1 from tci.premium_instalments pi
        where pi.id = t.object_id
          and pi.status in ('pending', 'invoiced')
          and pi.due_date <= current_date + 14
     );

  -- (5) NEW: an open overdue notification whose waiting period has run. The
  -- debt is now claimable, so the policyholder is told they may file and
  -- claims is told to expect it. Neither is a claim: only the policyholder
  -- decides that a debt is a loss.
  for v_row in
    select n.id, n.policy_id, n.entity_id, n.first_due_date, n.overdue_amount,
           n.currency_code, p.policy_number, p.waiting_period_days,
           (n.first_due_date + p.waiting_period_days) as claimable_from
    from tci.overdue_notifications n
    join tci.policies p on p.id = n.policy_id
    where n.status = 'open'
      and current_date >= n.first_due_date + p.waiting_period_days
      and not exists (
        select 1 from tci.claims c
         where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
  loop
    perform tci.open_task(
      'noa_matured_to_claim', 'overdue_notification', v_row.id,
      'agenda.tasks.noa_matured_to_claim',
      jsonb_build_object(
        'noa_id', v_row.id,
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'entity_id', v_row.entity_id,
        'amount', v_row.overdue_amount,
        'currency', v_row.currency_code,
        'claimable_from', v_row.claimable_from),
      'claims'::tci.user_role, null, v_row.claimable_from::timestamptz, 'normal', null);
    v_opened := v_opened + 1;

    -- Addressed to the individual portal users, never to the client role:
    -- every policyholder holds that role, so a role-targeted task would show
    -- them each other's files.
    for v_client in select tci.policyholder_user_ids(v_row.policy_id) loop
      perform tci.open_task(
        'claim_ready_to_file', 'overdue_notification', v_row.id,
        'agenda.tasks.claim_ready_to_file',
        jsonb_build_object(
          'noa_id', v_row.id,
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'entity_id', v_row.entity_id,
          'amount', v_row.overdue_amount,
          'currency', v_row.currency_code,
          'claimable_from', v_row.claimable_from),
        null, v_client, v_row.claimable_from::timestamptz, 'normal', null);
      v_opened := v_opened + 1;
    end loop;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('noa_matured_to_claim', 'claim_ready_to_file')
     and t.status = 'open'
     and not exists (
       select 1 from tci.overdue_notifications n
        where n.id = t.object_id
          and n.status = 'open'
          and not exists (
            select 1 from tci.claims c
             where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
     );

  -- (6) NEW: retire the reinstatement review once the buyer holds a live limit
  -- again, or the claim file is closed. The credit underwriter's decision IS
  -- the completion signal, so this type needs no button either.
  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        join tci.v_effective_limits v
          on v.policy_id = c.policy_id and v.entity_id = c.entity_id
       where c.id = t.object_id
         and v.outcome in ('approved', 'partial')
     );
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        where c.id = t.object_id and c.status in ('closed', 'withdrawn')
     );

  -- (7) NEW (Phase 6): a group whose exposure has crossed the warning share of
  -- its group limit. Keyed on the ULTIMATE PARENT, which is the group's
  -- identity - there is no group record to key on.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           gl.max_amount, gl.currency_code,
           tci.to_uzs(gl.max_amount, gl.currency_code) as limit_uzs
      from tci.v_group_exposure ge
      join tci.group_limits gl
        on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
       and gl.valid_from <= current_date
       and (gl.valid_to is null or gl.valid_to >= current_date)
     where tci.to_uzs(gl.max_amount, gl.currency_code) > 0
       and ge.exposure_uzs
           >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
  loop
    perform tci.open_task(
      'group_exposure_near_limit', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_exposure_near_limit',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'exposure_uzs', v_row.exposure_uzs,
        'limit_uzs', v_row.limit_uzs,
        'utilisation_pct', round(v_row.exposure_uzs * 100 / v_row.limit_uzs, 1)),
      'credit_underwriter'::tci.user_role, null, null, 'high', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_exposure_near_limit'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_group_exposure ge
        join tci.group_limits gl
          on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
         and gl.valid_from <= current_date
         and (gl.valid_to is null or gl.valid_to >= current_date)
       where ge.ultimate_parent_id = t.object_id
         and tci.to_uzs(gl.max_amount, gl.currency_code) > 0
         and ge.exposure_uzs
             >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
     );

  -- (8) NEW (Phase 6): a group carrying limits with NO group limit set. Not an
  -- error - most single-company "groups" never need one - so it is only raised
  -- where the group actually has more than one member.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           ge.members_with_limits
      from tci.v_group_exposure ge
     where ge.members_with_limits > 1
       and not exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = ge.ultimate_parent_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
  loop
    perform tci.open_task(
      'group_limit_missing', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_limit_missing',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'members_with_limits', v_row.members_with_limits,
        'exposure_uzs', v_row.exposure_uzs),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_limit_missing'
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = t.object_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
       or not exists (
         select 1 from tci.v_group_exposure ge
          where ge.ultimate_parent_id = t.object_id and ge.members_with_limits > 1)
     );

  return v_opened;
end;
$function$;

-- refresh_entity_suggestions: sets the internal-call token (trusted, definer)
create or replace function tci.refresh_entity_suggestions(p_entity_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
  v_signals jsonb;
  v_score numeric;
  v_a uuid;
  v_b uuid;
  v_n int := 0;
begin
  perform tci.begin_trusted_call();
  if not tci.is_staff() then
    return 0;   -- clients never see relationships; nothing to generate
  end if;

  for v_row in
    select e.id
      from tci.legal_entities e, tci.legal_entities me
     where me.id = p_entity_id
       and e.id <> p_entity_id
       and (
            (tci.email_domain(e.contact_email) is not null
             and tci.email_domain(e.contact_email) = tci.email_domain(me.contact_email)
             and not tci.is_free_email_domain(tci.email_domain(me.contact_email)))
         or (tci.normalise_for_match(e.address) is not null
             and tci.normalise_for_match(e.address) = tci.normalise_for_match(me.address))
         or (tci.normalise_for_match(e.contact_person) is not null
             and tci.normalise_for_match(e.contact_person) = tci.normalise_for_match(me.contact_person))
         or (e.country_code = me.country_code
             and length(coalesce(e.registration_number, '')) >= 9
             and length(coalesce(me.registration_number, '')) >= 9
             and left(e.registration_number, 5) = left(me.registration_number, 5))
         or extensions.similarity(e.name, me.name) > 0.45
       )
  loop
    v_a := least(p_entity_id, v_row.id);
    v_b := greatest(p_entity_id, v_row.id);

    -- Already related, in either direction? Then there is nothing to suggest.
    if exists (
      select 1 from tci.entity_relationships r
       where tci.relationship_is_live(r.valid_from, r.valid_to)
         and ((r.parent_entity_id = v_a and r.child_entity_id = v_b)
           or (r.parent_entity_id = v_b and r.child_entity_id = v_a))
    ) then
      continue;
    end if;

    -- A human has already said no to this pair. Do not ask again.
    if exists (
      select 1 from tci.entity_relationship_suggestions
       where entity_a = v_a and entity_b = v_b and status = 'rejected'
    ) then
      continue;
    end if;

    v_signals := tci.relationship_signals(v_a, v_b);
    v_score := tci.relationship_signal_score(v_signals);
    if v_score < tci.suggestion_threshold() then
      continue;
    end if;

    insert into tci.entity_relationship_suggestions (entity_a, entity_b, signals, score)
    values (v_a, v_b, v_signals, v_score)
    on conflict (entity_a, entity_b) do update
      set signals = excluded.signals,
          score = excluded.score,
          updated_at = now()
      -- An accepted or rejected pair keeps its verdict; only open rows refresh.
      where tci.entity_relationship_suggestions.status = 'open';
    v_n := v_n + 1;
  end loop;

  -- Retire open suggestions for pairs that have since been related by hand.
  update tci.entity_relationship_suggestions s
     set status = 'accepted', reviewed_at = now(), updated_at = now()
   where s.status = 'open'
     and (s.entity_a = p_entity_id or s.entity_b = p_entity_id)
     and exists (
       select 1 from tci.entity_relationships r
        where tci.relationship_is_live(r.valid_from, r.valid_to)
          and ((r.parent_entity_id = s.entity_a and r.child_entity_id = s.entity_b)
            or (r.parent_entity_id = s.entity_b and r.child_entity_id = s.entity_a))
     );

  return v_n;
end;
$function$;

-- register_claim_document: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.register_claim_document(p_claim_id uuid, p_storage_path text, p_document_type tci.claim_document_type, p_filename text, p_size_bytes bigint, p_content_type text, p_note text DEFAULT NULL::text)
 RETURNS tci.claim_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row   tci.claim_documents%rowtype;
  v_allowed text[];
begin
  if not tci.may_upload_to_claim(p_claim_id) then
    raise exception 'not permitted to add documents to this claim' using errcode = '42501';
  end if;
  if tci.claim_id_from_storage_path(p_storage_path) is distinct from p_claim_id then
    raise exception 'a claim document must live under claims/%/', p_claim_id
      using errcode = 'P0001';
  end if;
  if coalesce(p_size_bytes, 0) <= 0 or p_size_bytes > 20971520 then
    raise exception 'a claim document must be between 1 byte and 20 MiB'
      using errcode = 'P0001';
  end if;

  select allowed_mime_types into v_allowed from storage.buckets where id = 'claim-documents';
  if p_content_type is null or not (p_content_type = any (v_allowed)) then
    raise exception 'this file type is not accepted for claim documents'
      using errcode = 'P0001';
  end if;
  -- The extension has to agree with the declared type's family. It is a weak
  -- check by construction - neither side is the bytes - but a .exe announced
  -- as application/pdf is worth refusing anyway.
  if p_filename !~* '\.(pdf|jpe?g|png|tiff?|webp|docx?|xlsx?|csv|txt)$' then
    raise exception 'this file extension is not accepted for claim documents'
      using errcode = 'P0001';
  end if;

  insert into tci.claim_documents (
    claim_id, storage_path, document_type, original_filename,
    size_bytes, content_type, note
  ) values (
    p_claim_id, p_storage_path, p_document_type, p_filename,
    p_size_bytes, p_content_type, p_note
  ) returning * into v_row;

  return v_row;
end;
$function$;

-- reject_buyer_proposal: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (staff, invoker)
create or replace function tci.reject_buyer_proposal(p_proposal_id uuid, p_reason text)
 RETURNS tci.client_buyer_proposals
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_proposal tci.client_buyer_proposals%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('admin', 'information_manager', 'sales', 'credit_underwriter') then
    raise exception 'not allowed to resolve buyer proposals' using errcode = '42501';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'a rejection needs a reason' using errcode = 'P0001';
  end if;

  update tci.client_buyer_proposals
     set status = 'rejected', reject_reason = btrim(p_reason),
         resolved_by = (select auth.uid()), resolved_at = now()
   where id = p_proposal_id and status = 'pending_entity'
   returning * into v_proposal;
  if not found then
    raise exception 'proposal % not found or already resolved', p_proposal_id
      using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'client.buyer_proposal_resolved', 'client_buyer_proposal', p_proposal_id,
    jsonb_build_object('rejected', true), null);

  return v_proposal;
end;
$function$;

-- reject_relationship_suggestion: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.reject_relationship_suggestion(p_suggestion_id uuid)
 RETURNS tci.entity_relationship_suggestions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_s tci.entity_relationship_suggestions%rowtype;
begin
  if not tci.may_edit_relationships() then
    raise exception 'not permitted to review corporate relationships' using errcode = '42501';
  end if;
  update tci.entity_relationship_suggestions
     set status = 'rejected', reviewed_by = (select auth.uid()),
         reviewed_at = now(), updated_at = now()
   where id = p_suggestion_id and status = 'open'
   returning * into v_s;
  if not found then
    raise exception 'suggestion not found or already reviewed' using errcode = 'P0002';
  end if;
  return v_s;
end;
$function$;

-- release_decision: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (staff, invoker)
create or replace function tci.release_decision(p_decision_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS tci.credit_limit_decisions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_row tci.credit_limit_decisions%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('admin', 'sales') then
    raise exception 'only sales may release a decision to the client' using errcode = '42501';
  end if;
  update tci.credit_limit_decisions
     set released_at = coalesce(released_at, now()),
         release_kind = coalesce(release_kind, 'sales_confirmed'),
         held = false,
         hold_comment = null
   where id = p_decision_id
   returning * into v_row;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'limit.released', 'credit_limit_decision', p_decision_id,
    jsonb_build_object('release_kind', v_row.release_kind, 'comment', p_comment),
    'client'::tci.user_role
  );
  return v_row;
end;
$function$;

-- resolve_buyer_proposal: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (staff, invoker)
create or replace function tci.resolve_buyer_proposal(p_proposal_id uuid, p_entity_id uuid DEFAULT NULL::uuid, p_new_name text DEFAULT NULL::text, p_new_country character DEFAULT NULL::bpchar, p_new_registration_number text DEFAULT NULL::text, p_new_legal_form text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_proposal tci.client_buyer_proposals%rowtype;
  v_entity_id uuid;
  v_request tci.credit_limit_requests%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('admin', 'information_manager', 'sales', 'credit_underwriter') then
    raise exception 'not allowed to resolve buyer proposals' using errcode = '42501';
  end if;

  select * into v_proposal from tci.client_buyer_proposals
   where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id using errcode = 'P0002';
  end if;
  if v_proposal.status <> 'pending_entity' then
    raise exception 'this proposal is already %', v_proposal.status using errcode = 'P0001';
  end if;

  if p_entity_id is not null then
    v_entity_id := p_entity_id;
    if not exists (select 1 from tci.legal_entities where id = v_entity_id) then
      raise exception 'company not found' using errcode = 'P0002';
    end if;
  else
    if coalesce(btrim(coalesce(p_new_name, '')), '') = '' then
      raise exception 'either pick a company or give the new one a name'
        using errcode = 'P0001';
    end if;
    insert into tci.legal_entities (name, country_code, registration_number, legal_form)
    values (btrim(p_new_name),
            coalesce(p_new_country, v_proposal.proposed_country_code, 'UZ'),
            nullif(btrim(coalesce(p_new_registration_number,
                                  v_proposal.proposed_registration_number, '')), ''),
            p_new_legal_form)
    returning id into v_entity_id;
  end if;

  if exists (
    select 1 from tci.credit_limit_requests r
     where tci.limit_scope(r.policy_id, r.insurance_request_id) = v_proposal.policy_id
       and r.entity_id = v_entity_id
       and r.status in ('draft', 'submitted', 'under_review', 'escalated')
  ) then
    raise exception 'there is already an open limit request for this buyer on that policy'
      using errcode = 'P0001';
  end if;

  insert into tci.credit_limit_requests (
    policy_id, entity_id, requested_amount, currency_code,
    requested_payment_terms_days, justification, status, submitted_at
  ) values (
    v_proposal.policy_id, v_entity_id, v_proposal.requested_amount,
    v_proposal.currency_code, v_proposal.requested_payment_terms_days,
    v_proposal.justification, 'submitted', now()
  ) returning * into v_request;

  update tci.client_buyer_proposals
     set status = 'resolved',
         resolved_entity_id = v_entity_id,
         resolved_request_id = v_request.id,
         resolved_by = (select auth.uid()),
         resolved_at = now()
   where id = p_proposal_id;

  -- Closes the information manager's task...
  perform tci.emit_workflow_event(
    'client.buyer_proposal_resolved', 'client_buyer_proposal', p_proposal_id,
    jsonb_build_object('entity_id', v_entity_id, 'request_id', v_request.id),
    'credit_underwriter'::tci.user_role);
  -- ...and opens credit underwriting's, exactly as any other request would.
  perform tci.emit_workflow_event(
    'limit.request_submitted', 'credit_limit_request', v_request.id,
    jsonb_build_object(
      'entity_id', v_entity_id,
      'amount', v_request.requested_amount,
      'currency', v_request.currency_code,
      'from_proposal', p_proposal_id),
    'credit_underwriter'::tci.user_role);

  return jsonb_build_object('entity_id', v_entity_id, 'request_id', v_request.id);
end;
$function$;

-- resolve_overdue_notification: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.resolve_overdue_notification(p_noa_id uuid, p_status tci.noa_status, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_noa tci.overdue_notifications%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.is_staff() then
    raise exception 'only staff may resolve an overdue notification' using errcode = '42501';
  end if;
  if p_status = 'open' then
    raise exception 'resolving means moving off open' using errcode = 'P0001';
  end if;

  select * into v_noa from tci.overdue_notifications where id = p_noa_id;
  if not found then
    raise exception 'notification not found' using errcode = 'P0002';
  end if;
  if v_noa.status <> 'open' then
    raise exception 'this notification is already %', v_noa.status using errcode = 'P0001';
  end if;

  update tci.overdue_notifications
     set status = p_status,
         resolution_note = p_note,
         resolved_at = now(),
         updated_at = now()
   where id = p_noa_id
   returning * into v_noa;

  -- Resolution does NOT reinstate the limit. The buyer paid this invoice; a
  -- credit underwriter still has to decide whether they are good for the next
  -- one, which is a fresh decision through the normal path.
  perform tci.emit_workflow_event(
    'noa.resolved', 'overdue_notification', v_noa.id,
    jsonb_build_object('policy_id', v_noa.policy_id, 'status', p_status, 'note', p_note),
    'credit_underwriter'::tci.user_role);

  return jsonb_build_object('result', 'resolved', 'noa_id', v_noa.id, 'status', p_status);
end;
$function$;

-- resolve_request_buyer: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (staff, invoker)
create or replace function tci.resolve_request_buyer(p_buyer_row_id uuid, p_entity_id uuid)
 RETURNS tci.insurance_request_buyers
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_row tci.insurance_request_buyers%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('admin', 'sales', 'information_manager', 'credit_underwriter') then
    raise exception 'not allowed to resolve submission buyers' using errcode = '42501';
  end if;

  update tci.insurance_request_buyers
     set entity_id = p_entity_id, resolution_status = 'ready'
   where id = p_buyer_row_id
   returning * into v_row;
  if not found then
    raise exception 'package buyer % not found or not accessible', p_buyer_row_id
      using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'request.buyer_resolved', 'insurance_request', v_row.request_id,
    jsonb_build_object('buyer_row_id', v_row.id, 'entity_id', p_entity_id),
    'credit_underwriter'::tci.user_role
  );
  return v_row;
end;
$function$;

-- revoke_effective_limit: 2 errcodes P0004 -> 42501/P0001/P0002
create or replace function tci.revoke_effective_limit(p_policy_id uuid, p_entity_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_effective tci.credit_limit_decisions%rowtype;
  v_new tci.credit_limit_decisions%rowtype;
  v_band tci.grade_band;
begin
  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may revoke' using errcode = '42501';
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

  -- The band of the limit being revoked decides which authority applies.
  v_band := tci.grade_band_for_assessment(v_effective.based_on_assessment_id);

  if not tci.has_role('admin')
     and tci.to_uzs(v_effective.approved_amount, v_effective.currency_code)
         > tci.my_authority_uzs(v_band) then
    raise exception 'revoking this limit exceeds your authority for grade band %', v_band
      using errcode = '42501';
  end if;

  update tci.credit_limit_decisions set lifecycle = 'revoked_lc' where id = v_effective.id;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, comment
  ) values (
    v_effective.request_id, 'revoked', 0, v_effective.currency_code, current_date, p_comment
  ) returning * into v_new;

  return jsonb_build_object('result', 'revoked', 'decision_id', v_new.id, 'grade_band', v_band);
end;
$function$;

-- save_claim_invoice: 1 errcode P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.save_claim_invoice(p_claim_id uuid, p_invoice_number text, p_invoice_date date, p_shipment_date date, p_due_date date, p_amount numeric, p_paid_amount numeric DEFAULT 0, p_disputed_amount numeric DEFAULT 0, p_note text DEFAULT NULL::text, p_invoice_id uuid DEFAULT NULL::uuid)
 RETURNS tci.claim_invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim tci.claims%rowtype;
  v_row   tci.claim_invoices%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.may_edit_claim_content(p_claim_id) then
    raise exception 'this claim can no longer be edited' using errcode = 'P0001';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id;

  if coalesce(trim(coalesce(p_invoice_number, '')), '') = '' then
    raise exception 'an invoice needs its number' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'an invoice needs a positive amount' using errcode = 'P0001';
  end if;
  if p_due_date < p_invoice_date then
    raise exception 'the due date cannot precede the invoice date' using errcode = 'P0001';
  end if;
  if coalesce(p_paid_amount, 0) + coalesce(p_disputed_amount, 0) > p_amount then
    raise exception 'paid and disputed amounts cannot exceed the invoice'
      using errcode = 'P0001';
  end if;

  if p_invoice_id is null then
    insert into tci.claim_invoices (
      claim_id, invoice_number, invoice_date, shipment_date, due_date,
      amount, currency_code, paid_amount, disputed_amount, note
    ) values (
      p_claim_id, trim(p_invoice_number), p_invoice_date, p_shipment_date, p_due_date,
      p_amount, v_claim.currency_code, coalesce(p_paid_amount, 0),
      coalesce(p_disputed_amount, 0), p_note
    ) returning * into v_row;
  else
    update tci.claim_invoices
       set invoice_number = trim(p_invoice_number),
           invoice_date = p_invoice_date,
           shipment_date = p_shipment_date,
           due_date = p_due_date,
           amount = p_amount,
           paid_amount = coalesce(p_paid_amount, 0),
           disputed_amount = coalesce(p_disputed_amount, 0),
           note = p_note,
           updated_at = now()
     where id = p_invoice_id and claim_id = p_claim_id
     returning * into v_row;
    if not found then
      raise exception 'invoice not found on this claim' using errcode = 'P0002';
    end if;
  end if;

  -- Keep the verdicts honest. Recomputation never touches an override, so
  -- doing it eagerly costs nothing and stops a stale verdict from reaching
  -- an assessment.
  if exists (select 1 from tci.claim_invoice_verdicts where claim_id = p_claim_id) then
    perform tci.verify_claim_coverage(p_claim_id);
  end if;

  return v_row;
end;
$function$;

-- save_entity_relationship: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.save_entity_relationship(p_parent_entity_id uuid, p_child_entity_id uuid, p_relationship_type tci.relationship_type, p_ownership_pct numeric DEFAULT NULL::numeric, p_valid_from date DEFAULT CURRENT_DATE, p_valid_to date DEFAULT NULL::date, p_source tci.relationship_source DEFAULT 'manual'::tci.relationship_source, p_source_note text DEFAULT NULL::text, p_relationship_id uuid DEFAULT NULL::uuid)
 RETURNS tci.entity_relationships
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row tci.entity_relationships%rowtype;
begin
  if not tci.may_edit_relationships() then
    raise exception 'not permitted to record corporate relationships' using errcode = '42501';
  end if;
  if p_parent_entity_id = p_child_entity_id then
    raise exception 'a company cannot be related to itself' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_parent_entity_id)
     or not exists (select 1 from tci.legal_entities where id = p_child_entity_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if p_ownership_pct is not null and p_relationship_type <> 'ownership' then
    raise exception 'an ownership percentage only means something on an ownership relationship'
      using errcode = 'P0001';
  end if;

  if p_relationship_id is null then
    insert into tci.entity_relationships (
      parent_entity_id, child_entity_id, relationship_type, ownership_pct,
      valid_from, valid_to, source, source_note
    ) values (
      p_parent_entity_id, p_child_entity_id, p_relationship_type, p_ownership_pct,
      coalesce(p_valid_from, current_date), p_valid_to, p_source, p_source_note
    ) returning * into v_row;
  else
    update tci.entity_relationships
       set relationship_type = p_relationship_type,
           ownership_pct = p_ownership_pct,
           valid_from = coalesce(p_valid_from, valid_from),
           valid_to = p_valid_to,
           source_note = p_source_note,
           updated_at = now()
     where id = p_relationship_id
     returning * into v_row;
    if not found then
      raise exception 'relationship not found' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$function$;

-- set_group_limit: 2 errcodes P0004 -> 42501/P0001/P0002; sets the internal-call token (trusted, definer)
create or replace function tci.set_group_limit(p_ultimate_parent_id uuid, p_max_amount numeric, p_currency character, p_valid_from date DEFAULT CURRENT_DATE, p_comment text DEFAULT NULL::text)
 RETURNS tci.group_limits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row  tci.group_limits%rowtype;
  v_band tci.grade_band;
  v_assessment uuid;
  v_amount_uzs numeric;
  v_authority  numeric;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may set a group limit' using errcode = '42501';
  end if;
  if coalesce(p_max_amount, 0) <= 0 then
    raise exception 'a group limit needs a positive amount' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_ultimate_parent_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  if not tci.has_role('admin') then
    select a.id into v_assessment
      from tci.credit_assessments a
     where a.entity_id = p_ultimate_parent_id
     order by a.created_at desc limit 1;
    v_band := tci.grade_band_for_assessment(v_assessment);
    v_amount_uzs := tci.to_uzs(p_max_amount, p_currency);
    v_authority := tci.my_authority_uzs(v_band);
    if v_amount_uzs > v_authority then
      raise exception 'a group limit of % exceeds your authority for grade band % (% > %)',
        p_max_amount, v_band, v_amount_uzs, v_authority using errcode = '42501';
    end if;
  end if;

  -- Close the standing limit rather than editing it.
  update tci.group_limits
     set valid_to = greatest(coalesce(p_valid_from, current_date) - 1, valid_from - 1)
   where ultimate_parent_entity_id = p_ultimate_parent_id
     and valid_to is null;

  insert into tci.group_limits (
    ultimate_parent_entity_id, max_amount, currency_code, valid_from, comment
  ) values (
    p_ultimate_parent_id, p_max_amount, p_currency,
    coalesce(p_valid_from, current_date), p_comment
  ) returning * into v_row;

  perform tci.emit_workflow_event(
    'group.limit_set', 'legal_entity', p_ultimate_parent_id,
    jsonb_build_object('amount', p_max_amount, 'currency', p_currency,
                       'group_limit_id', v_row.id),
    'credit_underwriter'::tci.user_role);

  return v_row;
end;
$function$;

-- submit_declaration: sets the internal-call token (trusted, definer); gate: perform tci.require_staff_or_internal();
create or replace function tci.submit_declaration(p_declaration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dec tci.declarations%rowtype;
  v_lines int;
begin
  perform tci.require_staff_or_internal();
  perform tci.begin_trusted_call();
  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;

  if not tci.declaration_transition_allowed(v_dec.status, 'submitted') then
    raise exception 'a declaration cannot go from % to submitted', v_dec.status
      using errcode = 'P0001';
  end if;

  select count(*) into v_lines
    from tci.declaration_lines where declaration_id = p_declaration_id;
  if v_lines = 0 then
    raise exception 'a declaration cannot be submitted with no lines'
      using errcode = 'P0001';
  end if;

  update tci.declarations
     set status = 'submitted',
         submitted_by = coalesce(submitted_by, (select auth.uid())),
         submitted_at = now(),
         updated_at = now()
   where id = p_declaration_id
   returning * into v_dec;

  perform tci.emit_workflow_event(
    'declaration.submitted', 'declaration', v_dec.id,
    jsonb_build_object(
      'policy_id', v_dec.policy_id,
      'period_start', v_dec.period_start,
      'period_end', v_dec.period_end,
      'total', v_dec.total_insurable_turnover),
    'commercial_underwriter'::tci.user_role);

  return jsonb_build_object('result', 'submitted', 'declaration_id', v_dec.id);
end;
$function$;

-- submit_limit_request: sets the internal-call token (staff, invoker)
create or replace function tci.submit_limit_request(p_request_id uuid)
 RETURNS tci.credit_limit_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request tci.credit_limit_requests%rowtype;
  v_policy_status tci.policy_status;
  v_request_status tci.insurance_request_status;
begin
  perform tci.begin_internal_call();
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'only draft requests can be submitted (current: %)', v_request.status
      using errcode = 'P0001';
  end if;

  if v_request.policy_id is not null then
    select status into v_policy_status from tci.policies where id = v_request.policy_id;
    if v_policy_status is distinct from 'active' then
      raise exception 'policy is not active (current: %) - limit requests bind to active policies',
        v_policy_status using errcode = 'P0001';
    end if;
  else
    select status into v_request_status
      from tci.insurance_requests where id = v_request.insurance_request_id;
    if v_request_status is null then
      raise exception 'limit request % belongs to no policy and no submission', p_request_id
        using errcode = 'P0001';
    end if;
    if v_request_status in ('declined', 'withdrawn', 'bound') then
      raise exception 'submission is % - it can no longer take limit requests', v_request_status
        using errcode = 'P0001';
    end if;
  end if;

  update tci.credit_limit_requests
     set status = 'submitted', submitted_at = now()
   where id = p_request_id
   returning * into v_request;

  -- NEW in 0024: the Agenda's signal that a decision is owed.
  perform tci.emit_workflow_event(
    'limit.request_submitted', 'credit_limit_request', p_request_id,
    jsonb_build_object(
      'entity_id', v_request.entity_id,
      'amount', v_request.requested_amount,
      'currency', v_request.currency_code),
    'credit_underwriter'::tci.user_role);

  return v_request;
end;
$function$;

-- suspend_limit_for_claim: gate: perform tci.require_internal_call();
create or replace function tci.suspend_limit_for_claim(p_claim_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim    tci.claims%rowtype;
  v_limit    record;
  v_decision tci.credit_limit_decisions%rowtype;
begin
  perform tci.require_internal_call();
  select * into v_claim from tci.claims where id = p_claim_id;

  select * into v_limit
    from tci.v_effective_limits v
   where v.policy_id = v_claim.policy_id
     and v.entity_id = v_claim.entity_id
     and v.outcome in ('approved', 'partial')
   limit 1;
  -- Already suspended (usually by the NOA that preceded this claim), or the
  -- buyer traded on the discretionary limit. Nothing to do, not an error.
  if not found then
    return null;
  end if;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code,
    valid_from, comment, decided_by, system_generated, system_reason_key, stage
  ) values (
    v_limit.request_id, 'revoked', 0, v_limit.currency_code,
    current_date, null, null, true, 'limits.systemReason.claimApproved', 'credit'
  ) returning * into v_decision;

  -- Supersede the prior effective decisions for the scope, exactly as
  -- tci.decide_limit_request and tci.suspend_limit_for_noa do. Without it
  -- v_effective_limits keeps serving the old limit as live.
  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r, tci.credit_limit_requests nr
   where r.id = d.request_id
     and nr.id = v_decision.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(nr.policy_id, nr.insurance_request_id)
     and r.entity_id = nr.entity_id;

  return v_decision.id;
end;
$function$;

-- suspend_limit_for_noa: gate: perform tci.require_internal_call();
create or replace function tci.suspend_limit_for_noa(p_noa_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_noa      tci.overdue_notifications%rowtype;
  v_limit    record;
  v_decision tci.credit_limit_decisions%rowtype;
begin
  perform tci.require_internal_call();
  select * into v_noa from tci.overdue_notifications where id = p_noa_id;
  if not found then
    raise exception 'notification not found' using errcode = 'P0002';
  end if;

  select * into v_limit
    from tci.v_effective_limits v
   where v.policy_id = v_noa.policy_id
     and v.entity_id = v_noa.entity_id
     and v.outcome in ('approved', 'partial')
   limit 1;

  -- Nothing to suspend: the buyer was trading on the discretionary limit, or
  -- the limit was already revoked. Not an error - most NOAs on small buyers
  -- land here - so the filing stands and simply records no suspension.
  if not found then
    return null;
  end if;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code,
    valid_from, comment, decided_by, system_generated, system_reason_key, stage
  ) values (
    v_limit.request_id, 'revoked', 0, v_limit.currency_code,
    current_date, null, null, true, 'limits.systemReason.noaSuspension', 'credit'
  ) returning * into v_decision;

  -- Supersede the prior effective decisions for this buyer in this scope, the
  -- same way tci.decide_limit_request does. Without it the old decision stays
  -- 'effective' and v_effective_limits, which ranks a COMMERCIAL stage row
  -- above a credit one, would keep serving a commercially adjusted limit as
  -- live - so the suspension would be invisible exactly where it matters.
  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r,
         tci.credit_limit_requests nr
   where r.id = d.request_id
     and nr.id = v_decision.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(nr.policy_id, nr.insurance_request_id)
     and r.entity_id = nr.entity_id;

  update tci.overdue_notifications
     set suspension_decision_id = v_decision.id, updated_at = now()
   where id = p_noa_id;

  return v_decision.id;
end;
$function$;

-- verify_claim_coverage: sets the internal-call token (trusted, definer); gate: perform tci.require_staff_or_internal();
create or replace function tci.verify_claim_coverage(p_claim_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim   tci.claims%rowtype;
  v_policy  tci.policies%rowtype;
  v_noa     record;
  v_inv     record;
  v_lim     record;
  v_balance numeric(18,2) := 0;      -- cumulative claimable debt before this invoice
  v_cap     numeric(18,2);           -- the ceiling that applies to this invoice
  v_headroom numeric(18,2);
  v_covered numeric(18,2);
  v_reasons tci.coverage_reason[];
  v_verdict tci.coverage_verdict;
  v_detail  jsonb;
  v_basis   text;
  v_noa_late boolean := false;
  v_noa_missing boolean := false;
begin
  perform tci.require_staff_or_internal();
  perform tci.begin_trusted_call();
  select * into v_claim from tci.claims where id = p_claim_id;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  select * into v_policy from tci.policies where id = v_claim.policy_id;

  -- Reporting duty, judged once for the whole claim and stamped on every line
  -- so a verdict is readable on its own.
  if v_claim.overdue_notification_id is null then
    v_noa_missing := (v_claim.cause_of_loss = 'protracted_default');
  else
    select reported_late into v_noa_late
      from tci.v_overdue_notifications where id = v_claim.overdue_notification_id;
    v_noa_late := coalesce(v_noa_late, false);
  end if;

  for v_inv in
    select * from tci.claim_invoices
     where claim_id = p_claim_id
     order by shipment_date, due_date, invoice_number
  loop
    v_reasons := '{}';
    v_basis   := null;
    v_covered := 0;
    v_cap     := null;

    select * into v_lim
      from tci.limit_in_force_at(v_claim.policy_id, v_claim.entity_id, v_inv.shipment_date);

    if coalesce(v_inv.claimable_amount, 0) <= 0 then
      v_reasons := v_reasons || 'nothing_outstanding'::tci.coverage_reason;
    else
      -- Which ceiling applies, and is there a ceiling at all?
      if v_lim.decision_id is null then
        v_basis := 'discretionary';
        v_cap   := coalesce(v_policy.discretionary_limit, 0);
      elsif v_lim.outcome = 'revoked' then
        v_reasons := v_reasons || 'limit_revoked'::tci.coverage_reason;
        v_basis := 'none'; v_cap := 0;
      elsif v_lim.outcome = 'declined' then
        v_reasons := v_reasons || 'limit_declined'::tci.coverage_reason;
        -- A refused buyer falls back to the discretionary limit only if the
        -- policyholder could still have self-assessed - they could not, they
        -- had been told no. Cover stops.
        v_basis := 'none'; v_cap := 0;
      elsif not v_lim.within_validity then
        if v_inv.shipment_date < v_lim.valid_from then
          v_reasons := v_reasons || 'limit_not_yet_valid'::tci.coverage_reason;
        else
          v_reasons := v_reasons || 'limit_expired'::tci.coverage_reason;
        end if;
        -- An expired limit leaves the buyer where an unassessed buyer stands.
        v_basis := 'discretionary';
        v_cap   := coalesce(v_policy.discretionary_limit, 0);
      else
        v_basis := 'limit';
        v_cap   := coalesce(v_lim.approved_amount, 0);
      end if;

      v_headroom := greatest(v_cap - v_balance, 0);
      v_covered  := least(v_inv.claimable_amount, v_headroom);

      if v_basis = 'limit' then
        if v_covered >= v_inv.claimable_amount then
          v_reasons := v_reasons || 'covered_by_limit'::tci.coverage_reason;
        else
          v_reasons := v_reasons || 'limit_exceeded'::tci.coverage_reason;
        end if;
      elsif v_basis = 'discretionary' then
        if v_cap <= 0 then
          v_reasons := v_reasons || 'no_limit_in_force'::tci.coverage_reason;
        elsif v_covered >= v_inv.claimable_amount then
          v_reasons := v_reasons || 'covered_by_dl'::tci.coverage_reason;
        else
          v_reasons := v_reasons || 'dl_exceeded'::tci.coverage_reason;
        end if;
      end if;

      -- Hard policy conditions. Each of these takes cover away entirely: they
      -- are breaches of the contract, not shortfalls of amount.
      if v_inv.payment_terms_days > v_policy.max_payment_terms_days then
        v_reasons := v_reasons || 'payment_terms_exceeded'::tci.coverage_reason;
        v_covered := 0;
      end if;
      if v_inv.shipment_date < v_policy.inception_date then
        v_reasons := v_reasons || 'shipment_before_inception'::tci.coverage_reason;
        v_covered := 0;
      end if;
      if v_inv.shipment_date > v_policy.expiry_date then
        v_reasons := v_reasons || 'shipment_after_expiry'::tci.coverage_reason;
        v_covered := 0;
      end if;
    end if;

    -- Reporting duty. Flagged on every line, and prejudicial: an unreported or
    -- late-reported overdue account is a breach of the notification condition.
    if v_noa_missing then
      v_reasons := v_reasons || 'noa_missing'::tci.coverage_reason;
      v_covered := 0;
    elsif v_noa_late then
      v_reasons := v_reasons || 'noa_late'::tci.coverage_reason;
      v_covered := 0;
    end if;

    v_verdict := case
      when v_covered <= 0 then 'not_covered'::tci.coverage_verdict
      when v_covered >= v_inv.claimable_amount then 'covered'::tci.coverage_verdict
      else 'partial'::tci.coverage_verdict
    end;

    v_detail := jsonb_build_object(
      'basis', v_basis,
      'cap', v_cap,
      'balance_before', v_balance,
      'headroom', v_headroom,
      'claimable_amount', v_inv.claimable_amount,
      'payment_terms_days', v_inv.payment_terms_days,
      'max_payment_terms_days', v_policy.max_payment_terms_days,
      'shipment_date', v_inv.shipment_date,
      'policy_inception', v_policy.inception_date,
      'policy_expiry', v_policy.expiry_date,
      'discretionary_limit', v_policy.discretionary_limit,
      'decision_id', v_lim.decision_id,
      'decision_outcome', v_lim.outcome,
      'decision_amount', v_lim.approved_amount,
      'decision_effective_from', v_lim.effective_from,
      'decision_valid_from', v_lim.valid_from,
      'decision_valid_until', v_lim.valid_until,
      'decision_system_generated', v_lim.system_generated,
      'decision_system_reason_key', v_lim.system_reason_key);

    insert into tci.claim_invoice_verdicts as v (
      claim_invoice_id, claim_id, system_verdict, system_covered_amount,
      system_reasons, system_detail, computed_at
    ) values (
      v_inv.id, p_claim_id, v_verdict, v_covered, v_reasons, v_detail, now()
    )
    on conflict (claim_invoice_id) do update
      set system_verdict = excluded.system_verdict,
          system_covered_amount = excluded.system_covered_amount,
          system_reasons = excluded.system_reasons,
          system_detail = excluded.system_detail,
          computed_at = excluded.computed_at;
          -- The override columns are deliberately absent from this list.

    -- The balance is the DEBT, not the covered part: an uninsured shipment
    -- still fills the buyer's limit.
    v_balance := v_balance + greatest(coalesce(v_inv.claimable_amount, 0), 0);
  end loop;

  -- Verdicts for invoices that have since been deleted have no meaning.
  delete from tci.claim_invoice_verdicts v
   where v.claim_id = p_claim_id
     and not exists (select 1 from tci.claim_invoices i where i.id = v.claim_invoice_id);
end;
$function$;

-- withdraw_limit_request: 1 errcode P0004 -> 42501/P0001/P0002
create or replace function tci.withdraw_limit_request(p_request_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS tci.credit_limit_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      using errcode = '42501';
  end if;

  update tci.credit_limit_requests
     set status = 'withdrawn', withdrawn_at = now(), withdraw_comment = p_comment
   where id = p_request_id
   returning * into v_request;
  return v_request;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Residual PUBLIC grants, search_path
-- ---------------------------------------------------------------------------
-- 0039 left relationship_signals PUBLIC-executable and 0042 closed it; the
-- same default grant sat on every Phase 4 function and every trigger
-- function. The schema USAGE grant was the only thing keeping anon out.
--
-- For most of these the PUBLIC grant was the ONLY grant, so revoking it
-- alone would take `authenticated` (and service_role) with it — and three
-- security_invoker views (v_claims, v_claim_position, v_policy_liability)
-- call claim_eligible_from / claim_covered_totals / policy_*_consumed as
-- the querying user, which would then fail with "permission denied for
-- function" on every claims screen. The reach of `authenticated` is
-- therefore restated EXPLICITLY before PUBLIC is revoked: the gate inside
-- each function is what protects it now, the grant is not the control.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tci' and p.prosecdef
       and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end;
$$;

alter function tci.set_updated_at() set search_path = '';

-- ---------------------------------------------------------------------------
-- 6. The allow-list, and the assertions that keep this true
-- ---------------------------------------------------------------------------
-- A SECURITY DEFINER function executable by `authenticated` may skip a gate
-- only if it is listed here WITH its reason. tests/db/definer_gates.sql and
-- src/lib/securityContract.test.ts read this list.
create function tci.definer_gate_allowlist()
returns table (proname text, justification text)
language sql
immutable
parallel safe
set search_path = ''
as $$
  values
    ('has_role',                 'reads only the caller''s own tci.user_roles rows; it IS the gate'),
    ('is_staff',                 'reads only the caller''s own tci.user_roles rows; it IS the gate'),
    ('current_user_roles',       'returns only the caller''s own roles'),
    ('password_rotation_pending','reads only the caller''s own profile flag; part of the gate'),
    ('complete_password_change', 'writes only the caller''s own profile row, keyed by auth.uid()'),
    ('sales_window_hours',       'one non-sensitive workflow_settings number, needed by views a client reads'),
    ('group_depth_cap',          'one non-sensitive workflow_settings number'),
    ('group_exposure_warn_pct',  'one non-sensitive workflow_settings number'),
    ('decision_is_released',     'pure computation over its arguments and the sales window; no table read'),
    ('begin_internal_call',      'is itself gated on is_staff(); the token it sets dies with the transaction'),
    ('require_staff',            'a gate: only raises'),
    ('require_role',             'a gate: only raises'),
    ('require_claim_access',     'a gate: only raises')
$$;
grant execute on function tci.definer_gate_allowlist() to authenticated, service_role;

do $$
declare v_bad text; v_n int;
begin
  -- (a) every SECURITY DEFINER function executable by authenticated is gated,
  --     a trigger (Postgres refuses to call those directly), or allow-listed.
  select string_agg(p.proname, ', ' order by p.proname), count(*)
    into v_bad, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.prorettype <> 'trigger'::regtype
     and p.prosrc !~* 'tci\.require_(staff|role|claim_access|staff_or_internal|internal_call)\(|tci\.has_role\(|tci\.is_staff\(|tci\.may_edit_relationships\(|tci\.may_access_claim\(|tci\.may_upload_to_claim\(|tci\.may_edit_claim_content\(|tci\.client_policy_guard\(|tci\.my_client_entities\('
     and p.proname not in (select proname from tci.definer_gate_allowlist());
  if v_n > 0 then
    raise exception '0043: ungated SECURITY DEFINER functions executable by authenticated: %', v_bad;
  end if;

  -- (b) no SECURITY DEFINER function is executable by anon.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0043: anon-executable SECURITY DEFINER functions remain: %', v_bad;
  end if;

  -- (c) no function raises P0004 any more.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosrc like '%''P0004''%';
  if v_bad is not null then
    raise exception '0043: P0004 still raised by: %', v_bad;
  end if;

  -- (d) the token machinery is closed to the API roles.
  if has_function_privilege('authenticated', 'tci.begin_trusted_call()', 'execute')
     or has_function_privilege('authenticated', 'tci.internal_call_token()', 'execute')
     or has_table_privilege('authenticated', 'tci.internal_secrets', 'select') then
    raise exception '0043: the internal-call token is reachable by authenticated';
  end if;

  -- (e) every allow-listed name exists and is still SECURITY DEFINER (a stale
  --     entry would be a silent hole the next time someone renames a function).
  select string_agg(a.proname, ', ') into v_bad
    from tci.definer_gate_allowlist() a
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'tci' and p.proname = a.proname and p.prosecdef);
  if v_bad is not null then
    raise exception '0043: allow-list names a function that is not a SECURITY DEFINER function: %', v_bad;
  end if;
end;
$$;
