-- Tests for migration 0062: the failed-sign-in notice is anchored on the
-- previous successful sign-in (recorded by the app), acknowledged by a
-- server-side watermark (dismiss and password change), lists the attempts
-- with a masked network and user agent, and `client` is held alone.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/sign_in_notice.sql
--
-- One transaction, rolled back. Every UPDATE carries a WHERE clause. Each
-- round of attempts comes from its own network so the sign-in throttle
-- (3 free attempts per e-mail + network) never interferes.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-000000000ba1', 'notice-user@t'),
  ('99999999-0000-4000-8000-000000000ba2', 'notice-admin@t'),
  ('99999999-0000-4000-8000-000000000ba3', 'notice-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-000000000ba1', 'sales'),
  ('99999999-0000-4000-8000-000000000ba2', 'admin'),
  ('99999999-0000-4000-8000-000000000ba3', 'client');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-000000000ba1', 'Notice User', false),
  ('99999999-0000-4000-8000-000000000ba2', 'Notice Admin', false),
  ('99999999-0000-4000-8000-000000000ba3', 'Notice Client', false)
on conflict (user_id) do update set must_change_password = false where tci.user_profiles.user_id = excluded.user_id;

-- A REST request from a network, before sign-in (anon) …
create function pg_temp.from_net(p_ip text) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.headers',
    jsonb_build_object('x-forwarded-for', p_ip, 'user-agent', 'TestBrowser/1.0 (' || p_ip || ')')::text, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('tci.internal_call', '', true);
end $$;

-- … a wrong password: the page called login_begin, GoTrue said no.
create function pg_temp.fail(p_ip text) returns void language plpgsql as $$
begin
  perform pg_temp.from_net(p_ip);
  perform set_config('role', 'anon', true);
  perform tci.login_begin('notice-user@t');
  perform set_config('role', 'postgres', true);
end $$;
grant execute on function pg_temp.fail(text) to anon;

-- … a successful sign-in: the ticket, then the app records it with the new
-- session's token (iat = now).
create function pg_temp.succeed(p_ip text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.fail(p_ip);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '99999999-0000-4000-8000-000000000ba1', 'role', 'authenticated', 'aal', 'aal2',
    'iat', floor(extract(epoch from clock_timestamp())) + 1)::text, true);
  perform set_config('role', 'authenticated', true);
  v := tci.record_sign_in();
  perform set_config('role', 'postgres', true);
  return v;
end $$;
grant execute on function pg_temp.succeed(text) to anon, authenticated;

-- What the user sees right now.
create function pg_temp.notice() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '99999999-0000-4000-8000-000000000ba1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
  v := tci.my_sign_in_notice();
  perform set_config('role', 'postgres', true);
  return v;
end $$;
grant execute on function pg_temp.notice() to authenticated;

create function pg_temp.count() returns int language sql as
  $$ select (pg_temp.notice() ->> 'failed_since_previous_sign_in')::int $$;

do $$
declare
  v    jsonb;
  v_n  int;
  v_ip text;
  v_ua text;
begin
  -- 1. The anchor. A first sign-in is recorded by the app.
  v := pg_temp.succeed('198.51.100.10');
  if not (v ->> 'recorded')::boolean then
    raise exception 'sign_in_notice: the app did not record its own sign-in: %', v;
  end if;
  if pg_temp.count() <> 0 then
    raise exception 'sign_in_notice: a clean first sign-in reports % failures', pg_temp.count();
  end if;

  -- Two wrong passwords, then a sign-in: exactly those two are reported …
  perform pg_temp.fail('203.0.113.7');
  perform pg_temp.fail('203.0.113.7');
  perform pg_temp.succeed('198.51.100.20');
  if pg_temp.count() <> 2 then
    raise exception 'sign_in_notice: expected 2 failures since the previous sign-in, got %', pg_temp.count();
  end if;
  -- … with the time range, and the list carries the masked network and the
  -- user agent, never the address.
  v := pg_temp.notice();
  if v ->> 'first_failed_at' is null or v ->> 'last_failed_at' is null
     or (v ->> 'first_failed_at')::timestamptz > (v ->> 'last_failed_at')::timestamptz then
    raise exception 'sign_in_notice: the time range is wrong: %', v;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '99999999-0000-4000-8000-000000000ba1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*), min(ip_masked), min(user_agent) into v_n, v_ip, v_ua from tci.my_failed_sign_ins();
  perform set_config('role', 'postgres', true);
  if v_n <> 2 or v_ip <> '203.0.113.0/24' or v_ua not like 'TestBrowser/1.0%' then
    raise exception 'sign_in_notice: the attempt list is wrong (% rows, %, %)', v_n, v_ip, v_ua;
  end if;

  -- The NEXT sign-in moves the anchor: the old failures are no longer news.
  perform pg_temp.succeed('198.51.100.30');
  if pg_temp.count() <> 0 then
    raise exception 'sign_in_notice: the anchor did not move; % failures reported again', pg_temp.count();
  end if;

  -- 2. Acknowledgement by dismissal: failures up to the moment are done.
  perform pg_temp.fail('203.0.113.8');
  perform pg_temp.succeed('198.51.100.40');
  if pg_temp.count() <> 1 then
    raise exception 'sign_in_notice: expected 1 failure before acknowledging, got %', pg_temp.count();
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '99999999-0000-4000-8000-000000000ba1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
  perform tci.acknowledge_sign_in_failures();
  perform set_config('role', 'postgres', true);
  if pg_temp.count() <> 0 then
    raise exception 'sign_in_notice: «This was me» did not acknowledge the failures';
  end if;

  -- 3. Acknowledgement by a password change; a LATER failure still shows.
  perform pg_temp.fail('203.0.113.9');
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '99999999-0000-4000-8000-000000000ba1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
  perform tci.complete_password_change();
  perform set_config('role', 'postgres', true);
  perform pg_temp.fail('203.0.113.10');
  perform pg_temp.succeed('198.51.100.50');
  if pg_temp.count() <> 1 then
    raise exception 'sign_in_notice: after a password change expected only the later failure, got %', pg_temp.count();
  end if;

  -- 4. record_sign_in turns only the caller's own fresh ticket on its own
  --    network into a success: a ticket from another network stays counted.
  perform pg_temp.fail('192.0.2.77');
  perform pg_temp.from_net('192.0.2.88');
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '99999999-0000-4000-8000-000000000ba1', 'role', 'authenticated', 'aal', 'aal2',
    'iat', floor(extract(epoch from clock_timestamp())) + 1)::text, true);
  perform set_config('role', 'authenticated', true);
  v := tci.record_sign_in();
  perform set_config('role', 'postgres', true);
  if (v ->> 'recorded')::boolean then
    raise exception 'sign_in_notice: a ticket from another network was taken as this sign-in';
  end if;

  -- 5. Who may call what.
  perform pg_temp.from_net('192.0.2.1');
  perform set_config('role', 'anon', true);
  begin
    perform tci.record_sign_in();
    raise exception 'sign_in_notice: anon recorded a sign-in';
  exception when insufficient_privilege then null;
  end;
  begin
    perform tci.acknowledge_sign_in_failures();
    raise exception 'sign_in_notice: anon acknowledged failures';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'authenticated', true);
  begin
    perform tci.my_counted_failures();
    raise exception 'sign_in_notice: the internal counter is reachable';
  exception when insufficient_privilege then null;
  end;
  begin
    update tci.user_profiles set sign_in_ack_at = now() where user_id = '99999999-0000-4000-8000-000000000ba1';
    raise exception 'sign_in_notice: the watermark is writable through the API';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  -- 6. The role guard: `client` is held alone.
  begin
    insert into tci.user_roles (user_id, role) values ('99999999-0000-4000-8000-000000000ba1', 'client');
    raise exception 'sign_in_notice: client was added to a staff account';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'client_role_exclusive%' then raise; end if;
  end;
  begin
    insert into tci.user_roles (user_id, role) values ('99999999-0000-4000-8000-000000000ba3', 'sales');
    raise exception 'sign_in_notice: a staff role was added to a client account';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'client_role_exclusive%' then raise; end if;
  end;
  -- … both at once in one statement is refused as well …
  insert into auth.users (id, email) values ('99999999-0000-4000-8000-000000000ba4', 'notice-new@t');
  begin
    insert into tci.user_roles (user_id, role) values
      ('99999999-0000-4000-8000-000000000ba4', 'client'),
      ('99999999-0000-4000-8000-000000000ba4', 'claims');
    raise exception 'sign_in_notice: client and claims were granted together';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'client_role_exclusive%' then raise; end if;
  end;
  -- … through the admin's own path too (RLS "admin all"), and switching a
  -- user from client to staff the way the screen does it (delete, then
  -- insert) is allowed.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '99999999-0000-4000-8000-000000000ba2', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into tci.user_roles (user_id, role) values ('99999999-0000-4000-8000-000000000ba1', 'client');
    raise exception 'sign_in_notice: the admin added client to a staff account';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'client_role_exclusive%' then raise; end if;
  end;
  delete from tci.user_roles where user_id = '99999999-0000-4000-8000-000000000ba3' and role = 'client';
  insert into tci.user_roles (user_id, role) values ('99999999-0000-4000-8000-000000000ba3', 'sales');
  perform set_config('role', 'postgres', true);
  if (select array_agg(role::text) from tci.user_roles where user_id = '99999999-0000-4000-8000-000000000ba3') <> array['sales'] then
    raise exception 'sign_in_notice: switching a client to staff did not work';
  end if;
  if exists (select 1 from tci.user_roles group by user_id having bool_or(role = 'client') and count(*) > 1) then
    raise exception 'sign_in_notice: an account holds client with other roles';
  end if;

  perform set_config('request.headers', '', true);
  perform set_config('request.jwt.claims', '', true);
  raise notice 'sign_in_notice: OK — the app records its own sign-in, the anchor moves on every sign-in, the range and the masked list, dismissal and password change acknowledge, other networks never count as this sign-in, internal pieces closed, client held alone (direct, admin, multi-row; switching allowed)';
end;
$$;

rollback;
