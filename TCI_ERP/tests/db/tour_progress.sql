-- Tests for migration 0098: a person records their own guided tour progress
-- (staff and client), only in the shape the tour writes, and nobody else's;
-- anon reaches nothing and the 0048 closure stands.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/tour_progress.sql
--
-- One transaction, rolled back. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000098a1', 'tour-staff@t'),
  ('99999999-0000-4000-8000-0000000098a2', 'tour-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000098a1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000098a2', 'client');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000098a1', 'Tour Staff', false),
  ('99999999-0000-4000-8000-0000000098a2', 'Tour Client', false)
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
  c_staff  constant uuid := '99999999-0000-4000-8000-0000000098a1';
  c_client constant uuid := '99999999-0000-4000-8000-0000000098a2';
  c_state  constant jsonb := '{"credit_underwriter": {"status": "completed", "last_step": 11, "at": "2026-11-02T10:00:00.000Z"},
                                "release:2026.11": {"status": "skipped", "last_step": 0, "at": "2026-11-02T10:05:00.000Z"}}';
  v_n int;
begin
  -- Staff: writes and reads their own; the other display columns are untouched.
  perform pg_temp.act(c_staff);
  update tci.user_profiles set ui_tour_state = c_state where user_id = c_staff;
  get diagnostics v_n = row_count;
  if v_n <> 1 or (select ui_tour_state from tci.user_profiles where user_id = c_staff) <> c_state then
    raise exception 'tour_progress: staff could not record their own tour';
  end if;
  if (select coalesce(ui_theme, '') || coalesce(ui_scale::text, '') from tci.user_profiles where user_id = c_staff) <> '' then
    raise exception 'tour_progress: recording a tour changed another display setting';
  end if;

  -- Client: their own too (the portal tour).
  perform pg_temp.act(c_client);
  update tci.user_profiles
     set ui_tour_state = '{"client": {"status": "skipped", "last_step": 2, "at": "2026-11-02T11:00:00Z"}}'
   where user_id = c_client;
  if (select ui_tour_state -> 'client' ->> 'status' from tci.user_profiles where user_id = c_client) is distinct from 'skipped' then
    raise exception 'tour_progress: a client could not record their own tour';
  end if;

  -- Nobody else's: the row is invisible, so nothing changes — either way round.
  update tci.user_profiles set ui_tour_state = '{}' where user_id = c_staff;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'tour_progress: a client changed another person''s tour progress'; end if;
  perform pg_temp.act(c_staff);
  update tci.user_profiles set ui_tour_state = '{}' where user_id = c_client;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'tour_progress: staff changed another person''s tour progress'; end if;
  if exists (select 1 from tci.user_profiles where user_id = c_client) then
    raise exception 'tour_progress: staff could read a client''s profile row';
  end if;

  -- Only the shape the tour writes.
  begin
    update tci.user_profiles set ui_tour_state = '[1, 2]' where user_id = c_staff;
    raise exception 'tour_progress: an array was accepted';
  exception when check_violation then null;
  end;
  begin
    update tci.user_profiles
       set ui_tour_state = '{"sales": [{"status": "completed", "last_step": 0, "at": "x"}]}'
     where user_id = c_staff;
    raise exception 'tour_progress: an entry wrapped in an array was accepted';
  exception when check_violation then null;
  end;
  begin
    update tci.user_profiles set ui_tour_state = '{"sales": {"status": "seen", "last_step": 0, "at": "x"}}' where user_id = c_staff;
    raise exception 'tour_progress: an unknown status was accepted';
  exception when check_violation then null;
  end;
  begin
    update tci.user_profiles set ui_tour_state = '{"sales": {"status": "completed", "last_step": -1, "at": "x"}}' where user_id = c_staff;
    raise exception 'tour_progress: a negative step was accepted';
  exception when check_violation then null;
  end;
  begin
    update tci.user_profiles set ui_tour_state = '{"sales": {"status": "completed", "last_step": 1.5, "at": "x"}}' where user_id = c_staff;
    raise exception 'tour_progress: a fractional step was accepted';
  exception when check_violation then null;
  end;
  begin
    update tci.user_profiles set ui_tour_state = '{"sales": {"status": "completed", "at": "x"}}' where user_id = c_staff;
    raise exception 'tour_progress: an entry without its step was accepted';
  exception when check_violation then null;
  end;
  begin
    update tci.user_profiles set ui_tour_state = '{"Sales Tour!": {"status": "completed", "last_step": 0, "at": "x"}}' where user_id = c_staff;
    raise exception 'tour_progress: a malformed tour id was accepted';
  exception when check_violation then null;
  end;
  begin
    update tci.user_profiles
       set ui_tour_state = jsonb_build_object('sales', jsonb_build_object('status', 'completed', 'last_step', 0, 'at', repeat('x', 20000)))
     where user_id = c_staff;
    raise exception 'tour_progress: a value over 16 KB was accepted';
  exception when check_violation then null;
  end;

  -- The rotation flag stays closed to the person themselves.
  begin
    update tci.user_profiles set must_change_password = true where user_id = c_staff;
    raise exception 'tour_progress: must_change_password became writable';
  exception when insufficient_privilege then null;
  end;

  perform set_config('role', 'postgres', true);
  if has_column_privilege('anon', 'tci.user_profiles', 'ui_tour_state', 'select') then
    raise exception 'tour_progress: anon may read it';
  end if;
  raise notice 'tour_progress: OK — each person records and reads their own tour progress (staff and client), only in the tour''s shape (status, whole step >= 0, time, tour ids, 16 KB), nobody else''s either way, anon nothing, the other display settings and the 0048 closure unchanged';
end;
$$;

rollback;
