-- Tests for migrations 0068–0069: the credit analyst, the credit analysis mode,
-- the engine grade kept apart from the grade in force, the one-time
-- confirmation with four eyes, the rating tasks following the mode, and the
-- separation of rating and decision in 'separate' mode.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/credit_analysis.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000069a1', 'ca-analyst@t'),
  ('99999999-0000-4000-8000-0000000069a2', 'ca-analyst2@t'),
  ('99999999-0000-4000-8000-0000000069a3', 'ca-credit@t'),
  ('99999999-0000-4000-8000-0000000069a4', 'ca-credit2@t'),
  ('99999999-0000-4000-8000-0000000069a5', 'ca-dual@t'),
  ('99999999-0000-4000-8000-0000000069a6', 'ca-sales@t'),
  ('99999999-0000-4000-8000-0000000069a7', 'ca-admin@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000069a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000069a2', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000069a3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000069a4', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000069a5', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000069a5', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000069a6', 'sales'),
  ('99999999-0000-4000-8000-0000000069a7', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000069a1', 'CA Analyst', false),
  ('99999999-0000-4000-8000-0000000069a2', 'CA Analyst 2', false),
  ('99999999-0000-4000-8000-0000000069a3', 'CA Credit', false),
  ('99999999-0000-4000-8000-0000000069a4', 'CA Credit 2', false),
  ('99999999-0000-4000-8000-0000000069a5', 'CA Dual', false),
  ('99999999-0000-4000-8000-0000000069a6', 'CA Sales', false),
  ('99999999-0000-4000-8000-0000000069a7', 'CA Admin', false)
on conflict (user_id) do update set must_change_password = false;
insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, valid_from, created_by)
select u, 'credit', b, 10000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000069a7'
  from unnest(array['99999999-0000-4000-8000-0000000069a3', '99999999-0000-4000-8000-0000000069a4',
                    '99999999-0000-4000-8000-0000000069a5']::uuid[]) u,
       unnest(array['A', 'B', 'C', 'D', 'unrated']::tci.grade_band[]) b;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000069a6"}', true);
insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id) values
  ('99999999-0000-4000-8000-0000000069e1', 'CA Holder', 'UZ', '99999999-0000-4000-8000-0000000069a6', 'CA-H', 'Tashkent',
   (select min(i.code) from tci.industries i)),
  ('99999999-0000-4000-8000-0000000069e2', 'CA Buyer', 'KZ', '99999999-0000-4000-8000-0000000069a6', 'CA-B', 'Almaty',
   (select min(i.code) from tci.industries i));
insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
values ('99999999-0000-4000-8000-0000000069d1', '99999999-0000-4000-8000-0000000069e2', 'annual',
        extract(year from current_date - 120)::int, current_date - 120, 'UZS', '99999999-0000-4000-8000-0000000069a3');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000069f1', '99999999-0000-4000-8000-0000000069e1', 'CA-P1', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 10000, 0, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000069a6', 10000000);
update tci.policies set status = 'active' where id = '99999999-0000-4000-8000-0000000069f1';
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid, p_session uuid default '99999999-0000-4000-8000-0000000069c0') returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2', 'session_id', p_session)::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid, uuid) to authenticated;

create function pg_temp.owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('tci.internal_call', '', true);
end $$;
grant execute on function pg_temp.owner() to authenticated;

-- The rating the caller calculates (as the API would insert it). Each its own
-- moment: in one transaction now() would tie them all.
create function pg_temp.rate(p_grade text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_at)
  values ('99999999-0000-4000-8000-0000000069e2', '99999999-0000-4000-8000-0000000069d1', 30, p_grade, 1000000, 'UZS',
          '{}', '{}', 't', clock_timestamp())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function pg_temp.rate(text) to authenticated;

-- p_states: '|'-separated SQLSTATEs that count as the refusal.
create function pg_temp.refused(p_sql text, p_states text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = any (string_to_array(p_states, '|')) and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'credit_analysis: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_states, coalesce(p_fragment, '');
  end;
  raise exception 'credit_analysis: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_analyst  constant uuid := '99999999-0000-4000-8000-0000000069a1';
  c_analyst2 constant uuid := '99999999-0000-4000-8000-0000000069a2';
  c_credit   constant uuid := '99999999-0000-4000-8000-0000000069a3';
  c_credit2  constant uuid := '99999999-0000-4000-8000-0000000069a4';
  c_dual     constant uuid := '99999999-0000-4000-8000-0000000069a5';
  c_sales    constant uuid := '99999999-0000-4000-8000-0000000069a6';
  c_admin    constant uuid := '99999999-0000-4000-8000-0000000069a7';
  c_buyer    constant uuid := '99999999-0000-4000-8000-0000000069e2';
  c_s_rate   constant uuid := '99999999-0000-4000-8000-0000000069c1';
  c_s_decide constant uuid := '99999999-0000-4000-8000-0000000069c2';
  v_a1       uuid;
  v_a2       uuid;
  v_row      tci.credit_assessments;
  v_req      uuid;
  v_task     uuid;
  v_caps     jsonb;
begin
  -- 1. Combined mode (the default): credit underwriting rates and decides,
  --    an analyst rates but never decides.
  if tci.credit_analysis_mode() <> 'combined' then
    raise exception 'credit_analysis: the default mode is not combined';
  end if;
  perform pg_temp.act(c_credit);
  if not (tci.has_capability('rate') and tci.has_capability('confirm_rating') and tci.has_capability('decide')) then
    raise exception 'credit_analysis: a credit underwriter lacks a capability in combined mode';
  end if;
  perform pg_temp.act(c_analyst);
  if not tci.has_capability('rate') or tci.has_capability('decide') then
    raise exception 'credit_analysis: an analyst''s capabilities are wrong in combined mode';
  end if;
  perform pg_temp.act(c_sales);
  if tci.has_capability('rate') or tci.has_capability('decide') then
    raise exception 'credit_analysis: sales holds a credit capability';
  end if;

  -- 2. The engine grade is frozen on insert, and who calculated is who is
  --    signed in, whatever the row claims.
  perform pg_temp.act(c_credit);
  v_a1 := pg_temp.rate('B1');
  perform pg_temp.owner();
  select * into v_row from tci.credit_assessments where id = v_a1;
  if v_row.engine_grade <> 'B1' or v_row.rating_grade <> 'B1' or v_row.created_by <> c_credit
     or v_row.confirmed_at is not null then
    raise exception 'credit_analysis: the inserted assessment is wrong (%)', to_jsonb(v_row);
  end if;

  -- 3. Four eyes: the one who calculated does not confirm.
  perform pg_temp.act(c_credit);
  perform pg_temp.refused(format('select tci.confirm_rating(%L)', v_a1), '42501', 'confirming one''s own rating',
                          'four_eyes_own_rating');
  -- sales confirms nothing
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.confirm_rating(%L)', v_a1), '42501', 'a sales confirmation',
                          'rating_confirm_not_allowed');

  -- 4. An override of the engine grade needs a reason; a bad code is refused.
  perform pg_temp.act(c_analyst);
  perform pg_temp.refused(format('select tci.confirm_rating(%L, ''C1'')', v_a1), 'P0001', 'an override without a comment',
                          'rating_override_comment_required');
  perform pg_temp.refused(format('select tci.confirm_rating(%L, ''Z9'', ''x'')', v_a1), 'P0001', 'a grade off the scale',
                          'rating_grade_invalid');
  v_row := tci.confirm_rating(v_a1, 'c1', 'Receivables concentration not in the model');
  if v_row.rating_grade <> 'C1' or v_row.engine_grade <> 'B1' or v_row.confirmed_by <> c_analyst
     or v_row.confirmation_comment is null then
    raise exception 'credit_analysis: the confirmation did not stamp (%)', to_jsonb(v_row);
  end if;
  -- the band of everything downstream follows the grade in force
  if tci.grade_band_for_assessment(v_a1) <> 'C' then
    raise exception 'credit_analysis: the band does not follow the confirmed grade';
  end if;
  perform pg_temp.refused(format('select tci.confirm_rating(%L)', v_a1), 'P0001', 'a second confirmation',
                          'rating_already_confirmed');
  perform pg_temp.owner();
  if not exists (select 1 from tci.workflow_events e where e.event_type = 'rating.confirmed' and e.object_id = v_a1
                    and e.payload ->> 'grade' = 'C1' and (e.payload ->> 'overridden')::boolean) then
    raise exception 'credit_analysis: no rating.confirmed event';
  end if;

  -- 5. History is immutable: the API may not change or remove an assessment,
  --    and not even the owner may change anything but the confirmation.
  perform pg_temp.act(c_credit);
  perform pg_temp.refused(format('update tci.credit_assessments set rating_score = 1 where id = %L', v_a1), '42501',
                          'an API update of an assessment');
  perform pg_temp.refused(format('delete from tci.credit_assessments where id = %L', v_a1), '42501',
                          'an API delete of an assessment');
  perform pg_temp.owner();
  perform pg_temp.refused(format('update tci.credit_assessments set rating_score = 1 where id = %L', v_a1), 'P0001',
                          'an owner update of an assessment', 'rating_immutable');

  -- 6. Only the buyer's current rating is confirmed.
  perform pg_temp.act(c_credit2);
  v_a2 := pg_temp.rate('B2');
  perform pg_temp.owner();
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_by, created_at)
  values (c_buyer, '99999999-0000-4000-8000-0000000069d1', 40, 'B2', 1, 'UZS', '{}', '{}', 't', c_credit2,
          now() - interval '2 days')
  returning id into v_a1;
  perform pg_temp.act(c_analyst);
  perform pg_temp.refused(format('select tci.confirm_rating(%L)', v_a1), 'P0001', 'confirming an older rating',
                          'rating_not_latest');

  -- 7. The mode is admin's switch; sales may not touch it.
  perform pg_temp.act(c_sales);
  perform pg_temp.refused('select tci.set_credit_analysis_mode(''separate'')', '42501', 'a sales mode switch');
  perform pg_temp.act(c_admin);
  perform pg_temp.refused('select tci.set_credit_analysis_mode(''both'')', 'P0001', 'an unknown mode',
                          'credit_analysis_mode_invalid');

  -- An open rating task for the department, opened in combined mode.
  perform pg_temp.owner();
  perform tci.begin_trusted_call();
  perform tci.open_task('rating_stale', 'legal_entity', c_buyer, 'agenda.tasks.rating_stale',
                        jsonb_build_object('entity_id', c_buyer), 'credit_underwriter'::tci.user_role);
  select id into v_task from tci.tasks where task_type = 'rating_stale' and object_id = c_buyer and status = 'open';
  if (select target_role from tci.tasks where id = v_task) <> 'credit_underwriter' then
    raise exception 'credit_analysis: a combined-mode rating task did not go to credit underwriting';
  end if;

  perform pg_temp.act(c_admin);
  v_caps := tci.set_credit_analysis_mode('separate');
  if (v_caps ->> 'tasks_moved')::int < 1 or v_caps ->> 'mode' <> 'separate' then
    raise exception 'credit_analysis: the mode switch answered %', v_caps;
  end if;
  perform pg_temp.owner();
  if (select target_role from tci.tasks where id = v_task) <> 'credit_analyst' then
    raise exception 'credit_analysis: the open rating task did not follow the mode';
  end if;
  -- a new rating task goes to the analysts directly
  perform tci.begin_trusted_call();
  perform tci.close_tasks(array['rating_stale']::tci.task_type[], c_buyer);
  perform tci.open_task('buyer_needs_rating', 'legal_entity', c_buyer, 'agenda.tasks.buyer_needs_rating',
                        jsonb_build_object('entity_id', c_buyer), 'credit_underwriter'::tci.user_role);
  if (select target_role from tci.tasks where task_type = 'buyer_needs_rating' and object_id = c_buyer and status = 'open')
     <> 'credit_analyst' then
    raise exception 'credit_analysis: a separate-mode rating task did not go to the analysts';
  end if;
  -- any other task keeps its department
  perform tci.open_task('limit_needs_decision', 'credit_limit_request', c_buyer, 'agenda.tasks.limit_needs_decision',
                        '{}'::jsonb, 'credit_underwriter'::tci.user_role);
  if (select target_role from tci.tasks where task_type = 'limit_needs_decision' and object_id = c_buyer and status = 'open')
     <> 'credit_underwriter' then
    raise exception 'credit_analysis: a decision task was rerouted';
  end if;
  perform tci.begin_trusted_call();
  perform tci.close_tasks(array['buyer_needs_rating', 'limit_needs_decision']::tci.task_type[], c_buyer);

  -- 8. Separate mode: only analysts rate and confirm; underwriting decides.
  perform pg_temp.act(c_credit);
  if tci.has_capability('rate') or tci.has_capability('confirm_rating') or not tci.has_capability('decide') then
    raise exception 'credit_analysis: a credit underwriter''s capabilities are wrong in separate mode';
  end if;
  perform pg_temp.refused('select pg_temp.rate(''B1'')', '42501', 'a separate-mode rating by credit underwriting');
  perform pg_temp.refused(format('select tci.confirm_rating(%L)', v_a2), '42501', 'a separate-mode confirmation by credit',
                          'rating_confirm_not_allowed');
  perform pg_temp.act(c_analyst);
  v_caps := tci.my_capabilities();
  if v_caps -> 'capabilities' <> '["rate", "confirm_rating"]'::jsonb then
    raise exception 'credit_analysis: an analyst''s capabilities in separate mode are %', v_caps;
  end if;

  -- 9. The dual-role person rates as an analyst and may not decide the
  --    limit on that rating as an underwriter.
  perform pg_temp.act(c_dual, c_s_rate);
  perform tci.set_acting_role('credit_analyst');
  v_a2 := pg_temp.rate('B1');
  perform pg_temp.owner();
  v_req := gen_random_uuid();
  insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
  values (v_req, '99999999-0000-4000-8000-0000000069f1', c_buyer, 100000, 'UZS', 'draft', c_sales);
  perform pg_temp.act(c_sales);
  perform tci.submit_limit_request(v_req);
  perform pg_temp.owner();
  if (select status from tci.credit_limit_requests where id = v_req) <> 'submitted' then
    raise exception 'credit_analysis: the fixture request was routed (%)',
      (select status from tci.credit_limit_requests where id = v_req);
  end if;
  -- the worklist names the unconfirmed current rating now the buyer has live business
  perform pg_temp.act(c_analyst);
  if not exists (select 1 from tci.v_rating_worklist w where w.entity_id = c_buyer and w.reason = 'unconfirmed') then
    raise exception 'credit_analysis: the worklist does not name the unconfirmed rating';
  end if;
  perform pg_temp.act(c_dual, c_s_decide);
  perform tci.set_acting_role('credit_underwriter');
  perform pg_temp.refused(format('select tci.decide_limit_request(%L, ''approved'', 100000, ''UZS'')', v_req), '42501',
                          'deciding on one''s own rating', 'four_eyes_own_rating');
  -- a second analyst confirms; the dual person is still the one who rated
  perform pg_temp.act(c_analyst2);
  perform tci.confirm_rating(v_a2);
  if exists (select 1 from tci.v_rating_worklist w where w.entity_id = c_buyer and w.reason = 'unconfirmed') then
    raise exception 'credit_analysis: a confirmed rating is still on the worklist';
  end if;
  perform pg_temp.act(c_dual, c_s_decide);
  perform pg_temp.refused(format('select tci.decide_limit_request(%L, ''approved'', 100000, ''UZS'')', v_req), '42501',
                          'deciding on a rating one calculated', 'four_eyes_own_rating');
  -- an underwriter who neither rated nor confirmed decides
  perform pg_temp.act(c_credit2);
  perform tci.decide_limit_request(v_req, 'approved', 100000, 'UZS');
  perform pg_temp.owner();
  if (select status from tci.credit_limit_requests where id = v_req) <> 'decided' then
    raise exception 'credit_analysis: the independent decision was not recorded';
  end if;

  -- 10. Analysts enter statements; the ADT recheck listens to confirmations.
  perform pg_temp.act(c_analyst);
  insert into tci.financial_statements (entity_id, statement_kind, fiscal_year, period_end_date, currency_code)
  values (c_buyer, 'annual', extract(year from current_date - 120)::int - 1, current_date - 485, 'UZS');
  perform pg_temp.owner();
  if (select prosrc from pg_proc where oid = 'tci.handle_adt_event()'::regprocedure) not like '%''rating.confirmed''%' then
    raise exception 'credit_analysis: the ADT recheck does not hear a confirmation';
  end if;

  -- 11. Back in combined mode the analyst still never decides, and the
  --     rating/decision separation no longer applies.
  perform pg_temp.act(c_admin);
  perform tci.set_credit_analysis_mode('combined');
  perform pg_temp.act(c_analyst);
  if tci.has_capability('decide') then
    raise exception 'credit_analysis: an analyst may decide in combined mode';
  end if;
  perform pg_temp.owner();
  if tci.limit_four_eyes_refusal(v_req, c_dual, 'credit') is not null then
    raise exception 'credit_analysis: the rating separation applies in combined mode';
  end if;

  raise notice 'credit_analysis: OK — capabilities by mode, engine vs confirmed grade, four eyes on the rating, tasks follow the mode';
end;
$$;

rollback;
