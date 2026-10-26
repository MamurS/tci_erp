-- Tests for migration 0078: the rater chooses how a grade comes into force —
-- approved alone, sent to a named colleague (or any colleague), or escalated
-- — and sees whom each route reaches before sending.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/rating_self_approval.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000078a1', 'rs-analyst1@t'),
  ('99999999-0000-4000-8000-0000000078a2', 'rs-analyst2@t'),
  ('99999999-0000-4000-8000-0000000078a3', 'rs-analyst3@t'),
  ('99999999-0000-4000-8000-0000000078a4', 'rs-credit@t'),
  ('99999999-0000-4000-8000-0000000078a5', 'rs-sales@t'),
  ('99999999-0000-4000-8000-0000000078a6', 'rs-admin@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000078a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000078a2', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000078a3', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000078a4', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000078a5', 'sales'),
  ('99999999-0000-4000-8000-0000000078a6', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u, 'RS ' || right(u::text, 2), false
  from unnest(array['99999999-0000-4000-8000-0000000078a1', '99999999-0000-4000-8000-0000000078a2',
                    '99999999-0000-4000-8000-0000000078a3', '99999999-0000-4000-8000-0000000078a4',
                    '99999999-0000-4000-8000-0000000078a5', '99999999-0000-4000-8000-0000000078a6']::uuid[]) u
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000078a5"}', true);
insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id) values
  ('99999999-0000-4000-8000-0000000078e1', 'RS Manual Buyer', 'UZ', '99999999-0000-4000-8000-0000000078a5', 'RS-M', 'Tashkent',
   (select min(i.code) from tci.industries i)),
  ('99999999-0000-4000-8000-0000000078e2', 'RS Engine Buyer', 'KZ', '99999999-0000-4000-8000-0000000078a5', 'RS-E', 'Almaty',
   (select min(i.code) from tci.industries i));
insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
values ('99999999-0000-4000-8000-0000000078d1', '99999999-0000-4000-8000-0000000078e2', 'annual',
        extract(year from current_date - 120)::int, current_date - 120, 'UZS', '99999999-0000-4000-8000-0000000078a4');
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
                       'session_id', '99999999-0000-4000-8000-0000000078c0')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('tci.rating_target', '', true);
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
    raise exception 'rating_self_approval: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_states, coalesce(p_fragment, '');
  end;
  raise exception 'rating_self_approval: % was NOT refused', p_label;
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
  c_a1    constant uuid := '99999999-0000-4000-8000-0000000078a1';
  c_a2    constant uuid := '99999999-0000-4000-8000-0000000078a2';
  c_a3    constant uuid := '99999999-0000-4000-8000-0000000078a3';
  c_cr    constant uuid := '99999999-0000-4000-8000-0000000078a4';
  c_sales constant uuid := '99999999-0000-4000-8000-0000000078a5';
  c_admin constant uuid := '99999999-0000-4000-8000-0000000078a6';
  c_man   constant uuid := '99999999-0000-4000-8000-0000000078e1';
  c_eng   constant uuid := '99999999-0000-4000-8000-0000000078e2';
  v_opts  jsonb;
  v_state jsonb;
  v_row   tci.credit_assessments;
  v_eng   uuid;
  v_step  tci.rating_proposal_steps;
  v_n     integer;
begin
  -- Rank 1 of the credit levels: the credit underwriter.
  perform pg_temp.act(c_admin);
  perform tci.add_authority_level_member((select id from tci.authority_levels where stream = 'credit' and rank = 1), c_cr);

  -- 1. Whom each route reaches: the colleagues (not me), and the next level.
  perform pg_temp.act(c_a1);
  v_opts := tci.rating_send_options(c_man);
  if not (v_opts ->> 'can_self')::boolean then
    raise exception 'rating_self_approval: an analyst may not approve alone: %', v_opts;
  end if;
  if not (v_opts -> 'colleagues' @> jsonb_build_array(jsonb_build_object('user_id', c_a2)))
     or not (v_opts -> 'colleagues' @> jsonb_build_array(jsonb_build_object('user_id', c_a3)))
     or v_opts -> 'colleagues' @> jsonb_build_array(jsonb_build_object('user_id', c_a1)) then
    raise exception 'rating_self_approval: colleagues %', v_opts -> 'colleagues';
  end if;
  if (v_opts -> 'level' ->> 'rank')::int <> 1
     or not (v_opts -> 'level' -> 'members' @> jsonb_build_array(jsonb_build_object('user_id', c_cr))) then
    raise exception 'rating_self_approval: escalation %', v_opts -> 'level';
  end if;

  -- 2. A manual grade approved by its rater alone.
  perform pg_temp.sc('B1');
  v_state := tci.submit_rating(c_man, 'B1', 'well known buyer', 'self');
  select * into v_row from tci.credit_assessments where entity_id = c_man order by created_at desc limit 1;
  if v_row.source <> 'manual' or v_row.rating_grade <> 'B1'
     or v_row.created_by <> c_a1 or v_row.confirmed_by <> c_a1 then
    raise exception 'rating_self_approval: manual self approval wrote %', row_to_json(v_row);
  end if;
  if v_state -> 'pending' <> 'null'::jsonb
     or (v_state -> 'history' -> 0 ->> 'status') <> 'self_approved' then
    raise exception 'rating_self_approval: state after self approval %', v_state;
  end if;

  -- 3. One's own engine rating, approved alone (the plain confirmation of
  --    0069 still refuses its calculator).
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_at)
  values (c_eng, '99999999-0000-4000-8000-0000000078d1', 30, 'B2', 1000000, 'UZS', '{}', '{}', 't', clock_timestamp())
  returning id into v_eng;
  perform pg_temp.refused(format('select tci.confirm_rating(%L)', v_eng), '42501', 'confirming one''s own rating',
    'four_eyes_own_rating');
  perform pg_temp.sc('B2');
  perform tci.submit_rating(c_eng, 'B2', 'checked the statements', 'self', null, v_eng);
  select * into v_row from tci.credit_assessments where id = v_eng;
  if v_row.confirmed_by <> c_a1 or v_row.rating_grade <> 'B2' then
    raise exception 'rating_self_approval: engine self approval %', row_to_json(v_row);
  end if;

  -- 4. To one named colleague: only they get the task and may answer.
  perform pg_temp.sc('C1');
  perform tci.submit_rating(c_man, 'C1', 'payment delays', 'colleague', c_a2);
  select * into v_step from tci.rating_proposal_steps where entity_id = c_man and status = 'pending';
  perform set_config('role', 'postgres', true);  -- the answerers are internal
  if v_step.target_user is distinct from c_a2 or tci.rating_step_answerers(v_step) <> array[c_a2] then
    raise exception 'rating_self_approval: named step % answerers %', row_to_json(v_step), tci.rating_step_answerers(v_step);
  end if;
  perform pg_temp.act(c_a3);
  perform pg_temp.refused(format('select tci.resolve_rating_proposal(%L, ''approve'')', v_step.id), '42501',
    'another colleague answering a named proposal', 'rating_not_eligible');
  perform pg_temp.act(c_a2);
  select count(*) into v_n from tci.tasks where object_id = v_step.id and status = 'open';
  if v_n <> 1 then raise exception 'rating_self_approval: the named colleague sees % tasks', v_n; end if;
  perform tci.resolve_rating_proposal(v_step.id, 'approve');

  -- 5. To any colleague: every colleague (and, in combined mode, credit
  --    underwriting) may answer.
  perform pg_temp.act(c_a1);
  perform pg_temp.sc('B2');
  perform tci.submit_rating(c_man, 'B2', 'improved', 'colleague');
  select * into v_step from tci.rating_proposal_steps where entity_id = c_man and status = 'pending';
  perform set_config('role', 'postgres', true);
  if v_step.target_user is not null or not (tci.rating_step_answerers(v_step) @> array[c_a2, c_a3]) then
    raise exception 'rating_self_approval: open step % answerers %', row_to_json(v_step), tci.rating_step_answerers(v_step);
  end if;
  perform pg_temp.act(c_a1);
  perform tci.withdraw_rating_proposal(v_step.id);

  -- 6. A colleague who cannot confirm ratings is refused, and nothing is left.
  perform pg_temp.sc('B2');
  perform pg_temp.refused(format('select tci.submit_rating(%L, ''B2'', ''x'', ''colleague'', %L)', c_man, c_sales),
    'P0001', 'sending to sales', 'rating_colleague_not_eligible');
  if exists (select 1 from tci.rating_proposal_steps where entity_id = c_man and status = 'pending') then
    raise exception 'rating_self_approval: a refused proposal left a pending step';
  end if;

  -- 7. Refusals: an unknown route; sales and admin approve nothing alone.
  perform pg_temp.sc('B2');
  perform pg_temp.refused(format('select tci.submit_rating(%L, ''B2'', ''x'', ''boss'')', c_man), 'P0001',
    'an unknown route', 'rating_route_invalid');
  perform pg_temp.act(c_sales);
  perform pg_temp.sc('A1');
  perform pg_temp.refused(format('select tci.submit_rating(%L, ''A1'', ''x'', ''self'')', c_man), '42501',
    'sales approving a rating', 'rating_propose_not_allowed');
  perform pg_temp.refused(format('select tci.rating_send_options(%L)', c_man), '42501', 'sales reading the routes');
  perform pg_temp.act(c_admin);
  perform pg_temp.sc('A1');
  perform pg_temp.refused(format('select tci.submit_rating(%L, ''A1'', ''x'', ''self'')', c_man), '42501',
    'admin approving a rating', 'rating_propose_not_allowed');

  perform set_config('role', 'postgres', true);
  raise notice 'rating_self_approval: OK — the routes and their recipients, a manual grade and one''s own engine rating approved alone, a named colleague alone may answer, any colleague otherwise, an ineligible colleague refused, sales and admin approve nothing';
end;
$$;

rollback;
