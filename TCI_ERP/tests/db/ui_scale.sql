-- Tests for migration 0076: a person sets their own interface text size,
-- only to an offered value, and nobody else's.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/ui_scale.sql
--
-- One transaction, rolled back. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000076a1', 'ui-staff@t'),
  ('99999999-0000-4000-8000-0000000076a2', 'ui-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000076a1', 'sales'),
  ('99999999-0000-4000-8000-0000000076a2', 'client');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000076a1', 'UI Staff', false),
  ('99999999-0000-4000-8000-0000000076a2', 'UI Client', false)
on conflict (user_id) do update set must_change_password = false;

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

do $$
declare
  c_staff  constant uuid := '99999999-0000-4000-8000-0000000076a1';
  c_client constant uuid := '99999999-0000-4000-8000-0000000076a2';
  v_n int;
  v_state text;
begin
  -- Staff and client each set and read their own.
  perform pg_temp.act(c_staff);
  update tci.user_profiles set ui_scale = 200 where user_id = c_staff;
  if (select ui_scale from tci.user_profiles where user_id = c_staff) <> 200 then
    raise exception 'ui_scale: staff could not set their own size';
  end if;
  perform pg_temp.act(c_client);
  update tci.user_profiles set ui_scale = 125 where user_id = c_client;
  if (select ui_scale from tci.user_profiles where user_id = c_client) <> 125 then
    raise exception 'ui_scale: a client could not set their own size';
  end if;

  -- Nobody else's: the row is invisible, so nothing changes.
  update tci.user_profiles set ui_scale = 100 where user_id = c_staff;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'ui_scale: a client changed another person''s size'; end if;

  -- Only an offered value.
  begin
    update tci.user_profiles set ui_scale = 300 where user_id = c_client;
    raise exception 'ui_scale: 300 %% was accepted';
  exception when check_violation then null;
  end;

  -- The rotation flag stays closed to the person themselves.
  begin
    update tci.user_profiles set must_change_password = true where user_id = c_client;
    raise exception 'ui_scale: must_change_password became writable';
  exception when insufficient_privilege then null;
  end;

  perform set_config('role', 'postgres', true);
  raise notice 'ui_scale: OK — each person sets and reads their own size (staff and client), only 100–200 %%, nobody else''s, the 0048 closure unchanged';
end;
$$;

rollback;
