-- Tests for migration 0089: a person sets their own text on coloured badges
-- (white or dark), only to an offered value, and nobody else's; the theme,
-- the mode and the sizes are separate columns.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/ui_badge_ink.sql
--
-- One transaction, rolled back. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000089a1', 'bi-staff@t'),
  ('99999999-0000-4000-8000-0000000089a2', 'bi-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000089a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000089a2', 'client');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000089a1', 'BI Staff', false),
  ('99999999-0000-4000-8000-0000000089a2', 'BI Client', false)
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
  c_staff  constant uuid := '99999999-0000-4000-8000-0000000089a1';
  c_client constant uuid := '99999999-0000-4000-8000-0000000089a2';
  v_n int;
begin
  perform pg_temp.act(c_staff);
  update tci.user_profiles set ui_badge_ink = 'dark' where user_id = c_staff;
  if (select ui_badge_ink from tci.user_profiles where user_id = c_staff) <> 'dark' then
    raise exception 'ui_badge_ink: staff could not set their own';
  end if;
  if (select coalesce(ui_theme, '') || coalesce(ui_mode, '') from tci.user_profiles where user_id = c_staff) <> '' then
    raise exception 'ui_badge_ink: setting it changed the theme or the mode';
  end if;
  perform pg_temp.act(c_client);
  update tci.user_profiles set ui_badge_ink = 'white' where user_id = c_client;
  if (select ui_badge_ink from tci.user_profiles where user_id = c_client) <> 'white' then
    raise exception 'ui_badge_ink: a client could not set their own';
  end if;

  -- Nobody else's: the row is invisible, so nothing changes.
  update tci.user_profiles set ui_badge_ink = 'white' where user_id = c_staff;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'ui_badge_ink: a client changed another person''s choice'; end if;

  -- Only an offered value.
  begin
    update tci.user_profiles set ui_badge_ink = 'grey' where user_id = c_client;
    raise exception 'ui_badge_ink: an unknown value was accepted';
  exception when check_violation then null;
  end;

  perform set_config('role', 'postgres', true);
  if has_column_privilege('anon', 'tci.user_profiles', 'ui_badge_ink', 'select') then
    raise exception 'ui_badge_ink: anon may read it';
  end if;

  raise notice 'ui_badge_ink: OK — each person sets and reads their own text on coloured badges (staff and client), only white or dark, nobody else''s, the theme and mode untouched';
end $$;

rollback;
