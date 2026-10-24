-- Tests for migrations 0066–0067: a limit request on a buyer we lack the
-- minimum information about is routed to information gathering, released by
-- the data itself, re-checked on demand, or waived by credit underwriting.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/information_gathering.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000067a1', 'ig-credit@t'),
  ('99999999-0000-4000-8000-0000000067a2', 'ig-sales@t'),
  ('99999999-0000-4000-8000-0000000067a3', 'ig-info@t'),
  ('99999999-0000-4000-8000-0000000067a4', 'ig-client@t'),
  ('99999999-0000-4000-8000-0000000067a5', 'ig-credit-requester@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000067a1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000067a2', 'sales'),
  ('99999999-0000-4000-8000-0000000067a3', 'information_manager'),
  ('99999999-0000-4000-8000-0000000067a4', 'client'),
  ('99999999-0000-4000-8000-0000000067a5', 'credit_underwriter');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000067a1', 'IG Credit', false),
  ('99999999-0000-4000-8000-0000000067a2', 'IG Sales', false),
  ('99999999-0000-4000-8000-0000000067a3', 'IG Info', false),
  ('99999999-0000-4000-8000-0000000067a4', 'IG Client', false),
  ('99999999-0000-4000-8000-0000000067a5', 'IG Credit Requester', false)
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000067a2"}', true);
insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id) values
  -- the policyholder
  ('99999999-0000-4000-8000-0000000067e1', 'IG Holder', 'UZ', '99999999-0000-4000-8000-0000000067a2', 'IG-H', 'Tashkent',
   (select min(i.code) from tci.industries i)),
  -- a buyer with a complete card and a fresh statement
  ('99999999-0000-4000-8000-0000000067e2', 'IG Buyer Complete', 'KZ', '99999999-0000-4000-8000-0000000067a2', 'IG-B2', 'Almaty',
   (select min(i.code) from tci.industries i));
-- a buyer we know only by name
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000067e3', 'IG Buyer Bare', 'KZ', '99999999-0000-4000-8000-0000000067a2'),
  ('99999999-0000-4000-8000-0000000067e4', 'IG Buyer Waived', 'KZ', '99999999-0000-4000-8000-0000000067a2'),
  ('99999999-0000-4000-8000-0000000067e5', 'IG Buyer Client', 'KZ', '99999999-0000-4000-8000-0000000067a2');
insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
values ('99999999-0000-4000-8000-0000000067d2', '99999999-0000-4000-8000-0000000067e2', 'annual',
        extract(year from current_date - 120)::int, current_date - 120, 'UZS', '99999999-0000-4000-8000-0000000067a1');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000067f1', '99999999-0000-4000-8000-0000000067e1', 'IG-P1', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 10000, 0, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000067a2', 10000000);
update tci.policies set status = 'active' where id = '99999999-0000-4000-8000-0000000067f1';
insert into tci.policyholder_users (entity_id, user_id, created_by) values
  ('99999999-0000-4000-8000-0000000067e1', '99999999-0000-4000-8000-0000000067a4', '99999999-0000-4000-8000-0000000067a2');
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

-- A draft request raised by p_by and submitted by them; returns its id.
create function pg_temp.submit(p_buyer uuid, p_by uuid) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.owner();
  insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
  values (v_id, '99999999-0000-4000-8000-0000000067f1', p_buyer, 100000, 'UZS', 'draft', p_by);
  perform pg_temp.act(p_by);
  perform tci.submit_limit_request(v_id);
  perform pg_temp.owner();
  return v_id;
end $$;
grant execute on function pg_temp.submit(uuid, uuid) to authenticated;

create function pg_temp.status(p_id uuid) returns text language sql as $$
  select status::text from tci.credit_limit_requests where id = p_id
$$;
create function pg_temp.task(p_type text, p_id uuid) returns text language sql as $$
  select string_agg(status::text, ',' order by created_at) from tci.tasks where task_type::text = p_type and object_id = p_id
$$;

-- p_states: '|'-separated SQLSTATEs that count as the refusal.
create function pg_temp.refused(p_sql text, p_states text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = any (string_to_array(p_states, '|')) and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'information_gathering: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_states, coalesce(p_fragment, '');
  end;
  raise exception 'information_gathering: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_credit  constant uuid := '99999999-0000-4000-8000-0000000067a1';
  c_sales   constant uuid := '99999999-0000-4000-8000-0000000067a2';
  c_info    constant uuid := '99999999-0000-4000-8000-0000000067a3';
  c_client  constant uuid := '99999999-0000-4000-8000-0000000067a4';
  c_credit2 constant uuid := '99999999-0000-4000-8000-0000000067a5';
  c_full    constant uuid := '99999999-0000-4000-8000-0000000067e2';
  c_bare    constant uuid := '99999999-0000-4000-8000-0000000067e3';
  c_waived  constant uuid := '99999999-0000-4000-8000-0000000067e4';
  c_cbuyer  constant uuid := '99999999-0000-4000-8000-0000000067e5';
  v_r       uuid;
  v_r2      uuid;
  v_gaps    text[];
  v_res     jsonb;
begin
  -- 1. A buyer with a complete card goes straight to the credit desk.
  v_r := pg_temp.submit(c_full, c_sales);
  if pg_temp.status(v_r) <> 'submitted' or pg_temp.task('limit_needs_decision', v_r) <> 'open' then
    raise exception 'information_gathering: a complete buyer was routed away (% / %)',
      pg_temp.status(v_r), pg_temp.task('limit_needs_decision', v_r);
  end if;

  -- 2. A buyer known only by name goes to information gathering: the
  --    decision task the Agenda opened is cancelled, the data desk gets its own.
  v_r := pg_temp.submit(c_bare, c_sales);
  if pg_temp.status(v_r) <> 'information_gathering' then
    raise exception 'information_gathering: a bare buyer was not routed (%)', pg_temp.status(v_r);
  end if;
  if pg_temp.task('limit_needs_decision', v_r) <> 'cancelled'
     or pg_temp.task('limit_information_needed', v_r) <> 'open'
     or (select target_role::text from tci.tasks where task_type = 'limit_information_needed' and object_id = v_r) <> 'information_manager' then
    raise exception 'information_gathering: tasks after routing: decision %, information %',
      pg_temp.task('limit_needs_decision', v_r), pg_temp.task('limit_information_needed', v_r);
  end if;
  v_gaps := tci.buyer_information_gaps(c_bare);
  if v_gaps <> array['registration_number', 'address', 'industry', 'no_statements'] then
    raise exception 'information_gathering: gaps %', v_gaps;
  end if;
  if (select (params -> 'gaps') from tci.tasks where task_type = 'limit_information_needed' and object_id = v_r)
     <> to_jsonb(v_gaps) then
    raise exception 'information_gathering: the task does not carry the gaps';
  end if;
  -- the auto decision did not run on it (the request was no longer submitted)
  if exists (select 1 from tci.auto_decision_attempts a where a.request_id = v_r) then
    raise exception 'information_gathering: an auto decision ran on a request in information gathering';
  end if;

  -- 3. One open request per buyer and scope still holds while gathering.
  perform pg_temp.refused(format(
    'insert into tci.credit_limit_requests (policy_id, entity_id, requested_amount, currency_code, status, requested_by) values (%L, %L, 1, %L, %L, %L)',
    '99999999-0000-4000-8000-0000000067f1', c_bare, 'UZS', 'draft', c_sales), '23505', 'a second open request');

  -- 4. «Проверить снова» while something is missing answers what is missing.
  perform pg_temp.act(c_info);
  v_gaps := tci.recheck_limit_information(v_r);
  if pg_temp.status(v_r) <> 'information_gathering' or cardinality(v_gaps) <> 4 then
    raise exception 'information_gathering: recheck with gaps: % / %', pg_temp.status(v_r), v_gaps;
  end if;
  perform pg_temp.act(c_client);
  perform pg_temp.refused(format('select tci.recheck_limit_information(%L)', v_r), '42501', 'a client recheck');

  -- 5. The information manager completes the card, then saves a statement:
  --    the request goes on by itself, the tasks follow.
  perform pg_temp.act(c_info);
  update tci.legal_entities set registration_number = 'IG-B3', address = 'Astana',
         industry_id = (select min(i.code) from tci.industries i)
   where id = c_bare;
  if pg_temp.status(v_r) <> 'information_gathering' then
    raise exception 'information_gathering: released without statements';
  end if;
  insert into tci.financial_statements (entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
  values (c_bare, 'annual', extract(year from current_date - 200)::int, current_date - 200, 'UZS', c_info);
  perform pg_temp.owner();
  if pg_temp.status(v_r) <> 'submitted' then
    raise exception 'information_gathering: complete data did not release the request (%)', pg_temp.status(v_r);
  end if;
  if pg_temp.task('limit_information_needed', v_r) <> 'done'
     or pg_temp.task('limit_needs_decision', v_r) <> 'cancelled,open' then
    raise exception 'information_gathering: tasks after release: information %, decision %',
      pg_temp.task('limit_information_needed', v_r), pg_temp.task('limit_needs_decision', v_r);
  end if;

  -- 6. A statement older than the setting is stale; the setting moves the line.
  update tci.financial_statements set period_end_date = current_date - 700
   where entity_id = c_bare;
  if tci.buyer_information_gaps(c_bare) <> array['stale_statements'] then
    raise exception 'information_gathering: a 700-day-old statement is not stale: %', tci.buyer_information_gaps(c_bare);
  end if;
  update tci.workflow_settings set information_statement_max_age_months = 30 where id;
  if cardinality(tci.buyer_information_gaps(c_bare)) <> 0 then
    raise exception 'information_gathering: the setting did not move the line';
  end if;
  update tci.workflow_settings set information_statement_max_age_months = 18 where id;

  -- 7. The waiver: credit underwriting only, with a reason, never on its own
  --    request; recorded, and the request goes to the credit desk.
  v_r2 := pg_temp.submit(c_waived, c_credit2);
  if pg_temp.status(v_r2) <> 'information_gathering' then
    raise exception 'information_gathering: the waiver fixture was not routed';
  end if;
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.waive_limit_information(%L, %L)', v_r2, 'go'), '42501', 'a sales waiver');
  perform pg_temp.act(c_credit2);
  perform pg_temp.refused(format('select tci.waive_limit_information(%L, %L)', v_r2, 'go'), '42501',
                          'a waiver on one''s own request', 'four_eyes_own_request');
  perform pg_temp.act(c_credit);
  perform pg_temp.refused(format('select tci.waive_limit_information(%L, %L)', v_r2, '  '), 'P0001',
                          'a waiver without a reason', 'information_waiver_comment_required');
  perform tci.waive_limit_information(v_r2, 'Known group, statements due next week');
  perform pg_temp.owner();
  if pg_temp.status(v_r2) <> 'submitted'
     or (select cardinality(gaps) from tci.limit_information_waivers where request_id = v_r2) <> 4
     or pg_temp.task('limit_information_needed', v_r2) <> 'done'
     or pg_temp.task('limit_needs_decision', v_r2) <> 'cancelled,open' then
    raise exception 'information_gathering: after the waiver: %, information %, decision %', pg_temp.status(v_r2),
      pg_temp.task('limit_information_needed', v_r2), pg_temp.task('limit_needs_decision', v_r2);
  end if;
  perform pg_temp.act(c_credit);
  perform pg_temp.refused(format('select tci.waive_limit_information(%L, %L)', v_r2, 'again'), 'P0001',
                          'a second waiver', 'limit_not_gathering_information');

  -- 8. The client's own path is routed the same way, and the client sees it.
  perform pg_temp.act(c_client);
  v_res := tci.client_request_limit('99999999-0000-4000-8000-0000000067f1', c_cbuyer, null, null, null,
                                    50000, 'UZS', 60, 'New buyer');
  perform pg_temp.owner();
  select id into v_r from tci.credit_limit_requests where entity_id = c_cbuyer;
  if pg_temp.status(v_r) <> 'information_gathering' then
    raise exception 'information_gathering: the client path was not routed (%)', pg_temp.status(v_r);
  end if;
  perform pg_temp.act(c_client);
  if (select status from tci.v_client_limit_requests where id = v_r) <> 'information_gathering' then
    raise exception 'information_gathering: the client does not see the status';
  end if;

  -- 9. Withdrawal (credit underwriting, the client being the requester)
  --    closes the open limit tasks.
  perform pg_temp.act(c_credit);
  perform tci.withdraw_limit_request(v_r, 'no longer needed');
  perform pg_temp.owner();
  if pg_temp.task('limit_information_needed', v_r) <> 'cancelled' then
    raise exception 'information_gathering: withdrawal left the information task %', pg_temp.task('limit_information_needed', v_r);
  end if;

  -- 10. Closure: the release and the waiver table are not the API's.
  perform pg_temp.act(c_credit);
  perform pg_temp.refused(format('select tci.release_limit_information(%L)', v_r2), '42501', 'a direct release');
  perform pg_temp.refused(format(
    'insert into tci.limit_information_waivers (request_id, waived_by, comment, gaps) values (%L, %L, %L, %L)',
    v_r, c_credit, 'x', '{}'), '42501', 'a direct waiver');
  perform pg_temp.owner();

  raise notice 'information_gathering: OK — complete buyers go straight on, bare ones to information gathering with the data desk''s task, one open request per scope, recheck answers the gaps, completed data releases by itself, stale statements by the setting, the waiver is credit''s with a reason and four eyes, the client path is routed and visible, withdrawal closes the tasks, release and waivers closed to the API';
end;
$$;

rollback;
