-- tests/db/sanctions_registry.sql — migration 0099 (screening covers the whole
-- registry), with role impersonation, in one transaction rolled back at the end:
--
--   1. A company added while no list is in use is not screened (nothing to
--      screen against) — but it is DUE once a list takes effect, although it
--      has no business at all, and the re-screening after the import reaches it.
--   2. A company added while a list is in use is screened at once, with the
--      reason 'entity_created', and a close name is a pending match with its
--      review task for a credit analyst.
--   3. The population is the whole registry.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000099a1', 'swr-an@t'),
  ('99999999-0000-4000-8000-0000000099a2', 'swr-im@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000099a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000099a2', 'information_manager');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'SWR ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'swr-%@t'
on conflict (user_id) do update set must_change_password = false;

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

create function pg_temp.owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('tci.internal_call', '', true);
end $$;
grant execute on function pg_temp.owner() to authenticated;

do $$
declare
  c_an  constant uuid := '99999999-0000-4000-8000-0000000099a1';
  c_im  constant uuid := '99999999-0000-4000-8000-0000000099a2';
  c_old constant uuid := '99999999-0000-4000-8000-0000000099e1';
  c_new constant uuid := '99999999-0000-4000-8000-0000000099e2';
  v_imp uuid;
  v     jsonb;
  v_n   integer;
begin
  -- Other tests roll back; this one needs no list in use to start with.
  if exists (select 1 from tci.sanctions_list_imports i where i.status = 'active') then
    raise exception 'sanctions_registry: a list is already in use before the test';
  end if;

  -- 1. Added with no list in use: nothing screened, nothing to screen against.
  perform pg_temp.act(c_im);
  insert into tci.legal_entities (id, name, country_code, created_by)
  values (c_old, 'SWR Plain Meadow Trading', 'UZ', c_im);
  perform pg_temp.owner();
  if exists (select 1 from tci.sanctions_screenings s where s.entity_id = c_old) then
    raise exception 'sanctions_registry: a company was screened with no list in use';
  end if;

  -- A list takes effect.
  perform pg_temp.act(c_an);
  v_imp := tci.begin_sanctions_list_import('un', null, current_date - 1, 'swr.xml', repeat('b', 64));
  perform tci.add_sanctions_list_entries(v_imp, jsonb_build_array(
    jsonb_build_object('ref', 'SWR-E1', 'kind', 'entity',
      'names', jsonb_build_array(jsonb_build_object('n', 'CINNABAR HARBOUR LOGISTICS', 'p', true)))));
  perform tci.finish_sanctions_list_import(v_imp);

  -- The company with no business at all is due — 0091 left it out.
  perform pg_temp.owner();
  if not exists (select 1 from tci.sanctions_due_entities() d where d.entity_id = c_old) then
    raise exception 'sanctions_registry: a company with no business is not due after a new list';
  end if;
  if (select count(*) from tci.sanctions_population()) <> (select count(*) from tci.legal_entities) then
    raise exception 'sanctions_registry: the population is not the whole registry';
  end if;

  -- The re-screening after the import reaches it.
  perform pg_temp.act(c_an);
  loop
    v := tci.rescreen_sanctions_due(500);
    exit when (v ->> 'remaining')::int = 0 or (v ->> 'screened')::int = 0;
  end loop;
  perform pg_temp.owner();
  if not exists (select 1 from tci.sanctions_screenings s
                  where s.entity_id = c_old and s.reason = 'list_import' and s.outcome = 'clear') then
    raise exception 'sanctions_registry: the company with no business was not screened after the import';
  end if;

  -- 2. Added while a list is in use: screened at once, and a close name is held.
  perform pg_temp.act(c_im);
  insert into tci.legal_entities (id, name, country_code, created_by)
  values (c_new, 'Cinnabar Harbour Logistics LLC', 'UZ', c_im);
  perform pg_temp.owner();
  select count(*) into v_n from tci.sanctions_screenings s
   where s.entity_id = c_new and s.reason = 'entity_created' and s.outcome = 'possible_match';
  if v_n <> 1 then
    raise exception 'sanctions_registry: a new company was screened % times on creation', v_n;
  end if;
  if not exists (select 1 from tci.sanctions_matches m
                  where m.entity_id = c_new and m.status = 'pending' and m.list_ref = 'SWR-E1') then
    raise exception 'sanctions_registry: the close name was not held as a possible match';
  end if;
  if not exists (select 1 from tci.tasks t
                  where t.task_type = 'sanctions_match_review' and t.object_id = c_new and t.status = 'open'
                    and t.target_user = c_an) then
    raise exception 'sanctions_registry: the possible match was not handed to the credit analyst';
  end if;
  -- The screening of the old company did not change because of it.
  if (select count(*) from tci.sanctions_screenings s where s.entity_id = c_old) <> 1 then
    raise exception 'sanctions_registry: another company was screened again';
  end if;

  raise notice 'sanctions_registry: OK — screened on creation, the whole registry re-screened after a list';
end $$;

rollback;
