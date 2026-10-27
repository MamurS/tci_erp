-- Tests for migration 0082: a person sets their own colour theme and light /
-- dark mode, only to an offered value, and nobody else's; the zoom (0076) and
-- the text size (0081) are separate columns.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/ui_theme.sql
--
-- One transaction, rolled back. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000082a1', 'th-staff@t'),
  ('99999999-0000-4000-8000-0000000082a2', 'th-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000082a1', 'sales'),
  ('99999999-0000-4000-8000-0000000082a2', 'client');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000082a1', 'TH Staff', false),
  ('99999999-0000-4000-8000-0000000082a2', 'TH Client', false)
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
  c_staff  constant uuid := '99999999-0000-4000-8000-0000000082a1';
  c_client constant uuid := '99999999-0000-4000-8000-0000000082a2';
  v_n int;
begin
  -- Staff and client each set and read their own; the sizes are untouched.
  perform pg_temp.act(c_staff);
  update tci.user_profiles set ui_theme = 'salad', ui_mode = 'dark' where user_id = c_staff;
  if (select ui_theme || '/' || ui_mode from tci.user_profiles where user_id = c_staff) <> 'salad/dark' then
    raise exception 'ui_theme: staff could not set their own theme and mode';
  end if;
  if (select coalesce(ui_scale, 0) + coalesce(ui_text_scale, 0) from tci.user_profiles where user_id = c_staff) <> 0 then
    raise exception 'ui_theme: setting the theme changed the zoom or the text size';
  end if;
  perform pg_temp.act(c_client);
  update tci.user_profiles set ui_theme = 'plum', ui_mode = 'auto' where user_id = c_client;
  if (select ui_theme || '/' || ui_mode from tci.user_profiles where user_id = c_client) <> 'plum/auto' then
    raise exception 'ui_theme: a client could not set their own theme and mode';
  end if;

  -- Nobody else's: the row is invisible, so nothing changes.
  update tci.user_profiles set ui_theme = 'blue' where user_id = c_staff;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'ui_theme: a client changed another person''s theme'; end if;

  -- Only an offered value.
  begin
    update tci.user_profiles set ui_theme = 'orange' where user_id = c_client;
    raise exception 'ui_theme: an unknown theme was accepted';
  exception when check_violation then null;
  end;
  begin
    update tci.user_profiles set ui_mode = 'sepia' where user_id = c_client;
    raise exception 'ui_theme: an unknown mode was accepted';
  exception when check_violation then null;
  end;

  -- The rotation flag stays closed to the person themselves.
  begin
    update tci.user_profiles set must_change_password = true where user_id = c_client;
    raise exception 'ui_theme: must_change_password became writable';
  exception when insufficient_privilege then null;
  end;

  perform set_config('role', 'postgres', true);
  if has_column_privilege('anon', 'tci.user_profiles', 'ui_theme', 'select')
     or has_column_privilege('anon', 'tci.user_profiles', 'ui_mode', 'select') then
    raise exception 'ui_theme: anon may read it';
  end if;
  raise notice 'ui_theme: OK — each person sets and reads their own colour theme and light / dark mode (staff and client), only offered values, nobody else''s, the zoom, the text size and the 0048 closure unchanged';
end;
$$;

rollback;
