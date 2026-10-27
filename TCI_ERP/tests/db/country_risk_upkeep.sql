-- Tests for migration 0087: keeping the OECD list current — the admin
-- reminder (lazy, once, retired by an import that takes effect), the
-- preview of what a list changes (admin only), and the one
-- country_downgrade_review task for credit underwriting when a list makes
-- countries with in-force limits worse (manual close).
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/country_risk_upkeep.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.
-- Robust to a database that already holds an OECD list: the test's own
-- lists are dated today, so they are the ones in use.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000087b0', 'cru-cu0@t'),     -- credit underwriter, personal grant
  ('99999999-0000-4000-8000-0000000087c1', 'cru-sales@t'),
  ('99999999-0000-4000-8000-0000000087c2', 'cru-admin@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000087b0', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000087c1', 'sales'),
  ('99999999-0000-4000-8000-0000000087c2', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'CRU ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'cru-%@t'
on conflict (user_id) do update set must_change_password = false;
insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, valid_from, created_by) values
  ('99999999-0000-4000-8000-0000000087b0', 'credit', 'B', 10000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000087c2');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000087c1"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000087e0', 'CRU Holder', 'UZ', '99999999-0000-4000-8000-0000000087c1');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000087f1', '99999999-0000-4000-8000-0000000087e0', 'CRU-P1', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 10000, 0, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000087c1', 100000000);
update tci.policies set status = 'active' where id = '99999999-0000-4000-8000-0000000087f1';
select set_config('tci.internal_call', '', true);

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

create function pg_temp.refused(p_sql text, p_state text, p_label text) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state then return; end if;
    raise exception 'country_risk_upkeep: % refused with % (%) instead of %', p_label, v_state, v_msg, p_state;
  end;
  raise exception 'country_risk_upkeep: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text) to authenticated;

-- A buyer with a complete card, a recent statement and a B1 rating, in a
-- country the current lists rate 0–2 (no rank floor) and a B sector.
create function pg_temp.buyer(p_id uuid, p_name text, p_country char) returns void
language plpgsql as $$
begin
  perform pg_temp.owner();
  insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id)
  values (p_id, p_name, p_country, '99999999-0000-4000-8000-0000000087c1', 'CRU-' || right(p_id::text, 4), 'Somewhere', 'FOOD');
  insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
  values (p_id, p_id, 'annual', extract(year from current_date - 120)::int, current_date - 120, 'UZS', '99999999-0000-4000-8000-0000000087b0');
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_by)
  values (p_id, p_id, 30, 'B1', 50000000, 'UZS', '{}', '{}', 't', '99999999-0000-4000-8000-0000000087b0');
  perform set_config('tci.internal_call', '', true);
end $$;

-- Raised by sales, decided by the underwriter: an in-force limit.
create function pg_temp.limit_for(p_buyer uuid, p_amount numeric) returns jsonb
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_assessment uuid;
begin
  perform pg_temp.owner();
  insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
  values (v_id, '99999999-0000-4000-8000-0000000087f1', p_buyer, p_amount, 'UZS', 'draft', '99999999-0000-4000-8000-0000000087c1');
  perform pg_temp.act('99999999-0000-4000-8000-0000000087c1');
  perform tci.submit_limit_request(v_id);
  perform pg_temp.owner();
  select a.id into v_assessment from tci.credit_assessments a where a.entity_id = p_buyer order by a.created_at desc limit 1;
  perform pg_temp.act('99999999-0000-4000-8000-0000000087b0');
  return tci.decide_limit_request(v_id, 'approved', p_amount, 'UZS', current_date, null, '[]'::jsonb, null, v_assessment);
end $$;
grant execute on function pg_temp.limit_for(uuid, numeric) to authenticated;

do $$
declare
  c_cu0   constant uuid := '99999999-0000-4000-8000-0000000087b0';
  c_sales constant uuid := '99999999-0000-4000-8000-0000000087c1';
  c_admin constant uuid := '99999999-0000-4000-8000-0000000087c2';
  c_de    constant uuid := '99999999-0000-4000-8000-0000000087d1';
  c_cn    constant uuid := '99999999-0000-4000-8000-0000000087d2';
  c_nil   constant uuid := '00000000-0000-0000-0000-000000000000';
  v       jsonb;
  v_stale boolean;
  v_latest tci.country_risk_imports;
  v_task  tci.tasks%rowtype;
  v_n     integer;
  v_change jsonb;
begin
  -- 0. Two buyers with in-force limits, in Germany and China.
  perform pg_temp.buyer(c_de, 'CRU Germany', 'DE');
  perform pg_temp.buyer(c_cn, 'CRU China', 'CN');
  v := pg_temp.limit_for(c_de, 1000000);
  if v ->> 'result' <> 'decided' then raise exception 'country_risk_upkeep: the DE limit was not decided: %', v; end if;
  v := pg_temp.limit_for(c_cn, 2000000);
  if v ->> 'result' <> 'decided' then raise exception 'country_risk_upkeep: the CN limit was not decided: %', v; end if;

  -- 1. The reminder: one open task for admin while the list in use is
  --    older than the setting (4 months) or missing — through refresh_agenda.
  perform pg_temp.owner();
  if (select oecd_stale_months from tci.workflow_settings where id) <> 4 then
    raise exception 'country_risk_upkeep: the list should count as old after 4 months';
  end if;
  v_latest := tci.oecd_latest_import();
  v_stale := v_latest.id is null or v_latest.effective_date < current_date - interval '4 months';
  perform pg_temp.act(c_admin);
  perform tci.refresh_agenda();
  perform tci.refresh_agenda();
  perform pg_temp.owner();
  select count(*) into v_n from tci.tasks where task_type = 'oecd_review_due' and status = 'open';
  if v_n <> (case when v_stale then 1 else 0 end) then
    raise exception 'country_risk_upkeep: % open reminders, expected %', v_n, case when v_stale then 1 else 0 end;
  end if;
  if v_stale then
    select * into v_task from tci.tasks where task_type = 'oecd_review_due' and status = 'open';
    if v_task.target_role <> 'admin' or v_task.object_id <> coalesce(v_latest.id, c_nil) then
      raise exception 'country_risk_upkeep: the reminder is misaddressed: % %', v_task.target_role, v_task.object_id;
    end if;
    -- Admin sees it and cannot tick it off: the import answers it.
    perform pg_temp.act(c_admin);
    if not exists (select 1 from tci.tasks where id = v_task.id) then
      raise exception 'country_risk_upkeep: admin does not see the reminder';
    end if;
    perform pg_temp.refused(format('select tci.complete_task(%L)', v_task.id), 'P0001', 'the reminder ticked off by hand');
  end if;

  -- 2. List L1 (today): DE 0, CN 2, UZ 5 — it takes effect, answers the reminder.
  perform pg_temp.act(c_admin);
  v := tci.import_country_risk(current_date, 'L1.pdf',
         '[{"country_code":"DE","category":0},{"country_code":"CN","category":2},{"country_code":"UZ","category":5}]'::jsonb, null);
  if not (v ->> 'takes_effect')::boolean then raise exception 'country_risk_upkeep: L1 does not take effect: %', v; end if;
  perform pg_temp.owner();
  if exists (select 1 from tci.tasks where task_type = 'oecd_review_due' and status = 'open') then
    raise exception 'country_risk_upkeep: the reminder is still open after a current list';
  end if;
  if v_stale and (select status from tci.tasks where id = v_task.id) <> 'done' then
    raise exception 'country_risk_upkeep: the reminder was not answered by the import';
  end if;
  perform pg_temp.act(c_admin);
  perform tci.refresh_agenda();
  perform pg_temp.owner();
  if exists (select 1 from tci.tasks where task_type = 'oecd_review_due' and status = 'open') then
    raise exception 'country_risk_upkeep: a reminder reopened for a current list';
  end if;

  -- 3. The preview of L2 (CN to 6, DE dropped, UZ unchanged), admin only.
  perform pg_temp.act(c_cu0);
  perform pg_temp.refused('select tci.country_risk_import_preview(current_date, ''[]''::jsonb)', '42501', 'a preview by an underwriter');
  perform pg_temp.refused('select * from tci.country_risk_changes(''[]''::jsonb)', '42501', 'the internal comparison called directly');
  perform pg_temp.act(c_admin);
  v := tci.country_risk_import_preview(current_date,
         '[{"country_code":"CN","category":6},{"country_code":"UZ","category":5}]'::jsonb);
  if (v ->> 'superseded')::boolean or (v ->> 'first_import')::boolean then
    raise exception 'country_risk_upkeep: the preview misreads the list in use: %', v;
  end if;
  if jsonb_array_length(v -> 'changes') <> 2 then
    raise exception 'country_risk_upkeep: the preview should show two changes: %', v -> 'changes';
  end if;
  select c into v_change from jsonb_array_elements(v -> 'changes') c where c ->> 'country_code' = 'CN';
  if v_change ->> 'direction' <> 'worse' or (v_change ->> 'oecd_before')::int <> 2 or (v_change ->> 'oecd_after')::int <> 6
     or (v_change ->> 'buyers')::int < 1 or (v_change ->> 'exposure_uzs')::numeric < 2000000 then
    raise exception 'country_risk_upkeep: the CN change is wrong: %', v_change;
  end if;
  select c into v_change from jsonb_array_elements(v -> 'changes') c where c ->> 'country_code' = 'DE';
  if v_change ->> 'direction' <> 'worse' or v_change ->> 'oecd_after' is not null then
    raise exception 'country_risk_upkeep: a country dropped from the list is not worse: %', v_change;
  end if;
  -- An older file would not take effect.
  v := tci.country_risk_import_preview(current_date - 400, '[{"country_code":"CN","category":6}]'::jsonb);
  if not (v ->> 'superseded')::boolean then
    raise exception 'country_risk_upkeep: an older file is not marked superseded: %', v;
  end if;

  -- 4. Importing L2 opens ONE downgrade task for credit underwriting.
  v := tci.import_country_risk(current_date, 'L2.pdf',
         '[{"country_code":"CN","category":6},{"country_code":"UZ","category":5}]'::jsonb, null);
  if (v ->> 'downgrades')::int < 2 then
    raise exception 'country_risk_upkeep: L2 should report two downgrades: %', v;
  end if;
  perform pg_temp.owner();
  select * into v_task from tci.tasks
   where task_type = 'country_downgrade_review' and object_id = (v ->> 'import_id')::uuid and status = 'open';
  if not found or v_task.target_role <> 'credit_underwriter' or v_task.priority <> 'high'
     or (v_task.params ->> 'countries_count')::int < 2
     or not (v_task.params -> 'countries') @> '[{"code":"CN","from":2,"to":6}]'::jsonb then
    raise exception 'country_risk_upkeep: the downgrade task is wrong: %', to_jsonb(v_task);
  end if;
  -- Sales does not see it; credit underwriting closes it by hand.
  perform pg_temp.act(c_sales);
  if exists (select 1 from tci.tasks where id = v_task.id) then
    raise exception 'country_risk_upkeep: sales sees the downgrade task';
  end if;
  perform pg_temp.act(c_cu0);
  perform tci.complete_task(v_task.id);
  perform pg_temp.owner();
  if (select status from tci.tasks where id = v_task.id) <> 'done' then
    raise exception 'country_risk_upkeep: the downgrade task was not closed';
  end if;

  -- 5. An older list is stored but changes nothing and tells nobody.
  perform pg_temp.act(c_admin);
  v := tci.import_country_risk(current_date - 400, 'old.pdf', '[{"country_code":"CN","category":7}]'::jsonb, null);
  if (v ->> 'takes_effect')::boolean or (v ->> 'downgrades')::int <> 0 then
    raise exception 'country_risk_upkeep: an older list took effect: %', v;
  end if;
  perform pg_temp.owner();
  if (select r.category from tci.country_risk('CN') r) <> 6 then
    raise exception 'country_risk_upkeep: the list in use moved to an older file';
  end if;

  raise notice 'country_risk_upkeep: OK — the admin reminder opens once while the list is older than 4 months (or missing), cannot be ticked off and is answered by a list that takes effect; the preview (admin only) names each change with its buyers and limits and marks an older file; a list that makes countries with in-force limits worse opens one high-priority task for credit underwriting, which sales does not see and an underwriter closes; an older list changes nothing';
end $$;

rollback;
