-- Tests for migration 0065: admin is a technical role. Every business action
-- outside credit limits is refused to an admin-only account (by name, or by
-- the write policies the account no longer holds); admin still READS the
-- business screens and keeps the technical rights; the departments that own
-- the actions still have them.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/admin_technical.sql
--
-- One transaction, rolled back. API roles are impersonated; the
-- internal-call token is cleared at every actor switch. Every UPDATE carries
-- a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-000000006501', 'adm-admin@t'),
  ('99999999-0000-4000-8000-000000006502', 'adm-commercial@t'),
  ('99999999-0000-4000-8000-000000006503', 'adm-sales@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-000000006501', 'admin'),
  ('99999999-0000-4000-8000-000000006502', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-000000006503', 'sales');

insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000065e1', 'Adm Holder LLC', 'UZ', '99999999-0000-4000-8000-000000006502');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000065f1', '99999999-0000-4000-8000-0000000065e1', 'ADM-1', 'whole_turnover',
  'draft', current_date - 30, current_date + 300, 'UZS', 90, 0, 0.15, 10000, 25000, 30, 60, 90, 'monthly',
  '99999999-0000-4000-8000-000000006502', 1000000);
insert into tci.tasks (id, task_type, object_type, object_id, title_key, params, target_role, due_at, priority)
values ('99999999-0000-4000-8000-0000000065a1', 'submission_declined', 'insurance_request', gen_random_uuid(),
        'agenda.tasks.submission_declined', '{}', 'sales', null, 'normal');

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

-- p_states: '|'-separated SQLSTATEs that count as the refusal.
create function pg_temp.refused(p_sql text, p_states text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = any (string_to_array(p_states, '|')) and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'admin_technical: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_states, coalesce(p_fragment, '');
  end;
  raise exception 'admin_technical: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_admin  constant uuid := '99999999-0000-4000-8000-000000006501';
  c_comm   constant uuid := '99999999-0000-4000-8000-000000006502';
  c_sales  constant uuid := '99999999-0000-4000-8000-000000006503';
  c_policy constant uuid := '99999999-0000-4000-8000-0000000065f1';
  c_entity constant uuid := '99999999-0000-4000-8000-0000000065e1';
  c_task   constant uuid := '99999999-0000-4000-8000-0000000065a1';
  c_none   constant uuid := '99999999-0000-4000-8000-0000000065ff';
  v_n      integer;
  v_status text;
begin
  -- 1. Admin: no business action, named or by policy.
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('select tci.change_policy_status(%L, ''active'')', c_policy),
                          '42501', 'an admin policy status change', 'policy_status_commercial_only');
  perform pg_temp.refused(format('select tci.bind_insurance_request(%L, ''X-1'', current_date, current_date + 365)', c_none),
                          '42501|P0002', 'an admin bind');
  perform pg_temp.refused(format('select tci.accept_declaration(%L)', c_none),
                          '42501|P0002', 'an admin declaration acceptance');
  perform pg_temp.refused(format('select tci.approve_claim(%L, null)', c_none),
                          '42501|P0002', 'an admin claim approval');
  perform pg_temp.refused(format('select tci.record_premium_payment(%L, 100, current_date, null, null, ''manual'', null)', c_none),
                          '42501', 'an admin premium payment');
  perform pg_temp.refused(format('select tci.import_bank_statement(%L, ''s.csv'', ''[]'')', c_none),
                          '42501', 'an admin bank import');
  perform pg_temp.refused(format('select tci.publish_offer(%L)', c_none),
                          '42501', 'an admin offer publication');
  perform pg_temp.refused(format('select tci.take_entity_request(%L)', c_none),
                          '42501', 'an admin taking a data request');
  perform pg_temp.refused(format('select tci.complete_task(%L)', c_task),
                          '42501|P0002', 'an admin completing a sales task');
  perform pg_temp.refused(format('insert into tci.legal_entities (name, country_code, created_by) values (''Adm New'', ''UZ'', %L)', c_admin),
                          '42501', 'an admin creating a company');
  -- an UPDATE the write policies do not allow touches no row rather than raising
  update tci.policies set policy_number = 'ADM-X' where id = c_policy;
  perform set_config('role', 'postgres', true);
  if (select policy_number from tci.policies where id = c_policy) <> 'ADM-1' then
    raise exception 'admin_technical: an admin edited a policy directly';
  end if;

  -- 2. Admin still READS the business data (oversight) ...
  perform pg_temp.act(c_admin);
  select count(*) into v_n from tci.policies where id = c_policy;
  if v_n <> 1 then raise exception 'admin_technical: admin lost read oversight of policies'; end if;
  select count(*) into v_n from tci.tasks where id = c_task;
  if v_n <> 1 then raise exception 'admin_technical: admin lost read oversight of the Agenda'; end if;

  -- ... and keeps the technical rights.
  perform tci.user_managers();
  perform set_config('role', 'postgres', true);

  -- 3. The departments keep theirs.
  perform pg_temp.act(c_comm);
  select (tci.change_policy_status(c_policy, 'active')).status::text into v_status;
  if v_status <> 'active' then raise exception 'admin_technical: commercial could not activate the policy'; end if;
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.change_policy_status(%L, ''suspended'', ''x'')', c_policy),
                          '42501', 'a sales policy status change', 'policy_status_commercial_only');
  perform tci.complete_task(c_task);
  perform set_config('role', 'postgres', true);
  if (select status::text from tci.tasks where id = c_task) <> 'done' then
    raise exception 'admin_technical: sales could not complete its own task';
  end if;

  raise notice 'admin_technical: OK — admin refused policy status, bind, declarations, claims, premium, bank import, offers, data requests, other departments'' tasks, company and policy writes; admin still reads policies and the Agenda and keeps the technical functions; commercial and sales keep their actions';
end $$;

rollback;
