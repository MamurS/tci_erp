-- Tests for migration 0064: an attempt the browser reports as interrupted
-- (captcha, rate limit, network) is listed apart from wrong passwords in the
-- after-sign-in notice, only with the attempt's own ticket, once, while it
-- is pending — and the throttle still counts it.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/sign_in_interruptions.sql
--
-- One transaction, rolled back. Every UPDATE carries a WHERE clause. Each
-- round comes from its own network so the 3-free-attempts throttle never
-- interferes, except in the round that tests it.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-000000006401', 'interrupt-user@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-000000006401', 'sales');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-000000006401', 'Interrupt User', false)
on conflict (user_id) do update set must_change_password = false where tci.user_profiles.user_id = excluded.user_id;

-- A REST request from a network, before sign-in (anon).
create function pg_temp.from_net(p_ip text) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.headers',
    jsonb_build_object('x-forwarded-for', p_ip, 'user-agent', 'TestBrowser/1.0 (' || p_ip || ')')::text, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('tci.internal_call', '', true);
end $$;

-- The page starts an attempt and keeps the answer (with its ticket).
create function pg_temp.begin_attempt(p_ip text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.from_net(p_ip);
  perform set_config('role', 'anon', true);
  v := tci.login_begin('interrupt-user@t');
  perform set_config('role', 'postgres', true);
  return v;
end $$;
grant execute on function pg_temp.begin_attempt(text) to anon;

-- The page reports the attempt as interrupted (still anon: no session).
create function pg_temp.report(p_ip text, p_ticket text, p_reason text) returns void language plpgsql as $$
begin
  perform pg_temp.from_net(p_ip);
  perform set_config('role', 'anon', true);
  perform tci.login_interrupted(p_ticket, p_reason);
  perform set_config('role', 'postgres', true);
end $$;
grant execute on function pg_temp.report(text, text, text) to anon;

-- A successful sign-in: the ticket, then the app records it.
create function pg_temp.succeed(p_ip text) returns void language plpgsql as $$
begin
  perform pg_temp.begin_attempt(p_ip);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '99999999-0000-4000-8000-000000006401', 'role', 'authenticated', 'aal', 'aal2',
    'iat', floor(extract(epoch from clock_timestamp())) + 1)::text, true);
  perform set_config('role', 'authenticated', true);
  perform tci.record_sign_in();
  perform set_config('role', 'postgres', true);
end $$;
grant execute on function pg_temp.succeed(text) to anon, authenticated;

-- As the signed-in user.
create function pg_temp.as_user() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '99999999-0000-4000-8000-000000006401', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.as_user() to anon, authenticated;

do $$
declare
  v        jsonb;
  v_ticket text;
  v_n      int;
  v_reason text;
begin
  -- 0. The anchor: a previous successful sign-in.
  perform pg_temp.succeed('10.64.1.1');

  -- 1. Two wrong passwords: nothing is reported.
  perform pg_temp.begin_attempt('10.64.2.1');
  perform pg_temp.begin_attempt('10.64.2.1');

  -- 2. One attempt refused by the CAPTCHA: the page reports it with its ticket.
  v := pg_temp.begin_attempt('10.64.3.1');
  v_ticket := v ->> 'ticket';
  if v_ticket is null or length(v_ticket) <> 64 then
    raise exception 'sign_in_interruptions: login_begin handed out no 64-character ticket (%)', v;
  end if;
  if exists (select 1 from tci.login_attempts where ticket_hash = v_ticket) then
    raise exception 'sign_in_interruptions: the ticket is stored in clear';
  end if;
  perform pg_temp.report('10.64.3.1', v_ticket, 'captcha');

  -- 3. A label holds once: relabelling the same attempt changes nothing.
  perform pg_temp.report('10.64.3.1', v_ticket, 'network');
  select interrupted_reason into v_reason from tci.login_attempts
   where ticket_hash = tci.security_hash(v_ticket);
  if v_reason is distinct from 'captcha' then
    raise exception 'sign_in_interruptions: the label changed to %', v_reason;
  end if;

  -- 4. Nobody labels an attempt without its ticket, and only known reasons.
  perform pg_temp.report('10.64.2.1', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'network');
  v := pg_temp.begin_attempt('10.64.4.1');
  perform pg_temp.report('10.64.4.1', v ->> 'ticket', 'wrong_password');
  select count(*) into v_n from tci.login_attempts
   where email_hash = tci.login_email_hash('interrupt-user@t') and interrupted_reason is not null;
  if v_n <> 1 then
    raise exception 'sign_in_interruptions: % attempts are labelled, expected exactly the one with its ticket', v_n;
  end if;

  -- 5. Not after the attempt's 90 seconds.
  v := pg_temp.begin_attempt('10.64.5.1');
  update tci.login_attempts set expires_at = clock_timestamp() - interval '1 second'
   where ticket_hash = tci.security_hash(v ->> 'ticket');
  perform pg_temp.report('10.64.5.1', v ->> 'ticket', 'network');
  if (select interrupted_reason from tci.login_attempts where ticket_hash = tci.security_hash(v ->> 'ticket')) is not null then
    raise exception 'sign_in_interruptions: an expired attempt was labelled';
  end if;

  -- 6. This sign-in. The notice: four wrong passwords (2 + the unlabelled
  --    4.1 and 5.1), one interruption, listed apart.
  perform pg_temp.succeed('10.64.6.1');
  perform pg_temp.as_user();
  v := tci.my_sign_in_notice();
  if (v ->> 'failed_since_previous_sign_in')::int <> 4 or (v ->> 'interrupted_since_previous_sign_in')::int <> 1 then
    raise exception 'sign_in_interruptions: the notice counts % failed and % interrupted, expected 4 and 1',
      v ->> 'failed_since_previous_sign_in', v ->> 'interrupted_since_previous_sign_in';
  end if;
  select count(*), max(reason) into v_n, v_reason from tci.my_interrupted_sign_ins();
  if v_n <> 1 or v_reason <> 'captcha' then
    raise exception 'sign_in_interruptions: the interrupted list has % rows (%)', v_n, v_reason;
  end if;
  select count(*) into v_n from tci.my_failed_sign_ins();
  if v_n <> 4 then
    raise exception 'sign_in_interruptions: the wrong-password list has % rows, expected 4', v_n;
  end if;
  perform set_config('role', 'postgres', true);

  -- 7. The throttle still counts a labelled attempt: three interrupted
  --    attempts from one network, and the fourth waits.
  for v_n in 1..3 loop
    v := pg_temp.begin_attempt('10.64.7.1');
    perform pg_temp.report('10.64.7.1', v ->> 'ticket', 'network');
  end loop;
  v := pg_temp.begin_attempt('10.64.7.1');
  if (v ->> 'allowed')::boolean then
    raise exception 'sign_in_interruptions: three "network" labels reset the throttle';
  end if;

  -- 8. Closure: anon reaches the label and nothing of the notice; nobody
  --    reaches the internal window.
  perform pg_temp.from_net('10.64.8.1');
  perform set_config('role', 'anon', true);
  begin
    perform tci.my_interrupted_sign_ins();
    raise exception 'sign_in_interruptions: anon read the interrupted list';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user();
  begin
    perform tci.my_sign_in_window_attempts();
    raise exception 'sign_in_interruptions: an API role reached the internal window';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  raise notice 'sign_in_interruptions: OK — a ticket per attempt (hashed), the label only with that ticket, once, while pending, known reasons only; the notice counts wrong passwords and interruptions apart; the throttle still counts every attempt; the window closed to the API';
end $$;

rollback;
