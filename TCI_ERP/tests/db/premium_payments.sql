-- Tests for migration 0056: the instalment schedule, payments, invoices,
-- bank-statement import and the Agenda's premium tasks.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/premium_payments.sql
--
-- One transaction, rolled back. API roles are impersonated; the
-- internal-call token is cleared at every actor switch. Every UPDATE carries
-- a WHERE clause (the canonical tooling holds one without).

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000056c2', 'pp-commercial@t'),
  ('99999999-0000-4000-8000-0000000056c1', 'pp-credit@t'),
  ('99999999-0000-4000-8000-0000000056c5', 'pp-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000056c2', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000056c1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000056c5', 'client');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000056c2"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000056e1', 'PP Holder LLC', 'UZ', '99999999-0000-4000-8000-0000000056c2');
insert into tci.policyholder_users (entity_id, user_id, created_by) values
  ('99999999-0000-4000-8000-0000000056e1', '99999999-0000-4000-8000-0000000056c5', '99999999-0000-4000-8000-0000000056c2');

-- The policy of the bug, moved in time so that its first quarter is past due
-- today: anniversary to anniversary, quarterly, 45,000 USD.
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000056f1', '99999999-0000-4000-8000-0000000056e1', 'PP-QTR-1', 'whole_turnover',
  'draft', (current_date - interval '5 months')::date, (current_date - interval '5 months' + interval '1 year')::date,
  'USD', 90, 0, 0.15, 45000, 25000, 30, 60, 90, 'quarterly', '99999999-0000-4000-8000-0000000056c2', 1000000);
update tci.policies set status = 'active' where id = '99999999-0000-4000-8000-0000000056f1';

-- The regression matrix: start days 23-31 of every month of a leap year and
-- a common year, monthly and quarterly, expiry on the anniversary and on the
-- day before it, plus a year and a fortnight (a part period).
insert into tci.policies (entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
select '99999999-0000-4000-8000-0000000056e1',
       format('PP-M-%s-%s-%s-%s', f, inc, conv, y), 'whole_turnover', 'draft', inc,
       case conv when 'anniv' then (inc + interval '1 year')::date
                 when 'eve'   then (inc + interval '1 year')::date - 1
                 else (inc + interval '1 year 15 days')::date end,
       'UZS', 90, 0, 0.15, 1000000.07, 0, 30, 60, 90, f::tci.declaration_frequency,
       '99999999-0000-4000-8000-0000000056c2', 1000000
  from unnest(array['monthly', 'quarterly']) f,
       unnest(array[2024, 2027]) y,
       generate_series(1, 12) m,
       generate_series(23, 31) d,
       unnest(array['anniv', 'eve', 'part']) conv,
       lateral (select make_date(y, m, d) as inc) x
 where d <= extract(day from (make_date(y, m, 1) + interval '1 month - 1 day'));

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.refused(p_sql text, p_state text, p_label text, p_fragment text default null)
returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'premium_payments: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'premium_payments: % was NOT refused', p_label;
end $$;

do $$
declare
  v_bad   text;
  v_n     int;
  s1      tci.v_premium_instalments%rowtype;
  s2      tci.v_premium_instalments%rowtype;
  v_pay   uuid;
  v_res   jsonb;
  v_imp   uuid;
  v_line  uuid;
  v_task  tci.tasks%rowtype;
  v_cl    record;
begin
  -- 1. The schedule: every generated policy of the matrix is right.
  select string_agg(p.policy_number, ', ') into v_bad
    from tci.policies p
   where p.policy_number like 'PP-M-%'
     and (
       (select count(*) from tci.premium_instalments i where i.policy_id = p.id)
         <> case p.declaration_frequency when 'monthly' then 12 else 4 end
            + case when p.policy_number like '%-part-%' then 1 else 0 end
       or (select sum(i.amount) from tci.premium_instalments i where i.policy_id = p.id) <> 1000000.07
       or exists (select 1 from tci.premium_instalments i where i.policy_id = p.id
                   group by i.due_date having count(*) > 1)
       or exists (select 1 from tci.premium_instalments i where i.policy_id = p.id and i.due_date > p.expiry_date)
     );
  if v_bad is not null then
    raise exception 'premium_payments: wrong schedules: %', v_bad;
  end if;
  select count(*) into v_n from tci.premium_instalments where policy_id = '99999999-0000-4000-8000-0000000056f1';
  if v_n <> 4 then
    raise exception 'premium_payments: the anniversary quarterly policy has % instalments, not 4', v_n;
  end if;

  -- 2. Invoicing: commercial underwriting only, numbered, once.
  perform pg_temp.act('99999999-0000-4000-8000-0000000056c1');
  perform pg_temp.refused($q$select * from tci.invoice_premium_instalment(
    (select id from tci.premium_instalments where policy_id = '99999999-0000-4000-8000-0000000056f1' and sequence = 1), 'X')$q$,
    '42501', 'credit invoices');
  perform pg_temp.act('99999999-0000-4000-8000-0000000056c2');
  select count(*) into v_n from tci.invoice_premium_instalment(
    (select id from tci.premium_instalments where policy_id = '99999999-0000-4000-8000-0000000056f1' and sequence = 1),
    'INV-PP-1');
  if v_n <> 4 then raise exception 'premium_payments: invoicing returned % rows, not the policy''s 4', v_n; end if;
  select * into s1 from tci.v_premium_instalments where policy_id = '99999999-0000-4000-8000-0000000056f1' and sequence = 1;
  if s1.invoice_number <> 'INV-PP-1' or s1.invoiced_by <> '99999999-0000-4000-8000-0000000056c2'
     or s1.derived_status <> 'overdue' or s1.amount <> 11250 or s1.outstanding <> 11250 then
    raise exception 'premium_payments: invoiced s1 is %', row_to_json(s1);
  end if;
  perform pg_temp.refused(format($q$select * from tci.invoice_premium_instalment(%L, 'INV-PP-1b')$q$, s1.id),
    'P0001', 'invoice twice', 'instalment_already_invoiced');
  perform pg_temp.refused($q$select * from tci.invoice_premium_instalment(
    (select id from tci.premium_instalments where policy_id = '99999999-0000-4000-8000-0000000056f1' and sequence = 2), 'inv-pp-1')$q$,
    'P0001', 'reuse an invoice number', 'invoice_number_taken');
  perform pg_temp.refused($q$select * from tci.invoice_premium_instalment(
    (select id from tci.premium_instalments where policy_id = '99999999-0000-4000-8000-0000000056f1' and sequence = 2), '  ')$q$,
    'P0001', 'blank invoice number', 'invoice_number_required');

  -- 3. The Agenda chases s1 (overdue).
  perform tci.refresh_agenda();
  select * into v_task from tci.tasks
   where object_id = s1.id and task_type = 'instalment_overdue' and status = 'open';
  if not found or (v_task.params->>'amount')::numeric <> 11250 then
    raise exception 'premium_payments: no overdue task for s1 (or wrong amount)';
  end if;

  -- 4. A part payment: still overdue (precedence), paid and outstanding split,
  --    the task follows what is still owed.
  perform pg_temp.act('99999999-0000-4000-8000-0000000056c1');
  perform pg_temp.refused($q$select * from tci.record_premium_payment('99999999-0000-4000-8000-0000000056f1', 100, current_date)$q$,
    '42501', 'credit records a payment');
  perform pg_temp.act('99999999-0000-4000-8000-0000000056c2');
  perform * from tci.record_premium_payment('99999999-0000-4000-8000-0000000056f1', 5000, current_date - 3, 'USD', 'PP 1');
  select * into s1 from tci.v_premium_instalments where id = s1.id;
  if s1.paid_amount <> 5000 or s1.outstanding <> 6250 or s1.derived_status <> 'overdue' then
    raise exception 'premium_payments: after a part payment s1 is %', row_to_json(s1);
  end if;
  perform tci.refresh_agenda();
  select * into v_task from tci.tasks where object_id = s1.id and task_type = 'instalment_overdue' and status = 'open';
  if not found or (v_task.params->>'amount')::numeric <> 6250 then
    raise exception 'premium_payments: the overdue task does not follow the part payment';
  end if;

  -- 5. Refusals: more than is owed, another currency, a future date, a draft policy.
  perform pg_temp.refused($q$select * from tci.record_premium_payment('99999999-0000-4000-8000-0000000056f1', 40000.01, current_date)$q$,
    'P0001', 'overpayment', 'payment_exceeds_outstanding');
  perform pg_temp.refused($q$select * from tci.record_premium_payment('99999999-0000-4000-8000-0000000056f1', 10, current_date, 'EUR')$q$,
    'P0001', 'another currency', 'payment_currency_mismatch');
  perform pg_temp.refused($q$select * from tci.record_premium_payment('99999999-0000-4000-8000-0000000056f1', 10, current_date + 1)$q$,
    'P0001', 'a future payment', 'payment_date_invalid');
  perform pg_temp.refused($q$select * from tci.record_premium_payment(
    (select id from tci.policies where policy_number like 'PP-M-%' limit 1), 10, current_date)$q$,
    'P0001', 'a draft policy', 'policy_not_billable');

  -- 6. The rest of s1: paid, settled today, its task answered at once.
  perform * from tci.record_premium_payment('99999999-0000-4000-8000-0000000056f1', 6250, current_date, 'USD', 'PP 2');
  select * into s1 from tci.v_premium_instalments where id = s1.id;
  if s1.derived_status <> 'paid' or s1.outstanding <> 0 or s1.settled_on <> current_date then
    raise exception 'premium_payments: after the full payment s1 is %', row_to_json(s1);
  end if;
  select * into v_task from tci.tasks where object_id = s1.id and task_type = 'instalment_overdue' order by created_at desc limit 1;
  if v_task.status <> 'done' then
    raise exception 'premium_payments: the payment did not close the overdue task (%).', v_task.status;
  end if;

  -- 7. A reversal: the payment and its reversal both stay; s1 is owed again
  --    and chased again; a payment is reversed once, a reversal never.
  select id into v_pay from tci.premium_payments where reference = 'PP 2';
  perform pg_temp.refused(format($q$select * from tci.reverse_premium_payment(%L, ' ')$q$, v_pay),
    'P0001', 'a reversal without a reason', 'reversal_reason_required');
  perform * from tci.reverse_premium_payment(v_pay, 'bounced');
  select * into s1 from tci.v_premium_instalments where id = s1.id;
  if s1.outstanding <> 6250 or s1.derived_status <> 'overdue' then
    raise exception 'premium_payments: after the reversal s1 is %', row_to_json(s1);
  end if;
  perform pg_temp.refused(format($q$select * from tci.reverse_premium_payment(%L, 'again')$q$, v_pay),
    'P0001', 'reverse twice', 'payment_already_reversed');
  perform pg_temp.refused(format($q$select * from tci.reverse_premium_payment(%L, 'x')$q$,
    (select id from tci.premium_payments where reverses_id = v_pay)),
    'P0001', 'reverse a reversal', 'payment_is_reversal');
  select count(*) into v_n from tci.premium_payments where policy_id = '99999999-0000-4000-8000-0000000056f1';
  if v_n <> 3 then raise exception 'premium_payments: % payment rows, expected 3 (two payments, one reversal)', v_n; end if;
  perform tci.refresh_agenda();
  if not exists (select 1 from tci.tasks where object_id = s1.id and task_type = 'instalment_overdue' and status = 'open') then
    raise exception 'premium_payments: the reversed instalment is not chased again';
  end if;

  -- 8. Nothing is written directly.
  perform pg_temp.refused($q$insert into tci.premium_payments (policy_id, amount, currency_code, payment_date)
    values ('99999999-0000-4000-8000-0000000056f1', 1, 'USD', current_date)$q$, '42501', 'insert a payment');
  perform pg_temp.refused(format($q$update tci.premium_payments set amount = 1 where id = %L$q$, v_pay), '42501', 'edit a payment');
  perform pg_temp.refused(format($q$update tci.premium_instalments set note = 'x' where id = %L$q$, s1.id), '42501', 'edit an instalment');
  perform pg_temp.refused($q$insert into tci.bank_statement_lines (import_id, line_no, value_date, amount, currency_code, dedupe_key, status, match_reason)
    values (gen_random_uuid(), 1, current_date, 1, 'USD', 'x', 'matched', 'x')$q$, '42501', 'insert a bank line');

  -- 9. A bank statement: matched, suggested, unmatched; the queue task.
  perform * from tci.save_bank_statement_profile('PP Bank', '{"date": "Дата", "amount": "Сумма"}');
  perform * from tci.save_bank_statement_profile('PP Bank', '{"date": "Date", "amount": "Amount"}');
  select count(*) into v_n from tci.bank_statement_profiles where name = 'PP Bank' and mapping->>'date' = 'Date';
  if v_n <> 1 then raise exception 'premium_payments: a profile saved twice is not one updated row'; end if;

  v_res := tci.import_bank_statement(
    (select id from tci.bank_statement_profiles where name = 'PP Bank'), 'pp.csv', jsonb_build_array(
      jsonb_build_object('value_date', current_date, 'amount', 6250, 'currency', 'USD',
                         'purpose', 'Оплата по счёту inv pp 1, без НДС', 'payer', 'PP Holder'),
      jsonb_build_object('value_date', current_date, 'amount', 1000, 'currency', 'USD',
                         'purpose', 'Premium PP-QTR-1'),
      jsonb_build_object('value_date', current_date, 'amount', 777, 'currency', 'USD',
                         'purpose', 'Refund of something else'),
      jsonb_build_object('value_date', current_date, 'amount', 6250, 'currency', 'EUR',
                         'purpose', 'INV-PP-1')));
  v_imp := (v_res->>'import_id')::uuid;
  if (v_res->>'matched')::int <> 1 or (v_res->>'suggested')::int <> 1 or (v_res->>'unmatched')::int <> 2 then
    raise exception 'premium_payments: import counts %', v_res;
  end if;
  select * into v_task from tci.tasks
   where object_id = v_imp and task_type = 'premium_payment_unmatched' and status = 'open';
  if not found or (v_task.params->>'count')::int <> 3 then
    raise exception 'premium_payments: no unmatched-payments task with count 3 (%)', v_task.params;
  end if;
  if exists (select 1 from tci.bank_statement_lines where import_id = v_imp and amount = 6250 and currency_code = 'EUR'
              and match_reason <> 'currency') then
    raise exception 'premium_payments: a line in the wrong currency was not flagged';
  end if;

  -- one click records the confident match
  select id into v_line from tci.bank_statement_lines where import_id = v_imp and status = 'matched';
  for v_cl in select * from tci.confirm_bank_lines(array[v_line]) loop
    if v_cl.result <> 'recorded' then raise exception 'premium_payments: confirm answered %', v_cl.result; end if;
  end loop;
  select * into s1 from tci.v_premium_instalments where id = s1.id;
  if s1.derived_status <> 'paid' then raise exception 'premium_payments: the confirmed bank line did not pay s1'; end if;
  if not exists (select 1 from tci.premium_payments pp
                  where pp.bank_line_id = v_line and pp.source = 'bank_import') then
    raise exception 'premium_payments: the bank payment is not linked to its line';
  end if;

  -- a person resolves the rest: assign one, set two aside; the task closes
  perform tci.assign_bank_line(
    (select id from tci.bank_statement_lines where import_id = v_imp and status = 'suggested'),
    '99999999-0000-4000-8000-0000000056f1');
  perform pg_temp.refused(format($q$select tci.ignore_bank_line(%L, '')$q$,
    (select id from tci.bank_statement_lines where import_id = v_imp and amount = 777)),
    'P0001', 'set aside without a reason', 'ignore_reason_required');
  perform tci.ignore_bank_line((select id from tci.bank_statement_lines where import_id = v_imp and amount = 777), 'not premium');
  perform tci.ignore_bank_line((select id from tci.bank_statement_lines where import_id = v_imp and currency_code = 'EUR'), 'wrong account');
  if exists (select 1 from tci.tasks where object_id = v_imp and task_type = 'premium_payment_unmatched' and status = 'open') then
    raise exception 'premium_payments: the unmatched-payments task did not close';
  end if;

  -- the same file again: the recorded line is a duplicate
  v_res := tci.import_bank_statement(null, 'pp.csv', jsonb_build_array(
      jsonb_build_object('value_date', current_date, 'amount', 6250, 'currency', 'USD',
                         'purpose', 'Оплата по счёту inv pp 1, без НДС')));
  if (v_res->>'duplicate')::int <> 1 then raise exception 'premium_payments: a re-imported line is not a duplicate (%)', v_res; end if;

  -- 10. The integration point: the service role only; confident payments are
  --     recorded, the rest queued, a replay is a duplicate.
  perform * from tci.invoice_premium_instalment(
    (select id from tci.premium_instalments where policy_id = '99999999-0000-4000-8000-0000000056f1' and sequence = 2), 'INV-PP-2');
  perform pg_temp.refused($q$select tci.record_premium_payment_import('{"payments": []}')$q$, '42501', 'authenticated calls the integration');
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'service_role', true);
  v_res := tci.record_premium_payment_import(jsonb_build_object(
    'source', 'accounting_import', 'file_name', '1C',
    'payments', jsonb_build_array(
      -- what is still owed on s2 after the 1,000 assigned above
      jsonb_build_object('external_id', 'X1', 'value_date', current_date, 'amount', 10250, 'currency', 'USD',
                         'invoice_number', 'INV-PP-2'),
      jsonb_build_object('external_id', 'X2', 'value_date', current_date, 'amount', 5, 'currency', 'USD',
                         'purpose', 'unknown'))));
  if v_res->'results'->0->>'result' <> 'recorded' or v_res->'results'->1->>'result' <> 'queued' then
    raise exception 'premium_payments: integration answered %', v_res;
  end if;
  perform pg_temp.refused($q$select tci.record_premium_payment_import('{"payments": [{"value_date": "2026-01-01", "amount": 1, "currency": "USD"}]}')$q$,
    'P0001', 'a payment without external_id', 'external_id_required');
  v_res := tci.record_premium_payment_import(jsonb_build_object(
    'source', 'accounting_import',
    'payments', jsonb_build_array(
      jsonb_build_object('external_id', 'X1', 'value_date', current_date, 'amount', 10250, 'currency', 'USD',
                         'invoice_number', 'INV-PP-2'))));
  if v_res->'results'->0->>'result' <> 'duplicate' then
    raise exception 'premium_payments: a replayed integration payment is not a duplicate (%)', v_res;
  end if;
  perform set_config('role', 'postgres', true);

  -- 11. The policyholder sees paid and outstanding, nothing of the money's paperwork.
  perform pg_temp.act('99999999-0000-4000-8000-0000000056c5');
  select count(*) into v_n from tci.v_client_premium_instalments
   where policy_id = '99999999-0000-4000-8000-0000000056f1' and derived_status = 'paid' and outstanding = 0 and status = 'paid';
  if v_n <> 2 then raise exception 'premium_payments: the portal shows % paid instalments, not 2', v_n; end if;
  if not exists (select 1 from tci.v_client_premium where policy_id = '99999999-0000-4000-8000-0000000056f1'
                  and instalments_outstanding = 45000 - 11250 - 11250) then
    raise exception 'premium_payments: the portal policy outstanding is wrong (%)',
      (select instalments_outstanding from tci.v_client_premium where policy_id = '99999999-0000-4000-8000-0000000056f1');
  end if;
  if exists (select 1 from tci.premium_payments) or exists (select 1 from tci.bank_statement_lines)
     or exists (select 1 from tci.v_premium_instalments) then
    raise exception 'premium_payments: a client reads payments, bank lines or the staff instalment view';
  end if;

  -- 12. Credit underwriting reads payments (staff) but not bank statements.
  perform pg_temp.act('99999999-0000-4000-8000-0000000056c1');
  if not exists (select 1 from tci.premium_payments) or exists (select 1 from tci.bank_statement_lines) then
    raise exception 'premium_payments: staff read of payments / commercial-only bank lines is wrong';
  end if;
  perform set_config('role', 'postgres', true);
end $$;

do $$ begin raise notice 'premium_payments: OK — schedule matrix, invoices, part/full payments close tasks, overpay and currency refused, reversals, bank import with queue task, service-role integration, portal view, no direct writes'; end $$;
rollback;
