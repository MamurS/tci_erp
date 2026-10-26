-- Tests for migration 0079: a grade set by a person is built from sub-grades —
-- four pillars with a grade, a weight and a standard reason, the weighted
-- grade computed by the database, the overall grade and its reason checked
-- against it — and a proposal without a scorecard is refused.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/rating_scorecard.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000079a1', 'sc-analyst1@t'),
  ('99999999-0000-4000-8000-0000000079a2', 'sc-analyst2@t'),
  ('99999999-0000-4000-8000-0000000079a5', 'sc-sales@t'),
  ('99999999-0000-4000-8000-0000000079a6', 'sc-admin@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000079a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000079a2', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000079a5', 'sales'),
  ('99999999-0000-4000-8000-0000000079a6', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u, 'SC ' || right(u::text, 2), false
  from unnest(array['99999999-0000-4000-8000-0000000079a1', '99999999-0000-4000-8000-0000000079a2',
                    '99999999-0000-4000-8000-0000000079a5', '99999999-0000-4000-8000-0000000079a6']::uuid[]) u
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000079a5"}', true);
insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id) values
  ('99999999-0000-4000-8000-0000000079e1', 'SC Buyer', 'UZ', '99999999-0000-4000-8000-0000000079a5', 'SC-1', 'Tashkent',
   (select min(i.code) from tci.industries i));
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
                       'session_id', '99999999-0000-4000-8000-0000000079c0')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('tci.rating_target', '', true);
  perform set_config('tci.rating_scorecard', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

create function pg_temp.refused(p_sql text, p_states text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = any (string_to_array(p_states, '|')) and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'rating_scorecard: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_states, coalesce(p_fragment, '');
  end;
  raise exception 'rating_scorecard: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

-- A scorecard: general B1 / balance sheet B2 / P&L B1 / payment C1 at
-- 25 / 30 / 25 / 20 — weighted 3.70, i.e. B2.
create function pg_temp.card(p_grade text, p_reason text, p_pillars jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('grade', p_grade, 'reason', p_reason, 'pillars', coalesce(p_pillars, jsonb_build_array(
    jsonb_build_object('pillar', 'general', 'grade', 'B1', 'weight', 25, 'reason', 'long_track_record',
                       'comment', 'Twenty years on the market'),
    jsonb_build_object('pillar', 'balance_sheet', 'grade', 'B2', 'weight', 30, 'reason', 'high_leverage'),
    jsonb_build_object('pillar', 'profit_loss', 'grade', 'B1', 'weight', 25, 'reason', 'stable_results'),
    jsonb_build_object('pillar', 'payment', 'grade', 'C1', 'weight', 20, 'reason', 'payment_delays'))))
$$;
grant execute on function pg_temp.card(text, text, jsonb) to authenticated;

do $$
declare
  c_a1    constant uuid := '99999999-0000-4000-8000-0000000079a1';
  c_a2    constant uuid := '99999999-0000-4000-8000-0000000079a2';
  c_sales constant uuid := '99999999-0000-4000-8000-0000000079a5';
  c_admin constant uuid := '99999999-0000-4000-8000-0000000079a6';
  c_buyer constant uuid := '99999999-0000-4000-8000-0000000079e1';
  v_prop  tci.rating_proposals;
  v_a     tci.credit_assessments;
  v_step  tci.rating_proposal_steps;
  v_card  jsonb;
  v_set   jsonb;
  v_bad   jsonb;
begin
  perform pg_temp.act(c_a1);

  -- 1. No scorecard, no proposal — whichever route.
  perform pg_temp.refused(format('select tci.submit_rating(%L, ''B1'', ''x'', ''self'')', c_buyer), 'P0001',
    'a self-approved grade without a scorecard', 'rating_scorecard_required');
  perform pg_temp.refused(format('select tci.submit_rating(%L, ''B1'', ''x'', ''colleague'')', c_buyer), 'P0001',
    'a proposal to a colleague without a scorecard', 'rating_scorecard_required');

  -- 2. The scorecard is checked before anything is written.
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B1', 'consistent_with_subgrades')), 'P0001',
    'B1 called consistent with a weighted B2', 'rating_scorecard_adjustment_reason');
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B1', 'group_weakness')), 'P0001',
    'an upgrade explained by a downgrade reason', 'rating_scorecard_adjustment_reason');
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'group_support')), 'P0001',
    'the weighted grade explained by an adjustment', 'rating_scorecard_adjustment_reason');
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'because')), 'P0001', 'an overall reason off the list', 'rating_scorecard_reason_invalid');
  v_bad := jsonb_build_array(
    jsonb_build_object('pillar', 'general', 'grade', 'B1', 'weight', 25, 'reason', 'long_track_record'),
    jsonb_build_object('pillar', 'balance_sheet', 'grade', 'B2', 'weight', 30, 'reason', 'high_leverage'),
    jsonb_build_object('pillar', 'profit_loss', 'grade', 'B1', 'weight', 25, 'reason', 'stable_results'),
    jsonb_build_object('pillar', 'payment', 'grade', 'C1', 'weight', 10, 'reason', 'payment_delays'));
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'consistent_with_subgrades', v_bad)), 'P0001', 'weights adding up to 90', 'rating_scorecard_weights');
  v_bad := jsonb_set(pg_temp.card('B2', 'x') -> 'pillars', '{0,reason}', '"prompt_payment"');
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'consistent_with_subgrades', v_bad)), 'P0001',
    'a payment reason on the general pillar', 'rating_scorecard_reason_invalid');
  v_bad := jsonb_set(pg_temp.card('B2', 'x') -> 'pillars', '{1,reason}', 'null');
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'consistent_with_subgrades', v_bad)), 'P0001',
    'a graded pillar without a reason', 'rating_scorecard_reason_invalid');
  v_bad := jsonb_set(pg_temp.card('B2', 'x') -> 'pillars', '{3,grade}', 'null');
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'consistent_with_subgrades', v_bad)), 'P0001',
    'an ungraded pillar with a weight', 'rating_scorecard_weights');
  v_bad := jsonb_set(pg_temp.card('B2', 'x') -> 'pillars', '{3,grade}', '"E1"');
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'consistent_with_subgrades', v_bad)), 'P0001', 'a sub-grade off the scale',
    'rating_scorecard_grade_invalid');
  v_bad := jsonb_set(pg_temp.card('B2', 'x') -> 'pillars', '{3,pillar}', '"general"');
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'consistent_with_subgrades', v_bad)), 'P0001', 'a pillar twice', 'rating_scorecard_invalid');
  v_bad := '[{"pillar": "general", "weight": 0}, {"pillar": "balance_sheet", "weight": 0},
             {"pillar": "profit_loss", "weight": 0}, {"pillar": "payment", "weight": 0}]';
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'consistent_with_subgrades', v_bad)), 'P0001', 'no pillar graded', 'rating_scorecard_empty');
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''  '', ''self'')', c_buyer,
    pg_temp.card('B2', 'consistent_with_subgrades')), 'P0001', 'no justification', 'rating_proposal_reason_required');
  if exists (select 1 from tci.rating_proposals p where p.entity_id = c_buyer) then
    raise exception 'rating_scorecard: a refused scorecard left a proposal';
  end if;

  -- 3. Approved alone: the scorecard is stored with the weighted grade the
  --    database computed, and found behind the grade in force.
  perform tci.submit_rating_scorecard(c_buyer, pg_temp.card('B2', 'consistent_with_subgrades'),
    'Leverage and late payments keep it below B1', 'self');
  select * into v_prop from tci.rating_proposals p where p.entity_id = c_buyer order by p.created_at desc limit 1;
  if v_prop.scorecard ->> 'weighted_grade' <> 'B2' or (v_prop.scorecard ->> 'weighted_value')::numeric <> 3.70
     or v_prop.scorecard ->> 'grade' <> 'B2' or v_prop.scorecard -> 'pillars' -> 0 ->> 'comment' <> 'Twenty years on the market'
     or v_prop.scorecard -> 'pillars' -> 3 ->> 'pillar' <> 'payment' then
    raise exception 'rating_scorecard: stored %', v_prop.scorecard;
  end if;
  select * into v_a from tci.credit_assessments a where a.entity_id = c_buyer order by a.created_at desc limit 1;
  v_card := tci.rating_scorecard_of(v_a.id);
  if v_card ->> 'proposal_id' <> v_prop.id::text or v_card ->> 'justification' <> v_prop.reason then
    raise exception 'rating_scorecard: scorecard of the self-approved grade %', v_card;
  end if;

  -- 4. Above the weighted grade, with an upgrade reason, to a named colleague;
  --    the colleague's approval puts it in force and the scorecard follows.
  perform tci.submit_rating_scorecard(c_buyer, pg_temp.card('B1', 'group_support'),
    'The parent guarantees its trade debts', 'colleague', c_a2);
  select * into v_step from tci.rating_proposal_steps s where s.entity_id = c_buyer and s.status = 'pending';
  perform pg_temp.act(c_a2);
  perform tci.resolve_rating_proposal(v_step.id, 'approve');
  select * into v_step from tci.rating_proposal_steps s where s.id = v_step.id;
  v_card := tci.rating_scorecard_of(v_step.result_assessment_id);
  if v_card ->> 'grade' <> 'B1' or v_card ->> 'weighted_grade' <> 'B2' or v_card ->> 'reason' <> 'group_support' then
    raise exception 'rating_scorecard: scorecard of the approved proposal %', v_card;
  end if;

  -- 5. The default weights: everyone on staff reads them, admin sets them.
  v_set := tci.rating_scorecard_settings();
  if v_set -> 'weights' <> '{"general": 25, "balance_sheet": 30, "profit_loss": 25, "payment": 20}'::jsonb then
    raise exception 'rating_scorecard: default weights %', v_set;
  end if;
  perform pg_temp.refused('select tci.set_rating_pillar_weights(''{"general": 25, "balance_sheet": 25, "profit_loss": 25, "payment": 25}'')',
    '42501', 'an analyst setting the default weights');
  perform pg_temp.act(c_admin);
  perform pg_temp.refused('select tci.set_rating_pillar_weights(''{"general": 25, "balance_sheet": 25, "profit_loss": 25}'')',
    'P0001', 'three weights', 'rating_scorecard_weights');
  v_set := tci.set_rating_pillar_weights('{"general": 20, "balance_sheet": 35, "profit_loss": 30, "payment": 15}');
  if (v_set -> 'weights' ->> 'balance_sheet')::int <> 35 then
    raise exception 'rating_scorecard: weights after setting %', v_set;
  end if;

  -- 6. Sales neither rates nor reads a scorecard.
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.submit_rating_scorecard(%L, %L, ''x'', ''self'')', c_buyer,
    pg_temp.card('B2', 'consistent_with_subgrades')), '42501', 'sales rating a buyer', 'rating_propose_not_allowed');
  if tci.rating_scorecard_of(v_step.result_assessment_id) is not null then
    raise exception 'rating_scorecard: sales read a scorecard';
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'rating_scorecard: OK — a proposal without a scorecard refused on every route, the pillars, weights, reasons and the overall reason checked against the weighted grade (a half to the worse), the scorecard stored and found behind the grade in force (alone and after a colleague''s approval), default weights admin''s, sales kept out';
end;
$$;

rollback;
