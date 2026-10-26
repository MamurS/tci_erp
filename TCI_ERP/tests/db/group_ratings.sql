-- Tests for migration 0074: the group rating, set by a senior credit analyst,
-- capping every member's grade in force — at once for the current ratings,
-- and as they are written for new ones; confirmations and proposals above
-- the cap refused; raising or ending it raises nobody.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/group_ratings.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000074a1', 'gr-senior@t'),
  ('99999999-0000-4000-8000-0000000074a2', 'gr-analyst@t'),
  ('99999999-0000-4000-8000-0000000074a3', 'gr-credit@t'),
  ('99999999-0000-4000-8000-0000000074a4', 'gr-credit2@t'),
  ('99999999-0000-4000-8000-0000000074a6', 'gr-sales@t'),
  ('99999999-0000-4000-8000-0000000074a7', 'gr-admin@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000074a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000074a2', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000074a3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000074a4', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000074a6', 'sales'),
  ('99999999-0000-4000-8000-0000000074a7', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u, 'GR ' || right(u::text, 2), false
  from unnest(array['99999999-0000-4000-8000-0000000074a1', '99999999-0000-4000-8000-0000000074a2',
                    '99999999-0000-4000-8000-0000000074a3', '99999999-0000-4000-8000-0000000074a4',
                    '99999999-0000-4000-8000-0000000074a6', '99999999-0000-4000-8000-0000000074a7']::uuid[]) u
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000074a6"}', true);
-- p owns s1 and s2; x stands alone
insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id)
select id::uuid, name, 'UZ', '99999999-0000-4000-8000-0000000074a6', reg, 'Tashkent', (select min(i.code) from tci.industries i)
  from (values ('99999999-0000-4000-8000-0000000074e0', 'GR Parent', 'GR-P'),
               ('99999999-0000-4000-8000-0000000074e1', 'GR Sub One', 'GR-1'),
               ('99999999-0000-4000-8000-0000000074e2', 'GR Sub Two', 'GR-2'),
               ('99999999-0000-4000-8000-0000000074e9', 'GR Alone', 'GR-X')) v(id, name, reg);
insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
select s::uuid, e::uuid, 'annual', extract(year from current_date - 120)::int, current_date - 120, 'UZS',
       '99999999-0000-4000-8000-0000000074a3'
  from (values ('99999999-0000-4000-8000-0000000074d1', '99999999-0000-4000-8000-0000000074e1'),
               ('99999999-0000-4000-8000-0000000074d2', '99999999-0000-4000-8000-0000000074e2'),
               ('99999999-0000-4000-8000-0000000074d9', '99999999-0000-4000-8000-0000000074e9')) v(s, e);
insert into tci.entity_relationships (parent_entity_id, child_entity_id, relationship_type, ownership_pct, created_by)
values
  ('99999999-0000-4000-8000-0000000074e0', '99999999-0000-4000-8000-0000000074e1', 'ownership', 100, '99999999-0000-4000-8000-0000000074a3'),
  ('99999999-0000-4000-8000-0000000074e0', '99999999-0000-4000-8000-0000000074e2', 'ownership', 60, '99999999-0000-4000-8000-0000000074a3');
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
                       'session_id', '99999999-0000-4000-8000-0000000074c0')::text, true);
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

-- An engine rating of a buyer, calculated by the signed-in user.
create function pg_temp.rate(p_entity uuid, p_statement uuid, p_grade text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_at)
  values (p_entity, p_statement, 30, p_grade, 1000000, 'UZS', '{}', '{}', 't', clock_timestamp())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function pg_temp.rate(uuid, uuid, text) to authenticated;

create function pg_temp.current(p_entity uuid) returns tci.credit_assessments language sql as $$
  select * from tci.credit_assessments where entity_id = p_entity order by created_at desc limit 1
$$;
grant execute on function pg_temp.current(uuid) to authenticated;

create function pg_temp.refused(p_sql text, p_states text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = any (string_to_array(p_states, '|')) and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'group_ratings: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_states, coalesce(p_fragment, '');
  end;
  raise exception 'group_ratings: % was NOT refused', p_label;
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
  c_senior  constant uuid := '99999999-0000-4000-8000-0000000074a1';
  c_analyst constant uuid := '99999999-0000-4000-8000-0000000074a2';
  c_credit  constant uuid := '99999999-0000-4000-8000-0000000074a3';
  c_credit2 constant uuid := '99999999-0000-4000-8000-0000000074a4';
  c_sales   constant uuid := '99999999-0000-4000-8000-0000000074a6';
  c_admin   constant uuid := '99999999-0000-4000-8000-0000000074a7';
  c_parent  constant uuid := '99999999-0000-4000-8000-0000000074e0';
  c_s1      constant uuid := '99999999-0000-4000-8000-0000000074e1';
  c_s2      constant uuid := '99999999-0000-4000-8000-0000000074e2';
  c_alone   constant uuid := '99999999-0000-4000-8000-0000000074e9';
  v_s1      uuid;
  v_s2      uuid;
  v_row     tci.credit_assessments;
  v_state   jsonb;
  v_before  integer;
begin
  -- Ratings before the group is rated: s1 A2, s2 C1, alone A1.
  perform pg_temp.act(c_credit);
  v_s1 := pg_temp.rate(c_s1, '99999999-0000-4000-8000-0000000074d1', 'A2');
  v_s2 := pg_temp.rate(c_s2, '99999999-0000-4000-8000-0000000074d2', 'C1');
  perform pg_temp.rate(c_alone, '99999999-0000-4000-8000-0000000074d9', 'A1');

  -- 1. Seniority is admin's flag, on analysts only, never by the API.
  perform pg_temp.act(c_senior);
  perform pg_temp.refused(format('select tci.set_group_rating(%L, ''B1'', ''x'')', c_s1), '42501',
    'an analyst not yet senior', 'group_rating_senior_only');
  perform pg_temp.refused(format('update tci.user_profiles set senior_credit_analyst = true where user_id = %L', c_senior),
    '42501', 'marking oneself senior through the API');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.set_senior_credit_analyst(%L, true)', c_senior), '42501', 'sales marking a senior');
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('select tci.set_senior_credit_analyst(%L, true)', c_credit), 'P0001',
    'a credit underwriter marked senior', 'senior_requires_analyst');
  perform tci.set_senior_credit_analyst(c_senior, true);
  if not exists (select 1 from tci.senior_credit_analysts() s where s = c_senior) then
    raise exception 'group_ratings: the senior is not listed';
  end if;
  perform pg_temp.refused(format('select tci.set_group_rating(%L, ''B1'', ''x'')', c_s1), '42501',
    'admin setting a group rating');

  -- 2. Others may not set it.
  perform pg_temp.act(c_analyst);
  perform pg_temp.refused(format('select tci.set_group_rating(%L, ''B1'', ''x'')', c_s1), '42501',
    'a non-senior analyst', 'group_rating_senior_only');
  perform pg_temp.act(c_credit);
  perform pg_temp.refused(format('select tci.set_group_rating(%L, ''B1'', ''x'')', c_s1), '42501',
    'a credit underwriter setting a group rating');

  -- 3. The senior sets B1 on the group (through any member): s1 (A2) is capped
  --    at once, s2 (C1, already worse) is not, the lone company is untouched.
  perform pg_temp.act(c_senior);
  perform pg_temp.refused(format('select tci.set_group_rating(%L, ''B1'', '' '')', c_s1), 'P0001',
    'a group rating without a reason', 'group_rating_reason_required');
  perform pg_temp.refused(format('select tci.set_group_rating(%L, ''Z9'', ''x'')', c_s1), 'P0001',
    'a grade off the scale', 'rating_grade_invalid');
  v_state := tci.set_group_rating(c_s1, 'b1', 'Parent leverage 6x; cash pooled upstream');
  if v_state -> 'active' ->> 'grade' <> 'B1' or (v_state ->> 'capped_now')::int <> 1
     or (v_state ->> 'parent_id')::uuid <> c_parent or not (v_state ->> 'may_set')::boolean then
    raise exception 'group_ratings: the set group rating reads wrong: %', v_state;
  end if;
  perform pg_temp.owner();
  v_row := pg_temp.current(c_s1);
  if v_row.id = v_s1 or v_row.rating_grade <> 'B1' or v_row.engine_grade <> 'A2' or v_row.group_rating_id is null
     or v_row.confirmed_by <> c_senior or v_row.source <> 'engine' or v_row.statement_id <> '99999999-0000-4000-8000-0000000074d1'
     or tci.grade_band_for_assessment(v_row.id) <> 'B' then
    raise exception 'group_ratings: s1 was not capped at once: %', to_jsonb(v_row);
  end if;
  if (select rating_grade from tci.credit_assessments where id = v_s1) <> 'A2' then
    raise exception 'group_ratings: the capped history was rewritten';
  end if;
  if (pg_temp.current(c_s2)).id <> v_s2 or (pg_temp.current(c_alone)).rating_grade <> 'A1' then
    raise exception 'group_ratings: a member already worse, or a company outside the group, was touched';
  end if;
  if not exists (select 1 from tci.workflow_events where event_type = 'rating.created' and object_id = v_row.id) then
    raise exception 'group_ratings: the capped rating emitted no rating.created';
  end if;

  -- 4. A new engine rating is capped as it is written; the engine's grade stays.
  perform pg_temp.act(c_credit);
  perform pg_temp.rate(c_s2, '99999999-0000-4000-8000-0000000074d2', 'A1');
  perform pg_temp.owner();
  v_row := pg_temp.current(c_s2);
  if v_row.rating_grade <> 'B1' or v_row.engine_grade <> 'A1' or v_row.group_rating_id is null
     or v_row.confirmed_at is not null then
    raise exception 'group_ratings: a new rating was not capped as it was written: %', to_jsonb(v_row);
  end if;

  -- 5. Confirming it: the capped grade needs no reason; a better one is refused.
  perform pg_temp.act(c_credit2);
  perform pg_temp.refused(format('select tci.confirm_rating(%L, ''A2'', ''looks fine'')', v_row.id), 'P0001',
    'a confirmation above the cap', 'rating_above_group_cap');
  perform tci.confirm_rating(v_row.id);
  perform pg_temp.owner();
  if (select rating_grade from tci.credit_assessments where id = v_row.id) <> 'B1' then
    raise exception 'group_ratings: the plain confirmation did not keep the capped grade';
  end if;

  -- 6. A proposal above the cap is refused; at or below it goes.
  perform pg_temp.act(c_analyst);
  perform pg_temp.sc('A2');
  perform pg_temp.refused(format('select tci.propose_rating(%L, ''A2'', ''strong'')', c_s1), 'P0001',
    'a manual proposal above the cap', 'rating_above_group_cap');
  perform pg_temp.sc('B2');
  v_state := tci.propose_rating(c_s1, 'B2', 'Sub-scale and dependent on the parent');
  if v_state -> 'pending' ->> 'grade' <> 'B2' then
    raise exception 'group_ratings: a proposal below the cap was refused: %', v_state;
  end if;
  perform tci.withdraw_rating_proposal((v_state -> 'pending' ->> 'step_id')::uuid);

  -- 7. Lowering the group caps again; raising or ending it raises nobody.
  perform pg_temp.act(c_senior);
  v_state := tci.set_group_rating(c_parent, 'C1', 'Covenant breach at the parent');
  if (v_state ->> 'capped_now')::int <> 2 or jsonb_array_length(v_state -> 'history') <> 1
     or v_state -> 'history' -> 0 ->> 'status' <> 'replaced' then
    raise exception 'group_ratings: lowering the group did not cap both members: %', v_state;
  end if;
  perform pg_temp.owner();
  if (pg_temp.current(c_s1)).rating_grade <> 'C1' or (pg_temp.current(c_s2)).rating_grade <> 'C1' then
    raise exception 'group_ratings: a member is still better than the lowered group';
  end if;
  select count(*) into v_before from tci.credit_assessments where entity_id in (c_s1, c_s2);
  perform pg_temp.act(c_senior);
  v_state := tci.set_group_rating(c_parent, 'A1', 'Refinanced');
  if (v_state ->> 'capped_now')::int <> 0 then
    raise exception 'group_ratings: raising the group wrote rows';
  end if;
  perform pg_temp.refused(format('select tci.end_group_rating(%L, '' '')', c_parent), 'P0001',
    'ending without a reason', 'group_rating_reason_required');
  v_state := tci.end_group_rating(c_parent, 'Group sold');
  if v_state -> 'active' <> 'null'::jsonb then
    raise exception 'group_ratings: the ended group rating is still active: %', v_state;
  end if;
  perform pg_temp.refused(format('select tci.end_group_rating(%L, ''again'')', c_parent), 'P0002',
    'ending a group with no rating', 'group_rating_none');
  perform pg_temp.owner();
  if (select count(*) from tci.credit_assessments where entity_id in (c_s1, c_s2)) <> v_before
     or (pg_temp.current(c_s1)).rating_grade <> 'C1' then
    raise exception 'group_ratings: raising or ending the group raised a member';
  end if;

  -- 8. Nobody writes the table or a capped row directly.
  perform pg_temp.act(c_senior);
  perform pg_temp.refused(format(
    'insert into tci.group_ratings (parent_entity_id, grade, reason, set_by) values (%L, ''A1'', ''x'', %L)', c_parent, c_senior),
    '42501', 'a group rating inserted directly');
  perform pg_temp.act(c_credit);
  perform pg_temp.refused(format(
    'insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
       inputs_snapshot, calculation_trace, engine_version, group_rating_id)
     values (%L, %L, 30, ''A1'', 1, ''UZS'', ''{}'', ''{}'', ''t'', (select id from tci.group_ratings where parent_entity_id = %L limit 1))',
    c_s1, '99999999-0000-4000-8000-0000000074d1', c_parent), '42501', 'a capped row inserted directly', 'rating_group_cap_direct');

  -- 9. Who reads: the credit desk and admin; not sales.
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.group_rating_state(%L)', c_s1), '42501', 'sales reading the group rating');
  perform pg_temp.act(c_admin);
  if jsonb_array_length(tci.group_rating_state(c_s1) -> 'history') <> 3 then
    raise exception 'group_ratings: admin''s read of the history is wrong';
  end if;
  perform pg_temp.owner();
  raise notice 'group_ratings: OK — seniority is admin''s flag on analysts, only a senior sets or ends a group rating with a reason, members capped at once and new ratings capped as written (engine grade kept), confirmations and proposals above the cap refused, raising or ending raises nobody, no direct writes';
end;
$$;

rollback;
