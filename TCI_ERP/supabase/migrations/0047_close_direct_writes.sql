-- What: close the direct REST writes that walked around the workflow
--       functions. (1) Tables whose every writer is a SECURITY DEFINER
--       function lose INSERT/UPDATE/DELETE for `authenticated`: claims and
--       their money (payments, recoveries, verdicts, invoices, documents,
--       status history), group limits, relationships and suggestions,
--       overdue notifications, workflow events and settings. (2) Tables
--       written by SECURITY INVOKER workflow functions - limit decisions,
--       decision conditions, policy and submission history - get a guard
--       trigger: an API role may write them only inside a transaction marked
--       by tci.begin_internal_call(), i.e. from inside those functions.
--       (3) A policy's status changes only through change_policy_status, and
--       a policy is created as a draft.
-- Why:  the 2026-10 review found that the authority, escalation, group-cap,
--       NQL, payment-cap and immutability rules enforced by the functions
--       could be skipped with a raw PATCH/POST: a credit underwriter could
--       insert a released decision of any amount, sales could reinstate a
--       revoked limit or backdate released_at, claims staff could set
--       approved_indemnity or insert payments past the cap. The functions
--       were the rule; the grants were the hole.
--
-- How the guard tells trusted code from a REST call: inside a SECURITY
-- DEFINER function current_user is the owner, so the guard only checks API
-- roles (authenticated, anon); for those it requires the per-transaction
-- internal-call token of 0043 (tci.internal_call_ok()), which a REST caller
-- cannot forge and which only begin_internal_call() / begin_trusted_call()
-- set. Every SECURITY INVOKER writer of a guarded table calls
-- begin_internal_call() before writing - two did not and are restated here.

-- ---------------------------------------------------------------------------
-- 1. The gate the guard calls
-- ---------------------------------------------------------------------------
create function tci.require_trusted_write()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not tci.internal_call_ok() then
    raise exception 'this table is written only through its workflow functions'
      using errcode = '42501';
  end if;
end;
$$;
comment on function tci.require_trusted_write() is
  'Raises 42501 unless the transaction carries the internal-call token. A gate: only raises.';
revoke execute on function tci.require_trusted_write() from public, anon;
grant execute on function tci.require_trusted_write() to authenticated, service_role;

create function tci.guard_workflow_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Owner code (SECURITY DEFINER writers, migrations, service_role) passes;
  -- an API role passes only from inside a trusted workflow function.
  if current_user in ('authenticated', 'anon') then
    perform tci.require_trusted_write();
  end if;
  return coalesce(new, old);
end;
$$;

-- Trigger functions are not called through the API; no role needs EXECUTE.
revoke execute on function tci.guard_workflow_write() from public, anon, authenticated;

create trigger guard_workflow_write before insert or update or delete on tci.credit_limit_decisions
  for each row execute function tci.guard_workflow_write();
create trigger guard_workflow_write before insert or update or delete on tci.decision_conditions
  for each row execute function tci.guard_workflow_write();
create trigger guard_workflow_write before insert or update or delete on tci.policy_status_history
  for each row execute function tci.guard_workflow_write();
create trigger guard_workflow_write before insert or update or delete on tci.insurance_request_history
  for each row execute function tci.guard_workflow_write();

-- A policy's status is the status machine's: terms are edited directly,
-- the status never is, and a new policy starts as a draft.
create function tci.guard_policy_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.status <> 'draft' then
      perform tci.require_trusted_write();
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      perform tci.require_trusted_write();
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function tci.guard_policy_status() from public, anon, authenticated;
create trigger guard_policy_status before insert or update on tci.policies
  for each row execute function tci.guard_policy_status();

-- ---------------------------------------------------------------------------
-- 2. The two INVOKER writers that did not mark the transaction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tci.change_policy_status(p_policy_id uuid, p_to_status tci.policy_status, p_comment text DEFAULT NULL::text)
 RETURNS tci.policies
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_policy tci.policies%rowtype;
  v_from   tci.policy_status;
begin
  -- 0047: the status machine is the only path to a status change; it marks
  -- the transaction so the guard triggers let its writes through.
  perform tci.begin_internal_call();
  select * into v_policy from tci.policies where id = p_policy_id for update;
  if not found then
    raise exception 'policy % not found or not accessible', p_policy_id
      using errcode = 'P0002';
  end if;

  if not (
    (v_policy.status = 'draft'     and p_to_status = 'active')
    or (v_policy.status = 'active'    and p_to_status in ('suspended', 'cancelled', 'expired', 'annulled'))
    or (v_policy.status = 'suspended' and p_to_status in ('active', 'cancelled', 'annulled'))
  ) then
    raise exception 'invalid policy status transition: % -> %', v_policy.status, p_to_status
      using errcode = 'P0001';
  end if;

  if p_to_status = 'annulled' and (p_comment is null or btrim(p_comment) = '') then
    raise exception 'annulment requires a comment (reason for voiding the policy)'
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
$function$
;


CREATE OR REPLACE FUNCTION tci.revoke_effective_limit(p_policy_id uuid, p_entity_id uuid, p_comment text DEFAULT NULL::text)
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
  -- 0047: mark the transaction trusted for the guard on credit_limit_decisions.
  perform tci.begin_internal_call();

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
$function$
;


-- ---------------------------------------------------------------------------
-- 3. No direct writes where every writer is a SECURITY DEFINER function
-- ---------------------------------------------------------------------------
-- The write POLICIES stay (they are inert without the grant and document the
-- original intent); the GRANT is what PostgREST checks first.
revoke insert, update, delete on
  tci.claims, tci.claim_payments, tci.recoveries, tci.claim_invoice_verdicts,
  tci.claim_invoices, tci.claim_documents, tci.claim_status_history,
  tci.group_limits, tci.entity_relationships, tci.entity_relationship_suggestions,
  tci.overdue_notifications, tci.workflow_events, tci.workflow_settings
from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. The allow-list gains the new gate
-- ---------------------------------------------------------------------------
create or replace function tci.definer_gate_allowlist()
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
    ('require_claim_access',     'a gate: only raises'),
    ('auth_policy',              'non-sensitive policy numbers the UI mirrors to explain a refusal'),
    ('mfa_satisfied',            'reads only the caller''s own factors, roles and JWT claims; part of the gate'),
    ('my_auth_status',           'reads only the caller''s own rotation, MFA and lockout state'),
    ('login_begin',              'pre-sign-in entry point: salted hashes only, names no account (see pre_auth_entry_points)'),
    ('my_sign_in_notice',        'reads only the caller''s own sign-in attempts, keyed by auth.uid()'),
    ('require_trusted_write',    'a gate: only raises (the guard on workflow-written tables)')
$$;

-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  -- authenticated writes directly only the tables the application edits
  -- (forms, spreading, admin reference data) and the guarded ones.
  select string_agg(distinct g.table_name, ', ') into v_bad
    from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name and c.relnamespace = 'tci'::regnamespace and c.relkind = 'r'
   where g.grantee in ('authenticated', 'anon') and g.table_schema = 'tci'
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
     and g.table_name not in (
       -- edited by the application directly (RLS decides the rows)
       'authority_grants', 'balance_sheets', 'credit_assessments', 'credit_limit_requests',
       'declaration_lines', 'declarations', 'financial_statements', 'fx_rates', 'income_statements',
       'insurance_request_buyers', 'insurance_requests', 'legal_entities', 'local_statement_values',
       'policies', 'premium_instalments', 'user_roles',
       -- admin reference data and mappings
       'countries', 'currencies', 'industries', 'ifrs_mappings', 'statement_templates',
       'statement_template_lines', 'policyholder_users', 'client_buyer_proposals',
       -- written by INVOKER workflow functions, behind guard_workflow_write
       'credit_limit_decisions', 'decision_conditions', 'policy_status_history', 'insurance_request_history');
  if v_bad is not null then
    raise exception '0047: authenticated can write workflow tables directly: %', v_bad;
  end if;

  -- anon still executes nothing in tci but the pre-auth entry points
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select proname from tci.pre_auth_entry_points());
  if v_bad is not null then
    raise exception '0047: anon can execute: %', v_bad;
  end if;

  -- every guarded table carries the guard
  select string_agg(t, ', ') into v_bad
    from unnest(array['credit_limit_decisions', 'decision_conditions', 'policy_status_history',
                      'insurance_request_history']) t
   where not exists (select 1 from pg_trigger tg
                      where tg.tgrelid = ('tci.' || t)::regclass and tg.tgname = 'guard_workflow_write');
  if v_bad is not null then
    raise exception '0047: guard missing on: %', v_bad;
  end if;

  -- every INVOKER function that writes a guarded table marks the transaction
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and not p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+tci\.(credit_limit_decisions|decision_conditions|policy_status_history|insurance_request_history)\M'
     and p.prosrc !~ 'begin_internal_call\(\)';
  if v_bad is not null then
    raise exception '0047: invoker writers of guarded tables that do not mark the transaction: %', v_bad;
  end if;
end;
$$;
