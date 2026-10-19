-- What: authentication hardening (audit Phase A2). Account lockout fed by
--       Supabase Auth's password- and MFA-verification hooks, an append-only
--       auth event trail, MFA enforcement inside has_role()/is_staff(), admin
--       security views (events, lockouts, sessions, alerts), session
--       revocation, and the settings that drive all of it.
-- Why:  Phase A closed data isolation INSIDE the database; the perimeter was
--       still soft: repeated wrong passwords produced no reaction beyond
--       GoTrue's per-IP throttle, MFA existed nowhere, and no sign-in was
--       ever recorded. An insurer's staff accounts need a lockout, a second
--       factor and an audit trail, and all three have to be enforced where
--       the data is - not only in the UI.
--
-- WHERE THE LOCKOUT GETS ITS FACTS. Supabase has no native account lockout.
-- The only trustworthy record of a FAILED password is the
-- `password_verification_attempt` Auth hook, which GoTrue calls as
-- `supabase_auth_admin` with {user_id, valid} before it answers the client.
-- tci.password_verification_hook records the attempt, counts the recent
-- failures against the policy and answers `reject` while a lockout stands -
-- even for a correct password. The client never reports attempts: a client-
-- reported failure could lock any account by name (denial of service), so
-- nothing the browser says is written here.
--
-- The hook is gated on `session_user = 'supabase_auth_admin'` and has no
-- grant to any API role. It is SECURITY DEFINER so it may read the policy
-- and write the tables without granting GoTrue's role a view of the schema;
-- the docs prefer INVOKER plus grants, and the difference here is exactly
-- one gate line, which Phase A already requires of every definer function.
-- ENABLING THE HOOK IS A DASHBOARD STEP (Authentication -> Hooks), and the
-- hook type is available on the Teams plan and above. Until it is enabled
-- the tables stay empty and the policy is inert; nothing else degrades.
--
-- MFA. Supabase stamps the JWT with `aal` (aal1 / aal2). tci.mfa_satisfied()
-- decides whether the caller may pass: aal2 always may; a user with a
-- verified factor at aal1 must step up first; a user WITHOUT a factor may
-- pass unless the policy makes MFA mandatory for them (admin: always; other
-- staff: from `mfa_staff_enforced_from`; client: never). has_role() and
-- is_staff() now AND this in, next to the password-rotation predicate, so
-- every policy, client view and gate closes for a session that should have
-- a second factor and has none.
--
-- HASHING. Attempts carry sha256(salt || user id); IP addresses are hashed
-- the same way when a request carries one. The salt is the internal-call
-- salt of tci.internal_secrets, which no API role can read. Emails and IPs
-- are never stored in plain text. Lockouts and events DO carry the user id:
-- an administrator has to be able to find and unlock a person, and the
-- admin views already show email addresses to admins.

-- ---------------------------------------------------------------------------
-- 1. Policy settings
-- ---------------------------------------------------------------------------
alter table tci.workflow_settings
  add column lockout_max_failures      integer not null default 5
    check (lockout_max_failures between 1 and 100),
  add column lockout_window_minutes    integer not null default 15
    check (lockout_window_minutes between 1 and 1440),
  add column lockout_duration_minutes  integer not null default 30
    check (lockout_duration_minutes between 1 and 10080),
  add column mfa_required_for_admin    boolean not null default true,
  -- NULL = not yet enforced for non-admin staff. The grace period is the
  -- distance between today and this date.
  add column mfa_staff_enforced_from   date,
  add column auth_events_retention_days integer not null default 365
    check (auth_events_retention_days between 30 and 3650);

comment on column tci.workflow_settings.lockout_max_failures is
  'Failed password verifications inside lockout_window_minutes that lock the account.';
comment on column tci.workflow_settings.lockout_duration_minutes is
  'How long a lockout stands before sign-in is accepted again. An admin can clear it earlier.';
comment on column tci.workflow_settings.mfa_staff_enforced_from is
  'From this date every non-admin staff role needs a verified second factor. NULL = not enforced yet (grace period).';

create function tci.auth_policy()
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
    'auth_events_retention_days', s.auth_events_retention_days)
  from tci.workflow_settings s where s.id
$$;
comment on function tci.auth_policy() is
  'The authentication policy numbers. Non-sensitive; the UI mirrors them to explain a refusal.';
revoke execute on function tci.auth_policy() from public, anon;
grant execute on function tci.auth_policy() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Hashing and the two new gates
-- ---------------------------------------------------------------------------
create function tci.security_hash(p_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_value is null then null
              else encode(extensions.digest(
                     (select salt from tci.internal_secrets) || ':' || p_value, 'sha256'), 'hex') end
$$;
comment on function tci.security_hash(text) is
  'sha256(server salt || value). Owner-only: not executable by any API role.';
revoke execute on function tci.security_hash(text) from public, anon, authenticated, service_role;

-- The IP the current REST request arrived from, hashed. NULL when there is
-- no request (a hook call from GoTrue, a smoke, a direct connection).
create function tci.request_ip_hash()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_headers jsonb; v_ip text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if v_headers is null then return null; end if;
  v_ip := coalesce(v_headers ->> 'cf-connecting-ip',
                   split_part(v_headers ->> 'x-forwarded-for', ',', 1),
                   v_headers ->> 'x-real-ip');
  return tci.security_hash(nullif(btrim(v_ip), ''));
end;
$$;
revoke execute on function tci.request_ip_hash() from public, anon, authenticated, service_role;

-- GoTrue calls the hooks as supabase_auth_admin. Inside a SECURITY DEFINER
-- function current_user is the owner, so the check is on session_user.
create function tci.require_auth_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if session_user <> 'supabase_auth_admin' then
    raise exception 'not permitted: Supabase Auth only' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function tci.require_auth_admin() from public, anon, authenticated;
grant execute on function tci.require_auth_admin() to supabase_auth_admin;

-- GoTrue's role needs to SEE the schema to call a hook in it. USAGE only:
-- no table or other function in tci is granted to it.
grant usage on schema tci to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
create table tci.auth_attempts (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  subject_hash text not null,                 -- sha256(salt || user id)
  ip_hash      text,                          -- sha256(salt || ip), when known
  outcome      text not null check (outcome in ('success', 'failure', 'rejected_locked',
                                                'mfa_success', 'mfa_failure', 'mfa_rejected_locked'))
);
create index auth_attempts_subject_at_idx on tci.auth_attempts (subject_hash, at desc);
create index auth_attempts_at_idx on tci.auth_attempts (at);
comment on table tci.auth_attempts is
  'Every password / MFA verification GoTrue reported through the Auth hooks. Hashed identifiers only; pruned by tci.prune_auth_data().';
alter table tci.auth_attempts enable row level security;
-- No policies: nothing but owner code and the hook (as owner) touches it.
revoke all on tci.auth_attempts from public, anon, authenticated, service_role;

create table tci.auth_lockouts (
  user_id      uuid primary key,
  subject_hash text not null,
  locked_at    timestamptz not null default now(),
  locked_until timestamptz not null,
  failures     integer not null,
  cleared_at   timestamptz,
  cleared_by   uuid
);
comment on table tci.auth_lockouts is
  'One row per user who is, or was last, locked out. A row with cleared_at set or locked_until in the past is history.';
alter table tci.auth_lockouts enable row level security;
revoke all on tci.auth_lockouts from public, anon, authenticated, service_role;

create table tci.auth_events (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  event_type    text not null,
  user_id       uuid,          -- the account the event is about
  actor_user_id uuid,          -- who did it, when it was a person acting on another
  ip_hash       text,
  details       jsonb not null default '{}'::jsonb
);
create index auth_events_at_idx on tci.auth_events (at desc);
create index auth_events_user_idx on tci.auth_events (user_id, at desc);
create index auth_events_type_at_idx on tci.auth_events (event_type, at desc);
comment on table tci.auth_events is
  'Append-only authentication trail: sign-ins, lockouts, MFA verifications, password changes, session revocations, role grants. Read through tci.v_admin_auth_events.';
alter table tci.auth_events enable row level security;
revoke all on tci.auth_events from public, anon, authenticated, service_role;

-- Owner-only writer. Not granted to any API role; reachable only from
-- SECURITY DEFINER code, which is what "append-only" means here: no path
-- updates or deletes a row except retention pruning.
create function tci.log_auth_event(
  p_event_type text, p_user_id uuid, p_actor uuid default null,
  p_details jsonb default '{}'::jsonb, p_ip_hash text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into tci.auth_events (event_type, user_id, actor_user_id, ip_hash, details)
  values (p_event_type, p_user_id, p_actor, coalesce(p_ip_hash, tci.request_ip_hash()),
          coalesce(p_details, '{}'::jsonb))
$$;
revoke execute on function tci.log_auth_event(text, uuid, uuid, jsonb, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The lockout, fed by the Auth hooks
-- ---------------------------------------------------------------------------
-- Failures inside the window for one subject.
create function tci.recent_failures(p_subject_hash text, p_window_minutes integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from tci.auth_attempts
   where subject_hash = p_subject_hash
     and outcome = 'failure'
     and at > now() - make_interval(mins => p_window_minutes)
$$;
revoke execute on function tci.recent_failures(text, integer) from public, anon, authenticated, service_role;

create function tci.active_lockout(p_user_id uuid)
returns tci.auth_lockouts
language sql
stable
security definer
set search_path = ''
as $$
  select l.* from tci.auth_lockouts l
   where l.user_id = p_user_id
     and l.cleared_at is null
     and l.locked_until > now()
$$;
revoke execute on function tci.active_lockout(uuid) from public, anon, authenticated, service_role;

-- password_verification_attempt hook. Input {user_id, valid}; output
-- {decision: continue} or {decision: reject, message, should_logout_user}.
-- The message starts with a machine token the UI translates
-- (`account_locked`), followed by readable English for any other client.
create function tci.password_verification_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid;
  v_valid    boolean;
  v_subject  text;
  v_policy   jsonb;
  v_lock     tci.auth_lockouts%rowtype;
  v_failures integer;
  v_minutes  integer;
begin
  perform tci.require_auth_admin();
  v_user  := (event ->> 'user_id')::uuid;
  v_valid := coalesce((event ->> 'valid')::boolean, false);
  if v_user is null then
    return jsonb_build_object('decision', 'continue');
  end if;
  v_subject := tci.security_hash(v_user::text);
  v_policy  := tci.auth_policy();

  -- A standing lockout refuses even the right password: that is the point.
  v_lock := tci.active_lockout(v_user);
  if v_lock.user_id is not null then
    insert into tci.auth_attempts (subject_hash, outcome) values (v_subject, 'rejected_locked');
    perform tci.log_auth_event('sign_in.locked', v_user, null,
      jsonb_build_object('locked_until', v_lock.locked_until, 'valid_password', v_valid));
    v_minutes := greatest(1, ceil(extract(epoch from (v_lock.locked_until - now())) / 60))::int;
    return jsonb_build_object(
      'decision', 'reject',
      'message', format('account_locked: too many failed sign-in attempts; try again in %s minute(s) or contact your administrator', v_minutes),
      'should_logout_user', false);
  end if;

  if v_valid then
    insert into tci.auth_attempts (subject_hash, outcome) values (v_subject, 'success');
    perform tci.log_auth_event('sign_in.success', v_user);
    return jsonb_build_object('decision', 'continue');
  end if;

  insert into tci.auth_attempts (subject_hash, outcome) values (v_subject, 'failure');
  v_failures := tci.recent_failures(v_subject, (v_policy ->> 'lockout_window_minutes')::int);
  perform tci.log_auth_event('sign_in.failure', v_user, null,
    jsonb_build_object('recent_failures', v_failures));

  if v_failures >= (v_policy ->> 'lockout_max_failures')::int then
    insert into tci.auth_lockouts (user_id, subject_hash, locked_at, locked_until, failures)
    values (v_user, v_subject, now(),
            now() + make_interval(mins => (v_policy ->> 'lockout_duration_minutes')::int), v_failures)
    on conflict (user_id) do update
      set subject_hash = excluded.subject_hash, locked_at = excluded.locked_at,
          locked_until = excluded.locked_until, failures = excluded.failures,
          cleared_at = null, cleared_by = null;
    perform tci.log_auth_event('lockout.started', v_user, null,
      jsonb_build_object('failures', v_failures,
                         'duration_minutes', (v_policy ->> 'lockout_duration_minutes')::int));
    return jsonb_build_object(
      'decision', 'reject',
      'message', format('account_locked: too many failed sign-in attempts; try again in %s minute(s) or contact your administrator',
                        (v_policy ->> 'lockout_duration_minutes')::int),
      'should_logout_user', true);
  end if;

  -- Below the threshold: GoTrue answers "invalid credentials" as usual.
  return jsonb_build_object('decision', 'continue');
end;
$$;
comment on function tci.password_verification_hook(jsonb) is
  'Supabase Auth password_verification_attempt hook: records the attempt, applies the lockout policy. Enable under Authentication -> Hooks (Teams plan and above).';
revoke execute on function tci.password_verification_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function tci.password_verification_hook(jsonb) to supabase_auth_admin;

-- mfa_verification_attempt hook. Input {factor_id, factor_type, user_id,
-- valid}. A burst of wrong codes locks MFA verification for the lockout
-- duration; a correct code is recorded and lets the session step up.
create function tci.mfa_verification_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid;
  v_valid   boolean;
  v_subject text;
  v_policy  jsonb;
  v_lock    tci.auth_lockouts%rowtype;
  v_failures integer;
begin
  perform tci.require_auth_admin();
  v_user  := (event ->> 'user_id')::uuid;
  v_valid := coalesce((event ->> 'valid')::boolean, false);
  if v_user is null then
    return jsonb_build_object('decision', 'continue');
  end if;
  v_subject := tci.security_hash(v_user::text);
  v_policy  := tci.auth_policy();

  v_lock := tci.active_lockout(v_user);
  if v_lock.user_id is not null then
    insert into tci.auth_attempts (subject_hash, outcome) values (v_subject, 'mfa_rejected_locked');
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'account_locked: too many failed attempts; try again later or contact your administrator');
  end if;

  if v_valid then
    insert into tci.auth_attempts (subject_hash, outcome) values (v_subject, 'mfa_success');
    perform tci.log_auth_event('mfa.verify.success', v_user, null,
      jsonb_build_object('factor_type', event ->> 'factor_type'));
    return jsonb_build_object('decision', 'continue');
  end if;

  insert into tci.auth_attempts (subject_hash, outcome) values (v_subject, 'mfa_failure');
  select count(*)::int into v_failures from tci.auth_attempts
   where subject_hash = v_subject and outcome = 'mfa_failure'
     and at > now() - make_interval(mins => (v_policy ->> 'lockout_window_minutes')::int);
  perform tci.log_auth_event('mfa.verify.failure', v_user, null,
    jsonb_build_object('recent_failures', v_failures, 'factor_type', event ->> 'factor_type'));

  if v_failures >= (v_policy ->> 'lockout_max_failures')::int then
    insert into tci.auth_lockouts (user_id, subject_hash, locked_at, locked_until, failures)
    values (v_user, v_subject, now(),
            now() + make_interval(mins => (v_policy ->> 'lockout_duration_minutes')::int), v_failures)
    on conflict (user_id) do update
      set subject_hash = excluded.subject_hash, locked_at = excluded.locked_at,
          locked_until = excluded.locked_until, failures = excluded.failures,
          cleared_at = null, cleared_by = null;
    perform tci.log_auth_event('lockout.started', v_user, null,
      jsonb_build_object('failures', v_failures, 'source', 'mfa',
                         'duration_minutes', (v_policy ->> 'lockout_duration_minutes')::int));
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'account_locked: too many failed verification codes; try again later or contact your administrator');
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;
comment on function tci.mfa_verification_hook(jsonb) is
  'Supabase Auth mfa_verification_attempt hook: records verifications, locks after a burst of wrong codes.';
revoke execute on function tci.mfa_verification_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function tci.mfa_verification_hook(jsonb) to supabase_auth_admin;

-- Admin unlock. Clears the standing lockout AND forgives the failures that
-- caused it, so the next wrong password does not re-lock at once.
create function tci.unlock_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_lock tci.auth_lockouts%rowtype;
begin
  perform tci.require_role('admin');
  select * into v_lock from tci.auth_lockouts where user_id = p_user_id for update;
  if not found then
    raise exception 'this account is not locked' using errcode = 'P0002';
  end if;
  update tci.auth_lockouts
     set cleared_at = now(), cleared_by = (select auth.uid())
   where user_id = p_user_id;
  delete from tci.auth_attempts
   where subject_hash = v_lock.subject_hash and outcome in ('failure', 'mfa_failure');
  perform tci.log_auth_event('lockout.cleared', p_user_id, (select auth.uid()));
  return jsonb_build_object('result', 'unlocked', 'user_id', p_user_id);
end;
$$;
revoke execute on function tci.unlock_account(uuid) from public, anon;
grant execute on function tci.unlock_account(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. MFA policy, enforced where every policy looks
-- ---------------------------------------------------------------------------
-- The caller's own state only: the JWT's assurance level, their own factors,
-- their own roles. No table the caller could not already read about
-- themselves, which is why it may sit on the allow-list.
create function tci.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid,
           coalesce(auth.jwt() ->> 'aal', 'aal1') as aal
  ),
  facts as (
    select me.aal,
           exists (select 1 from auth.mfa_factors f
                    where f.user_id = me.uid and f.status = 'verified') as has_factor,
           exists (select 1 from tci.user_roles r
                    where r.user_id = me.uid and r.role = 'admin') as is_admin,
           exists (select 1 from tci.user_roles r
                    where r.user_id = me.uid and r.role not in ('admin', 'client')) as is_other_staff,
           (select s.mfa_required_for_admin from tci.workflow_settings s where s.id) as admin_required,
           (select s.mfa_staff_enforced_from from tci.workflow_settings s where s.id) as staff_from
      from me
  )
  select case
           when aal = 'aal2' then true
           when has_factor then false                       -- enrolled: step up first
           when is_admin and coalesce(admin_required, true) then false
           when is_other_staff and staff_from is not null and current_date >= staff_from then false
           else true
         end
    from facts
$$;
comment on function tci.mfa_satisfied() is
  'True when this session meets the MFA policy: aal2, or no factor enrolled and none required for the caller''s roles yet.';
revoke execute on function tci.mfa_satisfied() from public, anon;
grant execute on function tci.mfa_satisfied() to authenticated, service_role;

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
  and tci.mfa_satisfied()
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
  and tci.mfa_satisfied()
$$;

comment on function tci.has_role(variadic tci.user_role[]) is
  'True when the caller holds any of the roles, has no password rotation outstanding AND meets the MFA policy. Every RLS policy, client view and gate reads this.';
comment on function tci.is_staff() is
  'True when the caller holds any role but client, has no password rotation outstanding AND meets the MFA policy.';

-- What the UI needs to route a session: rotation, MFA state, lockout. Own
-- data only. `mfa_required` says whether the policy applies to this person;
-- `mfa_enrolled` whether they already have a verified factor.
create function tci.my_auth_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid)
  select jsonb_build_object(
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'rotation_pending', tci.password_rotation_pending(),
    'mfa_enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = me.uid and f.status = 'verified'),
    'mfa_required', (
      (exists (select 1 from tci.user_roles r where r.user_id = me.uid and r.role = 'admin')
         and coalesce((select mfa_required_for_admin from tci.workflow_settings where id), true))
      or (exists (select 1 from tci.user_roles r where r.user_id = me.uid and r.role not in ('admin', 'client'))
         and (select mfa_staff_enforced_from from tci.workflow_settings where id) is not null
         and current_date >= (select mfa_staff_enforced_from from tci.workflow_settings where id))),
    'mfa_staff_enforced_from', (select mfa_staff_enforced_from from tci.workflow_settings where id),
    'mfa_satisfied', tci.mfa_satisfied(),
    'locked_until', (select l.locked_until from tci.auth_lockouts l
                      where l.user_id = me.uid and l.cleared_at is null and l.locked_until > now()))
  from me
$$;
revoke execute on function tci.my_auth_status() from public, anon;
grant execute on function tci.my_auth_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Events from the paths we already own
-- ---------------------------------------------------------------------------
-- A password change is recorded on the row that clears the rotation flag.
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

  insert into tci.user_profiles (user_id, must_change_password, password_changed_at)
  values ((select auth.uid()), false, now())
  on conflict (user_id) do update
    set must_change_password = false,
        password_changed_at = now()
  returning * into v_row;

  perform tci.log_auth_event('password.changed', (select auth.uid()), (select auth.uid()));
  return v_row;
end;
$$;

-- Role grants and revocations are administrator actions on users.
create function tci.audit_user_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform tci.log_auth_event('user.role_granted', new.user_id, (select auth.uid()),
      jsonb_build_object('role', new.role));
    return new;
  else
    perform tci.log_auth_event('user.role_revoked', old.user_id, (select auth.uid()),
      jsonb_build_object('role', old.role));
    return old;
  end if;
end;
$$;
revoke execute on function tci.audit_user_role_change() from public, anon;
create trigger user_roles_audit
  after insert or delete on tci.user_roles
  for each row execute function tci.audit_user_role_change();

-- Admin: end every session of a user (their refresh tokens go with them,
-- ON DELETE CASCADE). Their current access token keeps working until it
-- expires - the JWT lifetime is the bound, which is why it is short.
create function tci.revoke_user_sessions(p_user_id uuid, p_keep_current boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer; v_current uuid;
begin
  perform tci.require_role('admin');
  v_current := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  delete from auth.sessions s
   where s.user_id = p_user_id
     and (not p_keep_current or v_current is null or s.id <> v_current);
  get diagnostics v_n = row_count;
  perform tci.log_auth_event('session.revoked', p_user_id, (select auth.uid()),
    jsonb_build_object('sessions', v_n, 'kept_current', p_keep_current));
  return v_n;
end;
$$;
revoke execute on function tci.revoke_user_sessions(uuid, boolean) from public, anon;
grant execute on function tci.revoke_user_sessions(uuid, boolean) to authenticated, service_role;

-- Retention. Called on read by the admin security screen; no cron.
create function tci.prune_auth_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_events integer; v_attempts integer; v_days integer;
begin
  perform tci.require_role('admin');
  v_days := (tci.auth_policy() ->> 'auth_events_retention_days')::int;
  delete from tci.auth_events where at < now() - make_interval(days => v_days);
  get diagnostics v_events = row_count;
  -- Attempts only matter inside the lockout window; 30 days keeps enough
  -- for the spike views without keeping a per-user sign-in history forever.
  delete from tci.auth_attempts where at < now() - interval '30 days';
  get diagnostics v_attempts = row_count;
  delete from tci.auth_lockouts where coalesce(cleared_at, locked_until) < now() - interval '30 days';
  return jsonb_build_object('events_pruned', v_events, 'attempts_pruned', v_attempts);
end;
$$;
revoke execute on function tci.prune_auth_data() from public, anon;
grant execute on function tci.prune_auth_data() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Admin views (SECURITY DEFINER, admin-gated - the v_admin_users pattern)
-- ---------------------------------------------------------------------------
create view tci.v_admin_auth_events as
select e.id, e.at, e.event_type, e.user_id,
       u.email::text as email,
       e.actor_user_id,
       a.email::text as actor_email,
       (e.ip_hash is not null) as ip_known,
       e.details
  from tci.auth_events e
  left join auth.users u on u.id = e.user_id
  left join auth.users a on a.id = e.actor_user_id
 where tci.has_role('admin');
comment on view tci.v_admin_auth_events is
  'Admin-only authentication trail. IP addresses are stored hashed and never shown.';
grant select on tci.v_admin_auth_events to authenticated, service_role;

create view tci.v_admin_lockouts as
select l.user_id, u.email::text as email, l.locked_at, l.locked_until, l.failures,
       l.cleared_at, l.cleared_by, c.email::text as cleared_by_email,
       (l.cleared_at is null and l.locked_until > now()) as active
  from tci.auth_lockouts l
  left join auth.users u on u.id = l.user_id
  left join auth.users c on c.id = l.cleared_by
 where tci.has_role('admin');
grant select on tci.v_admin_lockouts to authenticated, service_role;

create view tci.v_admin_sessions as
select s.id, s.user_id, u.email::text as email, s.created_at, s.updated_at, s.refreshed_at,
       s.aal::text as aal, s.user_agent,
       -- host part only, and only the network: enough to tell two devices apart
       case when s.ip is null then null
            when family(s.ip) = 4 then host(set_masklen(s.ip::cidr, 24))
            else host(set_masklen(s.ip::cidr, 48)) end as ip_network,
       s.not_after,
       (s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid) as is_current
  from auth.sessions s
  join auth.users u on u.id = s.user_id
 where tci.has_role('admin');
comment on view tci.v_admin_sessions is
  'Admin-only list of live GoTrue sessions. IPs are shown as their /24 (v4) or /48 (v6) network only.';
grant select on tci.v_admin_sessions to authenticated, service_role;

-- A view runs its table reads as the owner but its FUNCTION calls as the
-- querying user, and security_hash is closed to every API role. The hashed
-- lookup therefore lives in an admin-gated definer function the view calls.
create function tci.admin_user_failures(p_user_id uuid)
returns table (last_failure_at timestamptz, failures_in_window integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin');
  return query
  select max(a.at) filter (where a.outcome = 'failure'),
         (count(*) filter (where a.outcome = 'failure'
                             and a.at > now() - make_interval(mins => (tci.auth_policy() ->> 'lockout_window_minutes')::int)))::int
    from tci.auth_attempts a
   where a.subject_hash = tci.security_hash(p_user_id::text);
end;
$$;
revoke execute on function tci.admin_user_failures(uuid) from public, anon;
grant execute on function tci.admin_user_failures(uuid) to authenticated, service_role;

create view tci.v_admin_user_security as
select u.id as user_id, u.email::text as email,
       (select count(*)::int from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as mfa_factors,
       (select count(*)::int from auth.sessions s where s.user_id = u.id) as sessions,
       l.locked_until,
       (l.user_id is not null and l.cleared_at is null and l.locked_until > now()) as locked,
       fa.last_failure_at,
       fa.failures_in_window,
       (select max(e.at) from tci.auth_events e where e.user_id = u.id and e.event_type = 'sign_in.success') as last_success_at
  from auth.users u
  left join tci.auth_lockouts l on l.user_id = u.id
  cross join lateral tci.admin_user_failures(u.id) fa
 where tci.has_role('admin');
grant select on tci.v_admin_user_security to authenticated, service_role;

-- The conditions worth an alert, computed on read. A database webhook on
-- tci.auth_events (dashboard: Database -> Webhooks) can deliver each row to
-- a Cloudflare Worker; this view is what a poller or the admin screen reads.
create view tci.v_admin_security_alerts as
select * from (
  select 'lockout_burst'::text as alert, 'high'::text as severity,
         count(*)::int as n, min(at) as since
    from tci.auth_events where event_type = 'lockout.started' and at > now() - interval '1 hour'
  union all
  select 'failed_login_spike', 'medium', count(*)::int, min(at)
    from tci.auth_events where event_type = 'sign_in.failure' and at > now() - interval '15 minutes'
  union all
  select 'admin_role_granted', 'high', count(*)::int, min(at)
    from tci.auth_events
   where event_type = 'user.role_granted' and details ->> 'role' = 'admin'
     and at > now() - interval '24 hours'
) x
where tci.has_role('admin')
  and n >= case alert when 'lockout_burst' then 3 when 'failed_login_spike' then 20 else 1 end;
grant select on tci.v_admin_security_alerts to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The allow-list, extended, and the closing assertions
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
    ('my_auth_status',           'reads only the caller''s own rotation, MFA and lockout state')
$$;

do $$
declare v_bad text; v_n int;
begin
  -- (a) every SECURITY DEFINER function executable by authenticated is gated,
  --     a trigger, or allow-listed. Same regex as 0043 plus the auth-admin gate.
  select string_agg(p.proname, ', ' order by p.proname), count(*)
    into v_bad, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.prorettype <> 'trigger'::regtype
     and p.prosrc !~* 'tci\.require_(staff|role|claim_access|staff_or_internal|internal_call|auth_admin)\(|tci\.has_role\(|tci\.is_staff\(|tci\.may_edit_relationships\(|tci\.may_access_claim\(|tci\.may_upload_to_claim\(|tci\.may_edit_claim_content\(|tci\.client_policy_guard\(|tci\.my_client_entities\('
     and p.proname not in (select proname from tci.definer_gate_allowlist());
  if v_n > 0 then
    raise exception '0044: ungated SECURITY DEFINER functions executable by authenticated: %', v_bad;
  end if;

  -- (b) the hooks and the hashing helpers are closed to every API role.
  if has_function_privilege('authenticated', 'tci.password_verification_hook(jsonb)', 'execute')
     or has_function_privilege('anon', 'tci.password_verification_hook(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'tci.mfa_verification_hook(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'tci.security_hash(text)', 'execute')
     or has_function_privilege('authenticated', 'tci.log_auth_event(text, uuid, uuid, jsonb, text)', 'execute')
     or has_table_privilege('authenticated', 'tci.auth_attempts', 'select')
     or has_table_privilege('authenticated', 'tci.auth_events', 'select')
     or has_table_privilege('authenticated', 'tci.auth_lockouts', 'select') then
    raise exception '0044: an auth-hardening internal is reachable by an API role';
  end if;
  if not has_function_privilege('supabase_auth_admin', 'tci.password_verification_hook(jsonb)', 'execute') then
    raise exception '0044: GoTrue cannot execute the password verification hook';
  end if;

  -- (c) the gates enforce the MFA policy.
  if (select prosrc from pg_proc where pronamespace = 'tci'::regnamespace and proname = 'has_role')
       not like '%tci.mfa_satisfied()%'
     or (select prosrc from pg_proc where pronamespace = 'tci'::regnamespace and proname = 'is_staff')
       not like '%tci.mfa_satisfied()%' then
    raise exception '0044: has_role/is_staff do not enforce the MFA policy';
  end if;

  -- (d) no P0004 anywhere (Phase A rule).
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p where p.pronamespace = 'tci'::regnamespace and p.prosrc like '%''P0004''%';
  if v_bad is not null then
    raise exception '0044: P0004 still raised by: %', v_bad;
  end if;

  -- (e) the allow-list still names only SECURITY DEFINER functions.
  select string_agg(a.proname, ', ') into v_bad
    from tci.definer_gate_allowlist() a
   where not exists (select 1 from pg_proc p where p.pronamespace = 'tci'::regnamespace
                      and p.proname = a.proname and p.prosecdef);
  if v_bad is not null then
    raise exception '0044: allow-list names a function that is not a SECURITY DEFINER function: %', v_bad;
  end if;
end;
$$;
