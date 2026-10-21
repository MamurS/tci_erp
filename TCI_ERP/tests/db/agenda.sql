-- Tests for migration 0055: snooze, task comments, the closed task table,
-- rating_new_statements and the fifth workflow-event trigger.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/agenda.sql
--
-- One transaction, rolled back. API roles are impersonated; the
-- internal-call token is cleared at every actor switch. Every UPDATE carries
-- a WHERE clause (the canonical tooling holds one without).

\set ON_ERROR_STOP on
begin;

-- actors: two commercial underwriters (one department), a credit
-- underwriter with a small grant, an admin and a client
insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000003a1', 'g-commercial-a@t'),
  ('99999999-0000-4000-8000-0000000003a2', 'g-commercial-b@t'),
  ('99999999-0000-4000-8000-0000000003b1', 'g-credit@t'),
  ('99999999-0000-4000-8000-0000000003b9', 'g-admin@t'),
  ('99999999-0000-4000-8000-0000000003c1', 'g-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000003a1', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000003a2', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000003b1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000003b9', 'admin'),
  ('99999999-0000-4000-8000-0000000003c1', 'client');
insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, created_by)
values ('99999999-0000-4000-8000-0000000003b1', 'credit', 'unrated', 100000, 'UZS',
        '99999999-0000-4000-8000-0000000003b9');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000003a1"}', true) \gset g_
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000003e1', 'G Holder LLC', 'UZ', '99999999-0000-4000-8000-0000000003a1'),
  ('99999999-0000-4000-8000-0000000003e2', 'G Buyer New Period', 'UZ', '99999999-0000-4000-8000-0000000003a1'),
  ('99999999-0000-4000-8000-0000000003e3', 'G Buyer Escalated', 'KZ', '99999999-0000-4000-8000-0000000003a1'),
  ('99999999-0000-4000-8000-0000000003e4', 'G Buyer Group', 'KZ', '99999999-0000-4000-8000-0000000003a1');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000003f1', '99999999-0000-4000-8000-0000000003e1', 'G-1', 'whole_turnover',
  'draft', current_date - 30, current_date + 300, 'UZS', 90, 0, 0.15, 10000, 25000, 30, 60, 90, 'monthly',
  '99999999-0000-4000-8000-0000000003a1', 1000000);

-- e2 has a limit in force, rated on FY2024, and FY2025 statements were added
insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
values
  ('99999999-0000-4000-8000-000000000321', '99999999-0000-4000-8000-0000000003e2', 'annual', 2024, '2024-12-31', 'UZS', '99999999-0000-4000-8000-0000000003a1'),
  ('99999999-0000-4000-8000-000000000322', '99999999-0000-4000-8000-0000000003e2', 'annual', 2025, '2025-12-31', 'UZS', '99999999-0000-4000-8000-0000000003a1');
insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
  inputs_snapshot, calculation_trace, engine_version, created_by, created_at)
values ('99999999-0000-4000-8000-0000000003e2', '99999999-0000-4000-8000-000000000321', 30, 'A2', 1, 'UZS', '{}', '{}', 't',
        '99999999-0000-4000-8000-0000000003b1', now() - interval '2 months');
insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
values ('99999999-0000-4000-8000-0000000003d2', '99999999-0000-4000-8000-0000000003f1', '99999999-0000-4000-8000-0000000003e2',
        30000, 'UZS', 'decided', '99999999-0000-4000-8000-0000000003a1');
insert into tci.credit_limit_decisions (request_id, outcome, approved_amount, currency_code, lifecycle, decided_by)
values ('99999999-0000-4000-8000-0000000003d2', 'approved', 20000, 'UZS', 'effective', '99999999-0000-4000-8000-0000000003b1');

-- two open requests above the credit underwriter's authority
insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by, submitted_at, justification)
values
  ('99999999-0000-4000-8000-0000000003d3', '99999999-0000-4000-8000-0000000003f1', '99999999-0000-4000-8000-0000000003e3',
   200000, 'UZS', 'escalated', '99999999-0000-4000-8000-0000000003a1', now(), 'Seasonal orders'),
  ('99999999-0000-4000-8000-0000000003d4', '99999999-0000-4000-8000-0000000003f1', '99999999-0000-4000-8000-0000000003e4',
   90000, 'UZS', 'escalated', '99999999-0000-4000-8000-0000000003a1', now(), null);

-- two tasks generated as the database generates them: one for the
-- commercial department (automatic), one manual one for it as well
insert into tci.tasks (id, task_type, object_type, object_id, title_key, params, target_role, due_at, priority)
values
  ('99999999-0000-4000-8000-0000000003f8', 'instalment_overdue', 'premium_instalment', gen_random_uuid(),
   'agenda.tasks.instalment_overdue', '{}', 'commercial_underwriter', now() - interval '5 days', 'high'),
  ('99999999-0000-4000-8000-0000000003f9', 'uncovered_excess_review', 'declaration', gen_random_uuid(),
   'agenda.tasks.uncovered_excess_review', '{}', 'commercial_underwriter', null, 'high');

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

do $$
declare
  v_task    tci.tasks%rowtype;
  v_comment tci.task_comments%rowtype;
  v_n       int;
  v_params  jsonb;
begin
  -- 1. snooze: per task, recorded, refused by rule and by permission
  perform pg_temp.act('99999999-0000-4000-8000-0000000003a1');
  v_task := tci.snooze_task('99999999-0000-4000-8000-0000000003f8', now() + interval '1 day');
  if v_task.snoozed_until is null or v_task.snoozed_by <> '99999999-0000-4000-8000-0000000003a1' then
    raise exception 'agenda: snooze not recorded: %', row_to_json(v_task);
  end if;
  begin
    perform tci.snooze_task('99999999-0000-4000-8000-0000000003f8', now() - interval '1 minute');
    raise exception 'agenda: a snooze into the past was accepted';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform tci.snooze_task('99999999-0000-4000-8000-0000000003f8', now() + interval '400 days');
    raise exception 'agenda: a snooze beyond a year was accepted';
  exception when sqlstate 'P0001' then null;
  end;

  -- the colleague in the same department sees it snoozed (per task)
  perform pg_temp.act('99999999-0000-4000-8000-0000000003a2');
  select * into v_task from tci.tasks where id = '99999999-0000-4000-8000-0000000003f8';
  if v_task.snoozed_until is null then
    raise exception 'agenda: the department does not see the snooze';
  end if;

  -- another department cannot see the task, so cannot snooze it
  perform pg_temp.act('99999999-0000-4000-8000-0000000003b1');
  select count(*) into v_n from tci.tasks where id = '99999999-0000-4000-8000-0000000003f8';
  if v_n <> 0 then raise exception 'agenda: credit sees a commercial task'; end if;
  begin
    perform tci.snooze_task('99999999-0000-4000-8000-0000000003f8', now() + interval '1 day');
    raise exception 'agenda: another department snoozed the task';
  exception when sqlstate 'P0002' then null;
  end;

  -- a client is refused by permission
  perform pg_temp.act('99999999-0000-4000-8000-0000000003c1');
  begin
    perform tci.snooze_task('99999999-0000-4000-8000-0000000003f8', now() + interval '1 day');
    raise exception 'agenda: a client snoozed a task';
  exception when sqlstate '42501' then null;
  end;

  -- 2. the table itself is closed: no direct write, on any column
  perform pg_temp.act('99999999-0000-4000-8000-0000000003a1');
  begin
    update tci.tasks set status = 'done', completed_at = now()
     where id = '99999999-0000-4000-8000-0000000003f8';
    raise exception 'agenda: a direct PATCH closed an automatic task';
  exception when sqlstate '42501' then null;
  end;
  begin
    update tci.tasks set snoozed_until = null where id = '99999999-0000-4000-8000-0000000003f8';
    raise exception 'agenda: a direct PATCH changed a snooze';
  exception when sqlstate '42501' then null;
  end;

  -- 3. unsnooze, and the events
  v_task := tci.unsnooze_task('99999999-0000-4000-8000-0000000003f8');
  if v_task.snoozed_until is not null or v_task.snoozed_by is not null then
    raise exception 'agenda: unsnooze left %', row_to_json(v_task);
  end if;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from tci.workflow_events
   where object_id = '99999999-0000-4000-8000-0000000003f8'
     and event_type in ('task.snoozed', 'task.unsnoozed');
  if v_n <> 2 then raise exception 'agenda: % snooze events, expected 2', v_n; end if;

  -- 4. completion still refuses an automatic type and accepts a manual one
  perform pg_temp.act('99999999-0000-4000-8000-0000000003a1');
  begin
    perform tci.complete_task('99999999-0000-4000-8000-0000000003f8');
    raise exception 'agenda: an automatic task was completed by hand';
  exception when sqlstate 'P0001' then null;
  end;
  v_task := tci.complete_task('99999999-0000-4000-8000-0000000003f9');
  if v_task.status <> 'done' or v_task.completed_by <> '99999999-0000-4000-8000-0000000003a1' then
    raise exception 'agenda: manual completion: %', row_to_json(v_task);
  end if;

  -- 5. comments: written by whoever sees the task, read by the same people
  v_comment := tci.add_task_comment('99999999-0000-4000-8000-0000000003f8', '  Called the policyholder, paying Friday  ');
  if v_comment.body <> 'Called the policyholder, paying Friday'
     or v_comment.author_id <> '99999999-0000-4000-8000-0000000003a1' then
    raise exception 'agenda: comment %', row_to_json(v_comment);
  end if;
  begin
    perform tci.add_task_comment('99999999-0000-4000-8000-0000000003f8', '   ');
    raise exception 'agenda: an empty comment was accepted';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform tci.add_task_comment('99999999-0000-4000-8000-0000000003f8', repeat('x', 2001));
    raise exception 'agenda: a 2001-character comment was accepted';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into tci.task_comments (task_id, body) values ('99999999-0000-4000-8000-0000000003f8', 'direct');
    raise exception 'agenda: a comment was inserted around the function';
  exception when sqlstate '42501' then null;
  end;
  begin
    update tci.task_comments set body = 'edited' where id = v_comment.id;
    raise exception 'agenda: a comment was edited';
  exception when sqlstate '42501' then null;
  end;

  perform pg_temp.act('99999999-0000-4000-8000-0000000003a2');
  select count(*) into v_n from tci.task_comments where task_id = '99999999-0000-4000-8000-0000000003f8';
  if v_n <> 1 then raise exception 'agenda: the task owner (department) sees % comments', v_n; end if;

  perform pg_temp.act('99999999-0000-4000-8000-0000000003b9');
  select count(*) into v_n from tci.task_comments where task_id = '99999999-0000-4000-8000-0000000003f8';
  if v_n <> 1 then raise exception 'agenda: admin sees % comments', v_n; end if;

  perform pg_temp.act('99999999-0000-4000-8000-0000000003b1');
  select count(*) into v_n from tci.task_comments where task_id = '99999999-0000-4000-8000-0000000003f8';
  if v_n <> 0 then raise exception 'agenda: another department reads the comments'; end if;
  begin
    perform tci.add_task_comment('99999999-0000-4000-8000-0000000003f8', 'not mine');
    raise exception 'agenda: another department commented';
  exception when sqlstate 'P0002' then null;
  end;

  perform pg_temp.act('99999999-0000-4000-8000-0000000003c1');
  select count(*) into v_n from tci.task_comments;
  if v_n <> 0 then raise exception 'agenda: a client reads task comments'; end if;
  begin
    perform tci.add_task_comment('99999999-0000-4000-8000-0000000003f8', 'client');
    raise exception 'agenda: a client commented';
  exception when sqlstate '42501' then null;
  end;

  -- append-only even for the owner role
  perform set_config('role', 'postgres', true);
  begin
    delete from tci.task_comments where id = v_comment.id;
    raise exception 'agenda: a comment was deleted';
  exception when sqlstate '42501' then null;
  end;
  select count(*) into v_n from tci.workflow_events
   where event_type = 'task.commented' and object_id = '99999999-0000-4000-8000-0000000003f8'
     and target_role = 'commercial_underwriter' and payload ->> 'comment_id' = v_comment.id::text;
  if v_n <> 1 then raise exception 'agenda: task.commented not addressed to the task owner'; end if;

  -- 6. rating_new_statements: opened lazily with what its note says, retired
  --    the moment the new period is rated
  perform pg_temp.act('99999999-0000-4000-8000-0000000003b1');
  perform tci.refresh_agenda();
  perform set_config('role', 'postgres', true);
  select * into v_task from tci.tasks
   where task_type = 'rating_new_statements' and object_id = '99999999-0000-4000-8000-0000000003e2'
     and status = 'open';
  if not found then raise exception 'agenda: rating_new_statements not opened'; end if;
  if v_task.target_role <> 'credit_underwriter' or v_task.priority <> 'high'
     or v_task.params ->> 'statement_id' <> '99999999-0000-4000-8000-000000000322'
     or (v_task.params ->> 'fiscal_year')::int <> 2025
     or v_task.params ->> 'grade' <> 'A2'
     or v_task.params ->> 'rated_period_end' <> '2024-12-31'
     or v_task.params ->> 'added_by' <> '99999999-0000-4000-8000-0000000003a1'
     or (v_task.params ->> 'limits_in_force')::int <> 1
     or v_task.due_at is null then
    raise exception 'agenda: rating_new_statements %', row_to_json(v_task);
  end if;

  -- refreshing again opens nothing new
  perform pg_temp.act('99999999-0000-4000-8000-0000000003b1');
  perform tci.refresh_agenda();
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from tci.tasks
   where task_type = 'rating_new_statements' and object_id = '99999999-0000-4000-8000-0000000003e2';
  if v_n <> 1 then raise exception 'agenda: refresh_agenda duplicated rating_new_statements (%)', v_n; end if;

  perform pg_temp.act('99999999-0000-4000-8000-0000000003b1');
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version)
  values ('99999999-0000-4000-8000-0000000003e2', '99999999-0000-4000-8000-000000000322', 28, 'A2', 1, 'UZS', '{}', '{}', 't');
  perform set_config('role', 'postgres', true);
  select status::text into v_params from (select to_jsonb(t.status) as status from tci.tasks t
   where t.task_type = 'rating_new_statements' and t.object_id = '99999999-0000-4000-8000-0000000003e2') x;
  if v_params::text <> '"done"' then
    raise exception 'agenda: rating the new period did not retire the task (%)', v_params;
  end if;

  -- 7. the extras trigger: who escalated and their authority, recorded on
  --    the escalation task; a group breach now opens one
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '99999999-0000-4000-8000-0000000003b1')::text, true);
  insert into tci.workflow_events (event_type, object_type, object_id, payload, target_role)
  values ('limit.request_escalated', 'credit_limit_request', '99999999-0000-4000-8000-0000000003d3',
          jsonb_build_object('entity_id', '99999999-0000-4000-8000-0000000003e3', 'amount', 200000,
                             'currency', 'UZS', 'grade_band', 'unrated', 'amount_uzs', 200000),
          'credit_underwriter');
  select params into v_params from tci.tasks
   where task_type = 'limit_escalated' and object_id = '99999999-0000-4000-8000-0000000003d3' and status = 'open';
  if v_params is null
     or v_params ->> 'escalated_by' <> '99999999-0000-4000-8000-0000000003b1'
     or (v_params ->> 'authority_uzs')::numeric <> 100000 then
    raise exception 'agenda: escalation not annotated: %', v_params;
  end if;

  insert into tci.workflow_events (event_type, object_type, object_id, payload, target_role)
  values ('limit.group_limit_breached', 'credit_limit_request', '99999999-0000-4000-8000-0000000003d4',
          jsonb_build_object('entity_id', '99999999-0000-4000-8000-0000000003e4', 'amount', 90000,
                             'currency', 'UZS', 'exposure_after_uzs', 500000, 'group_limit_uzs', 400000),
          'credit_underwriter');
  select * into v_task from tci.tasks
   where task_type = 'limit_escalated' and object_id = '99999999-0000-4000-8000-0000000003d4' and status = 'open';
  if not found or v_task.target_role <> 'credit_underwriter' or v_task.priority <> 'urgent'
     or v_task.params ->> 'reason' <> 'group_limit' then
    raise exception 'agenda: a group breach opened no escalation task: %', row_to_json(v_task);
  end if;

  raise notice 'agenda: OK — snooze per task, closed task table, append-only comments for whoever sees the task, rating_new_statements, escalation annotated, group breach escalates';
end;
$$;

rollback;
