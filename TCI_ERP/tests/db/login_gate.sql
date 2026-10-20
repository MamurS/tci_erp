-- Tests for migration 0046 (the Free-plan sign-in lockout). Run against the
-- local replay harness:
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/login_gate.sql
--
-- Everything runs in one transaction that is rolled back. login_begin is
-- called as `anon` with a request IP in request.headers, exactly as
-- PostgREST calls it; the hook is called as supabase_auth_admin (SET SESSION
-- AUTHORIZATION, which only a superuser can assume - on canonical only the
-- refusals around it are exercised). Every check raises on failure.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('88888888-0000-4000-8000-0000000000a1', 'lg-admin@t'),
  ('88888888-0000-4000-8000-0000000000b1', 'lg-sales@t'),
  ('88888888-0000-4000-8000-0000000000b2', 'lg-locked@t');
insert into tci.user_roles (user_id, role) values
  ('88888888-0000-4000-8000-0000000000a1', 'admin'),
  ('88888888-0000-4000-8000-0000000000b1', 'sales'),
  ('88888888-0000-4000-8000-0000000000b2', 'sales');
insert into tci.user_profiles (user_id, must_change_password) values
  ('88888888-0000-4000-8000-0000000000b1', false)
on conflict (user_id) do nothing;
create temp table lg_out (k text primary key, res jsonb) on commit drop;
grant all on lg_out to anon, authenticated, supabase_auth_admin;

-- helper: begin as anon from an IP
create function pg_temp.begin_as(p_email text, p_ip text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.headers', jsonb_build_object('cf-connecting-ip', p_ip)::text, true);
  perform set_config('role', 'anon', true);
  v := tci.login_begin(p_email);
  perform set_config('role', 'postgres', true);
  return v;
end $$;

do $$
declare v jsonb; i int;
begin
  -- 1. three free attempts, then a 30 s wait; failures reported before each
  for i in 0..2 loop
    v := pg_temp.begin_as('lg-sales@t', '203.0.113.1');
    if not (v ->> 'allowed')::boolean or (v ->> 'failures')::int <> i then
      raise exception 'login_gate 1: attempt % should be allowed with % failures, got %', i + 1, i, v;
    end if;
  end loop;
  v := pg_temp.begin_as('LG-Sales@t ', '203.0.113.1');   -- case and spaces normalised
  if (v ->> 'allowed')::boolean or (v ->> 'retry_after_seconds')::int not between 25 and 30 then
    raise exception 'login_gate 1: the 4th attempt should wait ~30 s, got %', v;
  end if;

  -- 2. the counter is per email + IP: another IP is not held back
  v := pg_temp.begin_as('lg-sales@t', '198.51.100.7');
  if not (v ->> 'allowed')::boolean then
    raise exception 'login_gate 2: another IP should be allowed, got %', v;
  end if;

  -- 3. an unknown email behaves exactly like a known one (no enumeration)
  for i in 0..2 loop
    perform pg_temp.begin_as('nobody-here@t', '203.0.113.1');
  end loop;
  v := pg_temp.begin_as('nobody-here@t', '203.0.113.1');
  if (v ->> 'allowed')::boolean or v ? 'user' or v ? 'exists' then
    raise exception 'login_gate 3: an unknown email must be throttled the same way, got %', v;
  end if;

  -- 4. malformed input is refused plainly
  begin
    perform pg_temp.begin_as('not-an-email', '203.0.113.1');
    raise exception 'login_gate 4: a malformed email was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 5. the hook consumes the ticket from 198.51.100.7 and resets that pair only
set session authorization supabase_auth_admin;
insert into lg_out values ('success', tci.custom_access_token_hook(jsonb_build_object(
  'user_id', '88888888-0000-4000-8000-0000000000b1', 'authentication_method', 'password',
  'claims', jsonb_build_object('sub', '88888888-0000-4000-8000-0000000000b1', 'email', 'lg-sales@t'))));
reset session authorization;
do $$
begin
  if (select res from lg_out where k = 'success') ? 'error'
     or (select res -> 'claims' ->> 'email' from lg_out where k = 'success') <> 'lg-sales@t' then
    raise exception 'login_gate 5: a ticketed password sign-in must pass with its claims';
  end if;
  if (select count(*) from tci.login_attempts
       where email_hash = tci.login_email_hash('lg-sales@t') and status = 'succeeded') <> 1 then
    raise exception 'login_gate 5: the ticket was not consumed';
  end if;
  -- the attacker's IP keeps its three pending failures
  if (pg_temp.begin_as('lg-sales@t', '203.0.113.1') ->> 'allowed')::boolean then
    raise exception 'login_gate 5: a success from another IP must not reset this IP''s wait';
  end if;
end $$;

-- 6. a second ticketless sign-in while NOT enforced: allowed, logged. (The
--    three IP1 tickets are still within their 90 s and would be consumed:
--    let them lapse first - a ticket outlives its attempt by design.)
update tci.login_attempts set expires_at = now() - interval '1 second'
 where email_hash = tci.login_email_hash('lg-sales@t') and status = 'pending';
set session authorization supabase_auth_admin;
insert into lg_out values ('no_ticket', tci.custom_access_token_hook(jsonb_build_object(
  'user_id', '88888888-0000-4000-8000-0000000000b1', 'authentication_method', 'password',
  'claims', jsonb_build_object('sub', '88888888-0000-4000-8000-0000000000b1', 'email', 'lg-sales@t'))));
-- refreshes and MFA steps never need a ticket
insert into lg_out values ('refresh', tci.custom_access_token_hook(jsonb_build_object(
  'user_id', '88888888-0000-4000-8000-0000000000b1', 'authentication_method', 'token_refresh',
  'claims', jsonb_build_object('sub', '88888888-0000-4000-8000-0000000000b1', 'email', 'lg-sales@t'))));
reset session authorization;
do $$
begin
  if (select res from lg_out where k = 'no_ticket') ? 'error' or (select res from lg_out where k = 'refresh') ? 'error' then
    raise exception 'login_gate 6: not enforced, a ticketless sign-in and a refresh must pass';
  end if;
  if not exists (select 1 from tci.auth_events where event_type = 'sign_in.no_ticket'
                  and user_id = '88888888-0000-4000-8000-0000000000b1') then
    raise exception 'login_gate 6: a ticketless sign-in was not logged';
  end if;
end $$;

-- 7. enforced: a ticketless correct password hard-locks the account
update tci.workflow_settings set login_gate_enforced = true where id;
set session authorization supabase_auth_admin;
insert into lg_out values ('bypass', tci.custom_access_token_hook(jsonb_build_object(
  'user_id', '88888888-0000-4000-8000-0000000000b1', 'authentication_method', 'password',
  'claims', jsonb_build_object('sub', '88888888-0000-4000-8000-0000000000b1', 'email', 'lg-sales@t'))));
insert into lg_out values ('bypass_refresh', tci.custom_access_token_hook(jsonb_build_object(
  'user_id', '88888888-0000-4000-8000-0000000000b1', 'authentication_method', 'token_refresh',
  'claims', jsonb_build_object('sub', '88888888-0000-4000-8000-0000000000b1', 'email', 'lg-sales@t'))));
reset session authorization;
do $$
declare v jsonb;
begin
  if not ((select res from lg_out where k = 'bypass') ? 'error')
     or (select res -> 'error' ->> 'message' from lg_out where k = 'bypass') not like 'account_locked:%' then
    raise exception 'login_gate 7: an enforced ticketless sign-in must be refused';
  end if;
  if not ((select res from lg_out where k = 'bypass_refresh') ? 'error') then
    raise exception 'login_gate 7: a bypass lock must also refuse token refresh';
  end if;
  if (select reason from tci.auth_lockouts where user_id = '88888888-0000-4000-8000-0000000000b1') <> 'bypass' then
    raise exception 'login_gate 7: the bypass lock was not recorded';
  end if;
  v := pg_temp.begin_as('lg-sales@t', '192.0.2.50');
  if (v ->> 'allowed')::boolean then
    raise exception 'login_gate 7: a hard-locked account must not start a sign-in from any IP';
  end if;
end $$;

-- 8. the admin unlock clears it, forgives the attempts and forces a new password
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '88888888-0000-4000-8000-0000000000a1',
    'role', 'authenticated', 'aal', 'aal2')::text, true);
  update tci.workflow_settings set mfa_required_for_admin = false where id;
  perform set_config('role', 'authenticated', true);
  v := tci.unlock_account('88888888-0000-4000-8000-0000000000b1');
  perform set_config('role', 'postgres', true);
  if v ->> 'reason' <> 'bypass' then
    raise exception 'login_gate 8: unlock should report the bypass reason, got %', v;
  end if;
  if not (select must_change_password from tci.user_profiles where user_id = '88888888-0000-4000-8000-0000000000b1') then
    raise exception 'login_gate 8: a bypass unlock must force a password change';
  end if;
  if exists (select 1 from tci.login_attempts where email_hash = tci.login_email_hash('lg-sales@t') and status = 'pending') then
    raise exception 'login_gate 8: unlock must forgive the pending attempts';
  end if;
end $$;

-- 9. a wait that reaches 15 minutes becomes an account lockout the admin sees,
--    and the hook refuses even a ticketed sign-in while it stands
update tci.workflow_settings set login_gate_enforced = false where id;
insert into tci.login_attempts (at, email_hash, ip_hash, expires_at)
select now() - interval '2 hours', tci.login_email_hash('lg-locked@t'), tci.security_hash('203.0.113.9'), now() - interval '2 hours'
  from generate_series(1, 7);
do $$
declare v jsonb;
begin
  v := pg_temp.begin_as('lg-locked@t', '203.0.113.9');     -- the 8th: 30 * 2^5 = 16 min
  if not (v ->> 'allowed')::boolean then
    raise exception 'login_gate 9: the 8th attempt should start (the old wait is over), got %', v;
  end if;
  if not exists (select 1 from tci.auth_lockouts where user_id = '88888888-0000-4000-8000-0000000000b2'
                  and reason = 'failures' and cleared_at is null and locked_until > now() + interval '14 minutes') then
    raise exception 'login_gate 9: a 16-minute wait was not written as an account lockout';
  end if;
end $$;
set session authorization supabase_auth_admin;
insert into lg_out values ('locked', tci.custom_access_token_hook(jsonb_build_object(
  'user_id', '88888888-0000-4000-8000-0000000000b2', 'authentication_method', 'password',
  'claims', jsonb_build_object('sub', '88888888-0000-4000-8000-0000000000b2', 'email', 'lg-locked@t'))));
insert into lg_out values ('locked_refresh', tci.custom_access_token_hook(jsonb_build_object(
  'user_id', '88888888-0000-4000-8000-0000000000b2', 'authentication_method', 'token_refresh',
  'claims', jsonb_build_object('sub', '88888888-0000-4000-8000-0000000000b2', 'email', 'lg-locked@t'))));
reset session authorization;
do $$
begin
  if (select res -> 'error' ->> 'message' from lg_out where k = 'locked') not like 'account_locked: too many%' then
    raise exception 'login_gate 9: the hook must refuse the right password during a lockout';
  end if;
  -- a failures lock must NOT end an existing session (someone else's guesses
  -- cannot sign the owner out)
  if (select res from lg_out where k = 'locked_refresh') ? 'error' then
    raise exception 'login_gate 9: a failures lock must not refuse token refresh';
  end if;
end $$;

-- 10. a distributed guess: 20 failures from 3 IPs lock the email everywhere
do $$
declare v jsonb; i int;
begin
  for i in 1..20 loop
    insert into tci.login_attempts (at, email_hash, ip_hash, expires_at)
    values (now() - interval '1 minute', tci.login_email_hash('dist@t'),
            tci.security_hash('10.0.0.' || (i % 3)), now());
  end loop;
  v := pg_temp.begin_as('dist@t', '10.9.9.9');
  if (v ->> 'allowed')::boolean then
    raise exception 'login_gate 10: 20 failures from 3 IPs must lock the email for a fresh IP';
  end if;
end $$;

-- 11. closure: anon reaches login_begin and nothing else; nobody but GoTrue
--     reaches the hook; nobody reads the attempts
do $$
begin
  perform set_config('role', 'anon', true);
  begin
    perform tci.limit_scope(gen_random_uuid(), null);
    raise exception 'login_gate 11: anon executed tci.limit_scope';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from tci.login_attempts;
    raise exception 'login_gate 11: anon read login_attempts';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'authenticated', true);
  begin
    perform tci.custom_access_token_hook('{}'::jsonb);
    raise exception 'login_gate 11: authenticated executed the hook';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
end $$;

-- 12. the after-sign-in notice counts my failed attempts since my previous sign-in
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '88888888-0000-4000-8000-0000000000b1',
    'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v := tci.my_sign_in_notice();
  perform set_config('role', 'postgres', true);
  if not (v ? 'failed_since_previous_sign_in') then
    raise exception 'login_gate 12: my_sign_in_notice returned %', v;
  end if;
end $$;

do $$ begin raise notice 'login_gate: OK — schedule, per-IP counters, no enumeration, ticket consumption, bypass lock, unlock, account lockout, distributed lock, closure'; end $$;
rollback;
