-- tests/db/demo_worlds.sql — migration 0096 (demo data as a world of its own),
-- with role impersonation, in one transaction rolled back at the end:
--
--   1. A person in normal mode writes and reads real rows only; a person in
--      demo mode (or a demo account) writes and reads demo rows only.
--   2. A demo company is named «DEMO …» by the database; a real one may not be.
--   3. A row never moves between the worlds and never links the other world.
--   4. Real work is never routed to a demo account.
--   5. Only the person flips their own demo mode; nobody makes an account a
--      demo account through the API; the admin functions are admin's.
--   6. Sector grades are shared (owner 2026-11-03): a real analyst's review
--      is read in both worlds; nobody writes one from the demo world.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000096a1', 'dw-admin@t'),
  ('99999999-0000-4000-8000-0000000096a2', 'dw-sales@t'),
  ('99999999-0000-4000-8000-0000000096a3', 'dw-im@t'),
  ('99999999-0000-4000-8000-0000000096d1', 'dw-demo-im@demo.invalid'),
  ('99999999-0000-4000-8000-0000000096d2', 'dw-demo-sales@demo.invalid'),
  ('99999999-0000-4000-8000-0000000096a4', 'dw-analyst@t'),
  ('99999999-0000-4000-8000-0000000096d3', 'dw-demo-analyst@demo.invalid');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000096a1', 'admin'),
  ('99999999-0000-4000-8000-0000000096a2', 'sales'),
  ('99999999-0000-4000-8000-0000000096a3', 'information_manager'),
  ('99999999-0000-4000-8000-0000000096d1', 'information_manager'),
  ('99999999-0000-4000-8000-0000000096d2', 'sales'),
  ('99999999-0000-4000-8000-0000000096a4', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000096d3', 'credit_analyst');
insert into tci.user_profiles (user_id, full_name, must_change_password, is_demo_user, ui_demo_mode)
select u.id, 'DW ' || split_part(u.email, '@', 1), false, u.email like '%demo.invalid', u.email like '%demo.invalid'
  from auth.users u where u.email like 'dw-%'
on conflict (user_id) do update set must_change_password = false, is_demo_user = excluded.is_demo_user,
                                    ui_demo_mode = excluded.ui_demo_mode;
select set_config('tci.internal_call', '', true);

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
  perform set_config('request.jwt.claims', '', true);
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
    raise exception 'demo_worlds: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'demo_worlds: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_admin  constant uuid := '99999999-0000-4000-8000-0000000096a1';
  c_sales  constant uuid := '99999999-0000-4000-8000-0000000096a2';
  c_im     constant uuid := '99999999-0000-4000-8000-0000000096a3';
  c_dim    constant uuid := '99999999-0000-4000-8000-0000000096d1';
  c_dsales constant uuid := '99999999-0000-4000-8000-0000000096d2';
  c_an     constant uuid := '99999999-0000-4000-8000-0000000096a4';
  c_dan    constant uuid := '99999999-0000-4000-8000-0000000096d3';
  v_sector uuid;
  v_factors jsonb;
  v_real   uuid;
  v_demo   uuid;
  v_name   text;
  v_n      integer;
  v        jsonb;
begin
  -- 1. Each world writes and reads its own rows ---------------------------------
  perform pg_temp.act(c_sales);
  insert into tci.legal_entities (name, country_code) values ('DW Real Buyer LLC', 'UZ') returning id into v_real;
  perform pg_temp.act(c_dsales);
  insert into tci.legal_entities (name, country_code) values ('DW Demo Buyer LLC', 'UZ') returning id, name into v_demo, v_name;
  if v_name <> 'DEMO DW Demo Buyer LLC' then
    raise exception 'demo_worlds: a demo company is named %', v_name;
  end if;
  select count(*) into v_n from tci.legal_entities where name like '%DW %';
  if v_n <> 1 or not exists (select 1 from tci.legal_entities where id = v_demo) then
    raise exception 'demo_worlds: a demo account reads % companies, or not its own', v_n;
  end if;
  perform pg_temp.act(c_sales);
  select count(*) into v_n from tci.legal_entities where name like '%DW %';
  if v_n <> 1 or not exists (select 1 from tci.legal_entities where id = v_real) then
    raise exception 'demo_worlds: a real account reads % companies, or not its own', v_n;
  end if;
  update tci.legal_entities set address = 'Somewhere' where id = v_demo;
  if found then
    raise exception 'demo_worlds: a real account updated a demo company';
  end if;
  perform pg_temp.refused('insert into tci.legal_entities (name, country_code, is_demo) values (''DW Sneaky'', ''UZ'', true)',
                          '42501', 'a real account writing a demo row');

  -- the person switches to demo mode: now they see the demo world only
  update tci.user_profiles set ui_demo_mode = true where user_id = c_sales;
  select count(*) into v_n from tci.legal_entities where name like '%DW %';
  if v_n <> 1 or not exists (select 1 from tci.legal_entities where id = v_demo) then
    raise exception 'demo_worlds: demo mode reads the wrong world';
  end if;
  update tci.user_profiles set ui_demo_mode = false where user_id = c_sales;

  -- 2. «DEMO » is reserved ----------------------------------------------------
  perform pg_temp.refused('insert into tci.legal_entities (name, country_code) values (''DEMO Fake LLC'', ''UZ'')',
                          '23514', 'a real company named DEMO', 'demo_name_reserved');

  -- 3. Worlds never mix --------------------------------------------------------
  perform pg_temp.owner();
  perform pg_temp.refused(format('update tci.legal_entities set is_demo = true where id = %L', v_real),
                          '42501', 'moving a row to the demo world', 'demo_world_immutable');
  perform pg_temp.refused(format(
    'insert into tci.entity_relationships (parent_entity_id, child_entity_id, relationship_type) values (%L, %L, ''ownership'')',
    v_real, v_demo), '23514', 'a relationship between the worlds', 'demo_world_mixed');
  -- a child row takes its parent's world, whoever writes it
  insert into tci.financial_statements (entity_id, statement_kind, fiscal_year, period_end_date, currency_code, unit, source, created_by)
  values (v_demo, 'annual', 2025, '2025-12-31', 'UZS', 'thousands', 'test', c_dsales);
  if not (select s.is_demo from tci.financial_statements s where s.entity_id = v_demo) then
    raise exception 'demo_worlds: a demo company''s statement is not demo';
  end if;
  perform pg_temp.act(c_admin, 'aal2');
  if exists (select 1 from tci.demo_link_violations()) then
    raise exception 'demo_worlds: link violations %', (select jsonb_agg(x) from tci.demo_link_violations() x);
  end if;

  -- 4. Real work never reaches a demo account ------------------------------------
  perform pg_temp.act(c_sales);
  v := tci.request_entity('DW Prospect Real LLC', 'UZ', null, 'test');
  perform pg_temp.owner();
  if exists (select 1 from tci.entity_requests r where r.requested_name = 'DW Prospect Real LLC' and r.assigned_to = c_dim) then
    raise exception 'demo_worlds: a real data request went to a demo information manager';
  end if;
  if not exists (select 1 from tci.entity_requests r where r.requested_name = 'DW Prospect Real LLC'
                    and (r.assigned_to = c_im or r.assigned_to is null) and not r.is_demo) then
    raise exception 'demo_worlds: the real data request is not real or not routed to the real desk';
  end if;
  perform pg_temp.act(c_dsales);
  v := tci.request_entity('DW Prospect Demo LLC', 'UZ', null, 'test');
  perform pg_temp.owner();
  if not exists (select 1 from tci.entity_requests r where r.requested_name = 'DW Prospect Demo LLC'
                    and r.assigned_to = c_dim and r.is_demo) then
    raise exception 'demo_worlds: the demo data request did not go to the demo desk';
  end if;

  -- 5. Who switches what ---------------------------------------------------------
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('update tci.user_profiles set is_demo_user = true where user_id = %L', c_sales),
                          '42501', 'making oneself a demo account');
  perform pg_temp.refused('select tci.demo_data_counts()', '42501', 'counts for sales');
  perform pg_temp.refused('select tci.set_new_users_demo_mode(true)', '42501', 'the new-users switch for sales');
  perform pg_temp.act(c_admin, 'aal2');
  v := tci.demo_data_counts();
  if (v -> 'tables' ->> 'legal_entities')::int < 1 or (v ->> 'demo_users')::int < 2 then
    raise exception 'demo_worlds: counts %', v;
  end if;
  perform tci.set_new_users_demo_mode(true);
  if not (select w.new_users_demo_mode from tci.workflow_settings w limit 1) then
    raise exception 'demo_worlds: the new-users switch did not stick';
  end if;

  -- 6. Sector grades are shared ------------------------------------------------
  perform pg_temp.owner();
  if exists (select 1 from information_schema.columns
              where table_schema = 'tci' and table_name = 'sector_reviews' and column_name = 'is_demo') then
    raise exception 'demo_worlds: sector reviews belong to a world';
  end if;
  select s.id into v_sector from tci.sectors s order by s.industry_code limit 1;
  select jsonb_object_agg(k, jsonb_build_object('score', 'neutral', 'note', 'test'))
    into v_factors from unnest(tci.sector_factor_keys()) k;
  perform pg_temp.act(c_dan);
  perform pg_temp.refused(format('select tci.submit_sector_review(%L, ''B'', ''stable'', %L, ''DW demo review of the sector'')',
                                 v_sector, v_factors), '42501', 'a sector review from the demo world', 'demo_shared_write');
  perform pg_temp.act(c_an);
  perform tci.submit_sector_review(v_sector, 'C', 'negative', v_factors, 'DW real review of the sector', '[]'::jsonb, 'ad_hoc');
  if tci.sector_current_review(v_sector) is null then
    raise exception 'demo_worlds: the real analyst does not read the sector grade';
  end if;
  perform pg_temp.act(c_dsales);
  if (select r.grade from tci.sector_reviews r where r.id = (tci.sector_current_review(v_sector)).id) is distinct from 'C' then
    raise exception 'demo_worlds: the demo world does not read the shared sector grade';
  end if;

  perform pg_temp.owner();
  raise notice 'demo_worlds: OK — each world writes and reads only its rows (demo mode switches the world), demo companies are named DEMO by the database and the prefix is reserved, a row never changes world or links the other one, children follow their parent, real work is never routed to a demo account, only admin reads counts and sets the new-users switch, nobody makes an account a demo account, sector grades are shared and never written from the demo world';
end $$;

rollback;
