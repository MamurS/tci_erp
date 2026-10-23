-- Tests for migration 0061: auto decisions on credit limits (ADT).
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/auto_decisions.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.
-- Everything is in UZS; buyers are rated B1 (band B).

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000009a1', 'adt-credit@t'),   -- credit, band B up to 1M
  ('99999999-0000-4000-8000-0000000009a2', 'adt-junior@t'),   -- credit, band B up to 100k
  ('99999999-0000-4000-8000-0000000009a3', 'adt-sales@t'),
  ('99999999-0000-4000-8000-0000000009a4', 'adt-comm@t'),
  ('99999999-0000-4000-8000-0000000009a5', 'adt-admin@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000009a1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000009a2', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000009a3', 'sales'),
  ('99999999-0000-4000-8000-0000000009a4', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000009a5', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000009a1', 'ADT Credit', false),
  ('99999999-0000-4000-8000-0000000009a2', 'ADT Junior', false),
  ('99999999-0000-4000-8000-0000000009a3', 'ADT Sales', false),
  ('99999999-0000-4000-8000-0000000009a4', 'ADT Comm', false),
  ('99999999-0000-4000-8000-0000000009a5', 'ADT Admin', false)
on conflict (user_id) do update set must_change_password = false;
insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, valid_from, created_by) values
  ('99999999-0000-4000-8000-0000000009a1', 'credit', 'B', 1000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000009a5'),
  ('99999999-0000-4000-8000-0000000009a2', 'credit', 'B', 100000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000009a5');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000009a3"}', true);
-- Two policyholders with ACTIVE policies; one prospect submission.
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000009e1', 'ADT Holder One', 'UZ', '99999999-0000-4000-8000-0000000009a3'),
  ('99999999-0000-4000-8000-0000000009e2', 'ADT Holder Two', 'UZ', '99999999-0000-4000-8000-0000000009a3');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values
  ('99999999-0000-4000-8000-0000000009f1', '99999999-0000-4000-8000-0000000009e1', 'ADT-P1', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 10000, 0, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000009a3', 10000000),
  ('99999999-0000-4000-8000-0000000009f2', '99999999-0000-4000-8000-0000000009e2', 'ADT-P2', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 10000, 0, 30, 60, 120, 'monthly',
   '99999999-0000-4000-8000-0000000009a3', 10000000);
update tci.policies set status = 'active'
 where id in ('99999999-0000-4000-8000-0000000009f1', '99999999-0000-4000-8000-0000000009f2');
insert into tci.insurance_requests (id, entity_id, request_number, status, created_by) values
  ('99999999-0000-4000-8000-0000000009b1', '99999999-0000-4000-8000-0000000009e1', 'ADT-IR-1', 'underwriting',
   '99999999-0000-4000-8000-0000000009a3');
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

-- A buyer: recent (or old) statements, a B1 rating with a recommended limit.
create function pg_temp.buyer(p_id uuid, p_name text, p_period_end date, p_recommended numeric) returns void
language plpgsql as $$
begin
  -- 0067: a complete company card, so the request is routed to the credit
  -- desk rather than to information gathering.
  insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id)
  values (p_id, p_name, 'KZ', '99999999-0000-4000-8000-0000000009a3', 'ADT-' || left(p_id::text, 8), 'Almaty',
          (select min(i.code) from tci.industries i));
  insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
  values (p_id, p_id, 'annual', extract(year from p_period_end)::int, p_period_end, 'UZS', '99999999-0000-4000-8000-0000000009a1');
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_by)
  values (p_id, p_id, 30, 'B1', p_recommended, 'UZS', '{}', '{}', 't', '99999999-0000-4000-8000-0000000009a1');
  perform set_config('tci.internal_call', '', true);
end $$;

-- A draft request submitted by sales through the real path; returns its id.
create function pg_temp.submit(p_policy uuid, p_buyer uuid, p_amount numeric) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.owner();
  insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
  values (v_id, p_policy, p_buyer, p_amount, 'UZS', 'draft', '99999999-0000-4000-8000-0000000009a3');
  perform pg_temp.act('99999999-0000-4000-8000-0000000009a3');
  perform tci.submit_limit_request(v_id);
  perform pg_temp.owner();
  return v_id;
end $$;
grant execute on function pg_temp.submit(uuid, uuid, numeric) to authenticated;

create function pg_temp.reasons(p_request uuid) returns text[] language sql as $$
  select reasons from tci.auto_decision_attempts where request_id = p_request order by attempted_at desc limit 1
$$;

do $$
declare
  c_credit constant uuid := '99999999-0000-4000-8000-0000000009a1';
  c_junior constant uuid := '99999999-0000-4000-8000-0000000009a2';
  c_sales  constant uuid := '99999999-0000-4000-8000-0000000009a3';
  c_comm   constant uuid := '99999999-0000-4000-8000-0000000009a4';
  c_admin  constant uuid := '99999999-0000-4000-8000-0000000009a5';
  c_p1     constant uuid := '99999999-0000-4000-8000-0000000009f1';
  c_p2     constant uuid := '99999999-0000-4000-8000-0000000009f2';
  c_buyer  constant uuid := '99999999-0000-4000-8000-000000000911';
  v_r      uuid;
  v_d      tci.credit_limit_decisions%rowtype;
  v_adt    tci.buyer_adt%rowtype;
  v_n      int;
  v_s      text;
  v_b      uuid;
begin
  perform pg_temp.buyer(c_buyer, 'ADT Buyer Main', current_date - 90, 500000);

  -- 1. The ADT amount stays within the setter's authority for the band.
  perform pg_temp.act(c_junior);
  begin
    perform tci.set_buyer_adt(c_buyer, 200000, 'UZS', 2);
    raise exception 'auto_decisions: an ADT beyond the setter''s authority was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_s = message_text;
    if position('adt_beyond_authority' in v_s) = 0 then raise; end if;
  end;
  -- Commercial underwriting and sales neither set nor see it.
  perform pg_temp.act(c_comm);
  begin
    perform tci.set_buyer_adt(c_buyer, 50000, 'UZS', 2);
    raise exception 'auto_decisions: commercial set an ADT';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act(c_credit);
  v_adt := tci.set_buyer_adt(c_buyer, 200000, 'UZS', 2, null, 'Annual review');
  if v_adt.grade_band <> 'B' then
    raise exception 'auto_decisions: the ADT did not take the rating band';
  end if;
  perform pg_temp.act(c_sales);
  select count(*) into v_n from tci.buyer_adt;
  if v_n <> 0 then
    raise exception 'auto_decisions: sales sees % ADT rows', v_n;
  end if;
  begin
    perform tci.buyer_adt_state(c_buyer);
    raise exception 'auto_decisions: sales read the ADT state';
  exception when insufficient_privilege then null;
  end;

  -- 2. Switched off (the default): everything goes to the underwriters.
  v_r := pg_temp.submit(c_p1, c_buyer, 100000);
  if (select status from tci.credit_limit_requests where id = v_r) <> 'submitted'
     or exists (select 1 from tci.auto_decision_attempts where request_id = v_r) then
    raise exception 'auto_decisions: a request was auto-decided with the switch off';
  end if;
  perform pg_temp.owner();
  update tci.credit_limit_requests set status = 'withdrawn' where id = v_r;   -- free the slot

  perform pg_temp.act(c_admin);
  perform tci.set_auto_decision_settings(true);

  -- 3. Auto decided on policy 1: the requested amount, the policy's payment
  --    terms, released at once, no author, one charged.
  v_r := pg_temp.submit(c_p1, c_buyer, 150000);
  select * into v_d from tci.credit_limit_decisions where request_id = v_r;
  if v_d.id is null or v_d.outcome <> 'approved' or v_d.approved_amount <> 150000 or v_d.payment_terms_days <> 90
     or v_d.decided_by is not null or not v_d.system_generated or v_d.system_reason_key <> 'limits.auto.adt'
     or v_d.released_at is null or v_d.release_kind <> 'immediate' or v_d.adt_id <> v_adt.id
     or v_d.valid_until <> (current_date + interval '12 months')::date then
    raise exception 'auto_decisions: the auto decision is wrong: %', row_to_json(v_d);
  end if;
  if (select status from tci.credit_limit_requests where id = v_r) <> 'decided' then
    raise exception 'auto_decisions: the request is not decided';
  end if;
  if exists (select 1 from tci.tasks where object_id = v_r and task_type = 'limit_needs_decision' and status = 'open') then
    raise exception 'auto_decisions: the underwriting task stayed open';
  end if;

  -- 4. The counter is the BUYER's: a request from another policyholder, of a
  --    small amount, takes the last one — charged one, whatever the amount —
  --    and the credit desk is asked to review the buyer.
  v_r := pg_temp.submit(c_p2, c_buyer, 10000);
  if not exists (select 1 from tci.credit_limit_decisions where request_id = v_r and adt_id = v_adt.id
                  and payment_terms_days = 120) then
    raise exception 'auto_decisions: the second policyholder was not auto-decided';
  end if;
  if tci.adt_used(v_adt.id) <> 2 then
    raise exception 'auto_decisions: used is %, not 2', tci.adt_used(v_adt.id);
  end if;
  if not exists (select 1 from tci.tasks where task_type = 'adt_review' and object_id = c_buyer and status = 'open'
                  and title_key = 'agenda.tasks.adt_review_exhausted' and target_role = 'credit_underwriter') then
    raise exception 'auto_decisions: no review task when the ADT ran out';
  end if;
  -- 5. Used up: the next one goes to the underwriter, with the reason.
  v_r := pg_temp.submit(c_p1, c_buyer, 50000);
  if (select status from tci.credit_limit_requests where id = v_r) <> 'submitted'
     or not (pg_temp.reasons(v_r) @> array['adt_exhausted']) then
    raise exception 'auto_decisions: an exhausted ADT decided: %', pg_temp.reasons(v_r);
  end if;
  -- 6. A new review replaces the ADT and retires the task.
  perform pg_temp.act(c_credit);
  v_adt := tci.set_buyer_adt(c_buyer, 200000, 'UZS', 5);
  perform pg_temp.owner();
  if (select count(*) from tci.buyer_adt where entity_id = c_buyer and status = 'replaced') <> 1
     or exists (select 1 from tci.tasks where task_type = 'adt_review' and object_id = c_buyer and status = 'open') then
    raise exception 'auto_decisions: the new ADT did not replace the old one or close the task';
  end if;
  perform pg_temp.owner();
  update tci.credit_limit_requests set status = 'withdrawn' where id = v_r;
  -- 7. Above the ADT amount: no partial auto decision.
  v_r := pg_temp.submit(c_p1, c_buyer, 300000);
  if not (pg_temp.reasons(v_r) = array['above_adt_amount']) then
    raise exception 'auto_decisions: above the ADT amount gave %', pg_temp.reasons(v_r);
  end if;

  -- 8. Each stop factor, on its own buyer with a good ADT.
  for v_s in select unnest(array['above_recommended', 'open_noa', 'claims', 'limit_revoked', 'manual_block',
                                 'stale_financials', 'group_limit', 'no_policy']) loop
    v_b := gen_random_uuid();
    perform pg_temp.owner();
    perform pg_temp.buyer(v_b, 'ADT Buyer ' || v_s,
                          -- 0067: older than the ADT's 15 months, within routing's 18
                          case when v_s = 'stale_financials' then current_date - 500 else current_date - 90 end,
                          case when v_s = 'above_recommended' then 50000 else 500000 end);
    perform pg_temp.act(c_credit);
    perform tci.set_buyer_adt(v_b, 200000, 'UZS', 5);
    perform pg_temp.owner();
    perform tci.begin_trusted_call();
    if v_s = 'open_noa' then
      insert into tci.overdue_notifications (policy_id, entity_id, first_due_date, overdue_amount, currency_code, reported_by)
      values (c_p1, v_b, current_date - 70, 1000, 'UZS', c_sales);
    elsif v_s = 'claims' then
      insert into tci.claims (claim_number, policy_id, entity_id, currency_code, status, filed_at)
      values ('CL-ADT-' || left(v_b::text, 8), c_p1, v_b, 'UZS', 'submitted', now());
    elsif v_s = 'limit_revoked' then
      insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
      values (v_b, c_p2, v_b, 1000, 'UZS', 'decided', c_sales);
      insert into tci.credit_limit_decisions (request_id, outcome, approved_amount, currency_code, decided_by)
      values (v_b, 'revoked', null, 'UZS', c_credit);
    elsif v_s = 'manual_block' then
      perform pg_temp.act(c_credit);
      perform tci.set_buyer_adt_block(v_b, true, 'Watch list');
      perform pg_temp.owner();
    elsif v_s = 'group_limit' then
      insert into tci.legal_entities (id, name, country_code, created_by)
      values ('99999999-0000-4000-8000-0000000009c9', 'ADT Group Parent', 'KZ', c_sales);
      insert into tci.entity_relationships (parent_entity_id, child_entity_id, relationship_type, ownership_pct, created_by)
      values ('99999999-0000-4000-8000-0000000009c9', v_b, 'ownership', 100, c_credit);
      insert into tci.group_limits (ultimate_parent_entity_id, max_amount, currency_code, set_by)
      values ('99999999-0000-4000-8000-0000000009c9', 50000, 'UZS', c_credit);
    end if;
    perform pg_temp.owner();
    if v_s = 'no_policy' then
      v_r := gen_random_uuid();
      insert into tci.credit_limit_requests (id, entity_id, insurance_request_id, requested_amount, currency_code, status, requested_by)
      values (v_r, v_b, '99999999-0000-4000-8000-0000000009b1', 100000, 'UZS', 'draft', c_sales);
      perform pg_temp.act(c_sales);
      perform tci.submit_limit_request(v_r);
      perform pg_temp.owner();
    else
      v_r := pg_temp.submit(c_p1, v_b, 100000);
    end if;
    if (select status from tci.credit_limit_requests where id = v_r) <> 'submitted'
       or not (pg_temp.reasons(v_r) @> array[v_s]) then
      raise exception 'auto_decisions: stop factor % gave status % and reasons %',
        v_s, (select status from tci.credit_limit_requests where id = v_r), pg_temp.reasons(v_r);
    end if;
  end loop;

  -- 9. A downgrade below the ADT's band suspends it and asks for a review.
  perform pg_temp.owner();
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_by, created_at)
  values (c_buyer, c_buyer, 70, 'D1', 10000, 'UZS', '{}', '{}', 't', c_credit, now() + interval '1 minute');
  perform pg_temp.owner();
  if (select status from tci.buyer_adt where id = v_adt.id) <> 'suspended'
     or (select suspended_reason from tci.buyer_adt where id = v_adt.id) <> 'downgrade' then
    raise exception 'auto_decisions: a downgrade did not suspend the ADT';
  end if;
  if not exists (select 1 from tci.tasks where task_type = 'adt_review' and object_id = c_buyer and status = 'open'
                  and title_key = 'agenda.tasks.adt_review_downgrade') then
    raise exception 'auto_decisions: no review task after the downgrade';
  end if;

  -- 10. The report and the buyer block, for the credit desk.
  perform pg_temp.act(c_credit);
  select count(*) into v_n from tci.v_auto_decisions where buyer_id = c_buyer;
  if v_n <> 2 then
    raise exception 'auto_decisions: the report shows % auto decisions for the buyer, not 2', v_n;
  end if;
  if (tci.buyer_adt_state(c_buyer) -> 'live' ->> 'status') <> 'suspended'
     or jsonb_array_length(tci.buyer_adt_state(c_buyer) -> 'history') <> 2 then
    raise exception 'auto_decisions: the buyer ADT block is wrong: %', tci.buyer_adt_state(c_buyer);
  end if;
  perform pg_temp.act(c_sales);
  select count(*) into v_n from tci.v_auto_decisions;
  if v_n <> 0 then
    raise exception 'auto_decisions: sales sees the auto decision report';
  end if;
  perform pg_temp.owner();

  raise notice 'auto_decisions: OK — ADT within the setter''s authority and hidden from sales/commercial, switch off sends all to underwriters, auto decision released at once with policy terms, counter shared across policyholders, charged one whatever the amount, exhausted => review task and underwriter, new review replaces, no partial auto decisions, every stop factor, downgrade suspends, report for the credit desk only';
end;
$$;

rollback;
