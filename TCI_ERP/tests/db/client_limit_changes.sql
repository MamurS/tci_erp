-- Tests for migration 0075: the policyholder amends a limit request before
-- underwriting has it, replaces it after, withdraws it at any open stage —
-- and a withdrawal cancels a pending validation step whichever path made it.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/client_limit_changes.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000075a1', 'cl-credit@t'),
  ('99999999-0000-4000-8000-0000000075a2', 'cl-sales@t'),
  ('99999999-0000-4000-8000-0000000075a3', 'cl-info@t'),
  ('99999999-0000-4000-8000-0000000075a4', 'cl-client@t'),
  ('99999999-0000-4000-8000-0000000075a5', 'cl-credit2@t'),
  ('99999999-0000-4000-8000-0000000075a6', 'cl-stranger@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000075a1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000075a2', 'sales'),
  ('99999999-0000-4000-8000-0000000075a3', 'information_manager'),
  ('99999999-0000-4000-8000-0000000075a4', 'client'),
  ('99999999-0000-4000-8000-0000000075a5', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000075a6', 'client');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000075a1', 'CL Credit', false),
  ('99999999-0000-4000-8000-0000000075a2', 'CL Sales', false),
  ('99999999-0000-4000-8000-0000000075a3', 'CL Info', false),
  ('99999999-0000-4000-8000-0000000075a4', 'CL Client', false),
  ('99999999-0000-4000-8000-0000000075a5', 'CL Credit 2', false),
  ('99999999-0000-4000-8000-0000000075a6', 'CL Stranger', false)
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000075a2"}', true);
insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id) values
  ('99999999-0000-4000-8000-0000000075e1', 'CL Holder', 'UZ', '99999999-0000-4000-8000-0000000075a2', 'CL-H', 'Tashkent',
   (select min(i.code) from tci.industries i)),
  ('99999999-0000-4000-8000-0000000075e2', 'CL Buyer One', 'KZ', '99999999-0000-4000-8000-0000000075a2', 'CL-B1', 'Almaty',
   (select min(i.code) from tci.industries i)),
  ('99999999-0000-4000-8000-0000000075e3', 'CL Buyer Two', 'KZ', '99999999-0000-4000-8000-0000000075a2', 'CL-B2', 'Almaty',
   (select min(i.code) from tci.industries i)),
  ('99999999-0000-4000-8000-0000000075e4', 'CL Other Holder', 'UZ', '99999999-0000-4000-8000-0000000075a2', 'CL-H2', 'Tashkent',
   (select min(i.code) from tci.industries i));
insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
values
  ('99999999-0000-4000-8000-0000000075d2', '99999999-0000-4000-8000-0000000075e2', 'annual',
   extract(year from current_date - 120)::int, current_date - 120, 'UZS', '99999999-0000-4000-8000-0000000075a1'),
  ('99999999-0000-4000-8000-0000000075d3', '99999999-0000-4000-8000-0000000075e3', 'annual',
   extract(year from current_date - 120)::int, current_date - 120, 'UZS', '99999999-0000-4000-8000-0000000075a1');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000075f1', '99999999-0000-4000-8000-0000000075e1', 'CL-P1', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 10000, 50000, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000075a2', 10000000);
update tci.policies set status = 'active' where id = '99999999-0000-4000-8000-0000000075f1';
insert into tci.policyholder_users (entity_id, user_id, created_by) values
  ('99999999-0000-4000-8000-0000000075e1', '99999999-0000-4000-8000-0000000075a4', '99999999-0000-4000-8000-0000000075a2'),
  ('99999999-0000-4000-8000-0000000075e4', '99999999-0000-4000-8000-0000000075a6', '99999999-0000-4000-8000-0000000075a2');
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

create function pg_temp.status(p_id uuid) returns text language sql as $$
  select status::text from tci.credit_limit_requests where id = p_id
$$;
create function pg_temp.open_tasks(p_type text, p_id uuid) returns int language sql as $$
  select count(*)::int from tci.tasks where task_type::text = p_type and object_id = p_id and status = 'open'
$$;

create function pg_temp.refused(p_sql text, p_states text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = any (string_to_array(p_states, '|')) and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'client_limit_changes: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_states, coalesce(p_fragment, '');
  end;
  raise exception 'client_limit_changes: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_credit   constant uuid := '99999999-0000-4000-8000-0000000075a1';
  c_sales    constant uuid := '99999999-0000-4000-8000-0000000075a2';
  c_info     constant uuid := '99999999-0000-4000-8000-0000000075a3';
  c_client   constant uuid := '99999999-0000-4000-8000-0000000075a4';
  c_credit2  constant uuid := '99999999-0000-4000-8000-0000000075a5';
  c_stranger constant uuid := '99999999-0000-4000-8000-0000000075a6';
  c_policy   constant uuid := '99999999-0000-4000-8000-0000000075f1';
  c_b1       constant uuid := '99999999-0000-4000-8000-0000000075e2';
  c_b2       constant uuid := '99999999-0000-4000-8000-0000000075e3';
  v_r   uuid;
  v_r2  uuid;
  v_p   uuid;
  v_s   uuid := gen_random_uuid();
  v_res jsonb;
  v_n   int;
  v_t   int;
  v_row record;
begin
  -- 1. The client raises a request; it is submitted with its decision task
  --    (one per covering underwriter where authority grants exist, else one
  --    for the role — v_t remembers how many).
  perform pg_temp.act(c_client);
  v_res := tci.client_request_limit(c_policy, c_b1, null, null, null, 100000, 'UZS', 60, 'first');
  v_r := (v_res ->> 'id')::uuid;
  perform pg_temp.owner();
  v_t := pg_temp.open_tasks('limit_needs_decision', v_r);
  if pg_temp.status(v_r) <> 'submitted' or v_t < 1 then
    raise exception 'client_limit_changes: setup (% / %)', pg_temp.status(v_r), pg_temp.open_tasks('limit_needs_decision', v_r);
  end if;

  -- 2. The view offers both actions before underwriting has it.
  perform pg_temp.act(c_client);
  select * into v_row from tci.v_client_limit_requests where id = v_r;
  if not v_row.may_amend or not v_row.may_withdraw or v_row.amended_at is not null then
    raise exception 'client_limit_changes: the view''s flags before review are wrong';
  end if;

  -- 3. Amend: a record, the new amount, submitted again with fresh tasks.
  v_res := tci.client_amend_limit_request(v_r, 150000, 90, 'bigger order');
  if v_res ->> 'status' <> 'submitted' then
    raise exception 'client_limit_changes: an amended request is %', v_res ->> 'status';
  end if;
  perform pg_temp.refused(format('select tci.client_amend_limit_request(%L, 150000, 90, %L)', v_r, 'bigger order'),
    'P0001', 'an unchanged amendment', 'amendment_unchanged');
  perform pg_temp.refused(format('select tci.client_amend_limit_request(%L, 0, 90, null)', v_r),
    'P0001', 'a zero amount', 'amendment_amount_invalid');
  perform pg_temp.owner();
  select * into v_row from tci.credit_limit_requests where id = v_r;
  if v_row.requested_amount <> 150000 or v_row.requested_payment_terms_days <> 90 or v_row.justification <> 'bigger order' then
    raise exception 'client_limit_changes: the amendment did not apply';
  end if;
  select count(*) into v_n from tci.limit_request_amendments
   where request_id = v_r and from_amount = 100000 and to_amount = 150000 and from_payment_terms_days = 60
     and to_payment_terms_days = 90 and amended_by = c_client and kind = 'amended' and status_at = 'submitted';
  if v_n <> 1 then
    raise exception 'client_limit_changes: the amendment was not recorded';
  end if;
  if pg_temp.open_tasks('limit_needs_decision', v_r) < 1
     or (select count(*) from tci.tasks where task_type = 'limit_needs_decision' and object_id = v_r and status = 'cancelled') <> v_t then
    raise exception 'client_limit_changes: the decision task was not reopened for the new amount';
  end if;
  if not exists (select 1 from tci.workflow_events where object_id = v_r and event_type = 'limit.request_amended') then
    raise exception 'client_limit_changes: no amendment event';
  end if;

  -- 4. Only the policyholder's own users, only through the portal.
  perform pg_temp.act(c_stranger);
  perform pg_temp.refused(format('select tci.client_amend_limit_request(%L, 1, null, null)', v_r), 'P0002', 'a stranger amending');
  perform pg_temp.refused(format('select tci.client_withdraw_limit_request(%L)', v_r), 'P0002', 'a stranger withdrawing');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.client_amend_limit_request(%L, 1, null, null)', v_r), '42501', 'staff on the portal path');
  perform pg_temp.refused(format('select tci.client_withdraw_limit_request(%L)', v_r), '42501', 'staff withdrawing on the portal path');

  -- 5. Taken into review: no amendment, but a replacement — atomic.
  perform pg_temp.act(c_credit);
  perform tci.start_limit_review(v_r);
  perform pg_temp.act(c_client);
  perform pg_temp.refused(format('select tci.client_amend_limit_request(%L, 200000, 90, null)', v_r),
    'P0001', 'amending under review', 'limit_request_in_review');
  select * into v_row from tci.v_client_limit_requests where id = v_r;
  if v_row.may_amend or not v_row.may_withdraw or v_row.amended_at is null then
    raise exception 'client_limit_changes: the view''s flags under review are wrong';
  end if;
  -- A replacement the new request refuses withdraws nothing.
  perform pg_temp.refused(format('select tci.client_replace_limit_request(%L, -5, 90, null)', v_r),
    'P0001', 'a replacement with a negative amount');
  perform pg_temp.owner();
  if pg_temp.status(v_r) <> 'under_review' then
    raise exception 'client_limit_changes: a refused replacement withdrew the request (%)', pg_temp.status(v_r);
  end if;
  perform pg_temp.act(c_client);
  v_res := tci.client_replace_limit_request(v_r, 200000, 90, 'bigger still', 'replaced');
  v_r2 := (v_res ->> 'id')::uuid;
  perform pg_temp.owner();
  select * into v_row from tci.credit_limit_requests where id = v_r;
  if v_row.status <> 'withdrawn' or v_row.withdrawn_by <> c_client or v_row.withdrawn_via <> 'portal'
     or v_row.withdraw_comment <> 'replaced' then
    raise exception 'client_limit_changes: the replaced request was not withdrawn as the policyholder''s';
  end if;
  select * into v_row from tci.credit_limit_requests where id = v_r2;
  if v_row.status <> 'submitted' or v_row.replaces_request_id <> v_r or v_row.requested_amount <> 200000
     or v_row.requested_by <> c_client then
    raise exception 'client_limit_changes: the replacing request is wrong';
  end if;
  if not exists (select 1 from tci.limit_request_amendments where request_id = v_r2 and kind = 'replaced'
                  and replaced_request_id = v_r and from_amount = 150000 and to_amount = 200000 and status_at = 'under_review') then
    raise exception 'client_limit_changes: the replacement was not recorded';
  end if;
  if pg_temp.open_tasks('limit_needs_decision', v_r) <> 0 or pg_temp.open_tasks('limit_needs_decision', v_r2) < 1 then
    raise exception 'client_limit_changes: the tasks did not follow the replacement';
  end if;

  -- 6. Staff read the changes, the client does not read the record.
  perform pg_temp.act(c_credit);
  select count(*) into v_n from tci.limit_request_changes(v_r2);
  if v_n <> 1 then raise exception 'client_limit_changes: staff see % changes of the replacing request', v_n; end if;
  select count(*) into v_n from tci.limit_request_changes(v_r);
  if v_n <> 1 then raise exception 'client_limit_changes: staff see % changes of the amended request', v_n; end if;
  perform pg_temp.act(c_client);
  select count(*) into v_n from tci.limit_request_amendments;
  if v_n <> 0 then raise exception 'client_limit_changes: the client reads the amendment record'; end if;
  perform pg_temp.refused(format(
    'insert into tci.limit_request_amendments (request_id, amended_by, status_at, currency_code, from_amount, to_amount) values (%L, %L, %L, %L, 1, 2)',
    v_r2, c_client, 'submitted', 'UZS'), '42501', 'a direct amendment insert');
  perform pg_temp.owner();
  perform pg_temp.refused(format('update tci.limit_request_amendments set to_amount = 1 where request_id = %L', v_r2),
    '42501', 'changing an amendment, owner included');

  -- 7. Withdrawn on validation: the pending step is cancelled with its task.
  update tci.credit_limit_requests set status = 'escalated' where id = v_r2;
  insert into tci.limit_validations (id, chain_id, request_id, stream, kind, outcome, amount, currency_code,
    grade_band, proposed_by, validator_id, comment)
  values (v_s, v_s, v_r2, 'credit', 'required', 'approved', 200000, 'UZS', 'unrated', c_credit, c_credit2, 'beyond me');
  perform tci.begin_trusted_call();
  perform tci.open_task('limit_validation', 'limit_validation', v_s, 'agenda.tasks.limit_validation',
    '{}'::jsonb, null, c_credit2, null, 'urgent', null);
  perform pg_temp.owner();
  perform pg_temp.act(c_client);
  perform tci.client_withdraw_limit_request(v_r2, null);
  perform pg_temp.refused(format('select tci.client_withdraw_limit_request(%L)', v_r2),
    'P0001', 'withdrawing twice', 'limit_request_not_open');
  perform pg_temp.owner();
  if (select status::text from tci.limit_validations where id = v_s) <> 'cancelled'
     or (select resolved_by from tci.limit_validations where id = v_s) <> c_client
     or pg_temp.open_tasks('limit_validation', v_s) <> 0 then
    raise exception 'client_limit_changes: the pending validation step survived the withdrawal';
  end if;

  -- 8. The staff withdrawal does the same, and says it was staff.
  perform pg_temp.act(c_client);
  v_res := tci.client_request_limit(c_policy, c_b2, null, null, null, 70000, 'UZS', null, null);
  v_r := (v_res ->> 'id')::uuid;
  perform pg_temp.owner();
  v_s := gen_random_uuid();
  update tci.credit_limit_requests set status = 'escalated' where id = v_r;
  insert into tci.limit_validations (id, chain_id, request_id, stream, kind, outcome, amount, currency_code,
    grade_band, proposed_by, validator_id, comment)
  values (v_s, v_s, v_r, 'credit', 'required', 'approved', 70000, 'UZS', 'unrated', c_credit, c_credit2, 'beyond me');
  perform pg_temp.act(c_credit);
  perform tci.withdraw_limit_request(v_r, 'no longer needed');
  perform pg_temp.owner();
  if (select status::text from tci.limit_validations where id = v_s) <> 'cancelled'
     or (select withdrawn_via from tci.credit_limit_requests where id = v_r) <> 'staff'
     or (select withdrawn_by from tci.credit_limit_requests where id = v_r) <> c_credit then
    raise exception 'client_limit_changes: the staff withdrawal did not cancel the step or record itself';
  end if;

  -- 9. A buyer proposal: amended while being identified, then withdrawn,
  --    and nobody can resolve it afterwards.
  perform pg_temp.act(c_client);
  v_res := tci.client_request_limit(c_policy, null, 'CL Unknown LLC', null, null, 30000, 'UZS', null, null);
  v_p := (v_res ->> 'id')::uuid;
  v_res := tci.client_amend_limit_request(v_p, 45000, 30, 'new contract');
  select * into v_row from tci.v_client_limit_requests where id = v_p;
  if v_row.requested_amount <> 45000 or not v_row.may_amend or v_row.amended_at is null then
    raise exception 'client_limit_changes: the proposal amendment did not show';
  end if;
  perform pg_temp.owner();
  if pg_temp.open_tasks('buyer_needs_entity', v_p) <> 1 then
    raise exception 'client_limit_changes: the proposal has no identification task';
  end if;
  perform pg_temp.act(c_client);
  perform tci.client_withdraw_limit_request(v_p, 'found another buyer');
  perform pg_temp.owner();
  if (select status from tci.client_buyer_proposals where id = v_p) <> 'withdrawn'
     or pg_temp.open_tasks('buyer_needs_entity', v_p) <> 0 then
    raise exception 'client_limit_changes: the proposal withdrawal did not close it';
  end if;
  perform pg_temp.act(c_info);
  perform pg_temp.refused(format('select tci.resolve_buyer_proposal(%L, %L)', v_p, c_b2), 'P0001', 'resolving a withdrawn proposal');
  perform pg_temp.owner();

  raise notice 'client_limit_changes: OK — amended before review (recorded, submitted again with the decision task reopened), refused unchanged / zero / in review / to strangers and staff, replaced after review atomically (old withdrawn as the policyholder''s, new names it), withdrawn on validation cancels the step and its task on both paths, proposals amended and withdrawn, the record staff-only and immutable';
end;
$$;

rollback;
