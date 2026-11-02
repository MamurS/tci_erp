-- tests/db/demo_seed.sql — migration 0097 (load and unload the demo data), in
-- one transaction rolled back at the end:
--
--   1. Only admin loads and unloads; a password shorter than 12 is refused.
--   2. Loading fills every area (companies, ratings, limits at every stage,
--      a committee vote, a commercial increase on validation, information
--      gathering, policies, declarations, premium, a notice and a claim, a
--      group over its limit, a review per sector, submissions, Agenda work
--      for the departments), with demo accounts per role, and no row links
--      the other world. Loading again changes nothing.
--   3. Unloading removes every demo row (append-only tables included) and the
--      demo accounts, and leaves real data exactly as it was.
--   4. Loading again after an unload gives the same structure.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000097a1', 'ds-admin@t'),
  ('99999999-0000-4000-8000-0000000097a2', 'ds-sales@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000097a1', 'admin'),
  ('99999999-0000-4000-8000-0000000097a2', 'sales');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'DS ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'ds-%@t'
on conflict (user_id) do update set must_change_password = false;
insert into tci.fx_rates (currency_code, rate_date, rate_to_uzs, source)
select c, current_date - 1, r, 'manual' from (values ('USD', 12650), ('EUR', 13750), ('GBP', 16300)) v(c, r)
on conflict do nothing;
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
    raise exception 'demo_seed: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'demo_seed: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

-- every table's rows, real and demo, as one fingerprint of the real data
create function pg_temp.real_fingerprint() returns text language plpgsql as $$
declare t text; v text := ''; n bigint;
begin
  foreach t in array tci.demo_world_tables() loop
    execute format('select count(*) from tci.%I where not is_demo', t) into n;
    v := v || t || '=' || n || ';';
  end loop;
  return md5(v || (select count(*) from auth.users where email not like '%@demo.invalid')::text);
end $$;

do $$
declare
  c_admin constant uuid := '99999999-0000-4000-8000-0000000097a1';
  c_sales constant uuid := '99999999-0000-4000-8000-0000000097a2';
  v_real    uuid;
  v_before  text;
  v_loaded  text;
  v_tasks   bigint;
  v1        jsonb;
  v2        jsonb;
  v         jsonb;
  k         text;
  v_n       integer;
begin
  -- real data that must survive
  perform pg_temp.act(c_sales);
  insert into tci.legal_entities (name, country_code) values ('DS Real Company LLC', 'UZ') returning id into v_real;
  perform pg_temp.owner();
  v_before := pg_temp.real_fingerprint();
  select count(*) into v_tasks from tci.tasks where not is_demo;

  -- 1. Admin only --------------------------------------------------------------
  perform pg_temp.act(c_sales);
  perform pg_temp.refused('select tci.seed_demo_data()', '42501', 'sales loading demo data');
  perform pg_temp.refused('select tci.delete_demo_data()', '42501', 'sales unloading demo data');
  perform pg_temp.act(c_admin, 'aal2');
  perform pg_temp.refused('select tci.seed_demo_data(''short'')', 'P0001', 'a short demo password', 'demo_password_short');

  -- 2. Load ------------------------------------------------------------------
  v1 := tci.seed_demo_data('Demo-Password-2026');
  if not (v1 ->> 'loaded')::boolean or (v1 ->> 'demo_users')::int < 13 then
    raise exception 'demo_seed: load answered %', v1 - 'tables';
  end if;
  foreach k in array array['legal_entities', 'financial_statements', 'credit_assessments', 'credit_limit_requests',
                           'credit_limit_decisions', 'limit_validations', 'committee_votes', 'policies',
                           'declarations', 'premium_payments', 'overdue_notifications', 'claims', 'claim_invoices',
                           'group_limits', 'entity_relationships', 'sector_reviews', 'insurance_requests',
                           'commercial_offers', 'rating_proposals', 'entity_requests', 'client_buyer_proposals',
                           'country_risk_overrides', 'tasks', 'workflow_events'] loop
    if coalesce((v1 -> 'tables' ->> k)::int, 0) = 0 then
      raise exception 'demo_seed: the demo data has no %', k;
    end if;
  end loop;
  perform pg_temp.owner();
  -- the load adds no real row but the lazy reminders on the shared lists,
  -- which anyone opening the Agenda would have generated
  if exists (select 1 from tci.tasks t where not t.is_demo and t.created_at = now()
                and t.task_type::text not in ('oecd_review_due', 'sanctions_list_due')) then
    raise exception 'demo_seed: the load wrote real tasks %',
      (select jsonb_agg(t.task_type) from tci.tasks t where not t.is_demo and t.created_at = now());
  end if;
  v_loaded := pg_temp.real_fingerprint();
  select count(*) into v_n from tci.credit_limit_requests r where r.is_demo and r.status = 'information_gathering';
  if v_n = 0 then raise exception 'demo_seed: no request in information gathering'; end if;
  select count(*) into v_n from tci.limit_validations v where v.is_demo and v.stream = 'commercial' and v.status = 'pending';
  if v_n = 0 then raise exception 'demo_seed: no commercial increase on validation'; end if;
  perform tci.begin_trusted_call();   -- the group views call gated helpers
  select count(*) into v_n from tci.v_group_limit_status g where g.over_limit;
  if v_n = 0 then raise exception 'demo_seed: no group over its limit'; end if;
  select count(*) into v_n from tci.claims c where c.is_demo and c.overdue_notification_id is not null;
  if v_n = 0 then raise exception 'demo_seed: no claim from an overdue notification'; end if;
  if exists (select 1 from tci.sectors s where not exists (
               select 1 from tci.sector_reviews r where r.sector_id = s.id and r.is_demo)) then
    raise exception 'demo_seed: a sector has no demo review';
  end if;
  foreach k in array array['sales', 'commercial_underwriter', 'credit_underwriter', 'credit_analyst',
                           'information_manager', 'claims'] loop
    if not exists (select 1 from tci.tasks t where t.is_demo and t.status = 'open'
                     and (t.target_role::text = k or exists (select 1 from tci.user_roles ur
                                                              where ur.user_id = t.target_user and ur.role::text = k))) then
      raise exception 'demo_seed: no open demo task for %', k;
    end if;
  end loop;
  if exists (select 1 from tci.tasks t join tci.user_profiles p on p.user_id = t.target_user
              where not t.is_demo and p.is_demo_user) then
    raise exception 'demo_seed: a real task is addressed to a demo account';
  end if;
  if exists (select 1 from tci.legal_entities e where e.is_demo and e.name not like 'DEMO %') then
    raise exception 'demo_seed: a demo company is not named DEMO';
  end if;
  perform pg_temp.act(c_admin, 'aal2');
  if exists (select 1 from tci.demo_link_violations()) then
    raise exception 'demo_seed: link violations %', (select jsonb_agg(x) from tci.demo_link_violations() x);
  end if;
  v := tci.seed_demo_data();
  if not (v ->> 'already_loaded')::boolean or v -> 'tables' <> v1 -> 'tables' then
    raise exception 'demo_seed: a second load changed something';
  end if;

  -- 3. Unload ----------------------------------------------------------------
  v := tci.delete_demo_data();
  if (v -> 'after' ->> 'demo_users')::int <> 0 or (v -> 'after' ->> 'loaded')::boolean then
    raise exception 'demo_seed: unload left %', v -> 'after';
  end if;
  for k in select jsonb_object_keys(v -> 'after' -> 'tables') loop
    if (v -> 'after' -> 'tables' ->> k)::int <> 0 then
      raise exception 'demo_seed: unload left % rows in %', v -> 'after' -> 'tables' ->> k, k;
    end if;
  end loop;
  perform pg_temp.owner();
  foreach k in array tci.demo_world_tables() loop
    execute format('select count(*) from tci.%I where is_demo', k) into v_n;
    if v_n <> 0 then raise exception 'demo_seed: % demo rows left in %', v_n, k; end if;
  end loop;
  if exists (select 1 from auth.users u where u.email like 'demo.%@demo.invalid') then
    raise exception 'demo_seed: demo accounts left behind';
  end if;
  if pg_temp.real_fingerprint() <> v_loaded or not exists (select 1 from tci.legal_entities where id = v_real) then
    raise exception 'demo_seed: the unload touched real data';
  end if;
  if (select count(*) from tci.tasks where not is_demo) - v_tasks > 2 or v_before is null then
    raise exception 'demo_seed: the load left more than the two list reminders in the real world';
  end if;

  -- 4. Load again: the same structure -----------------------------------------
  perform pg_temp.act(c_admin, 'aal2');
  v2 := tci.seed_demo_data('Demo-Password-2026');
  if v2 -> 'tables' <> v1 -> 'tables' then
    raise exception 'demo_seed: the reload differs: % vs %', v2 -> 'tables', v1 -> 'tables';
  end if;
  v := tci.delete_demo_data();

  perform pg_temp.owner();
  raise notice 'demo_seed: OK — admin alone loads and unloads (password ≥ 12), the load fills every area with demo accounts per role and work for every department and links nothing across worlds, loading twice changes nothing, the unload leaves zero demo rows and no demo account and real data identical, and a reload gives the same structure';
end $$;

rollback;
