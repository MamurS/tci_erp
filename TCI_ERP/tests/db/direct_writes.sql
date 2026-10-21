-- Tests for migration 0047: the workflow tables can no longer be written
-- with a raw REST call, and the workflow functions still can. Run against
-- the local replay harness:
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/direct_writes.sql
--
-- One transaction, rolled back. API roles are impersonated with
-- set_config('role', 'authenticated') + request.jwt.claims, and the
-- internal-call token is cleared at every switch, as a new REST call has
-- none (CLAUDE.md, "Impersonated smokes must clear the token").

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000000c1', 'dw-credit@t'),
  ('99999999-0000-4000-8000-0000000000c2', 'dw-commercial@t'),
  ('99999999-0000-4000-8000-0000000000c3', 'dw-claims@t'),
  ('99999999-0000-4000-8000-0000000000c4', 'dw-sales@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000000c1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000000c2', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000000c3', 'claims'),
  ('99999999-0000-4000-8000-0000000000c4', 'sales');
-- defaults such as created_by = auth.uid() need a caller while fixtures are made
select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000000c3"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000000e1', 'DW Holder', 'AD', '99999999-0000-4000-8000-0000000000c1'),
  ('99999999-0000-4000-8000-0000000000e2', 'DW Buyer', 'AD', '99999999-0000-4000-8000-0000000000c1');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000000f1', '99999999-0000-4000-8000-0000000000e1', 'DW-1', 'whole_turnover',
  'active', current_date, current_date + 365, 'UZS', 90, 0, 0.1, 1000, 0, 30, 60, 90, 'monthly',
  '99999999-0000-4000-8000-0000000000c2', 100000);
insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
values ('99999999-0000-4000-8000-0000000000a1', '99999999-0000-4000-8000-0000000000f1',
        '99999999-0000-4000-8000-0000000000e2', 1000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000000c4');
insert into tci.credit_limit_decisions (id, request_id, outcome, approved_amount, currency_code, lifecycle, decided_by)
values ('99999999-0000-4000-8000-0000000000d1', '99999999-0000-4000-8000-0000000000a1', 'approved', 1000, 'UZS', 'effective',
        '99999999-0000-4000-8000-0000000000c1');
insert into tci.claims (id, claim_number, policy_id, entity_id, currency_code)
values ('99999999-0000-4000-8000-0000000000b1', 'CL-DW-1', '99999999-0000-4000-8000-0000000000f1',
        '99999999-0000-4000-8000-0000000000e2', 'UZS');

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);   -- a new REST call carries no token
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.refused(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'direct_writes: % was NOT refused', p_label;
end $$;

do $$
begin
  -- a credit underwriter cannot insert a released decision of any amount
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c1');
  perform pg_temp.refused($q$insert into tci.credit_limit_decisions (request_id, outcome, approved_amount, currency_code, lifecycle, released_at)
    values ('99999999-0000-4000-8000-0000000000a1', 'approved', 999999999, 'UZS', 'effective', now())$q$,
    'credit: direct decision insert');

  -- sales cannot reinstate or backdate a decision
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c4');
  perform pg_temp.refused($q$update tci.credit_limit_decisions set released_at = now() - interval '1 year'
    where id = '99999999-0000-4000-8000-0000000000d1'$q$, 'sales: backdate released_at');

  -- a commercial underwriter cannot insert a commercial override
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c2');
  perform pg_temp.refused($q$insert into tci.credit_limit_decisions (request_id, outcome, approved_amount, currency_code, stage, adjusts_decision_id)
    values ('99999999-0000-4000-8000-0000000000a1', 'approved', 5, 'UZS', 'commercial', '99999999-0000-4000-8000-0000000000d1')$q$,
    'commercial: direct override');
  -- nor change a policy status around the machine, nor create an active policy
  perform pg_temp.refused($q$update tci.policies set status = 'suspended' where id = '99999999-0000-4000-8000-0000000000f1'$q$,
    'commercial: direct status change');
  perform pg_temp.refused($q$insert into tci.policies (entity_id, policy_number, product_structure, status, inception_date, expiry_date,
      currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
      waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency)
    values ('99999999-0000-4000-8000-0000000000e1', 'DW-2', 'whole_turnover', 'active', current_date, current_date + 1,
      'UZS', 90, 0, 0.1, 1, 0, 30, 60, 90, 'monthly')$q$, 'commercial: create an active policy');
  perform pg_temp.refused($q$insert into tci.policy_status_history (policy_id, from_status, to_status)
    values ('99999999-0000-4000-8000-0000000000f1', 'active', 'cancelled')$q$, 'commercial: forge status history');

  -- claims staff cannot set the indemnity or pay past the cap by hand
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c3');
  perform pg_temp.refused($q$update tci.claims set approved_indemnity = 1e9, status = 'approved'
    where id = '99999999-0000-4000-8000-0000000000b1'$q$, 'claims: direct approval');
  perform pg_temp.refused($q$insert into tci.claim_payments (claim_id, amount, currency_code)
    values ('99999999-0000-4000-8000-0000000000b1', 1e9, 'UZS')$q$, 'claims: direct payment');
  perform pg_temp.refused($q$delete from tci.recoveries$q$, 'claims: erase recoveries');

  -- nobody writes group limits, relationships or events directly
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c1');
  perform pg_temp.refused($q$delete from tci.group_limits$q$, 'credit: delete group limits');
  perform pg_temp.refused($q$delete from tci.entity_relationships$q$, 'credit: delete relationships');
  perform pg_temp.refused($q$insert into tci.workflow_events (event_type, object_type, object_id)
    values ('x', 'y', gen_random_uuid())$q$, 'credit: forge a workflow event');

  -- nobody closes, reopens or snoozes an Agenda task around its functions
  -- (0055: the column grant of 0024 let a PATCH close any automatic task)
  perform pg_temp.refused($q$update tci.tasks set status = 'done', completed_at = now()
    where target_role = 'credit_underwriter'$q$, 'credit: close an automatic task directly');
  perform pg_temp.refused($q$update tci.tasks set snoozed_until = now() + interval '1 day'
    where target_role = 'credit_underwriter'$q$, 'credit: snooze a task directly');
  perform pg_temp.refused($q$insert into tci.task_comments (task_id, body)
    values (gen_random_uuid(), 'x')$q$, 'credit: comment around add_task_comment');

  -- what the application still edits directly keeps working: policy terms
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c2');
  update tci.policies set notes = 'terms edited' where id = '99999999-0000-4000-8000-0000000000f1';
  if not found then
    raise exception 'direct_writes: a commercial underwriter could not edit policy terms';
  end if;

  -- and the status machine still works (it marks the transaction itself)
  perform tci.change_policy_status('99999999-0000-4000-8000-0000000000f1', 'suspended', 'test');
  perform set_config('role', 'postgres', true);
  if (select status from tci.policies where id = '99999999-0000-4000-8000-0000000000f1') <> 'suspended'
     or not exists (select 1 from tci.policy_status_history where policy_id = '99999999-0000-4000-8000-0000000000f1') then
    raise exception 'direct_writes: change_policy_status no longer works';
  end if;
end $$;

do $$ begin raise notice 'direct_writes: OK — decisions, policy status, claims money, group limits, relationships, events, tasks and task comments are function-only'; end $$;
rollback;
