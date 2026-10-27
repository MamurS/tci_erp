-- tests/db/task_transfers.sql — migration 0092: an Agenda task handed to a
-- colleague, one or several, with role impersonation, rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000092a1', 'ttr-cu1@t'),
  ('99999999-0000-4000-8000-0000000092a2', 'ttr-cu2@t'),
  ('99999999-0000-4000-8000-0000000092a3', 'ttr-an@t'),
  ('99999999-0000-4000-8000-0000000092a4', 'ttr-sales@t'),
  ('99999999-0000-4000-8000-0000000092a5', 'ttr-client@t'),
  ('99999999-0000-4000-8000-0000000092a6', 'ttr-cu3@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000092a1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000092a2', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000092a3', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000092a4', 'sales'),
  ('99999999-0000-4000-8000-0000000092a5', 'client'),
  ('99999999-0000-4000-8000-0000000092a6', 'credit_underwriter');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'TTR ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'ttr-%@t'
on conflict (user_id) do update set must_change_password = false;
-- cu3 is banned: never offered, never accepted.
update auth.users set banned_until = now() + interval '1 day' where id = '99999999-0000-4000-8000-0000000092a6';

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

create function pg_temp.refused(p_sql text, p_state text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'task_transfers: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'task_transfers: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_cu1    constant uuid := '99999999-0000-4000-8000-0000000092a1';
  c_cu2    constant uuid := '99999999-0000-4000-8000-0000000092a2';
  c_an     constant uuid := '99999999-0000-4000-8000-0000000092a3';
  c_sales  constant uuid := '99999999-0000-4000-8000-0000000092a4';
  c_client constant uuid := '99999999-0000-4000-8000-0000000092a5';
  c_cu3    constant uuid := '99999999-0000-4000-8000-0000000092a6';
  o1 constant uuid := '99999999-0000-4000-8000-0000000092f1';
  o2 constant uuid := '99999999-0000-4000-8000-0000000092f2';
  o3 constant uuid := '99999999-0000-4000-8000-0000000092f3';
  o4 constant uuid := '99999999-0000-4000-8000-0000000092f4';
  t_dept uuid; t_two uuid; t_mine1 uuid; t_mine2 uuid; t_val uuid;
  v_n integer;
begin
  -- Tasks: one for the department, one more for it, per-person copies of a
  -- band-aware task (cu1 and cu2), and a validation step.
  perform pg_temp.owner();
  perform tci.begin_trusted_call();
  perform tci.open_task('rating_stale', 'legal_entity', o1, 'agenda.tasks.rating_stale', '{}'::jsonb, 'credit_underwriter', null, null, 'normal', null);
  perform tci.open_task('limit_review_due', 'legal_entity', o2, 'agenda.tasks.limit_review_due', '{}'::jsonb, 'credit_underwriter', null, null, 'normal', null);
  perform tci.open_task('limit_needs_decision', 'credit_limit_request', o3, 'agenda.tasks.limit_needs_decision', '{}'::jsonb, 'credit_underwriter', c_cu1, null, 'normal', null);
  perform tci.open_task('limit_needs_decision', 'credit_limit_request', o3, 'agenda.tasks.limit_needs_decision', '{}'::jsonb, 'credit_underwriter', c_cu2, null, 'normal', null);
  perform tci.open_task('limit_validation', 'limit_validation', o4, 'agenda.tasks.limit_validation', '{"stream": "credit"}'::jsonb, 'credit_underwriter', c_cu1, null, 'high', null);
  select id into t_dept from tci.tasks where object_id = o1;
  select id into t_two from tci.tasks where object_id = o2;
  select id into t_mine1 from tci.tasks where object_id = o3 and target_user = c_cu1;
  select id into t_mine2 from tci.tasks where object_id = o3 and target_user = c_cu2;
  select id into t_val from tci.tasks where object_id = o4;
  update tci.tasks set snoozed_until = now() + interval '1 day', snoozed_by = c_cu1 where id = t_dept;

  -- Candidates: the other active credit underwriter only.
  perform pg_temp.act(c_cu1);
  if (select array_agg(user_id) from tci.task_transfer_candidates(array[t_dept, t_two])) <> array[c_cu2] then
    raise exception 'task_transfers: candidates were %', (select array_agg(user_id) from tci.task_transfer_candidates(array[t_dept, t_two]));
  end if;
  if exists (select 1 from tci.task_transfer_candidates(array[t_val])) then
    raise exception 'task_transfers: a validation step offered candidates';
  end if;

  -- Refusals.
  perform pg_temp.refused(format('select tci.transfer_tasks(array[%L]::uuid[], %L)', t_dept, c_cu1), 'P0001', 'to oneself', 'task_transfer_self');
  perform pg_temp.refused(format('select tci.transfer_tasks(array[%L]::uuid[], %L)', t_dept, c_sales), 'P0001', 'to another department', 'task_transfer_wrong_colleague');
  perform pg_temp.refused(format('select tci.transfer_tasks(array[%L]::uuid[], %L)', t_dept, c_cu3), 'P0001', 'to a banned colleague', 'task_transfer_wrong_colleague');
  perform pg_temp.refused(format('select tci.transfer_tasks(array[%L]::uuid[], %L)', t_val, c_cu2), 'P0001', 'a validation step', 'task_transfer_not_allowed');
  perform pg_temp.refused('select tci.transfer_tasks(array[]::uuid[], ''99999999-0000-4000-8000-0000000092a2'')', 'P0001', 'nothing', 'task_transfer_none');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.transfer_tasks(array[%L]::uuid[], %L)', t_dept, c_cu2), '42501', 'someone else''s task', 'task_transfer_not_yours');
  perform pg_temp.act(c_client);
  perform pg_temp.refused(format('select tci.transfer_tasks(array[%L]::uuid[], %L)', t_dept, c_cu2), '42501', 'a client');

  -- Two at once, with a note: the department's tasks become cu2's by name,
  -- the snooze is cleared, the note is a comment, cu1 no longer works them.
  perform pg_temp.act(c_cu1);
  v_n := tci.transfer_tasks(array[t_dept, t_two], c_cu2, 'On leave until Monday.');
  if v_n <> 2 then
    raise exception 'task_transfers: % moved', v_n;
  end if;
  perform pg_temp.owner();
  if exists (select 1 from tci.tasks where id in (t_dept, t_two)
              and (target_user is distinct from c_cu2 or target_role is distinct from 'credit_underwriter'
                   or snoozed_until is not null or status <> 'open')) then
    raise exception 'task_transfers: the moved tasks are not cu2''s';
  end if;
  if (select count(*) from tci.task_comments where task_id in (t_dept, t_two) and body = 'On leave until Monday.') <> 2
     or (select count(*) from tci.task_transfers where task_id in (t_dept, t_two) and from_user is null
           and from_role = 'credit_underwriter' and to_user = c_cu2 and transferred_by = c_cu1) <> 2 then
    raise exception 'task_transfers: the hand-over was not recorded';
  end if;
  perform pg_temp.act(c_cu1);
  perform pg_temp.refused(format('select tci.transfer_tasks(array[%L]::uuid[], %L)', t_dept, c_an), '42501', 'a task already handed on', 'task_transfer_not_yours');

  -- cu2 already has a copy of the band-aware task: cu1's copy merges.
  v_n := tci.transfer_tasks(array[t_mine1], c_cu2);
  perform pg_temp.owner();
  if (select status from tci.tasks where id = t_mine1) <> 'cancelled'
     or (select status from tci.tasks where id = t_mine2) <> 'open'
     or not (select merged from tci.task_transfers where task_id = t_mine1) then
    raise exception 'task_transfers: the duplicate copy did not merge';
  end if;

  -- The record never changes; no API role writes it; a client reads nothing.
  perform pg_temp.refused(format('update tci.task_transfers set note = ''x'' where task_id = %L', t_dept), 'P0001', 'a record changed', 'task_transfer_immutable');
  perform pg_temp.act(c_cu2);
  perform pg_temp.refused(format('insert into tci.task_transfers (task_id, to_user, to_role, transferred_by) values (%L, %L, ''credit_underwriter'', %L)', t_dept, c_cu2, c_cu2),
                          '42501', 'a record written directly');
  perform pg_temp.act(c_client);
  if exists (select 1 from tci.task_transfers) then
    raise exception 'task_transfers: a client reads hand-overs';
  end if;

  raise notice 'task_transfers: OK — one or many tasks handed to an active colleague of the department (by name, snooze cleared, note as a comment, recorded), never to oneself, another department, a banned colleague, nor a validation step; someone else''s task refused; a duplicate copy merges; the record is immutable and staff-only';
end $$;

rollback;
