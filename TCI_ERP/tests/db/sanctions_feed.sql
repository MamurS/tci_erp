-- tests/db/sanctions_feed.sql — migration 0095 (the sanctions feed account),
-- with role impersonation, in one transaction rolled back at the end:
--
--   1. A feed account (no role, scope 'sanctions_lists') imports a list:
--      begin, batches, finish, rescreen.
--   2. It may not confirm a shrunken list; a person may.
--   3. It can do nothing else: the search, the registry and the flags are
--      closed to it, as to any account without a role.
--   4. It stops being a feed when it gets a role, must change its password
--      or is banned; an account without a role and without the row is
--      refused.
--   5. Admin reads the feed accounts; nobody writes them through the API.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000095a1', 'sfd-feed@t'),
  ('99999999-0000-4000-8000-0000000095a2', 'sfd-norole@t'),
  ('99999999-0000-4000-8000-0000000095b1', 'sfd-analyst@t'),
  ('99999999-0000-4000-8000-0000000095b2', 'sfd-admin@t'),
  ('99999999-0000-4000-8000-0000000095b3', 'sfd-sales@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000095b1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000095b2', 'admin'),
  ('99999999-0000-4000-8000-0000000095b3', 'sales');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'SFD ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'sfd-%@t'
on conflict (user_id) do update set must_change_password = false;
insert into tci.feed_accounts (user_id, scope, note) values
  ('99999999-0000-4000-8000-0000000095a1', 'sanctions_lists', 'test feed');
select set_config('tci.internal_call', '', true);

-- The feed signs in with a password alone (aal1); admin has MFA (aal2).
create function pg_temp.act(p_user uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid, text) to authenticated;

create function pg_temp.owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('tci.internal_call', '', true);
end $$;
grant execute on function pg_temp.owner() to authenticated;

create function pg_temp.refused(p_sql text, p_state text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'sanctions_feed: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'sanctions_feed: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_feed    constant uuid := '99999999-0000-4000-8000-0000000095a1';
  c_norole  constant uuid := '99999999-0000-4000-8000-0000000095a2';
  c_analyst constant uuid := '99999999-0000-4000-8000-0000000095b1';
  c_admin   constant uuid := '99999999-0000-4000-8000-0000000095b2';
  c_sales   constant uuid := '99999999-0000-4000-8000-0000000095b3';
  v_rows    jsonb;
  v_imp     uuid;
  v_imp2    uuid;
  v         jsonb;
  v_n       integer;
begin
  select jsonb_agg(jsonb_build_object('ref', 'SFD-' || g, 'kind', 'entity',
                                      'names', jsonb_build_array(jsonb_build_object('n', 'SFD FEED PARTY ' || g, 'p', true))))
    into v_rows from generate_series(1, 10) g;

  -- 1. The feed imports a list -------------------------------------------------
  perform pg_temp.act(c_feed);
  if tci.has_role('credit_analyst', 'admin') or tci.is_staff() then
    raise exception 'sanctions_feed: the feed account answers as staff';
  end if;
  v_imp := tci.begin_sanctions_list_import('other', 'SFD feed test list', current_date - 2, 'feed.csv', repeat('b', 64));
  perform tci.add_sanctions_list_entries(v_imp, v_rows);
  v := tci.finish_sanctions_list_import(v_imp);
  if (v ->> 'entries')::int <> 10 then
    raise exception 'sanctions_feed: the feed import counted %', v;
  end if;
  v := tci.rescreen_sanctions_due(5);
  if v ->> 'screened' is null then
    raise exception 'sanctions_feed: the feed could not rescreen (%)', v;
  end if;
  perform pg_temp.refused(format('select tci.begin_sanctions_list_import(''other'', ''SFD feed test list'', current_date - 2, ''again.csv'', %L)', repeat('b', 64)),
                          'P0001', 'the same file from the feed', 'sanctions_list_same');

  -- 2. A shrunken list is a person's call ---------------------------------------
  v_imp2 := tci.begin_sanctions_list_import('other', 'SFD feed test list', current_date - 1, 'feed-2.csv');
  perform tci.add_sanctions_list_entries(v_imp2, jsonb_build_array(v_rows -> 0, v_rows -> 1));
  perform pg_temp.refused(format('select tci.finish_sanctions_list_import(%L)', v_imp2),
                          'P0001', 'a shrunken list from the feed', 'sanctions_list_shrunk');
  perform pg_temp.refused(format('select tci.finish_sanctions_list_import(%L, true)', v_imp2),
                          '42501', 'a feed confirming a shrunken list', 'sanctions_shrink_needs_person');
  perform pg_temp.act(c_analyst);
  v := tci.finish_sanctions_list_import(v_imp2, true);
  if (v ->> 'delisted')::int <> 8 then
    raise exception 'sanctions_feed: the analyst''s confirmation delisted %', v;
  end if;

  -- 3. Nothing else is open to the feed ----------------------------------------
  perform pg_temp.act(c_feed);
  perform pg_temp.refused('select * from tci.sanctions_search(''SFD FEED PARTY 1'')', '42501', 'a search by the feed');
  perform pg_temp.refused('select tci.task_transfer_candidates(array[]::uuid[])', '42501', 'the colleague list for the feed');
  select count(*) into v_n from tci.legal_entities;
  if v_n <> 0 then
    raise exception 'sanctions_feed: the feed reads % companies', v_n;
  end if;
  select count(*) into v_n from tci.sanctions_list_imports;
  if v_n <> 0 then
    raise exception 'sanctions_feed: the feed reads the list imports';
  end if;
  select count(*) into v_n from tci.feed_accounts;
  if v_n <> 0 then
    raise exception 'sanctions_feed: the feed reads the feed accounts';
  end if;

  -- 4. Who is not a feed -------------------------------------------------------
  perform pg_temp.act(c_norole);
  perform pg_temp.refused('select tci.begin_sanctions_list_import(''other'', ''SFD x'', current_date, ''x.csv'')',
                          '42501', 'an account without a role and without a feed row');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused('select tci.begin_sanctions_list_import(''other'', ''SFD x'', current_date, ''x.csv'')',
                          '42501', 'sales', 'sanctions_import_only');

  perform pg_temp.owner();
  update tci.user_profiles set must_change_password = true where user_id = c_feed;
  perform pg_temp.act(c_feed);
  perform pg_temp.refused('select tci.begin_sanctions_list_import(''other'', ''SFD x'', current_date, ''x.csv'')',
                          '42501', 'a feed that must change its password');
  perform pg_temp.owner();
  update tci.user_profiles set must_change_password = false where user_id = c_feed;
  update auth.users set banned_until = now() + interval '1 day' where id = c_feed;
  perform pg_temp.act(c_feed);
  perform pg_temp.refused('select tci.begin_sanctions_list_import(''other'', ''SFD x'', current_date, ''x.csv'')',
                          '42501', 'a banned feed');
  perform pg_temp.owner();
  update auth.users set banned_until = null where id = c_feed;
  insert into tci.user_roles (user_id, role) values (c_feed, 'sales');
  perform pg_temp.act(c_feed);
  perform pg_temp.refused('select tci.begin_sanctions_list_import(''other'', ''SFD x'', current_date, ''x.csv'')',
                          '42501', 'a feed that was given a role', 'sanctions_import_only');
  perform pg_temp.owner();

  -- 5. Admin reads the feed accounts; nobody writes them -----------------------
  perform pg_temp.act(c_admin, 'aal2');
  select count(*) into v_n from tci.feed_accounts f where f.user_id = c_feed;
  if v_n <> 1 then
    raise exception 'sanctions_feed: admin does not read the feed account';
  end if;
  perform pg_temp.refused(format('insert into tci.feed_accounts (user_id, scope) values (%L, ''sanctions_lists'')', c_admin),
                          '42501', 'admin writing a feed account');
  perform pg_temp.act(c_sales);
  select count(*) into v_n from tci.feed_accounts;
  if v_n <> 0 then
    raise exception 'sanctions_feed: sales reads the feed accounts';
  end if;
  perform pg_temp.refused('select tci.is_feed_account(''sanctions_lists'')', '42501', 'the feed check called through the API');

  perform pg_temp.owner();
  raise notice 'sanctions_feed: OK — a feed account without a role imports a list in batches, finishes and rescreens; it may not confirm a shrunken list (a person may); search, registry, imports and feed rows are closed to it; a role, a forced password change or a ban ends it; an account without the row and sales are refused; admin reads feed accounts, nobody writes them';
end $$;

rollback;
