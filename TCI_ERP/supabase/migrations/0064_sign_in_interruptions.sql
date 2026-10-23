-- 0064_sign_in_interruptions.sql
--
-- What: A sign-in attempt that never reached the password check — refused by
--       the CAPTCHA, by GoTrue's rate limit, or lost to the network — is
--       labelled as INTERRUPTED and no longer shown as a wrong password in
--       the after-sign-in notice; it is listed separately.
--       (1) tci.login_begin hands the browser an unguessable ticket token
--           (stored only as a salted hash) with every attempt it records.
--       (2) tci.login_interrupted(ticket, reason) — a second pre-sign-in
--           entry point — labels THAT attempt, and only while it is still
--           pending and inside its 90 seconds. One label per attempt.
--       (3) tci.my_counted_failures excludes labelled attempts;
--           tci.my_interrupted_sign_ins lists them; tci.my_sign_in_notice
--           counts them separately.
-- Why:  The owner's question (2026-10-23): "captcha / rate-limit / network
--       errors are not counted as password failures". Without the Teams-plan
--       verification hook the server cannot see why GoTrue refused, so
--       before this migration such an attempt looked exactly like a wrong
--       password.
--
-- Deliberately NOT changed: the THROTTLE (tci.login_locked_until) still
-- counts a labelled attempt. The label is the browser's word, which the
-- server cannot check; if it lowered the throttle, anyone could guess a
-- password and then report "network error" to reset their allowance. The
-- label only changes what the notice calls the attempt — it never hides it:
-- an attempt someone labelled is still shown, in its own list.

-- ---------------------------------------------------------------------------
-- 1. Ticket and label on the attempt
-- ---------------------------------------------------------------------------

alter table tci.login_attempts
  add column ticket_hash        text,
  add column interrupted_reason text
    constraint login_attempts_interrupted_reason_check
    check (interrupted_reason in ('captcha', 'rate_limited', 'network')),
  add column interrupted_at     timestamptz;

create unique index login_attempts_ticket_uq on tci.login_attempts (ticket_hash)
  where ticket_hash is not null;

comment on column tci.login_attempts.ticket_hash is
  'tci.security_hash of the ticket token tci.login_begin returned to the browser (0064). The token itself is never stored.';
comment on column tci.login_attempts.interrupted_reason is
  'Set by tci.login_interrupted when the browser reports that the attempt never reached the password check (captcha, rate_limited, network). The browser''s word: the notice lists it apart; the throttle still counts it.';

-- ---------------------------------------------------------------------------
-- 2. login_begin hands out the ticket (definition as of 0046, changed only
--    where marked 0064)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.login_begin(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_hash     text;
  v_ip       text := tci.request_ip_hash();
  v_until    timestamptz;
  v_user     uuid;
  v_lock     tci.auth_lockouts%rowtype;
  v_failures integer;
  -- 0064: 244 random bits from two v4 UUIDs (no extension needed).
  v_ticket   text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  -- No gate: this runs BEFORE anyone is signed in, and it reveals nothing
  -- about any account (see the header). Malformed input is refused plainly.
  if length(v_email) = 0 or length(v_email) > 320 or position('@' in v_email) = 0 then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  v_hash := tci.login_email_hash(v_email);

  -- An account-level lockout (admin view, bypass) stands for every IP. The
  -- answer has the same shape as the counters' answer: no account is named.
  select id into v_user from auth.users where lower(email) = v_email limit 1;
  if v_user is not null then
    v_lock := tci.active_lockout(v_user);
    if v_lock.user_id is not null then
      return jsonb_build_object('allowed', false,
        'retry_after_seconds', least(3600, greatest(1, ceil(extract(epoch from (v_lock.locked_until - now())))))::int);
    end if;
  end if;

  v_until := tci.login_locked_until(v_hash, v_ip);
  if v_until is not null then
    return jsonb_build_object('allowed', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_until - clock_timestamp()))))::int);
  end if;

  select count(*) into v_failures from tci.login_attempts
   where email_hash = v_hash and ip_hash is not distinct from v_ip
     and status = 'pending' and at > now() - interval '24 hours';

  insert into tci.login_attempts (email_hash, ip_hash, expires_at, ip_masked, user_agent, ticket_hash)
  values (v_hash, v_ip, clock_timestamp() + interval '90 seconds',
          tci.request_ip_masked(), tci.request_user_agent(), tci.security_hash(v_ticket));

  -- The attempt now counts. If, should it fail, the wait reaches 15 minutes,
  -- an administrator should see it: write the account lockout up front.
  if v_user is not null then
    v_until := tci.login_locked_until(v_hash, v_ip);
    if v_until is not null and v_until - clock_timestamp() >= interval '15 minutes' then
      insert into tci.auth_lockouts (user_id, subject_hash, locked_at, locked_until, failures, reason)
      values (v_user, tci.security_hash(v_user::text), now(), v_until, v_failures + 1, 'failures')
      on conflict (user_id) do update
        set locked_at = excluded.locked_at, locked_until = excluded.locked_until,
            failures = excluded.failures, reason = 'failures', cleared_at = null, cleared_by = null
        where tci.auth_lockouts.cleared_at is not null or tci.auth_lockouts.locked_until <= now();
      perform tci.log_auth_event('lockout.started', v_user, null,
        jsonb_build_object('failures', v_failures + 1, 'locked_until', v_until), v_ip);
    end if;
  end if;

  -- 0064: the ticket lets this browser, and only it, label the attempt.
  return jsonb_build_object('allowed', true, 'failures', v_failures, 'ticket', v_ticket);
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 3. The label
-- ---------------------------------------------------------------------------

-- Labels the attempt whose ticket the caller holds. The answer is always the
-- same (nothing), whether the ticket matched or not: it confirms no attempt
-- and names no account. Only a pending attempt inside its 90 seconds, and
-- only once.
create function tci.login_interrupted(p_ticket text, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_reason not in ('captcha', 'rate_limited', 'network')
     or p_ticket is null or length(p_ticket) <> 64 then
    return;
  end if;
  update tci.login_attempts
     set interrupted_reason = p_reason, interrupted_at = clock_timestamp()
   where ticket_hash = tci.security_hash(p_ticket)
     and status = 'pending'
     and interrupted_reason is null
     and expires_at > clock_timestamp();
end;
$$;

create or replace function tci.pre_auth_entry_points()
returns table (proname text, justification text)
language sql
immutable
parallel safe
set search_path = ''
as $$
  values
    ('login_begin', 'starts a sign-in before anyone is signed in; computes on salted hashes and names no account'),
    ('login_interrupted', 'labels only the attempt whose unguessable ticket the caller holds, while it is pending; always answers the same and names no account')
$$;

-- ---------------------------------------------------------------------------
-- 4. The notice: wrong passwords and interruptions apart
-- ---------------------------------------------------------------------------

-- The window of 0062 (after the previous successful sign-in and the
-- acknowledgement, before this sign-in), now shared by both lists.
create function tci.my_sign_in_window_attempts()
returns setof tci.login_attempts
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select tci.login_email_hash(u.email) as h,
           (select p.sign_in_ack_at from tci.user_profiles p where p.user_id = u.id) as ack
      from auth.users u where u.id = (select auth.uid())
  ),
  successes as (
    select a.at, row_number() over (order by a.at desc) as rn
      from tci.login_attempts a, me
     where a.email_hash = me.h and a.status = 'succeeded'
  )
  select a.*
    from tci.login_attempts a, me
   where a.email_hash = me.h
     and a.status in ('pending', 'forgiven')
     and a.at > greatest(coalesce((select at from successes where rn = 2), '-infinity'::timestamptz),
                         coalesce(me.ack, '-infinity'::timestamptz))
     and a.at < coalesce((select at from successes where rn = 1), clock_timestamp())
$$;

-- What 0062 counted, less what the browser labelled as interrupted.
create or replace function tci.my_counted_failures()
returns setof tci.login_attempts
language sql
stable
security definer
set search_path = ''
as $$
  select w.* from tci.my_sign_in_window_attempts() w where w.interrupted_reason is null
$$;

create function tci.my_interrupted_sign_ins()
returns table (at timestamptz, ip_masked text, user_agent text, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.at, w.ip_masked, w.user_agent, w.interrupted_reason
    from tci.my_sign_in_window_attempts() w
   where w.interrupted_reason is not null
   order by w.at desc
   limit 50
$$;

create or replace function tci.my_sign_in_notice()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'failed_since_previous_sign_in', (select count(*) from tci.my_counted_failures()),
    'first_failed_at', (select min(at) from tci.my_counted_failures()),
    'last_failed_at', (select max(at) from tci.my_counted_failures()),
    -- 0064: attempts the browser reported as interrupted, apart.
    'interrupted_since_previous_sign_in', (
      select count(*) from tci.my_sign_in_window_attempts() w where w.interrupted_reason is not null),
    'previous_sign_in_at', (
      select at from (
        select a.at, row_number() over (order by a.at desc) as rn
          from tci.login_attempts a
         where a.email_hash = (select tci.login_email_hash(u.email) from auth.users u where u.id = (select auth.uid()))
           and a.status = 'succeeded') s
       where rn = 2),
    'acknowledged_at', (select p.sign_in_ack_at from tci.user_profiles p where p.user_id = (select auth.uid())))
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants and the definer allow-list (as of 0063, two entries added)
-- ---------------------------------------------------------------------------

revoke all on function tci.login_interrupted(text, text) from public;
grant execute on function tci.login_interrupted(text, text) to anon, authenticated, service_role;
revoke all on function tci.my_sign_in_window_attempts() from public, anon, authenticated;
revoke all on function tci.my_counted_failures() from public, anon, authenticated;
revoke all on function tci.my_interrupted_sign_ins() from public, anon;
grant execute on function tci.my_interrupted_sign_ins() to authenticated, service_role;
revoke all on function tci.my_sign_in_notice() from public, anon;
grant execute on function tci.my_sign_in_notice() to authenticated, service_role;

CREATE OR REPLACE FUNCTION tci.definer_gate_allowlist()
 RETURNS TABLE(proname text, justification text)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  values
    ('has_role',                 'reads only the caller''s own acting role and tci.user_roles rows; it IS the gate'),
    ('is_staff',                 'reads only the caller''s own acting role and tci.user_roles rows; it IS the gate'),
    ('current_user_roles',       'returns only the caller''s own acting role'),
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
    ('login_interrupted',        'pre-sign-in entry point: labels only the attempt whose ticket the caller holds (see pre_auth_entry_points)'),
    ('my_sign_in_notice',        'reads only the caller''s own sign-in attempts, keyed by auth.uid()'),
    ('require_trusted_write',    'a gate: only raises (the guard on workflow-written tables)'),
    ('may_remove_claim_object',  'a storage-policy predicate: true only for the caller''s own unregistered upload to a claim they may upload to'),
    ('is_validation_participant','an RLS predicate of tci.limit_validations: answers only whether the CALLER is in a validation chain'),
    ('record_sign_in',           'marks only the caller''s own fresh sign-in ticket succeeded, keyed by auth.uid(), same network'),
    ('acknowledge_sign_in_failures','writes only the caller''s own acknowledgement watermark, keyed by auth.uid()'),
    ('my_failed_sign_ins',       'lists only the caller''s own counted sign-in failures, keyed by auth.uid()'),
    ('my_interrupted_sign_ins',  'lists only the caller''s own interrupted sign-in attempts, keyed by auth.uid()'),
    ('acting_role',              'answers only the caller''s own acting role, from roles they hold; part of the gate'),
    ('held_roles',               'returns only the caller''s own roles'),
    ('set_acting_role',          'writes only the caller''s own acting role for their own session, from roles they hold')
$function$
;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_src text;
begin
  -- anon reaches exactly the pre-sign-in entry points in tci, nothing else.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tci' and has_function_privilege('anon', p.oid, 'execute')
       and p.proname not in (select proname from tci.pre_auth_entry_points())) then
    raise exception '0064: anon executes a tci function that is not a pre-sign-in entry point';
  end if;
  -- the throttle is untouched: it still counts every pending attempt.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.proname = 'login_locked_until';
  if v_src like '%interrupted%' then
    raise exception '0064: the throttle must not trust the browser''s interruption label';
  end if;
  -- the internal window is closed to every API role.
  if has_function_privilege('authenticated', 'tci.my_sign_in_window_attempts()', 'execute')
     or has_function_privilege('anon', 'tci.my_sign_in_window_attempts()', 'execute') then
    raise exception '0064: my_sign_in_window_attempts is reachable through the API';
  end if;
  if not has_function_privilege('anon', 'tci.login_interrupted(text, text)', 'execute') then
    raise exception '0064: the sign-in page (anon) cannot label an interrupted attempt';
  end if;
end;
$$;
