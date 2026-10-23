-- What: the «failed sign-in attempts» notice tells the truth, and `client`
--       is a role held alone.
--         * the anchor          a successful sign-in is recorded from the
--                               app's own login flow (tci.record_sign_in):
--                               the caller's sign-in ticket becomes
--                               'succeeded', exactly what the access-token
--                               hook does when it is enabled. Without it
--                               every successful sign-in left a 'pending'
--                               ticket behind, counted as a failure by the
--                               notice AND by the sign-in throttle
--         * acknowledgement     a per-user server-side watermark
--                               (user_profiles.sign_in_ack_at): «This was me»
--                               / dismiss (tci.acknowledge_sign_in_failures)
--                               and a password change
--                               (tci.complete_password_change) acknowledge
--                               every failure up to that moment; only later
--                               failures show the notice again
--         * detail              login_begin records the /24 (v4) or /48 (v6)
--                               and the user agent of each attempt;
--                               tci.my_failed_sign_ins lists the counted
--                               attempts; the notice returns the time range
--         * role guard          a trigger on tci.user_roles refuses `client`
--                               next to any other role (P0001
--                               client_role_exclusive); the one account that
--                               holds both today loses `client`
-- Why:  owner report (2026-10-22): «11 failed attempts since your previous
--       sign-in» on every login, after several password changes. On canonical
--       the access-token hook is not enabled, so no ticket was ever marked
--       'succeeded': the anchor never moved and the owner's own five
--       successful sign-ins counted with the six real wrong passwords.
--       The provisioning rules have always said a client holds no other
--       role (services/analytics/app/provisioning_rules.py); nothing in the
--       database enforced it.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table tci.login_attempts
  add column ip_masked  text,
  add column user_agent text check (user_agent is null or char_length(user_agent) <= 200);
comment on column tci.login_attempts.ip_masked is
  'The network the attempt came from, masked to /24 (IPv4) or /48 (IPv6) — never the address (0062).';

alter table tci.user_profiles
  add column sign_in_ack_at timestamptz;
comment on column tci.user_profiles.sign_in_ack_at is
  'Failed sign-in attempts up to this moment are acknowledged by the user (dismissed the notice or changed the password) and no longer reported (0062). No API role writes it: tci.acknowledge_sign_in_failures and tci.complete_password_change do.';

-- ---------------------------------------------------------------------------
-- 2. What the request says about where it came from
-- ---------------------------------------------------------------------------
-- The same header precedence as tci.request_ip_hash (0044), masked instead
-- of hashed. NULL when there is no request or the address does not parse.
create function tci.request_ip_masked()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_ip      text;
  v_inet    inet;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if v_headers is null then return null; end if;
  v_ip := nullif(btrim(coalesce(v_headers ->> 'cf-connecting-ip',
                                split_part(v_headers ->> 'x-forwarded-for', ',', 1),
                                v_headers ->> 'x-real-ip')), '');
  if v_ip is null then return null; end if;
  begin
    v_inet := v_ip::inet;
  exception when others then
    return null;
  end;
  return host(network(set_masklen(v_inet, case when family(v_inet) = 4 then 24 else 48 end)))
         || case when family(v_inet) = 4 then '/24' else '/48' end;
end;
$$;

create function tci.request_user_agent()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare v_headers jsonb;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  return left(nullif(btrim(v_headers ->> 'user-agent'), ''), 200);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. login_begin records where the attempt came from (0046 body, plus the
--    two columns in the insert)
-- ---------------------------------------------------------------------------
create or replace function tci.login_begin(p_email text)
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

  insert into tci.login_attempts (email_hash, ip_hash, expires_at, ip_masked, user_agent)
  values (v_hash, v_ip, clock_timestamp() + interval '90 seconds',
          tci.request_ip_masked(), tci.request_user_agent());

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

-- ---------------------------------------------------------------------------
-- 4. The anchor: the app records its own successful sign-in
-- ---------------------------------------------------------------------------
-- Called by the sign-in page right after GoTrue accepted the password. It
-- marks the caller's own ticket 'succeeded' — the one login_begin wrote for
-- this sign-in: same e-mail, same network, still within its 90 seconds, and
-- written before the token this call carries was issued. Idempotent with
-- the access-token hook: if the hook already consumed the ticket there is
-- nothing pending and nothing happens. It can only ever turn the caller's
-- own fresh ticket into a success, which the caller just proved.
create function tci.record_sign_in()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_email  text;
  v_issued timestamptz;
  v_ticket tci.login_attempts%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null then
    return jsonb_build_object('recorded', false);
  end if;
  begin
    v_issued := to_timestamp((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'iat')::double precision);
  exception when others then
    v_issued := null;
  end;

  select * into v_ticket from tci.login_attempts
   where email_hash = tci.login_email_hash(v_email)
     and ip_hash is not distinct from tci.request_ip_hash()
     and status = 'pending'
     and expires_at > clock_timestamp()
     and (v_issued is null or at <= v_issued + interval '1 second')
   order by at desc, id desc
   limit 1
   for update;
  if v_ticket.id is null then
    return jsonb_build_object('recorded', false);
  end if;

  update tci.login_attempts set status = 'succeeded', resolved_at = now() where id = v_ticket.id;
  perform tci.log_auth_event('sign_in.succeeded', v_uid, v_uid, jsonb_build_object('source', 'app'));
  return jsonb_build_object('recorded', true, 'at', v_ticket.at);
end;
$$;
comment on function tci.record_sign_in() is
  'The sign-in page records its own successful sign-in (0062): the caller''s fresh ticket becomes succeeded, as the access-token hook would do. Keyed by auth.uid(); idempotent with the hook.';

-- ---------------------------------------------------------------------------
-- 5. Acknowledgement
-- ---------------------------------------------------------------------------
create function tci.acknowledge_sign_in_failures()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_at timestamptz := clock_timestamp();
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into tci.user_profiles (user_id, sign_in_ack_at)
  values ((select auth.uid()), v_at)
  on conflict (user_id) do update set sign_in_ack_at = v_at;
  perform tci.log_auth_event('sign_in.failures_acknowledged', (select auth.uid()), (select auth.uid()));
  return v_at;
end;
$$;
comment on function tci.acknowledge_sign_in_failures() is
  '«This was me» / dismiss on the failed-sign-in notice (0062): every failure up to now is acknowledged for the caller. Keyed by auth.uid().';

-- A password change acknowledges too (the 0048 body, plus the watermark).
create or replace function tci.complete_password_change()
returns tci.user_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.user_profiles%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if exists (
    select 1
      from tci.user_profiles p
      join auth.users u on u.id = p.user_id
     where p.user_id = (select auth.uid())
       and p.must_change_password
       and p.temp_password_hash is not null
       and p.temp_password_hash = tci.security_hash(u.encrypted_password)
  ) then
    raise exception 'password_unchanged: the temporary password has not been changed'
      using errcode = 'P0001';
  end if;

  insert into tci.user_profiles (user_id, must_change_password, password_changed_at, sign_in_ack_at)
  values ((select auth.uid()), false, now(), clock_timestamp())
  on conflict (user_id) do update
    set must_change_password = false,
        password_changed_at = now(),
        sign_in_ack_at = clock_timestamp()
  returning * into v_row;

  perform tci.log_auth_event('password.changed', (select auth.uid()), (select auth.uid()));
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. What the notice reads
-- ---------------------------------------------------------------------------
-- The counted failures: tickets of the caller's e-mail that never became a
-- success ('pending' — a wrong password, or a sign-in abandoned — and
-- 'forgiven' by an unlock), after BOTH the previous successful sign-in and
-- the acknowledgement watermark, and before this sign-in.
create function tci.my_counted_failures()
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
comment on function tci.my_counted_failures() is
  'The caller''s failed sign-in attempts the notice reports (0062): after the previous sign-in and the acknowledgement, before this sign-in. Internal.';

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
    'previous_sign_in_at', (
      select at from (
        select a.at, row_number() over (order by a.at desc) as rn
          from tci.login_attempts a
         where a.email_hash = (select tci.login_email_hash(u.email) from auth.users u where u.id = (select auth.uid()))
           and a.status = 'succeeded') s
       where rn = 2),
    'acknowledged_at', (select p.sign_in_ack_at from tci.user_profiles p where p.user_id = (select auth.uid())))
$$;

create function tci.my_failed_sign_ins()
returns table (at timestamptz, ip_masked text, user_agent text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.at, f.ip_masked, f.user_agent
    from tci.my_counted_failures() f
   order by f.at desc
   limit 50
$$;
comment on function tci.my_failed_sign_ins() is
  'The attempts behind the notice (0062): time, masked network, user agent; at most 50, newest first. Keyed by auth.uid().';

-- ---------------------------------------------------------------------------
-- 7. `client` is held alone
-- ---------------------------------------------------------------------------
-- The account that holds both today (the owner's) loses `client`: it has no
-- policyholder mapping, so the role gave it nothing. Asserted below.
do $$
declare v_before int; v_removed int;
begin
  select count(*) into v_before
    from (select user_id from tci.user_roles group by user_id
          having bool_or(role = 'client') and count(*) > 1) x;
  delete from tci.user_roles r
   where r.role = 'client'
     and exists (select 1 from tci.user_roles o where o.user_id = r.user_id and o.role <> 'client');
  get diagnostics v_removed = row_count;
  if v_removed <> v_before then
    raise exception '0062: % accounts held client with other roles, % client rows removed', v_before, v_removed;
  end if;
  raise notice '0062: client removed from % account(s) that also held staff roles', v_removed;
end;
$$;

-- AFTER the row, so a statement that inserts several roles at once is
-- judged on the whole resulting set. The admin screen deletes before it
-- inserts, so switching a user between client and staff passes.
create function tci.guard_client_role_exclusive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from tci.user_roles r where r.user_id = new.user_id and r.role = 'client')
     and exists (select 1 from tci.user_roles r where r.user_id = new.user_id and r.role <> 'client') then
    raise exception 'client_role_exclusive: a portal client holds no other role'
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger user_roles_client_exclusive
  after insert or update on tci.user_roles
  for each row execute function tci.guard_client_role_exclusive();

-- ---------------------------------------------------------------------------
-- 8. Grants and the allow-list
-- ---------------------------------------------------------------------------
revoke all on function tci.request_ip_masked() from public, anon, authenticated;
revoke all on function tci.request_user_agent() from public, anon, authenticated;
revoke all on function tci.my_counted_failures() from public, anon, authenticated;
revoke all on function tci.guard_client_role_exclusive() from public, anon, authenticated;
revoke all on function tci.record_sign_in() from public, anon;
grant execute on function tci.record_sign_in() to authenticated, service_role;
revoke all on function tci.acknowledge_sign_in_failures() from public, anon;
grant execute on function tci.acknowledge_sign_in_failures() to authenticated, service_role;
revoke all on function tci.my_failed_sign_ins() from public, anon;
grant execute on function tci.my_failed_sign_ins() to authenticated, service_role;

-- The 0060 list, unchanged, plus the three self-service functions above.
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
    ('require_trusted_write',    'a gate: only raises (the guard on workflow-written tables)'),
    ('may_remove_claim_object',  'a storage-policy predicate: true only for the caller''s own unregistered upload to a claim they may upload to'),
    ('is_validation_participant','an RLS predicate of tci.limit_validations: answers only whether the CALLER is in a validation chain'),
    ('record_sign_in',           'marks only the caller''s own fresh sign-in ticket succeeded, keyed by auth.uid(), same network'),
    ('acknowledge_sign_in_failures','writes only the caller''s own acknowledgement watermark, keyed by auth.uid()'),
    ('my_failed_sign_ins',       'lists only the caller''s own counted sign-in failures, keyed by auth.uid()')
$$;

-- ---------------------------------------------------------------------------
-- 9. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from tci.user_roles group by user_id having bool_or(role = 'client') and count(*) > 1) then
    raise exception '0062: an account still holds client with other roles';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'user_roles_client_exclusive'
                    and tgrelid = 'tci.user_roles'::regclass) then
    raise exception '0062: the client-exclusive trigger is missing';
  end if;
  if position('sign_in_ack_at' in pg_get_functiondef('tci.complete_password_change()'::regprocedure)) = 0 then
    raise exception '0062: a password change does not acknowledge the failures';
  end if;
  if position('ip_masked' in pg_get_functiondef('tci.login_begin(text)'::regprocedure)) = 0 then
    raise exception '0062: login_begin does not record the network';
  end if;
  if has_function_privilege('authenticated', 'tci.my_counted_failures()', 'execute')
     or has_function_privilege('anon', 'tci.record_sign_in()', 'execute')
     or has_function_privilege('anon', 'tci.my_failed_sign_ins()', 'execute') then
    raise exception '0062: a sign-in notice function is reachable by a role that must not reach it';
  end if;
  if has_column_privilege('authenticated', 'tci.user_profiles', 'sign_in_ack_at', 'update') then
    raise exception '0062: the acknowledgement watermark is writable through the API';
  end if;
end;
$$;
