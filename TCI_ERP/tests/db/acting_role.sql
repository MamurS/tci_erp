-- Tests for migration 0063: one acting role at a time, four eyes on credit
-- limits, and admin without business decision rights.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/acting_role.sql
--
-- One transaction, rolled back. API roles impersonated WITH a session id in
-- the claims (the acting role is per session); the internal-call token is
-- cleared at every actor switch. Every UPDATE carries a WHERE clause.
-- Amounts are in UZS and the band is `unrated` (no assessment).

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-000000006301', 'act-multi@t'),   -- sales + commercial + credit + admin
  ('99999999-0000-4000-8000-000000006302', 'act-credit@t'),  -- credit only
  ('99999999-0000-4000-8000-000000006303', 'act-comm@t'),    -- commercial only
  ('99999999-0000-4000-8000-000000006304', 'act-sales@t'),   -- sales only
  ('99999999-0000-4000-8000-000000006305', 'act-admin@t');   -- admin only
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-000000006301', 'sales'),
  ('99999999-0000-4000-8000-000000006301', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-000000006301', 'credit_underwriter'),
  ('99999999-0000-4000-8000-000000006301', 'admin'),
  ('99999999-0000-4000-8000-000000006302', 'credit_underwriter'),
  ('99999999-0000-4000-8000-000000006303', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-000000006304', 'sales'),
  ('99999999-0000-4000-8000-000000006305', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-000000006301', 'Act Multi', false),
  ('99999999-0000-4000-8000-000000006302', 'Act Credit', false),
  ('99999999-0000-4000-8000-000000006303', 'Act Comm', false),
  ('99999999-0000-4000-8000-000000006304', 'Act Sales', false),
  ('99999999-0000-4000-8000-000000006305', 'Act Admin', false)
on conflict (user_id) do update set must_change_password = false, full_name = excluded.full_name;
insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, valid_from, created_by) values
  ('99999999-0000-4000-8000-000000006301', 'credit', 'unrated', 1000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-000000006305'),
  ('99999999-0000-4000-8000-000000006301', 'commercial', 'unrated', 1000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-000000006305'),
  ('99999999-0000-4000-8000-000000006302', 'credit', 'unrated', 1000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-000000006305'),
  ('99999999-0000-4000-8000-000000006303', 'commercial', 'unrated', 1000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-000000006305');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-000000006304"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000063e1', 'Act Holder', 'UZ', '99999999-0000-4000-8000-000000006304'),
  ('99999999-0000-4000-8000-0000000063e2', 'Act Buyer One', 'KZ', '99999999-0000-4000-8000-000000006304'),
  ('99999999-0000-4000-8000-0000000063e3', 'Act Buyer Two', 'KZ', '99999999-0000-4000-8000-000000006304'),
  ('99999999-0000-4000-8000-0000000063e4', 'Act Buyer Three', 'TR', '99999999-0000-4000-8000-000000006304'),
  ('99999999-0000-4000-8000-0000000063e5', 'Act Buyer Four', 'TR', '99999999-0000-4000-8000-000000006304');
insert into tci.insurance_requests (id, entity_id, request_number, status, created_by) values
  ('99999999-0000-4000-8000-0000000063b1', '99999999-0000-4000-8000-0000000063e1', 'ACT-IR-1', 'underwriting',
   '99999999-0000-4000-8000-000000006304');
select tci.begin_trusted_call();
-- r_own: raised by the multi-role person; r_other, r_admin: raised by sales;
-- r_val: raised by the multi-role person, proposed by someone else.
insert into tci.credit_limit_requests (id, entity_id, insurance_request_id, requested_amount, currency_code, status, requested_by) values
  ('99999999-0000-4000-8000-0000000063c1', '99999999-0000-4000-8000-0000000063e2', '99999999-0000-4000-8000-0000000063b1', 200000, 'UZS', 'submitted', '99999999-0000-4000-8000-000000006301'),
  ('99999999-0000-4000-8000-0000000063c2', '99999999-0000-4000-8000-0000000063e3', '99999999-0000-4000-8000-0000000063b1', 200000, 'UZS', 'submitted', '99999999-0000-4000-8000-000000006304'),
  ('99999999-0000-4000-8000-0000000063c3', '99999999-0000-4000-8000-0000000063e4', '99999999-0000-4000-8000-0000000063b1', 100000, 'UZS', 'submitted', '99999999-0000-4000-8000-000000006304'),
  ('99999999-0000-4000-8000-0000000063c4', '99999999-0000-4000-8000-0000000063e5', '99999999-0000-4000-8000-0000000063b1', 100000, 'UZS', 'submitted', '99999999-0000-4000-8000-000000006301');
insert into tci.tasks (id, task_type, object_type, object_id, title_key, target_role) values
  ('99999999-0000-4000-8000-0000000063f1', 'limit_needs_decision', 'credit_limit_request',
   '99999999-0000-4000-8000-0000000063c2', 'agenda.tasks.limit_needs_decision', 'credit_underwriter');
select set_config('tci.internal_call', '', true);

-- The caller, signed in to p_session (null: a token without a session).
create function pg_temp.act(p_user uuid, p_session uuid default '99999999-0000-4000-8000-0000000063a0') returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2', 'session_id', p_session))::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('tci.resolving_validation', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid, uuid) to authenticated;

create function pg_temp.refused(p_sql text, p_state text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'acting_role: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'acting_role: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_multi  constant uuid := '99999999-0000-4000-8000-000000006301';
  c_credit constant uuid := '99999999-0000-4000-8000-000000006302';
  c_comm   constant uuid := '99999999-0000-4000-8000-000000006303';
  c_sales  constant uuid := '99999999-0000-4000-8000-000000006304';
  c_admin  constant uuid := '99999999-0000-4000-8000-000000006305';
  c_own    constant uuid := '99999999-0000-4000-8000-0000000063c1';
  c_other  constant uuid := '99999999-0000-4000-8000-0000000063c2';
  c_radmin constant uuid := '99999999-0000-4000-8000-0000000063c3';
  c_rval   constant uuid := '99999999-0000-4000-8000-0000000063c4';
  c_task   constant uuid := '99999999-0000-4000-8000-0000000063f1';
  c_s2     constant uuid := '99999999-0000-4000-8000-0000000063a9';
  v        jsonb;
  v_dec_other uuid;
  v_dec_own   uuid;
  v_n      int;
begin
  -- 1. Several roles and none chosen: the person acts in no role, so every
  --    gate is closed; the held roles are still listed for the switcher.
  perform pg_temp.act(c_multi);
  if tci.acting_role() is not null or tci.has_role('sales', 'credit_underwriter', 'admin') or tci.is_staff() then
    raise exception 'acting_role: a multi-role person with no acting role passes a gate';
  end if;
  select count(*) into v_n from tci.held_roles();
  if v_n <> 4 then raise exception 'acting_role: held_roles lists % roles, expected 4', v_n; end if;

  -- 2. Choosing: only a held role, only with a session.
  perform pg_temp.refused('select tci.set_acting_role(''client'')', '42501', 'acting as a role not held', 'acting_role_not_held');
  perform pg_temp.act(c_multi, null);
  perform pg_temp.refused('select tci.set_acting_role(''sales'')', 'P0001', 'acting role without a session', 'acting_role_no_session');

  -- 3. Acting as commercial underwriting: the credit rights are gone.
  perform pg_temp.act(c_multi);
  perform tci.set_acting_role('commercial_underwriter');
  if tci.acting_role() <> 'commercial_underwriter' or not tci.has_role('commercial_underwriter')
     or tci.has_role('credit_underwriter') or tci.has_role('admin') or not tci.is_staff() then
    raise exception 'acting_role: acting as commercial does not answer as commercial only';
  end if;
  select count(*) into v_n from tci.current_user_roles();
  if v_n <> 1 then raise exception 'acting_role: current_user_roles returns % rows', v_n; end if;
  perform pg_temp.refused(format('select tci.decide_limit_request(%L, ''approved'', 100000, ''UZS'')', c_other),
                          '42501', 'a credit decision while acting as commercial', 'only credit underwriting');
  perform pg_temp.refused(format('select tci.start_limit_review(%L)', c_other),
                          '42501', 'taking a request into review while acting as commercial', 'only credit underwriting');

  -- 4. The acting role is per session: another session of the same person
  --    has chosen nothing yet.
  perform pg_temp.act(c_multi, c_s2);
  if tci.acting_role() is not null then
    raise exception 'acting_role: the acting role leaked into another session';
  end if;

  -- 5. Department tasks follow the acting role; the switch is immediate.
  perform pg_temp.act(c_multi);
  select count(*) into v_n from tci.tasks where id = c_task;
  if v_n <> 0 then raise exception 'acting_role: a credit task is visible while acting as commercial'; end if;
  perform tci.set_acting_role('credit_underwriter');
  select count(*) into v_n from tci.tasks where id = c_task;
  if v_n <> 1 then raise exception 'acting_role: a credit task is not visible while acting as credit'; end if;

  -- 6. Acting as credit: decides what others raised, never what they raised.
  v := tci.decide_limit_request(c_other, 'approved', 200000, 'UZS');
  if v ->> 'result' <> 'decided' then raise exception 'acting_role: credit decision answered %', v; end if;
  v_dec_other := (v ->> 'decision_id')::uuid;
  perform pg_temp.refused(format('select tci.start_limit_review(%L)', c_own),
                          '42501', 'reviewing one''s own request', 'four_eyes_own_request');
  perform pg_temp.refused(format('select tci.decide_limit_request(%L, ''approved'', 100000, ''UZS'')', c_own),
                          '42501', 'deciding one''s own request', 'four_eyes_own_request');
  perform pg_temp.refused(format('select tci.submit_limit_for_validation(%L, %L, ''approved'', 100000, ''UZS'', current_date, null, ''[]''::jsonb, ''second opinion'')', c_own, c_credit),
                          '42501', 'proposing a decision on one''s own request', 'four_eyes_own_request');
  select own_request into strict v from (select to_jsonb(q.own_request) as own_request
                                           from tci.v_limit_request_queue q where q.request_id = c_own) x;
  if v <> 'true'::jsonb then raise exception 'acting_role: the queue does not flag the caller''s own request'; end if;

  -- 7. A single-role colleague acts without choosing, and may decide it.
  perform pg_temp.act(c_credit);
  if tci.acting_role() <> 'credit_underwriter' then
    raise exception 'acting_role: a single-role person has to choose';
  end if;
  v := tci.decide_limit_request(c_own, 'approved', 200000, 'UZS');
  if v ->> 'result' <> 'decided' then raise exception 'acting_role: the colleague''s decision answered %', v; end if;
  v_dec_own := (v ->> 'decision_id')::uuid;
  -- ...but nobody validates what the requester raised.
  perform pg_temp.refused(format('select tci.submit_limit_for_validation(%L, %L, ''approved'', 100000, ''UZS'', current_date, null, ''[]''::jsonb, ''second opinion'')', c_rval, c_multi),
                          'P0001', 'the requester as validator', 'validator_four_eyes_own_request');

  -- 8. Commercial stage: neither the credit decider nor the requester adjusts.
  perform pg_temp.act(c_multi);
  perform tci.set_acting_role('commercial_underwriter');
  perform pg_temp.refused(format('select tci.adjust_limit_commercial(%L, 250000)', v_dec_other),
                          '42501', 'adjusting one''s own credit decision', 'four_eyes_own_credit_decision');
  perform pg_temp.refused(format('select tci.adjust_limit_commercial(%L, 250000)', v_dec_own),
                          '42501', 'adjusting a limit on one''s own request', 'four_eyes_own_request');
  perform pg_temp.act(c_comm);
  v := tci.adjust_limit_commercial(v_dec_other, 250000);
  if v ->> 'result' not in ('adjusted', 'held') and v ->> 'decision_id' is null then
    raise exception 'acting_role: a colleague''s commercial adjustment answered %', v;
  end if;

  -- 9. Admin: technical role only. No decision, no hold, no authority.
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('select tci.decide_limit_request(%L, ''approved'', 100000, ''UZS'')', c_radmin),
                          '42501', 'an admin credit decision', 'only credit underwriting');
  perform pg_temp.refused(format('select tci.adjust_limit_commercial(%L, 300000)', v_dec_other),
                          '42501', 'an admin commercial adjustment', 'only commercial underwriting');
  perform pg_temp.refused(format('select tci.hold_decision(%L, ''why'')', v_dec_own),
                          '42501', 'an admin hold', 'only sales');
  perform set_config('role', 'postgres', true);
  if tci.user_authority_uzs(c_admin, 'credit', 'unrated') <> 0 then
    raise exception 'acting_role: admin still has unlimited authority';
  end if;

  -- 10. Nobody reaches the acting-role table directly.
  perform pg_temp.act(c_multi);
  perform pg_temp.refused('select * from tci.acting_roles', '42501', 'reading tci.acting_roles');
  perform pg_temp.refused(format('insert into tci.acting_roles (user_id, session_id, role) values (%L, gen_random_uuid(), ''admin'')', c_multi),
                          '42501', 'writing tci.acting_roles');

  raise notice 'acting_role: OK — one acting role per session from held roles only, none until chosen for a multi-role person, gates and department tasks follow it, four eyes on review/decide/propose/validate/adjust, admin without business rights or authority, table closed to the API';
end $$;

rollback;
