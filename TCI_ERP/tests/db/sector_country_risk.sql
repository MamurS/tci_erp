-- Tests for migration 0085: sector grades, country risk (OECD + internal
-- override), sanctions, the cover matrix and concentration — the eight
-- acceptance cases of Prompt 31 (the engine's trace is the analytics
-- service's own test).
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/sector_country_risk.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.
-- Amounts in UZS; every buyer is rated B1 (band B).

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000085a1', 'scr-an1@t'),     -- credit analyst, responsible for METL
  ('99999999-0000-4000-8000-0000000085a2', 'scr-an2@t'),     -- credit analyst
  ('99999999-0000-4000-8000-0000000085a3', 'scr-head@t'),    -- senior credit analyst (head)
  ('99999999-0000-4000-8000-0000000085b0', 'scr-cu0@t'),     -- credit underwriter, no rank, personal grant
  ('99999999-0000-4000-8000-0000000085b1', 'scr-cu1@t'),     -- credit underwriter, rank 1
  ('99999999-0000-4000-8000-0000000085b4', 'scr-cu4@t'),     -- credit underwriter, rank 4
  ('99999999-0000-4000-8000-0000000085c1', 'scr-sales@t'),
  ('99999999-0000-4000-8000-0000000085c2', 'scr-admin@t'),
  ('99999999-0000-4000-8000-0000000085c3', 'scr-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000085a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000085a2', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000085a3', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000085b0', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000085b1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000085b4', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000085c1', 'sales'),
  ('99999999-0000-4000-8000-0000000085c2', 'admin'),
  ('99999999-0000-4000-8000-0000000085c3', 'client');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'SCR ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'scr-%@t'
on conflict (user_id) do update set must_change_password = false;
update tci.user_profiles set senior_credit_analyst = true where user_id = '99999999-0000-4000-8000-0000000085a3';
insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, valid_from, created_by) values
  ('99999999-0000-4000-8000-0000000085b0', 'credit', 'B', 10000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000085c2');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000085c1"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000085e0', 'SCR Holder', 'UZ', '99999999-0000-4000-8000-0000000085c1');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000085f1', '99999999-0000-4000-8000-0000000085e0', 'SCR-P1', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 10000, 0, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000085c1', 100000000);
update tci.policies set status = 'active' where id = '99999999-0000-4000-8000-0000000085f1';
insert into tci.policyholder_users (entity_id, user_id, created_by) values
  ('99999999-0000-4000-8000-0000000085e0', '99999999-0000-4000-8000-0000000085c3', '99999999-0000-4000-8000-0000000085c1');
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('tci.resolving_validation', '', true);
  perform set_config('tci.committee_resolution', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

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
    raise exception 'sector_country_risk: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'sector_country_risk: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

-- A buyer with a complete card, a recent statement and a B1 rating.
create function pg_temp.buyer(p_id uuid, p_name text, p_country char, p_industry text) returns void
language plpgsql as $$
begin
  perform pg_temp.owner();
  insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id)
  values (p_id, p_name, p_country, '99999999-0000-4000-8000-0000000085c1', 'SCR-' || right(p_id::text, 4), 'Somewhere', p_industry);
  insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
  values (p_id, p_id, 'annual', extract(year from current_date - 120)::int, current_date - 120, 'UZS', '99999999-0000-4000-8000-0000000085a1');
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_by)
  values (p_id, p_id, 30, 'B1', 50000000, 'UZS', '{}', '{}', 't', '99999999-0000-4000-8000-0000000085a1');
  perform set_config('tci.internal_call', '', true);
end $$;

-- A request raised by sales on the policy through the real path.
create function pg_temp.submit(p_buyer uuid, p_amount numeric) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.owner();
  insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
  values (v_id, '99999999-0000-4000-8000-0000000085f1', p_buyer, p_amount, 'UZS', 'draft', '99999999-0000-4000-8000-0000000085c1');
  perform pg_temp.act('99999999-0000-4000-8000-0000000085c1');
  perform tci.submit_limit_request(v_id);
  perform pg_temp.owner();
  return v_id;
end $$;
grant execute on function pg_temp.submit(uuid, numeric) to authenticated;

create function pg_temp.decide(p_user uuid, p_request uuid, p_amount numeric) returns jsonb
language plpgsql as $$
declare v_assessment uuid;
begin
  perform pg_temp.owner();
  select a.id into v_assessment from tci.credit_assessments a
    join tci.credit_limit_requests r on r.entity_id = a.entity_id
   where r.id = p_request order by a.created_at desc limit 1;
  perform pg_temp.act(p_user);
  return tci.decide_limit_request(p_request, 'approved', p_amount, 'UZS', current_date, null, '[]'::jsonb, null, v_assessment);
end $$;
grant execute on function pg_temp.decide(uuid, uuid, numeric) to authenticated;

create function pg_temp.sector(p_industry text) returns uuid language sql as $$
  select id from tci.sectors where industry_code = p_industry
$$;
grant execute on function pg_temp.sector(text) to authenticated;

create function pg_temp.level(p_stream text, p_rank int) returns uuid language sql as $$
  select id from tci.authority_levels where stream::text = p_stream and rank = p_rank
$$;
grant execute on function pg_temp.level(text, int) to authenticated;

create function pg_temp.factors() returns jsonb language sql as $$
  select jsonb_object_agg(k, jsonb_build_object('score', 'neutral', 'note', 'n')) from unnest(tci.sector_factor_keys()) k
$$;
grant execute on function pg_temp.factors() to authenticated;

select pg_temp.buyer('99999999-0000-4000-8000-0000000085d1', 'SCR Metals One', 'DE', 'METL');
select pg_temp.buyer('99999999-0000-4000-8000-0000000085d2', 'SCR Metals Two', 'DE', 'METL');
select pg_temp.buyer('99999999-0000-4000-8000-0000000085d3', 'SCR Kazakh Food', 'KZ', 'FOOD');
select pg_temp.buyer('99999999-0000-4000-8000-0000000085d4', 'SCR Kazakh Food Two', 'KZ', 'FOOD');
select pg_temp.buyer('99999999-0000-4000-8000-0000000085d5', 'SCR Russian Food', 'RU', 'FOOD');
select pg_temp.buyer('99999999-0000-4000-8000-0000000085d6', 'SCR German Food', 'DE', 'FOOD');

do $$
declare
  c_an1   constant uuid := '99999999-0000-4000-8000-0000000085a1';
  c_an2   constant uuid := '99999999-0000-4000-8000-0000000085a2';
  c_head  constant uuid := '99999999-0000-4000-8000-0000000085a3';
  c_cu0   constant uuid := '99999999-0000-4000-8000-0000000085b0';
  c_cu1   constant uuid := '99999999-0000-4000-8000-0000000085b1';
  c_cu4   constant uuid := '99999999-0000-4000-8000-0000000085b4';
  c_sales constant uuid := '99999999-0000-4000-8000-0000000085c1';
  c_admin constant uuid := '99999999-0000-4000-8000-0000000085c2';
  c_client constant uuid := '99999999-0000-4000-8000-0000000085c3';
  c_holder constant uuid := '99999999-0000-4000-8000-0000000085e0';
  c_policy constant uuid := '99999999-0000-4000-8000-0000000085f1';
  c_met1  constant uuid := '99999999-0000-4000-8000-0000000085d1';
  c_met2  constant uuid := '99999999-0000-4000-8000-0000000085d2';
  c_kz1   constant uuid := '99999999-0000-4000-8000-0000000085d3';
  c_kz2   constant uuid := '99999999-0000-4000-8000-0000000085d4';
  c_ru    constant uuid := '99999999-0000-4000-8000-0000000085d5';
  c_de    constant uuid := '99999999-0000-4000-8000-0000000085d6';
  v       jsonb;
  v_req   uuid;
  v_req_ru uuid;
  v_req_met1 uuid;
  v_review tci.sector_reviews%rowtype;
  v_ovr   tci.country_risk_overrides%rowtype;
  v_sub   uuid := gen_random_uuid();
  v_n     integer;
  v_t     text;
begin
  -- 0. Before any grade or list the matrix is silent: an ordinary decision.
  v_req_met1 := pg_temp.submit(c_met1, 1000000);
  if tci.cover_required_rank_internal(c_met1) <> 0 then
    raise exception 'sector_country_risk: the matrix is not silent before any grade or OECD list';
  end if;
  v := pg_temp.decide(c_cu0, v_req_met1, 1000000);
  if v ->> 'result' <> 'decided' then
    raise exception 'sector_country_risk: an ordinary decision did not go through: %', v;
  end if;
  v_req_ru := pg_temp.submit(c_ru, 2000000);
  v := pg_temp.decide(c_cu0, v_req_ru, 2000000);
  if v ->> 'result' <> 'decided' then
    raise exception 'sector_country_risk: the RU decision did not go through: %', v;
  end if;

  -- 1. The quarterly task reaches the responsible analyst; the review puts
  --    the grade in force everywhere; an earlier quarter's review is stale.
  perform pg_temp.act(c_an1);
  perform pg_temp.refused(format('select tci.assign_sector_analyst(%L, %L)', pg_temp.sector('METL'), c_an1),
                          '42501', 'an analyst assigned by a non-admin');
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('select tci.assign_sector_analyst(%L, %L)', pg_temp.sector('METL'), c_cu0),
                          'P0001', 'a non-analyst made responsible', 'sector_analyst_not_analyst');
  perform tci.assign_sector_analyst(pg_temp.sector('METL'), c_an1);
  perform pg_temp.owner();
  select count(*) into v_n from tci.tasks
   where task_type = 'sector_review_due' and object_id = pg_temp.sector('METL') and status = 'open'
     and target_user = c_an1 and target_role = 'credit_analyst'
     and (params ->> 'quarter_start')::date = tci.quarter_start(current_date)
     and due_at = ((tci.quarter_start(current_date) + 14) + time '23:59') at time zone 'Asia/Tashkent';
  if v_n <> 1 then
    raise exception 'sector_country_risk: the quarterly task was not opened for the analyst, due on day 15';
  end if;
  -- Generated lazily on read, never twice.
  perform pg_temp.act(c_an1);
  perform tci.refresh_agenda();
  perform pg_temp.owner();
  if (select count(*) from tci.tasks where task_type = 'sector_review_due' and object_id = pg_temp.sector('METL')) <> 1 then
    raise exception 'sector_country_risk: the quarterly task was opened twice';
  end if;
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.submit_sector_review(%L, ''A'', ''stable'', %L, ''x'')', pg_temp.sector('METL'), pg_temp.factors()),
                          '42501', 'a sector review by sales');
  perform pg_temp.act(c_an1);
  perform pg_temp.refused(format('select tci.submit_sector_review(%L, ''A'', ''stable'', %L, ''x'')', pg_temp.sector('METL'),
                                 pg_temp.factors() - 'demand'),
                          'P0001', 'a review missing a factor', 'sector_review_factors');
  perform pg_temp.refused(format('select tci.submit_sector_review(%L, ''A'', ''stable'', %L, '' '')', pg_temp.sector('METL'), pg_temp.factors()),
                          'P0001', 'a review without a narrative', 'sector_review_narrative_required');
  v_review := tci.submit_sector_review(pg_temp.sector('METL'), 'A', 'stable', pg_temp.factors(),
                                       'Strong demand, stable margins.', '["Steel federation Q report"]'::jsonb);
  if v_review.status <> 'approved' then
    raise exception 'sector_country_risk: with four eyes off a review is not in force at once';
  end if;
  perform pg_temp.owner();
  if exists (select 1 from tci.tasks where task_type = 'sector_review_due' and object_id = pg_temp.sector('METL') and status = 'open') then
    raise exception 'sector_country_risk: the quarterly task did not close with the review';
  end if;
  perform pg_temp.act(c_cu0);
  select grade, stale into v_t, v from (select grade::text, to_jsonb(stale) as stale from tci.v_sector_grades where industry_code = 'METL') x;
  if v_t <> 'A' or v::boolean then
    raise exception 'sector_country_risk: the sector grade is not A and current (%, %)', v_t, v;
  end if;
  if tci.buyer_risk_context(c_met1) ->> 'sector_grade' <> 'A' then
    raise exception 'sector_country_risk: the buyer does not show its sector grade';
  end if;
  -- A review of an earlier quarter is stale.
  perform pg_temp.owner();
  insert into tci.sector_reviews (sector_id, quarter_start, kind, grade, outlook, factors, narrative, status, created_by, decided_by, decided_at)
  values (pg_temp.sector('FOOD'), tci.quarter_start((current_date - interval '3 months')::date), 'quarterly', 'B', 'negative',
          pg_temp.factors(), 'Last quarter.', 'approved', c_an2, c_an2, now() - interval '100 days');
  perform pg_temp.act(c_cu0);
  if not (select stale from tci.v_sector_grades where industry_code = 'FOOD') then
    raise exception 'sector_country_risk: a review of an earlier quarter is not stale';
  end if;
  -- Reviews never change.
  perform pg_temp.owner();
  perform pg_temp.refused(format('update tci.sector_reviews set grade = ''B'' where id = %L', v_review.id),
                          'P0001', 'a review rewritten', 'sector_review_immutable');

  -- 2. A downgrade A → D: credit underwriting is told which buyers it
  --    touches, and a decision in the sector needs one rank more.
  perform pg_temp.act(c_an1);
  v_review := tci.submit_sector_review(pg_temp.sector('METL'), 'D', 'negative', pg_temp.factors(),
                                       'Import quotas lifted; prices collapsed.', '[]'::jsonb, 'ad_hoc');
  perform pg_temp.owner();
  select (params ->> 'buyers')::int into v_n from tci.tasks
   where task_type = 'sector_downgrade_review' and object_id = pg_temp.sector('METL') and status = 'open'
     and target_role = 'credit_underwriter' and params ->> 'from' = 'A' and params ->> 'to' = 'D';
  if coalesce(v_n, 0) < 1 then
    raise exception 'sector_country_risk: the downgrade opened no affected-buyers task';
  end if;
  if not exists (select 1 from tci.workflow_events where event_type = 'sector.graded' and object_id = pg_temp.sector('METL')
                  and payload ->> 'to' = 'D') then
    raise exception 'sector_country_risk: no sector.graded event';
  end if;
  if tci.cover_required_rank_internal(c_met2) <> 1 then
    raise exception 'sector_country_risk: a D sector does not add one rank (%)', tci.cover_required_rank_internal(c_met2);
  end if;
  v_req := pg_temp.submit(c_met2, 1000000);
  v := pg_temp.decide(c_cu0, v_req, 1000000);
  if v ->> 'result' <> 'needs_validation' or (v ->> 'required_rank')::int <> 1 then
    raise exception 'sector_country_risk: a decision in a D sector did not need rank 1: %', v;
  end if;
  -- The manual close is the underwriter's.
  perform pg_temp.act(c_cu0);
  perform tci.complete_task((select id from tci.tasks where task_type = 'sector_downgrade_review'
                              and object_id = pg_temp.sector('METL') and status = 'open'));

  -- Four eyes on sector reviews, when switched on.
  perform pg_temp.act(c_admin);
  perform tci.set_risk_settings(15::smallint, true, 6::smallint, 40, false);
  perform pg_temp.act(c_an1);
  v_review := tci.submit_sector_review(pg_temp.sector('TEXT'), 'C', 'negative', pg_temp.factors(), 'Weak demand.');
  if v_review.status <> 'pending' then
    raise exception 'sector_country_risk: with four eyes on a review went into force alone';
  end if;
  perform pg_temp.refused(format('select tci.decide_sector_review(%L, true)', v_review.id),
                          '42501', 'one''s own sector review approved', 'four_eyes_own_sector_review');
  perform pg_temp.act(c_an2);
  if (select grade from tci.v_sector_grades where industry_code = 'TEXT') is not null then
    raise exception 'sector_country_risk: a pending review is in force';
  end if;
  perform tci.decide_sector_review(v_review.id, true);
  if (select grade from tci.v_sector_grades where industry_code = 'TEXT') <> 'C' then
    raise exception 'sector_country_risk: an approved review is not in force';
  end if;
  perform pg_temp.act(c_admin);
  perform tci.set_risk_settings(15::smallint, false, 6::smallint, 40, false);

  -- 3. The OECD list: imported with history; category 6 routes to rank 4;
  --    a country not in the list is not classified (the committee), never 0.
  perform pg_temp.act(c_an1);
  perform pg_temp.refused('select tci.import_country_risk(current_date, ''x.csv'', ''[{"country_code":"DE","category":0}]'')',
                          '42501', 'an import by an analyst');
  perform pg_temp.act(c_admin);
  perform pg_temp.refused('select tci.import_country_risk(current_date, ''x.csv'', ''[{"country_code":"XQ","category":0}]'')',
                          'P0001', 'an unknown country code', 'country_import_unknown');
  perform pg_temp.refused('select tci.import_country_risk(current_date, ''x.csv'', ''[{"country_code":"DE","category":8}]'')',
                          'P0001', 'a category beyond 7', 'country_import_category');
  perform pg_temp.refused('select tci.import_country_risk(current_date, ''x.csv'', ''[{"country_code":"DE","category":0},{"country_code":"de","category":1}]'')',
                          'P0001', 'a country twice', 'country_import_duplicate');
  perform tci.import_country_risk(current_date - 400, 'oecd-old.csv', '[{"country_code":"DE","category":0},{"country_code":"KZ","category":5}]', null);
  v := tci.import_country_risk(current_date - 10, 'oecd-2026.csv',
         '[{"country_code":"DE","category":0},{"country_code":"KZ","category":6},{"country_code":"UZ","category":5}]', 'Q3 list');
  if (v ->> 'rows')::int <> 3 then
    raise exception 'sector_country_risk: the import did not record its rows: %', v;
  end if;
  perform pg_temp.act(c_cu1);
  if (select oecd_category from tci.v_country_risk where country_code = 'KZ') <> 6
     or (select import_stale from tci.v_country_risk where country_code = 'KZ')
     or (select oecd_category from tci.v_country_risk where country_code = 'RU') is not null then
    raise exception 'sector_country_risk: the latest list is not the one in use (or RU is not «not classified»)';
  end if;
  if tci.cover_required_rank(c_ru) <> 5 or tci.cover_required_rank(c_kz1) <> 4 or tci.cover_required_rank(c_met2) <> 1 then
    raise exception 'sector_country_risk: the cover matrix ranks are wrong (RU %, KZ %, DE/D %)',
      tci.cover_required_rank(c_ru), tci.cover_required_rank(c_kz1), tci.cover_required_rank(c_met2);
  end if;
  -- The levels: rank 1, rank 4 and a committee.
  perform pg_temp.act(c_admin);
  perform tci.save_authority_level_grant(pg_temp.level('credit', 1), 'B', 5000000, 'UZS');
  perform tci.save_authority_level_grant(pg_temp.level('credit', 4), 'B', 50000000, 'UZS');
  perform tci.add_authority_level_member(pg_temp.level('credit', 1), c_cu1);
  perform tci.add_authority_level_member(pg_temp.level('credit', 4), c_cu4);
  v_req := pg_temp.submit(c_kz1, 500000);
  v := pg_temp.decide(c_cu1, v_req, 500000);
  if v ->> 'result' <> 'needs_validation' or (v ->> 'required_rank')::int <> 4 then
    raise exception 'sector_country_risk: a category 6 decision within the amount did not need rank 4: %', v;
  end if;
  perform pg_temp.act(c_cu1);
  v := tci.submit_limit_for_validation(v_req, null, 'approved', 500000, 'UZS', current_date, null, '[]'::jsonb, null,
         (select a.id from tci.credit_assessments a where a.entity_id = c_kz1 order by a.created_at desc limit 1));
  if (v ->> 'rank')::int <> 4 or v ->> 'kind' <> 'required' then
    raise exception 'sector_country_risk: a category 6 decision was not routed to rank 4: %', v;
  end if;
  -- Rank 4 decides it.
  perform pg_temp.act(c_cu4);
  v := tci.resolve_limit_validation((v ->> 'validation_id')::uuid, 'approve');
  if v ->> 'result' is distinct from 'decided' and (v ->> 'decision_id') is null then
    raise exception 'sector_country_risk: rank 4 could not decide the category 6 limit: %', v;
  end if;

  -- 4. An internal override, four eyes by the head of credit analysis;
  --    both values shown, the decision uses the internal one.
  perform pg_temp.act(c_an1);
  perform pg_temp.refused('select tci.propose_country_override(''KZ'', 2::smallint, '' '')',
                          'P0001', 'an override without a justification', 'country_override_justification');
  v_ovr := tci.propose_country_override('KZ', 2::smallint, 'Our own payment experience in KZ is far better than the OECD view.');
  perform pg_temp.owner();
  if not exists (select 1 from tci.tasks where task_type = 'country_override_approval' and object_id = v_ovr.id
                  and target_user = c_head and status = 'open') then
    raise exception 'sector_country_risk: the head of credit analysis got no approval task';
  end if;
  if tci.cover_required_rank_internal(c_kz2) <> 4 then
    raise exception 'sector_country_risk: a pending override is in use';
  end if;
  perform pg_temp.act(c_an2);
  perform pg_temp.refused(format('select tci.decide_country_override(%L, true)', v_ovr.id),
                          '42501', 'an override approved by a non-senior analyst', 'country_override_head_only');
  perform pg_temp.act(c_head);
  perform tci.decide_country_override(v_ovr.id, true, 'Agreed.');
  perform pg_temp.act(c_cu1);
  select oecd_category::text || '/' || internal_category::text || '/' || category::text || '/' || source
    into v_t from tci.v_country_risk where country_code = 'KZ';
  if v_t <> '6/2/2/internal' then
    raise exception 'sector_country_risk: both values are not shown, or the internal one is not in use (%)', v_t;
  end if;
  v_req := pg_temp.submit(c_kz2, 500000);
  v := pg_temp.decide(c_cu1, v_req, 500000);
  if v ->> 'result' <> 'decided' then
    raise exception 'sector_country_risk: the decision did not use the internal category: %', v;
  end if;
  -- A head cannot approve their own.
  perform pg_temp.act(c_head);
  v_ovr := tci.propose_country_override('UZ', 3::smallint, 'Domestic market we know.');
  perform pg_temp.refused(format('select tci.decide_country_override(%L, true)', v_ovr.id),
                          '42501', 'one''s own override approved', 'four_eyes_own_country_override');

  -- 5. A country flag: no new cover in SQL whatever the authority, an urgent
  --    task per in-force limit, the count reported, the client told only
  --    that cover is not available.
  perform pg_temp.act(c_an1);
  perform pg_temp.refused('select tci.set_sanction_flag(''country'', ''RU'', null, ''EU'', ''EU Regulation 833/2014'')',
                          '42501', 'a sanctions flag by an analyst', 'sanctions_manage_only');
  perform pg_temp.act(c_admin);
  v := tci.set_sanction_flag('country', 'RU', null, 'EU', 'EU Regulation 833/2014', 'Annex IV', current_date, null);
  if (v ->> 'limits_to_review')::int < 1 then
    raise exception 'sector_country_risk: the in-force limit was not counted: %', v;
  end if;
  perform pg_temp.owner();
  if not exists (select 1 from tci.tasks where task_type = 'sanctions_limit_review' and object_id = v_req_ru
                  and priority = 'urgent' and target_role = 'credit_underwriter' and status = 'open') then
    raise exception 'sector_country_risk: no urgent review task for the in-force limit';
  end if;
  -- A new request, from staff or from the portal, is refused in SQL.
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format(
      'insert into tci.credit_limit_requests (policy_id, entity_id, requested_amount, currency_code, status, requested_by) values (%L, %L, 1, ''UZS'', ''draft'', %L)',
      c_policy, c_ru, c_sales),
    'P0001', 'a request for a sanctioned country', 'cover_not_available: country');
  perform pg_temp.act(c_client);
  perform pg_temp.refused(format('select tci.client_request_limit(%L, %L, null, null, null, 100000, ''UZS'', null, null)', c_policy, c_ru),
                          'P0001', 'a client request for a sanctioned country', 'cover_not_available: country');
  -- Not even the top of the chain: the committee's marker changes nothing.
  perform pg_temp.owner();
  perform pg_temp.refused(format(
      'insert into tci.credit_limit_decisions (request_id, stage, outcome, approved_amount, currency_code, valid_from, decided_by) values (%L, ''credit'', ''approved'', 1, ''UZS'', current_date, %L)',
      v_req_ru, c_cu4),
    'P0001', 'an approving decision written by the owner', 'cover_not_available');
  -- A sanctioned policyholder is blocked at submission.
  perform pg_temp.owner();
  perform pg_temp.refused(format(
      'insert into tci.insurance_requests (entity_id, request_number, status, created_by) values (%L, ''SCR-IR-RU'', ''draft'', %L)',
      c_ru, c_sales),
    'P0001', 'a submission for a sanctioned policyholder', 'cover_not_available');
  -- Credit underwriting closes the review by hand (revoked or kept).
  perform pg_temp.act(c_cu0);
  perform tci.complete_task((select id from tci.tasks where task_type = 'sanctions_limit_review' and object_id = v_req_ru and status = 'open'));
  -- Lifting is stamped and reopens the path.
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('select tci.lift_sanction_flag(%L, '' '')', (v ->> 'flag_id')::uuid),
                          'P0001', 'a lift without a reason', 'sanctions_lift_reason');
  perform tci.lift_sanction_flag((v ->> 'flag_id')::uuid, 'Delisted.');
  perform pg_temp.owner();
  perform pg_temp.refused(format('update tci.sanction_flags set source = ''x'' where id = %L', (v ->> 'flag_id')::uuid),
                          'P0001', 'a lifted flag changed', 'sanction_flag_immutable');
  if tci.cover_block_internal(c_ru) is not null then
    raise exception 'sector_country_risk: a lifted flag still blocks';
  end if;

  -- 6. A company flag blocks a buyer in a clean country.
  perform pg_temp.act(c_admin);
  v := tci.set_sanction_flag('entity', null, c_de, 'OFAC', 'SDN List', 'SDN-1', current_date, null);
  if (v ->> 'limits_to_review')::int <> 0 then
    raise exception 'sector_country_risk: a buyer without limits produced review tasks: %', v;
  end if;
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format(
      'insert into tci.credit_limit_requests (policy_id, entity_id, requested_amount, currency_code, status, requested_by) values (%L, %L, 1, ''UZS'', ''draft'', %L)',
      c_policy, c_de, c_sales),
    'P0001', 'a request for a sanctioned company', 'cover_not_available: company');
  perform pg_temp.act(c_cu4);
  v := tci.buyer_risk_context(c_de);
  if v ->> 'cover_block' <> 'company' or jsonb_array_length(v -> 'sanctions') <> 1 then
    raise exception 'sector_country_risk: the decision screen does not show the company block: %', v;
  end if;
  if tci.cover_block(c_met1) is not null then
    raise exception 'sector_country_risk: a company flag blocks another company';
  end if;

  -- 7. Concentration: every buyer of the submission in one D sector.
  perform pg_temp.owner();
  insert into tci.insurance_requests (id, entity_id, request_number, status, created_by, currency_code)
  values (v_sub, c_holder, 'SCR-IR-1', 'underwriting', c_sales, 'UZS');
  insert into tci.insurance_request_buyers (request_id, entity_id, requested_amount, resolution_status, created_by) values
    (v_sub, c_met1, 3000000, 'ready', c_sales),
    (v_sub, c_met2, 1000000, 'ready', c_sales);
  perform pg_temp.refused(format(
      'insert into tci.insurance_request_buyers (request_id, entity_id, requested_amount, resolution_status, created_by) values (%L, %L, 1, ''ready'', %L)',
      v_sub, c_de, c_sales),
    'P0001', 'a sanctioned buyer in a package', 'cover_not_available: company');
  perform pg_temp.act(c_sales);
  v := tci.cover_concentration(null, v_sub);
  if not (v ->> 'warn')::boolean or not (v ->> 'single_cd_sector')::boolean or (v ->> 'share_cd')::numeric <> 100
     or (v ->> 'loading_hint_pct')::numeric <> 25 then
    raise exception 'sector_country_risk: no concentration warning on a one-D-sector submission: %', v;
  end if;
  v := tci.cover_concentration(c_policy, null);
  if (v ->> 'buyers')::int < 2 or v -> 'by_country' is null then
    raise exception 'sector_country_risk: the policy concentration is empty: %', v;
  end if;

  -- 8. Clients see nothing of it.
  perform pg_temp.act(c_client);
  select coalesce(sum(n), 0) into v_n from (
    select count(*) n from tci.sectors union all select count(*) from tci.sector_reviews
    union all select count(*) from tci.country_risk_imports union all select count(*) from tci.country_risk_classifications
    union all select count(*) from tci.country_risk_overrides union all select count(*) from tci.sanction_flags
    union all select count(*) from tci.risk_adjustment_settings
    union all select count(*) from tci.v_sector_grades union all select count(*) from tci.v_country_risk) x;
  if v_n <> 0 then
    raise exception 'sector_country_risk: a client reads % risk rows', v_n;
  end if;
  perform pg_temp.refused(format('select tci.buyer_risk_context(%L)', c_kz1), '42501', 'a client reading a buyer''s risk');
  perform pg_temp.refused(format('select tci.cover_block(%L)', c_kz1), '42501', 'a client probing a block');
  perform pg_temp.refused(format('select tci.cover_required_rank(%L)', c_kz1), '42501', 'a client probing the matrix');
  perform pg_temp.refused(format('select tci.cover_concentration(%L, null)', c_policy), '42501', 'a client reading concentration');
  perform pg_temp.owner();
  select string_agg(table_name || '.' || column_name, ', ') into v_t
    from information_schema.columns
   where table_schema = 'tci' and table_name like 'v\_client\_%'
     and (column_name ~ '(sector|oecd|sanction|country_risk|cover_block|required_rank|loading)');
  if v_t is not null then
    raise exception 'sector_country_risk: a client view carries an internal risk column: %', v_t;
  end if;
  perform pg_temp.act(c_client);
  perform pg_temp.refused('select tci.set_sanction_flag(''country'', ''RU'', null, ''EU'', ''x'')', '42501', 'a client setting a flag');

  -- Nothing is written by hand.
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('insert into tci.sanction_flags (scope, country_code, regime, source, set_by) values (''country'', ''IR'', ''UN'', ''x'', %L)', c_admin),
                          '42501', 'a flag written directly');
  perform pg_temp.refused('update tci.risk_adjustment_settings set notch = 0 where dimension = ''sector'' and key = ''A''',
                          '42501', 'a setting written directly');
  -- The matrix is admin's: a change is a function call.
  perform tci.save_risk_adjustment('country', '6', 0::smallint, 'C1', 'restricted', 3::smallint, 0::smallint, 20);
  perform pg_temp.act(c_cu1);
  perform pg_temp.refused('select tci.save_risk_adjustment(''country'', ''6'', 0::smallint, null, ''available'', 0::smallint, 0::smallint, 0)',
                          '42501', 'the matrix changed by an underwriter');

  perform pg_temp.owner();
  raise notice 'sector_country_risk: OK — quarterly task to the responsible analyst (lazy, once, day 15), reviews in force at once or with four eyes, stale after the quarter, immutable; a downgrade to D tells credit underwriting and adds a rank; OECD imports with history (latest in use, not classified = committee), category 6 to rank 4; an internal override approved by the head and used; country and company sanctions refused in SQL on every path, urgent tasks counted, lifted with a reason; concentration warns on one D sector; clients see none of it';
end $$;

rollback;
