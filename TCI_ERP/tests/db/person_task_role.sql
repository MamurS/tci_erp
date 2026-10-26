-- Tests for migration 0077: a task addressed to a person for their
-- department's work is seen only while they act in that department's role;
-- a personal notice is seen in every workspace.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/person_task_role.sql
--
-- One transaction, rolled back. API roles impersonated with a session id
-- (the acting role is per session); the internal-call token is cleared at
-- every actor switch. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000077a1', 'ptr-both@t'),    -- credit underwriter + credit analyst
  ('99999999-0000-4000-8000-0000000077a2', 'ptr-credit@t');  -- credit underwriter only
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000077a1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000077a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000077a2', 'credit_underwriter');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000077a1', 'PTR Both', false),
  ('99999999-0000-4000-8000-0000000077a2', 'PTR Credit', false)
on conflict (user_id) do update set must_change_password = false;

-- Two tasks for the two-role person: decision work, and a personal notice.
select tci.begin_trusted_call();
select tci.open_task('limit_needs_decision', 'credit_limit_request', '99999999-0000-4000-8000-0000000077c1',
  'agenda.tasks.limit_needs_decision', '{"amount": 1, "currency": "UZS"}'::jsonb,
  null, '99999999-0000-4000-8000-0000000077a1');
select tci.open_task('rating_proposal_result', 'rating_proposal_step', '99999999-0000-4000-8000-0000000077c2',
  'agenda.tasks.rating_proposal_result_approved', '{}'::jsonb,
  null, '99999999-0000-4000-8000-0000000077a1');
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2', 'session_id', p_session)::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid, uuid) to authenticated;

do $$
declare
  c_both   constant uuid := '99999999-0000-4000-8000-0000000077a1';
  c_credit constant uuid := '99999999-0000-4000-8000-0000000077a2';
  c_s1     constant uuid := '99999999-0000-4000-8000-0000000077b1';
  c_s2     constant uuid := '99999999-0000-4000-8000-0000000077b2';
  v_role text;
  v_seen text;
begin
  -- The decision task names the department it is worked in.
  select target_role::text into v_role from tci.tasks
   where object_id = '99999999-0000-4000-8000-0000000077c1';
  if v_role is distinct from 'credit_underwriter' then
    raise exception 'person_task_role: the decision task names %', coalesce(v_role, 'no role');
  end if;
  if (select target_role from tci.tasks where object_id = '99999999-0000-4000-8000-0000000077c2') is not null then
    raise exception 'person_task_role: a personal notice was given a role';
  end if;

  -- Acting as a credit analyst: the notice, not the decision.
  perform pg_temp.act(c_both, c_s1);
  perform tci.set_acting_role('credit_analyst');
  select string_agg(task_type::text, ',' order by task_type::text) into v_seen from tci.tasks
   where object_id in ('99999999-0000-4000-8000-0000000077c1', '99999999-0000-4000-8000-0000000077c2');
  if v_seen is distinct from 'rating_proposal_result' then
    raise exception 'person_task_role: an analyst sees %', coalesce(v_seen, 'nothing');
  end if;
  begin
    perform tci.snooze_task((select id from tci.tasks where object_id = '99999999-0000-4000-8000-0000000077c1'),
                            now() + interval '1 day');
    raise exception 'person_task_role: an analyst snoozed the decision task';
  exception when sqlstate 'P0002' then null;
  end;

  -- Acting as a credit underwriter (another sign-in): both.
  perform pg_temp.act(c_both, c_s2);
  perform tci.set_acting_role('credit_underwriter');
  select string_agg(task_type::text, ',' order by task_type::text) into v_seen from tci.tasks
   where object_id in ('99999999-0000-4000-8000-0000000077c1', '99999999-0000-4000-8000-0000000077c2');
  if v_seen is distinct from 'limit_needs_decision,rating_proposal_result' then
    raise exception 'person_task_role: an underwriter sees %', coalesce(v_seen, 'nothing');
  end if;

  -- A colleague in the same department does not see a task addressed to
  -- someone else, though it names their role.
  perform pg_temp.act(c_credit, c_s1);
  if exists (select 1 from tci.tasks where object_id = '99999999-0000-4000-8000-0000000077c1') then
    raise exception 'person_task_role: another underwriter sees a task addressed to a colleague';
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'person_task_role: OK — person-addressed department work only in its role, personal notices everywhere, nobody else''s';
end;
$$;

rollback;
