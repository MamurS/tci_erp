-- Negative tests for migration 0044 (audit Phase A2): the lockout hook, the
-- MFA policy inside has_role()/is_staff(), the admin security surface and
-- the closure of the auth tables. Run against the local replay harness:
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/auth_hardening.sql
--
-- Fixtures are created inside one transaction that is always rolled back.
-- Every check raises on failure; the last line prints OK.
--
-- The hook gate is `session_user = 'supabase_auth_admin'`, which only a
-- superuser can assume (SET SESSION AUTHORIZATION), so the hook logic is
-- exercised here on the harness and only its refusals on canonical.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('77777777-0000-4000-8000-0000000000a1', 'ah-admin@t'),
  ('77777777-0000-4000-8000-0000000000b1', 'ah-sales@t'),
  ('77777777-0000-4000-8000-0000000000d1', 'ah-client@t'),
  ('77777777-0000-4000-8000-0000000000d2', 'ah-client-mfa@t');
insert into tci.user_roles (user_id, role) values
  ('77777777-0000-4000-8000-0000000000a1', 'admin'),
  ('77777777-0000-4000-8000-0000000000b1', 'sales'),
  ('77777777-0000-4000-8000-0000000000d1', 'client'),
  ('77777777-0000-4000-8000-0000000000d2', 'client');
insert into auth.mfa_factors (user_id, factor_type, status, friendly_name) values
  ('77777777-0000-4000-8000-0000000000d2', 'totp', 'verified', 'phone');
insert into auth.sessions (id, user_id, aal, user_agent, ip) values
  ('77777777-0000-4000-8000-00000000ee01', '77777777-0000-4000-8000-0000000000b1', 'aal1', 'ua-1', '203.0.113.9'),
  ('77777777-0000-4000-8000-00000000ee02', '77777777-0000-4000-8000-0000000000b1', 'aal1', 'ua-2', '2001:db8::9');
insert into auth.refresh_tokens (token, user_id, session_id) values
  ('rt-1', '77777777-0000-4000-8000-0000000000b1', '77777777-0000-4000-8000-00000000ee01');

-- ---- 1. the hook refuses anyone but GoTrue --------------------------------
do $$
begin
  begin
    perform tci.password_verification_hook('{"user_id":"77777777-0000-4000-8000-0000000000b1","valid":false}');
    raise exception 'auth_hardening: the hook ran for session_user %', session_user;
  exception when sqlstate '42501' then null; end;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    perform tci.password_verification_hook('{"user_id":"77777777-0000-4000-8000-0000000000b1","valid":false}');
    raise exception 'auth_hardening: an authenticated admin could call the hook';
  exception when sqlstate '42501' then null; end;
  begin
    perform tci.security_hash('x');
    raise exception 'auth_hardening: authenticated can call security_hash';
  exception when sqlstate '42501' then null; end;
  begin
    perform 1 from tci.auth_attempts;
    raise exception 'auth_hardening: authenticated can read auth_attempts';
  exception when sqlstate '42501' then null; end;
  begin
    perform 1 from tci.auth_events;
    raise exception 'auth_hardening: authenticated can read auth_events';
  exception when sqlstate '42501' then null; end;
  perform set_config('role', 'postgres', true);
end $$;

-- ---- 2. the lockout, as GoTrue would drive it -------------------------------
set session authorization supabase_auth_admin;
do $$
declare r jsonb; i int;
begin
  -- four failures: still "continue" (GoTrue says invalid credentials)
  for i in 1..4 loop
    r := tci.password_verification_hook('{"user_id":"77777777-0000-4000-8000-0000000000b1","valid":false}');
    if r ->> 'decision' <> 'continue' then
      raise exception 'auth_hardening: failure % was rejected early: %', i, r;
    end if;
  end loop;
  -- the fifth locks
  r := tci.password_verification_hook('{"user_id":"77777777-0000-4000-8000-0000000000b1","valid":false}');
  if r ->> 'decision' <> 'reject' or r ->> 'message' not like 'account_locked:%' then
    raise exception 'auth_hardening: fifth failure did not lock: %', r;
  end if;
  -- the RIGHT password is refused while the lockout stands
  r := tci.password_verification_hook('{"user_id":"77777777-0000-4000-8000-0000000000b1","valid":true}');
  if r ->> 'decision' <> 'reject' then
    raise exception 'auth_hardening: a locked account accepted a valid password: %', r;
  end if;
  -- MFA verification for a locked account is refused too
  r := tci.mfa_verification_hook('{"user_id":"77777777-0000-4000-8000-0000000000b1","factor_type":"totp","valid":true}');
  if r ->> 'decision' <> 'reject' then
    raise exception 'auth_hardening: a locked account could verify MFA: %', r;
  end if;
  -- a different user is untouched
  r := tci.password_verification_hook('{"user_id":"77777777-0000-4000-8000-0000000000a1","valid":true}');
  if r ->> 'decision' <> 'continue' then
    raise exception 'auth_hardening: the lockout leaked to another user: %', r;
  end if;
  -- a burst of wrong codes locks as well
  for i in 1..5 loop
    r := tci.mfa_verification_hook('{"user_id":"77777777-0000-4000-8000-0000000000d2","factor_type":"totp","valid":false}');
  end loop;
  if r ->> 'decision' <> 'reject' then
    raise exception 'auth_hardening: five wrong MFA codes did not lock: %', r;
  end if;
end $$;
reset session authorization;

do $$
declare v_n int;
begin
  select count(*) into v_n from tci.auth_lockouts where cleared_at is null and locked_until > now();
  if v_n <> 2 then raise exception 'auth_hardening: expected 2 active lockouts, got %', v_n; end if;
  select count(*) into v_n from tci.auth_events where event_type = 'lockout.started';
  if v_n <> 2 then raise exception 'auth_hardening: expected 2 lockout events, got %', v_n; end if;
  select count(*) into v_n from tci.auth_events where event_type = 'sign_in.failure';
  if v_n <> 5 then raise exception 'auth_hardening: expected 5 failure events, got %', v_n; end if;
  -- nothing in plain text: the attempts carry hashes, never the id
  if exists (select 1 from tci.auth_attempts where subject_hash like '77777777%' or length(subject_hash) <> 64) then
    raise exception 'auth_hardening: an attempt row carries a plain identifier';
  end if;
end $$;

-- ---- 3. the MFA policy inside the gates -----------------------------------
do $$
declare v boolean; st jsonb;
begin
  -- an admin at aal1 with no factor: MFA is mandatory for admins, so the gate closes
  perform set_config('role', 'authenticated', true); perform set_config('tci.internal_call', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if tci.is_staff() then raise exception 'auth_hardening: admin at aal1 passed is_staff'; end if;
  if tci.has_role('admin') then raise exception 'auth_hardening: admin at aal1 passed has_role'; end if;
  st := tci.my_auth_status();
  if not (st ->> 'mfa_required')::boolean or (st ->> 'mfa_satisfied')::boolean then
    raise exception 'auth_hardening: my_auth_status wrong for admin at aal1: %', st;
  end if;
  -- the same admin at aal2 passes
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  if not tci.is_staff() then raise exception 'auth_hardening: admin at aal2 failed is_staff'; end if;

  -- sales with no factor: allowed until the enforcement date
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000b1', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if not tci.is_staff() then raise exception 'auth_hardening: sales without a factor was refused before the enforcement date'; end if;
  perform set_config('role', 'postgres', true);
  update tci.workflow_settings set mfa_staff_enforced_from = current_date;
  perform set_config('role', 'authenticated', true);
  if tci.is_staff() then raise exception 'auth_hardening: sales without a factor passed after the enforcement date'; end if;
  perform set_config('role', 'postgres', true);
  update tci.workflow_settings set mfa_staff_enforced_from = null;
  perform set_config('role', 'authenticated', true);

  -- a client with a verified factor must step up; one without passes
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000d2', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if tci.has_role('client') then raise exception 'auth_hardening: enrolled client at aal1 passed has_role'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000d2', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  if not tci.has_role('client') then raise exception 'auth_hardening: enrolled client at aal2 failed has_role'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000d1', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if not tci.has_role('client') then raise exception 'auth_hardening: client without a factor was refused'; end if;
  st := tci.my_auth_status();
  if (st ->> 'mfa_required')::boolean or (st ->> 'mfa_enrolled')::boolean then
    raise exception 'auth_hardening: my_auth_status wrong for a plain client: %', st;
  end if;
  perform set_config('role', 'postgres', true);
end $$;

-- ---- 4. the admin surface: views, unlock, sessions, prune -------------------
do $$
declare v_n int; v_res jsonb; v_events int;
begin
  -- a non-admin sees nothing and may do nothing
  perform set_config('role', 'authenticated', true); perform set_config('tci.internal_call', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000b1', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into v_n from tci.v_admin_auth_events; if v_n <> 0 then raise exception 'auth_hardening: sales reads auth events'; end if;
  select count(*) into v_n from tci.v_admin_lockouts;    if v_n <> 0 then raise exception 'auth_hardening: sales reads lockouts'; end if;
  select count(*) into v_n from tci.v_admin_sessions;    if v_n <> 0 then raise exception 'auth_hardening: sales reads sessions'; end if;
  select count(*) into v_n from tci.v_admin_user_security; if v_n <> 0 then raise exception 'auth_hardening: sales reads user security'; end if;
  begin
    perform tci.unlock_account('77777777-0000-4000-8000-0000000000b1');
    raise exception 'auth_hardening: sales could unlock an account';
  exception when sqlstate '42501' then null; end;
  begin
    perform tci.revoke_user_sessions('77777777-0000-4000-8000-0000000000b1', false);
    raise exception 'auth_hardening: sales could revoke sessions';
  exception when sqlstate '42501' then null; end;
  begin
    perform tci.prune_auth_data();
    raise exception 'auth_hardening: sales could prune the trail';
  exception when sqlstate '42501' then null; end;

  -- the admin, at aal2
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2', 'session_id', '77777777-0000-4000-8000-00000000ee99')::text, true);
  select count(*) into v_n from tci.v_admin_lockouts where active; if v_n <> 2 then raise exception 'auth_hardening: admin sees % active lockouts, expected 2', v_n; end if;
  select count(*) into v_n from tci.v_admin_sessions where email = 'ah-sales@t'; if v_n <> 2 then raise exception 'auth_hardening: admin sees % sessions, expected 2', v_n; end if;
  if exists (select 1 from tci.v_admin_sessions where ip_network in ('203.0.113.9', '2001:db8::9')) then
    raise exception 'auth_hardening: the sessions view shows a full IP address';
  end if;
  if not exists (select 1 from tci.v_admin_sessions where ip_network = '203.0.113.0') then
    raise exception 'auth_hardening: the sessions view does not show the /24 network';
  end if;
  select count(*) into v_n from tci.v_admin_user_security where email = 'ah-sales@t' and locked and failures_in_window = 5;
  if v_n <> 1 then raise exception 'auth_hardening: user security row wrong for the locked user'; end if;
  select count(*) into v_n from tci.v_admin_security_alerts where alert = 'lockout_burst';
  if v_n <> 0 then raise exception 'auth_hardening: 2 lockouts should not be a burst (threshold 3)'; end if;

  v_res := tci.unlock_account('77777777-0000-4000-8000-0000000000b1');
  select count(*) into v_n from tci.v_admin_lockouts where active; if v_n <> 1 then raise exception 'auth_hardening: unlock did not clear the lockout'; end if;
  begin
    perform tci.unlock_account('77777777-0000-4000-8000-0000000000d1');
    raise exception 'auth_hardening: unlocking an unlocked account did not refuse';
  exception when sqlstate 'P0002' then null; end;
  -- the SAME account a second time: its row is now history, not a lockout (0045)
  begin
    perform tci.unlock_account('77777777-0000-4000-8000-0000000000b1');
    raise exception 'auth_hardening: unlocking an already-cleared account did not refuse';
  exception when sqlstate 'P0002' then null; end;
  select count(*) into v_n from tci.v_admin_auth_events where event_type = 'lockout.cleared';
  if v_n <> 1 then raise exception 'auth_hardening: expected exactly one lockout.cleared event, got %', v_n; end if;

  v_n := tci.revoke_user_sessions('77777777-0000-4000-8000-0000000000b1', false);
  if v_n <> 2 then raise exception 'auth_hardening: revoke returned %, expected 2', v_n; end if;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from auth.refresh_tokens where session_id = '77777777-0000-4000-8000-00000000ee01';
  if v_n <> 0 then raise exception 'auth_hardening: the refresh token survived the session'; end if;

  -- the forgiven user signs in again
  set session authorization supabase_auth_admin;
  v_res := tci.password_verification_hook('{"user_id":"77777777-0000-4000-8000-0000000000b1","valid":true}');
  reset session authorization;
  if v_res ->> 'decision' <> 'continue' then raise exception 'auth_hardening: the unlocked user is still refused: %', v_res; end if;

  -- role changes are audited, with the actor
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '77777777-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into tci.user_roles (user_id, role) values ('77777777-0000-4000-8000-0000000000b1', 'claims');
  delete from tci.user_roles where user_id = '77777777-0000-4000-8000-0000000000b1' and role = 'claims';
  select count(*) into v_n from tci.v_admin_auth_events
   where event_type in ('user.role_granted', 'user.role_revoked') and email = 'ah-sales@t' and actor_email = 'ah-admin@t';
  if v_n <> 2 then raise exception 'auth_hardening: role changes were not audited (%)', v_n; end if;
  select count(*) into v_n from tci.v_admin_auth_events where event_type in ('lockout.cleared', 'session.revoked') and actor_email = 'ah-admin@t';
  if v_n <> 2 then raise exception 'auth_hardening: admin actions were not audited (%)', v_n; end if;

  -- pruning respects retention and refuses to touch fresh rows
  select count(*) into v_events from tci.v_admin_auth_events;
  v_res := tci.prune_auth_data();
  if (v_res ->> 'events_pruned')::int <> 0 then raise exception 'auth_hardening: prune removed fresh events'; end if;
  perform set_config('role', 'postgres', true);
  update tci.auth_events set at = now() - interval '400 days' where event_type = 'sign_in.failure';
  perform set_config('role', 'authenticated', true);
  v_res := tci.prune_auth_data();
  if (v_res ->> 'events_pruned')::int <> 5 then raise exception 'auth_hardening: prune removed % events, expected 5', v_res ->> 'events_pruned'; end if;
  perform set_config('role', 'postgres', true);

  -- IP hashing from request headers: present, salted, never the raw value
  perform set_config('request.headers', '{"x-forwarded-for": "198.51.100.7, 10.0.0.1"}', true);
  if tci.request_ip_hash() is null or tci.request_ip_hash() like '%198.51%' or length(tci.request_ip_hash()) <> 64 then
    raise exception 'auth_hardening: request_ip_hash is not a salted hash';
  end if;
  perform set_config('request.headers', '', true);
  if tci.request_ip_hash() is not null then raise exception 'auth_hardening: request_ip_hash without headers is not null'; end if;

  raise notice 'auth_hardening: OK — lockout hook, MFA policy, admin surface, retention and closure all hold';
end $$;

rollback;
