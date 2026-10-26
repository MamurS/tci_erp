-- Tests for migrations 0072–0073: rating proposals (manual grades and grades
-- for an engine rating), confirmed by a colleague or escalated up the credit
-- authority levels to the committee's vote, and ADT for credit analysts
-- within their own authority grants.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/rating_proposals.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000073a1', 'rp-analyst@t'),
  ('99999999-0000-4000-8000-0000000073a2', 'rp-analyst2@t'),
  ('99999999-0000-4000-8000-0000000073a3', 'rp-credit@t'),
  ('99999999-0000-4000-8000-0000000073a4', 'rp-rank1@t'),
  ('99999999-0000-4000-8000-0000000073b1', 'rp-m1@t'),
  ('99999999-0000-4000-8000-0000000073b2', 'rp-m2@t'),
  ('99999999-0000-4000-8000-0000000073b3', 'rp-m3@t'),
  ('99999999-0000-4000-8000-0000000073a6', 'rp-sales@t'),
  ('99999999-0000-4000-8000-0000000073a7', 'rp-admin@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000073a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000073a2', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000073a3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000073a4', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000073b1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000073b2', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000073b3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000073a6', 'sales'),
  ('99999999-0000-4000-8000-0000000073a7', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u, 'RP ' || right(u::text, 2), false
  from unnest(array['99999999-0000-4000-8000-0000000073a1', '99999999-0000-4000-8000-0000000073a2',
                    '99999999-0000-4000-8000-0000000073a3', '99999999-0000-4000-8000-0000000073a4',
                    '99999999-0000-4000-8000-0000000073b1', '99999999-0000-4000-8000-0000000073b2',
                    '99999999-0000-4000-8000-0000000073b3', '99999999-0000-4000-8000-0000000073a6',
                    '99999999-0000-4000-8000-0000000073a7']::uuid[]) u
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000073a6"}', true);
insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id) values
  ('99999999-0000-4000-8000-0000000073e1', 'RP Manual Buyer', 'UZ', '99999999-0000-4000-8000-0000000073a6', 'RP-M', 'Tashkent',
   (select min(i.code) from tci.industries i)),
  ('99999999-0000-4000-8000-0000000073e2', 'RP Engine Buyer', 'KZ', '99999999-0000-4000-8000-0000000073a6', 'RP-E', 'Almaty',
   (select min(i.code) from tci.industries i));
insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
values ('99999999-0000-4000-8000-0000000073d1', '99999999-0000-4000-8000-0000000073e2', 'annual',
        extract(year from current_date - 120)::int, current_date - 120, 'UZS', '99999999-0000-4000-8000-0000000073a3');
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
                       'session_id', '99999999-0000-4000-8000-0000000073c0')::text, true);
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

create function pg_temp.level(p_rank int) returns uuid language sql as $$
  select id from tci.authority_levels where stream = 'credit' and rank = p_rank
$$;
grant execute on function pg_temp.level(int) to authenticated;

-- An engine rating of the engine buyer, calculated by the signed-in user.
create function pg_temp.rate(p_grade text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_at)
  values ('99999999-0000-4000-8000-0000000073e2', '99999999-0000-4000-8000-0000000073d1', 30, p_grade, 1000000, 'UZS',
          '{}', '{}', 't', clock_timestamp())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function pg_temp.rate(text) to authenticated;

create function pg_temp.refused(p_sql text, p_states text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = any (string_to_array(p_states, '|')) and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'rating_proposals: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_states, coalesce(p_fragment, '');
  end;
  raise exception 'rating_proposals: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

-- 0079: every proposal carries a scorecard; this one grades all four pillars
-- at the proposed grade, so the weighted grade is that grade.
create function pg_temp.sc(p_grade text) returns void language sql as $sc$
  select set_config('tci.rating_scorecard', jsonb_build_object(
    'grade', upper(p_grade), 'reason', 'consistent_with_subgrades',
    'pillars', jsonb_build_array(
      jsonb_build_object('pillar', 'general', 'grade', upper(p_grade), 'weight', 25, 'reason', 'in_line_with_peers'),
      jsonb_build_object('pillar', 'balance_sheet', 'grade', upper(p_grade), 'weight', 25, 'reason', 'in_line_with_peers'),
      jsonb_build_object('pillar', 'profit_loss', 'grade', upper(p_grade), 'weight', 25, 'reason', 'in_line_with_peers'),
      jsonb_build_object('pillar', 'payment', 'grade', upper(p_grade), 'weight', 25, 'reason', 'no_negative_experience')))::text,
    true)::text is not null
$sc$;
grant execute on function pg_temp.sc(text) to authenticated;

do $$
declare
  c_a1    constant uuid := '99999999-0000-4000-8000-0000000073a1';
  c_a2    constant uuid := '99999999-0000-4000-8000-0000000073a2';
  c_cr    constant uuid := '99999999-0000-4000-8000-0000000073a3';
  c_r1    constant uuid := '99999999-0000-4000-8000-0000000073a4';
  c_m1    constant uuid := '99999999-0000-4000-8000-0000000073b1';
  c_m2    constant uuid := '99999999-0000-4000-8000-0000000073b2';
  c_m3    constant uuid := '99999999-0000-4000-8000-0000000073b3';
  c_sales constant uuid := '99999999-0000-4000-8000-0000000073a6';
  c_admin constant uuid := '99999999-0000-4000-8000-0000000073a7';
  c_man   constant uuid := '99999999-0000-4000-8000-0000000073e1';
  c_eng   constant uuid := '99999999-0000-4000-8000-0000000073e2';
  v_state jsonb;
  v_step  uuid;
  v_row   tci.credit_assessments;
  v_eng   uuid;
  v_task  uuid;
  v_n     integer;
begin
  -- Levels: rank 1 = c_r1; the committee = m1 (chair), m2, m3.
  perform pg_temp.act(c_admin);
  perform tci.add_authority_level_member(pg_temp.level(1), c_r1);
  perform tci.add_authority_level_member(pg_temp.level(5), c_m1);
  perform tci.add_authority_level_member(pg_temp.level(5), c_m2);
  perform tci.add_authority_level_member(pg_temp.level(5), c_m3);
  perform tci.set_committee_chair(pg_temp.level(5), c_m1);

  -- 1. Who may propose: whoever rates; sales and admin do not.
  perform pg_temp.act(c_sales);
  perform pg_temp.sc('B1');
  perform pg_temp.refused(format('select tci.propose_rating(%L, ''B1'', ''x'')', c_man), '42501',
    'sales proposing a rating', 'rating_propose_not_allowed');
  perform pg_temp.refused(format('select tci.rating_proposal_state(%L)', c_man), '42501', 'sales reading proposals');
  perform pg_temp.act(c_admin);
  perform pg_temp.sc('B1');
  perform pg_temp.refused(format('select tci.propose_rating(%L, ''B1'', ''x'')', c_man), '42501',
    'admin proposing a rating', 'rating_propose_not_allowed');

  -- A manual rating never goes in directly, not even with the right shape.
  perform pg_temp.act(c_a1);
  perform pg_temp.refused(format(
    'insert into tci.credit_assessments (entity_id, rating_grade, inputs_snapshot, calculation_trace, engine_version,
       source, manual_reason, confirmed_by, confirmed_at) values (%L, ''A1'', ''{}'', ''{}'', ''m'', ''manual'', ''x'', %L, now())',
    c_man, c_a2), '42501', 'a manual rating inserted directly', 'rating_manual_direct');
  perform pg_temp.refused(format(
    'insert into tci.rating_proposals (entity_id, proposed_grade, reason, proposed_by) values (%L, ''A1'', ''x'', %L)',
    c_man, c_a1), '42501', 'a proposal inserted directly');

  -- 2. Manual grade to a colleague (combined mode: analysts and underwriters).
  perform pg_temp.refused(format('select tci.propose_rating(%L, ''E5'', ''x'')', c_man), 'P0001',
    'a grade off the scale', 'rating_grade_invalid');
  perform pg_temp.sc('B1');
  perform pg_temp.refused(format('select tci.propose_rating(%L, ''B1'', ''  '')', c_man), 'P0001',
    'a proposal without a reason', 'rating_proposal_reason_required');
  perform pg_temp.sc('B1');
  v_state := tci.propose_rating(c_man, 'b1', 'No statements: a state-owned distributor, rated by hand');
  if v_state -> 'pending' ->> 'grade' <> 'B1' or v_state -> 'pending' ->> 'route' <> 'colleague'
     or not (v_state -> 'pending' ->> 'manual')::boolean or (v_state -> 'pending' ->> 'can_answer')::boolean
     or (v_state ->> 'can_propose')::boolean then
    raise exception 'rating_proposals: the pending manual proposal reads wrong: %', v_state;
  end if;
  v_step := (v_state -> 'pending' ->> 'step_id')::uuid;
  if exists (select 1 from jsonb_array_elements(v_state -> 'pending' -> 'answerers') x where (x ->> 'user_id')::uuid = c_a1)
     or not exists (select 1 from jsonb_array_elements(v_state -> 'pending' -> 'answerers') x where (x ->> 'user_id')::uuid = c_a2)
     or not exists (select 1 from jsonb_array_elements(v_state -> 'pending' -> 'answerers') x where (x ->> 'user_id')::uuid = c_cr) then
    raise exception 'rating_proposals: the colleagues of a combined-mode proposal are wrong: %', v_state -> 'pending' -> 'answerers';
  end if;
  perform pg_temp.sc('B2');
  perform pg_temp.refused(format('select tci.propose_rating(%L, ''B2'', ''again'')', c_man), 'P0001',
    'a second pending proposal', 'rating_proposal_pending');
  perform pg_temp.refused(format('select tci.resolve_rating_proposal(%L, ''approve'')', v_step), '42501',
    'the proposer answering their own proposal', 'rating_not_eligible');
  perform pg_temp.owner();
  select count(*) into v_n from tci.tasks
   where task_type = 'rating_proposal' and object_id = v_step and status = 'open';
  if v_n < 2 or exists (select 1 from tci.tasks where task_type = 'rating_proposal' and object_id = v_step and target_user = c_a1) then
    raise exception 'rating_proposals: the colleagues'' tasks are wrong (% open)', v_n;
  end if;

  perform pg_temp.act(c_a2);
  perform pg_temp.refused(format('select tci.resolve_rating_proposal(%L, ''approve_modified'', ''B2'')', v_step), 'P0001',
    'approve-modified without a reason', 'validation_comment_required');
  perform pg_temp.refused(format('select tci.resolve_rating_proposal(%L, ''approve_modified'', ''B1'', ''same'')', v_step), 'P0001',
    'approve-modified with the proposed grade', 'rating_modified_same');
  v_state := tci.resolve_rating_proposal(v_step, 'approve_modified', 'B2', 'Sector risk: one notch lower');
  if v_state -> 'pending' <> 'null'::jsonb or v_state -> 'history' -> 0 ->> 'status' <> 'modified' then
    raise exception 'rating_proposals: the approved manual proposal reads wrong: %', v_state;
  end if;
  perform pg_temp.owner();
  select * into v_row from tci.credit_assessments where entity_id = c_man order by created_at desc limit 1;
  if v_row.source <> 'manual' or v_row.rating_grade <> 'B2' or v_row.engine_grade is not null
     or v_row.created_by <> c_a1 or v_row.confirmed_by <> c_a2 or v_row.suggested_limit is not null
     or v_row.rating_score is not null or v_row.manual_reason is null
     or tci.grade_band_for_assessment(v_row.id) <> 'B' then
    raise exception 'rating_proposals: the manual assessment is wrong: %', to_jsonb(v_row);
  end if;
  if exists (select 1 from tci.tasks where task_type = 'rating_proposal' and object_id = v_step and status = 'open') then
    raise exception 'rating_proposals: the colleagues'' tasks stayed open';
  end if;
  select id into v_task from tci.tasks
   where task_type = 'rating_proposal_result' and object_id = v_step and target_user = c_a1 and status = 'open'
     and title_key = 'agenda.tasks.rating_proposal_result_modified';
  if v_task is null then
    raise exception 'rating_proposals: the proposer was not told';
  end if;
  if not exists (select 1 from tci.workflow_events where event_type = 'rating.created' and object_id = v_row.id) then
    raise exception 'rating_proposals: the manual rating emitted no rating.created';
  end if;
  perform pg_temp.act(c_a1);
  perform tci.complete_task(v_task);

  -- 3. A grade for an engine rating, escalated: rank 1, forwarded, committee.
  perform pg_temp.act(c_cr);
  v_eng := pg_temp.rate('A2');
  perform pg_temp.act(c_a1);
  perform pg_temp.sc('B1');
  v_state := tci.propose_rating(c_eng, 'B1', 'The group''s debt sits with the parent', v_eng, null, true);
  v_step := (v_state -> 'pending' ->> 'step_id')::uuid;
  if v_state -> 'pending' ->> 'route' <> 'level' or (v_state -> 'pending' ->> 'rank')::int <> 1 then
    raise exception 'rating_proposals: the escalation did not go to rank 1: %', v_state;
  end if;
  perform pg_temp.act(c_cr);
  perform pg_temp.refused(format('select tci.confirm_rating(%L)', v_eng), 'P0001',
    'a plain confirmation while a proposal is pending', 'rating_proposal_pending');
  perform pg_temp.act(c_a2);
  perform pg_temp.refused(format('select tci.resolve_rating_proposal(%L, ''approve'')', v_step), '42501',
    'an analyst answering a level step', 'rating_not_eligible');
  perform pg_temp.act(c_m1);
  perform pg_temp.refused(format('select tci.resolve_rating_proposal(%L, ''approve'')', v_step), '42501',
    'a member of another level answering rank 1', 'rating_not_eligible');
  perform pg_temp.act(c_r1);
  v_state := tci.resolve_rating_proposal(v_step, 'forward', null, 'For the committee: the parent''s exposure');
  v_step := (v_state -> 'pending' ->> 'step_id')::uuid;
  if not (v_state -> 'pending' ->> 'is_committee')::boolean then
    raise exception 'rating_proposals: the forward skipped the empty ranks wrongly: %', v_state;
  end if;
  perform pg_temp.refused(format('select tci.cast_rating_vote(%L, ''approve'')', v_step), '42501',
    'the forwarder voting', 'rating_not_eligible');
  perform pg_temp.act(c_m2);
  perform pg_temp.refused(format('select tci.resolve_rating_proposal(%L, ''approve'')', v_step), 'P0001',
    'a single answer before the committee', 'rating_committee_votes');
  perform pg_temp.refused(format('select tci.cast_rating_vote(%L, ''reject'')', v_step), 'P0001',
    'a rejection without a reason', 'validation_comment_required');
  perform tci.cast_rating_vote(v_step, 'reject', 'Too harsh for a solvent subsidiary');
  perform pg_temp.refused(format('select tci.cast_rating_vote(%L, ''approve'')', v_step), 'P0001',
    'a second vote', 'committee_already_voted');
  perform pg_temp.act(c_m3);
  perform tci.declare_rating_conflict(v_step, 'I sit on the parent''s supervisory board');
  perform pg_temp.refused(format('select tci.cast_rating_vote(%L, ''approve'')', v_step), '42501',
    'a conflicted member voting', 'rating_not_eligible');
  perform pg_temp.act(c_m1);
  v_state := tci.rating_proposal_state(c_eng);
  if (v_state -> 'pending' -> 'committee' ->> 'electorate')::int <> 2
     or not (v_state -> 'pending' -> 'committee' ->> 'i_may_vote')::boolean then
    raise exception 'rating_proposals: the committee electorate is wrong: %', v_state -> 'pending' -> 'committee';
  end if;
  perform tci.cast_rating_vote(v_step, 'approve');
  perform pg_temp.act(c_m2);
  perform pg_temp.refused(format('select tci.close_rating_vote(%L)', v_step), '42501',
    'a member other than the chair closing', 'committee_chair_closes');
  perform pg_temp.act(c_m1);
  v_state := tci.close_rating_vote(v_step);
  if v_state -> 'committee' ->> 'action' <> 'approve' or v_state -> 'history' -> 0 ->> 'status' <> 'approved' then
    raise exception 'rating_proposals: the chair''s casting vote did not approve: %', v_state;
  end if;
  perform pg_temp.owner();
  select * into v_row from tci.credit_assessments where id = v_eng;
  if v_row.rating_grade <> 'B1' or v_row.engine_grade <> 'A2' or v_row.confirmed_by <> c_m1
     or v_row.confirmation_comment is null then
    raise exception 'rating_proposals: the committee''s grade did not come into force: %', to_jsonb(v_row);
  end if;
  if not exists (select 1 from tci.workflow_events where event_type = 'rating.confirmed' and object_id = v_eng) then
    raise exception 'rating_proposals: the confirmation emitted no rating.confirmed';
  end if;

  -- 4. Return, withdraw.
  perform pg_temp.act(c_cr);
  v_eng := pg_temp.rate('B2');
  perform pg_temp.act(c_a1);
  perform pg_temp.sc('B2');
  v_state := tci.propose_rating(c_eng, 'B2', 'Recommended grade, please confirm', v_eng);
  v_step := (v_state -> 'pending' ->> 'step_id')::uuid;
  if exists (select 1 from jsonb_array_elements(v_state -> 'pending' -> 'answerers') x where (x ->> 'user_id')::uuid = c_cr) then
    raise exception 'rating_proposals: whoever calculated the rating may answer its proposal';
  end if;
  perform pg_temp.act(c_a2);
  perform pg_temp.refused(format('select tci.resolve_rating_proposal(%L, ''return'')', v_step), 'P0001',
    'a return without a reason', 'validation_comment_required');
  perform pg_temp.refused(format('select tci.withdraw_rating_proposal(%L)', v_step), '42501',
    'someone else withdrawing', 'rating_withdraw_not_yours');
  v_state := tci.resolve_rating_proposal(v_step, 'return', null, 'Attach the auditor''s letter first');
  if v_state -> 'history' -> 0 ->> 'status' <> 'returned' then
    raise exception 'rating_proposals: the return reads wrong: %', v_state;
  end if;
  perform pg_temp.act(c_a1);
  perform pg_temp.sc('B2');
  v_state := tci.propose_rating(c_eng, 'B2', 'With the auditor''s letter', v_eng);
  v_step := (v_state -> 'pending' ->> 'step_id')::uuid;
  v_state := tci.withdraw_rating_proposal(v_step);
  if v_state -> 'pending' <> 'null'::jsonb or v_state -> 'history' -> 0 ->> 'status' <> 'withdrawn' then
    raise exception 'rating_proposals: the withdrawal reads wrong: %', v_state;
  end if;
  perform pg_temp.owner();
  if exists (select 1 from tci.tasks where task_type = 'rating_proposal' and object_id = v_step and status = 'open')
     or exists (select 1 from tci.tasks where task_type = 'rating_proposal_result' and object_id = v_step) then
    raise exception 'rating_proposals: a withdrawal left tasks behind or told the proposer';
  end if;

  -- 5. Separate mode: only analysts confirm on the colleague route.
  perform pg_temp.act(c_admin);
  perform tci.set_credit_analysis_mode('separate');
  perform pg_temp.act(c_a1);
  perform pg_temp.sc('B2');
  v_state := tci.propose_rating(c_eng, 'B2', 'Recommended grade, please confirm', v_eng);
  v_step := (v_state -> 'pending' ->> 'step_id')::uuid;
  if exists (select 1 from jsonb_array_elements(v_state -> 'pending' -> 'answerers') x
              where (x ->> 'user_id')::uuid in (c_r1, c_m1, c_m2, c_m3)) then
    raise exception 'rating_proposals: an underwriter is a colleague in separate mode';
  end if;
  perform pg_temp.act(c_r1);
  perform pg_temp.refused(format('select tci.resolve_rating_proposal(%L, ''approve'')', v_step), '42501',
    'an underwriter confirming in separate mode', 'rating_confirm_not_allowed');
  perform pg_temp.act(c_a2);
  perform tci.resolve_rating_proposal(v_step, 'approve');
  perform pg_temp.owner();
  if (select confirmed_by from tci.credit_assessments where id = v_eng) <> c_a2 then
    raise exception 'rating_proposals: the analyst''s confirmation did not land';
  end if;

  -- 6. ADT by a credit analyst, within the analyst's own grants.
  perform pg_temp.act(c_a2);
  perform pg_temp.refused(format('select tci.set_buyer_adt(%L, 500000, ''UZS'', 3)', c_eng), 'P0001',
    'an analyst ADT without authority', 'adt_beyond_authority');
  perform pg_temp.owner();
  insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, valid_from, created_by)
  values (c_a2, 'credit', 'B', 1000000, 'UZS', current_date - 1, c_admin);
  perform pg_temp.act(c_a2);
  perform tci.set_buyer_adt(c_eng, 500000, 'UZS', 3);
  if tci.buyer_adt_state(c_eng) is null then
    raise exception 'rating_proposals: the analyst cannot read the ADT state';
  end if;
  select count(*) into v_n from tci.buyer_adt where entity_id = c_eng;
  if v_n <> 1 then
    raise exception 'rating_proposals: the analyst does not see the ADT row (% rows)', v_n;
  end if;
  perform pg_temp.refused(format('select tci.set_buyer_adt(%L, 5000000, ''UZS'', 3)', c_eng), 'P0001',
    'an analyst ADT beyond the grant', 'adt_beyond_authority');
  perform tci.disable_buyer_adt(c_eng, 'Group review pending');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.set_buyer_adt(%L, 1, ''UZS'', 1)', c_eng), '42501', 'sales setting an ADT');

  -- 7. Admin reads, never answers.
  perform pg_temp.act(c_admin);
  v_state := tci.rating_proposal_state(c_eng);
  if jsonb_array_length(v_state -> 'history') < 4 then
    raise exception 'rating_proposals: admin''s read of the history is short: %', v_state -> 'history';
  end if;
  perform pg_temp.owner();
  raise notice 'rating_proposals: OK — manual grades only through a second person, colleagues by mode, escalation rank by rank to the committee''s vote (chair''s casting vote, conflicts barred), return / withdraw, a plain confirmation waits for a proposal, analyst ADT within the analyst''s own grants, no direct writes';
end;
$$;

rollback;
