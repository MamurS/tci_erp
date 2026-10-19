-- What: an enforced sign-in lockout that works on the Free plan. Every
--       sign-in starts with tci.login_begin(email), which refuses while the
--       (email, IP) pair, the email or the IP is locked and otherwise issues a
--       short-lived attempt ticket that COUNTS AS A FAILURE until a real
--       success refunds it. The refund happens only in
--       tci.custom_access_token_hook — GoTrue's own token issuance — which
--       also refuses a session while the account is locked (even for the
--       right password) and treats a correct password that arrives without a
--       ticket as a bypass of the sign-in form: the account is hard-locked
--       until an administrator resets the password and unlocks it.
-- Why:  0044 fed its lockout from the password-verification hook, which is
--       a Teams-plan feature; on this project (Free) the hook never ran and
--       tci.auth_attempts stayed empty, so wrong passwords were limited only
--       by GoTrue's per-IP throttle. The custom-access-token hook IS on the
--       Free plan and sees every successful sign-in; failures it never sees
--       are counted up front by the ticket instead.
--
-- THE SCHEDULE (exponential, per email + IP, reset by a success):
--   failures 1..2           no wait
--   failure 3               30 s
--   then each failure       doubles: 1, 2, 4, 8, 16, 32 min, capped at 60 min
--   plus: 20 failures for one email from >= 3 IPs in an hour  -> 15 min for that email
--         30 failures from one IP across >= 5 emails in an hour -> 30 min for that IP
-- A lock that reaches 15 minutes is written to tci.auth_lockouts, so it shows
-- on the admin «Безопасность» screen and can be cleared there.
--
-- WHAT A CLIENT CAN LEARN: nothing about whether an account exists. The
-- counters are keyed on sha256(salt || email) whether or not that email has
-- an account, and GoTrue answers every wrong password with the same
-- "Invalid login credentials".
--
-- ENFORCEMENT IS A SWITCH. Until workflow_settings.login_gate_enforced is
-- true, a sign-in without a ticket is allowed and logged ('sign_in.no_ticket')
-- instead of hard-locking: the hook can be enabled before every browser has
-- the new sign-in page, and an administrator flips the switch once it has.
--
-- ENABLING THE HOOK IS A DASHBOARD STEP: Authentication -> Hooks -> Customize
-- Access Token (JWT) Claims -> Postgres -> tci.custom_access_token_hook.

-- ---------------------------------------------------------------------------
-- 1. Policy
-- ---------------------------------------------------------------------------
alter table tci.workflow_settings
  add column login_gate_enforced     boolean not null default false,
  add column login_free_attempts     integer not null default 3
    check (login_free_attempts between 1 and 20),
  add column login_base_lock_seconds integer not null default 30
    check (login_base_lock_seconds between 1 and 3600),
  add column login_max_lock_seconds  integer not null default 3600
    check (login_max_lock_seconds between 60 and 86400);

comment on column tci.workflow_settings.login_gate_enforced is
  'When true, a password sign-in that did not start with tci.login_begin() is refused and the account hard-locked (a bypass of the sign-in form).';
comment on column tci.workflow_settings.login_free_attempts is
  'Failed sign-ins (per email and IP) before the first wait.';

alter table tci.auth_lockouts
  add column reason text not null default 'failures'
    check (reason in ('failures', 'bypass'));
comment on column tci.auth_lockouts.reason is
  'failures: too many wrong passwords (ends by itself). bypass: a correct password arrived without the sign-in form - reset the password before unlocking.';

-- The wait after n failures. Pure; mirrored in src/auth/loginGate.ts.
create function tci.login_lock_seconds(p_failures integer, p_free integer, p_base integer, p_max integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_failures < p_free then 0
              else least(p_max, (p_base * power(2, least(p_failures - p_free, 20)))::int) end
$$;
revoke execute on function tci.login_lock_seconds(integer, integer, integer, integer) from public, anon;
grant execute on function tci.login_lock_seconds(integer, integer, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Attempts
-- ---------------------------------------------------------------------------
create table tci.login_attempts (
  id          bigint generated always as identity primary key,
  -- clock_timestamp, not now(): two attempts in one transaction (a test, a
  -- retry) must still be ordered, because the hook consumes the LATEST ticket.
  at          timestamptz not null default clock_timestamp(),
  email_hash  text not null,                   -- sha256(salt || 'login:' || email)
  ip_hash     text,                            -- sha256(salt || ip), when known
  -- pending: counted as a failure (no success has refunded it);
  -- succeeded: the attempt that a successful sign-in consumed;
  -- forgiven: a failure a later success from the same email + IP has reset.
  status      text not null default 'pending' check (status in ('pending', 'succeeded', 'forgiven')),
  expires_at  timestamptz not null,            -- the ticket may be consumed until then
  resolved_at timestamptz
);
create index login_attempts_email_at_idx on tci.login_attempts (email_hash, at desc);
create index login_attempts_ip_at_idx on tci.login_attempts (ip_hash, at desc) where ip_hash is not null;
create index login_attempts_at_idx on tci.login_attempts (at);
comment on table tci.login_attempts is
  'One row per sign-in attempt started through tci.login_begin(). Hashed identifiers only; pruned after 30 days.';
alter table tci.login_attempts enable row level security;
-- No policies: only owner code (login_begin, the hook, the admin functions).
revoke all on tci.login_attempts from public, anon, authenticated, service_role;

create function tci.login_email_hash(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select tci.security_hash('login:' || lower(btrim(p_email)))
$$;
revoke execute on function tci.login_email_hash(text) from public, anon, authenticated, service_role;

-- When the next attempt for this email from this IP may start, given every
-- rule; NULL when it may start now.
create function tci.login_locked_until(p_email_hash text, p_ip_hash text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s        tci.workflow_settings%rowtype;
  v_pair     integer;
  v_pair_at  timestamptz;
  v_until    timestamptz;
  v_n        integer;
  v_distinct integer;
  v_last     timestamptz;
begin
  select * into v_s from tci.workflow_settings where id;

  -- 1. this email from this IP: exponential
  select count(*), max(at) into v_pair, v_pair_at
    from tci.login_attempts
   where email_hash = p_email_hash
     and ip_hash is not distinct from p_ip_hash
     and status = 'pending'
     and at > now() - interval '24 hours';
  if tci.login_lock_seconds(v_pair, v_s.login_free_attempts, v_s.login_base_lock_seconds,
                            v_s.login_max_lock_seconds) > 0 then
    v_until := v_pair_at + make_interval(secs => tci.login_lock_seconds(
      v_pair, v_s.login_free_attempts, v_s.login_base_lock_seconds, v_s.login_max_lock_seconds));
  end if;

  -- 2. this email from anywhere: a distributed guess
  select count(*), count(distinct ip_hash), max(at) into v_n, v_distinct, v_last
    from tci.login_attempts
   where email_hash = p_email_hash and status = 'pending' and at > now() - interval '1 hour';
  if v_n >= 20 and v_distinct >= 3 then
    v_until := greatest(v_until, v_last + interval '15 minutes');
  end if;

  -- 3. this IP against many emails: credential stuffing
  if p_ip_hash is not null then
    select count(*), count(distinct email_hash), max(at) into v_n, v_distinct, v_last
      from tci.login_attempts
     where ip_hash = p_ip_hash and status = 'pending' and at > now() - interval '1 hour';
    if v_n >= 30 and v_distinct >= 5 then
      v_until := greatest(v_until, v_last + interval '30 minutes');
    end if;
  end if;

  -- clock_timestamp: attempts are stamped with it (see the table).
  return case when v_until > clock_timestamp() then v_until end;
end;
$$;
revoke execute on function tci.login_locked_until(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The entry point the sign-in page calls first (anon)
-- ---------------------------------------------------------------------------
create function tci.login_begin(p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_hash     text;
  v_ip       text := tci.request_ip_hash();
  v_until    timestamptz;
  v_user     uuid;
  v_lock     tci.auth_lockouts%rowtype;
  v_failures integer;
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

  insert into tci.login_attempts (email_hash, ip_hash, expires_at)
  values (v_hash, v_ip, clock_timestamp() + interval '90 seconds');

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

  return jsonb_build_object('allowed', true, 'failures', v_failures);
end;
$$;
comment on function tci.login_begin(text) is
  'Start a sign-in: refuses while locked (retry_after_seconds), otherwise records an attempt that counts as a failure until the access-token hook consumes it.';
revoke execute on function tci.login_begin(text) from public;
grant execute on function tci.login_begin(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The access-token hook (GoTrue, every token it issues)
-- ---------------------------------------------------------------------------
create function tci.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method  text := coalesce(event ->> 'authentication_method', '');
  v_user    uuid := nullif(event ->> 'user_id', '')::uuid;
  v_email   text := lower(btrim(coalesce(event -> 'claims' ->> 'email', '')));
  v_lock    tci.auth_lockouts%rowtype;
  v_ticket  tci.login_attempts%rowtype;
  v_minutes integer;
begin
  perform tci.require_auth_admin();
  if v_user is null then
    return jsonb_build_object('claims', event -> 'claims');
  end if;

  v_lock := tci.active_lockout(v_user);

  -- A bypass lock ends every session, refreshes included: the password is
  -- known to someone who should not have it.
  if v_lock.user_id is not null and v_lock.reason = 'bypass' then
    perform tci.log_auth_event('sign_in.locked', v_user, null,
      jsonb_build_object('method', v_method, 'reason', 'bypass'));
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', 'account_locked: sign-in is blocked for this account; contact your administrator'));
  end if;

  if v_method <> 'password' then
    return jsonb_build_object('claims', event -> 'claims');
  end if;

  -- A lockout refuses even the right password: that is the point.
  if v_lock.user_id is not null then
    v_minutes := greatest(1, ceil(extract(epoch from (v_lock.locked_until - now())) / 60))::int;
    perform tci.log_auth_event('sign_in.locked', v_user, null,
      jsonb_build_object('locked_until', v_lock.locked_until));
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', format('account_locked: too many failed sign-in attempts; try again in %s minute(s) or contact your administrator', v_minutes)));
  end if;

  select * into v_ticket from tci.login_attempts
   where email_hash = tci.login_email_hash(v_email)
     and status = 'pending' and expires_at > clock_timestamp()
   order by at desc, id desc limit 1
   for update;

  if v_ticket.id is not null then
    update tci.login_attempts set status = 'succeeded', resolved_at = now() where id = v_ticket.id;
    -- A success from this email + IP resets its counter.
    update tci.login_attempts set status = 'forgiven', resolved_at = now()
     where email_hash = v_ticket.email_hash
       and ip_hash is not distinct from v_ticket.ip_hash
       and status = 'pending' and id <> v_ticket.id;
    perform tci.log_auth_event('sign_in.success', v_user, null, '{}'::jsonb, v_ticket.ip_hash);
    return jsonb_build_object('claims', event -> 'claims');
  end if;

  -- A correct password that did not come through the sign-in form.
  if coalesce((select login_gate_enforced from tci.workflow_settings where id), false) then
    insert into tci.auth_lockouts (user_id, subject_hash, locked_at, locked_until, failures, reason)
    values (v_user, tci.security_hash(v_user::text), now(), now() + interval '10 years', 0, 'bypass')
    on conflict (user_id) do update
      set locked_at = now(), locked_until = now() + interval '10 years', failures = 0,
          reason = 'bypass', cleared_at = null, cleared_by = null;
    perform tci.log_auth_event('sign_in.bypass_blocked', v_user);
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', 'account_locked: sign-in is blocked for this account; contact your administrator'));
  end if;

  perform tci.log_auth_event('sign_in.no_ticket', v_user);
  return jsonb_build_object('claims', event -> 'claims');
end;
$$;
comment on function tci.custom_access_token_hook(jsonb) is
  'Supabase Auth custom-access-token hook: consumes the sign-in ticket, refuses while locked, hard-locks a ticketless password sign-in when login_gate_enforced.';
revoke execute on function tci.custom_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function tci.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 5. What the signed-in user and the administrator see
-- ---------------------------------------------------------------------------
-- Failed attempts on MY account between my previous sign-in and this one:
-- the "was this you?" notice after signing in.
create function tci.my_sign_in_notice()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select tci.login_email_hash(u.email) as h
      from auth.users u where u.id = (select auth.uid())
  ),
  successes as (
    select a.at, row_number() over (order by a.at desc) as rn
      from tci.login_attempts a, me
     where a.email_hash = me.h and a.status = 'succeeded'
  )
  select jsonb_build_object(
    'failed_since_previous_sign_in', (
      select count(*) from tci.login_attempts a, me
       where a.email_hash = me.h and a.status in ('pending', 'forgiven')
         and a.at > coalesce((select at from successes where rn = 2), '-infinity'::timestamptz)
         and a.at < coalesce((select at from successes where rn = 1), now())),
    'previous_sign_in_at', (select at from successes where rn = 2))
$$;
revoke execute on function tci.my_sign_in_notice() from public, anon;
grant execute on function tci.my_sign_in_notice() to authenticated, service_role;

-- An unlock also forgives the counted attempts; a bypass unlock forces the
-- password to be changed at the next sign-in (the administrator resets it
-- first - see docs/create-user.sql).
create or replace function tci.unlock_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_lock tci.auth_lockouts%rowtype; v_email text;
begin
  perform tci.require_role('admin');
  select * into v_lock from tci.auth_lockouts
   where user_id = p_user_id
     and cleared_at is null
     and locked_until > now()
   for update;
  if not found then
    raise exception 'this account is not locked' using errcode = 'P0002';
  end if;
  update tci.auth_lockouts
     set cleared_at = now(), cleared_by = (select auth.uid())
   where user_id = p_user_id;
  delete from tci.auth_attempts
   where subject_hash = v_lock.subject_hash and outcome in ('failure', 'mfa_failure');
  select email into v_email from auth.users where id = p_user_id;
  if v_email is not null then
    update tci.login_attempts set status = 'forgiven', resolved_at = now()
     where email_hash = tci.login_email_hash(v_email) and status = 'pending';
  end if;
  if v_lock.reason = 'bypass' then
    update tci.user_profiles set must_change_password = true where user_id = p_user_id;
  end if;
  perform tci.log_auth_event('lockout.cleared', p_user_id, (select auth.uid()),
    jsonb_build_object('reason', v_lock.reason));
  return jsonb_build_object('result', 'unlocked', 'user_id', p_user_id, 'reason', v_lock.reason);
end;
$$;

-- The admin lockout list gains the reason (appended: create or replace view
-- may only add columns at the end).
create or replace view tci.v_admin_lockouts as
select l.user_id, u.email::text as email, l.locked_at, l.locked_until, l.failures,
       l.cleared_at, l.cleared_by, c.email::text as cleared_by_email,
       (l.cleared_at is null and l.locked_until > now()) as active,
       l.reason
  from tci.auth_lockouts l
  left join auth.users u on u.id = l.user_id
  left join auth.users c on c.id = l.cleared_by
 where tci.has_role('admin');

-- Retention: login attempts are kept 30 days like auth_attempts.
create or replace function tci.prune_auth_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_events integer; v_attempts integer; v_logins integer; v_days integer;
begin
  perform tci.require_role('admin');
  v_days := (tci.auth_policy() ->> 'auth_events_retention_days')::int;
  delete from tci.auth_events where at < now() - make_interval(days => v_days);
  get diagnostics v_events = row_count;
  -- Attempts only matter inside the lockout window; 30 days keeps enough
  -- for the spike views without keeping a per-user sign-in history forever.
  delete from tci.auth_attempts where at < now() - interval '30 days';
  get diagnostics v_attempts = row_count;
  delete from tci.login_attempts where at < now() - interval '30 days';
  get diagnostics v_logins = row_count;
  delete from tci.auth_lockouts where coalesce(cleared_at, locked_until) < now() - interval '30 days';
  return jsonb_build_object('events_pruned', v_events, 'attempts_pruned', v_attempts + v_logins);
end;
$$;

-- The policy numbers the UI mirrors to explain a refusal.
create or replace function tci.auth_policy()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lockout_max_failures',       s.lockout_max_failures,
    'lockout_window_minutes',     s.lockout_window_minutes,
    'lockout_duration_minutes',   s.lockout_duration_minutes,
    'mfa_required_for_admin',     s.mfa_required_for_admin,
    'mfa_staff_enforced_from',    s.mfa_staff_enforced_from,
    'auth_events_retention_days', s.auth_events_retention_days,
    'login_gate_enforced',        s.login_gate_enforced,
    'login_free_attempts',        s.login_free_attempts,
    'login_base_lock_seconds',    s.login_base_lock_seconds,
    'login_max_lock_seconds',     s.login_max_lock_seconds)
  from tci.workflow_settings s where s.id
$$;

-- An administrator switches enforcement on once every browser has the new
-- sign-in page (and off again if a client cannot be updated).
create function tci.set_login_gate_enforced(p_enforced boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin');
  update tci.workflow_settings set login_gate_enforced = coalesce(p_enforced, false) where id;
  perform tci.log_auth_event('policy.login_gate', (select auth.uid()), (select auth.uid()),
    jsonb_build_object('enforced', coalesce(p_enforced, false)));
  return tci.auth_policy();
end;
$$;
revoke execute on function tci.set_login_gate_enforced(boolean) from public, anon;
grant execute on function tci.set_login_gate_enforced(boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. anon reaches the schema for exactly one function
-- ---------------------------------------------------------------------------
-- PostgREST needs USAGE on the schema to route /rpc/login_begin for a caller
-- who is not signed in yet. Every other tci function anon could have reached
-- through the PUBLIC default is closed to it here, and the closing assertion
-- (and tests/db/definer_gates.sql) keeps it that way: anon executes
-- tci.login_begin and nothing else.
-- Most of them reached anon only through the PUBLIC default, so the grant to
-- authenticated and service_role is restated BEFORE PUBLIC is revoked
-- (CLAUDE.md, "Revoking the PUBLIC default takes authenticated with it").
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tci' and p.proname <> 'login_begin'
       and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end;
$$;
grant usage on schema tci to anon;
grant execute on function tci.login_begin(text) to anon;

create or replace function tci.pre_auth_entry_points()
returns table (proname text, justification text)
language sql
immutable
parallel safe
set search_path = ''
as $$
  values ('login_begin', 'starts a sign-in before anyone is signed in; computes on salted hashes and names no account')
$$;
revoke execute on function tci.pre_auth_entry_points() from public, anon;
grant execute on function tci.pre_auth_entry_points() to authenticated, service_role;

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
    ('my_sign_in_notice',        'reads only the caller''s own sign-in attempts, keyed by auth.uid()')
$$;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  -- the schedule
  if tci.login_lock_seconds(2, 3, 30, 3600) <> 0 or tci.login_lock_seconds(3, 3, 30, 3600) <> 30
     or tci.login_lock_seconds(4, 3, 30, 3600) <> 60 or tci.login_lock_seconds(9, 3, 30, 3600) <> 1920
     or tci.login_lock_seconds(10, 3, 30, 3600) <> 3600 or tci.login_lock_seconds(99, 3, 30, 3600) <> 3600 then
    raise exception '0046: login_lock_seconds does not follow the schedule';
  end if;

  -- anon executes exactly the pre-auth entry points, and nothing in tci else
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select proname from tci.pre_auth_entry_points());
  if v_bad is not null then
    raise exception '0046: anon can execute tci functions beyond the pre-auth entry points: %', v_bad;
  end if;
  if not has_function_privilege('anon', 'tci.login_begin(text)', 'execute') then
    raise exception '0046: anon cannot start a sign-in';
  end if;

  -- anon still reads no table or view
  if exists (select 1 from information_schema.role_table_grants
              where grantee = 'anon' and table_schema = 'tci') then
    raise exception '0046: anon holds a table grant in tci';
  end if;

  -- the hook is GoTrue's alone
  if has_function_privilege('authenticated', 'tci.custom_access_token_hook(jsonb)', 'execute')
     or has_function_privilege('anon', 'tci.custom_access_token_hook(jsonb)', 'execute')
     or not has_function_privilege('supabase_auth_admin', 'tci.custom_access_token_hook(jsonb)', 'execute') then
    raise exception '0046: custom_access_token_hook grants are wrong';
  end if;
  if (select prosrc from pg_proc where pronamespace = 'tci'::regnamespace and proname = 'custom_access_token_hook')
       not like '%perform tci.require_auth_admin()%' then
    raise exception '0046: custom_access_token_hook is not gated';
  end if;

  -- the attempts table is closed
  if has_table_privilege('authenticated', 'tci.login_attempts', 'select')
     or has_table_privilege('anon', 'tci.login_attempts', 'select') then
    raise exception '0046: login_attempts is readable by an API role';
  end if;
end;
$$;
