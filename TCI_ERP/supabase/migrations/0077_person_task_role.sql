-- 0077_person_task_role.sql
--
-- What: a task addressed to a PERSON for their department's work also names
--       the department role it is worked in (tci.tasks.target_role next to
--       target_user). The Agenda shows it only while the person acts in that
--       role; a task addressed to the person alone (a result notice, a
--       client's task) stays visible in every workspace, as before.
--         * tci.task_work_role(type, params): the role of a person-addressed
--           task type — limit decisions, escalations and holds → credit
--           underwriting; data requests → the information desk; validation
--           steps, FYIs and results → the stream's department; a rating
--           proposal at an authority level → credit underwriting (a
--           colleague's proposal stays role-less: credit analysts and, in
--           combined mode, credit underwriters both answer it).
--         * tci.open_task fills target_role from it when only a person is
--           given; the open and closed rows already written are filled the
--           same way.
--         * tci.task_is_mine and the "tasks: read mine" policy: a task with a
--           person is mine when it is addressed to me AND (it names no role
--           or I act in that role); a task with only a role, when I act in it.
-- Why:  the owner, acting as a credit analyst, saw «Decide the credit limit
--       requested for …» in their Agenda and found no decision form behind
--       it (2026-10-26). The band-aware limit tasks of 0024 are addressed to
--       each covering underwriter by name, and since 0063 a task addressed
--       to a person shows in every workspace the person holds — so a person
--       holding credit underwriting and credit analysis saw the decision work
--       while acting as an analyst, who may not decide.

-- ---------------------------------------------------------------------------
-- 1. The role a person-addressed task is worked in
-- ---------------------------------------------------------------------------

create function tci.task_work_role(p_task_type tci.task_type, p_params jsonb)
returns tci.user_role
language sql
immutable
set search_path = ''
as $$
  select case
    when p_task_type in ('limit_needs_decision', 'limit_escalated', 'limit_held')
      then 'credit_underwriter'::tci.user_role
    when p_task_type in ('entity_requested', 'statements_requested')
      then 'information_manager'::tci.user_role
    when p_task_type in ('limit_validation', 'limit_validation_fyi', 'limit_validation_result')
      then case p_params ->> 'stream'
             when 'credit' then 'credit_underwriter'::tci.user_role
             when 'commercial' then 'commercial_underwriter'::tci.user_role
           end
    when p_task_type = 'rating_proposal' and p_params ->> 'route' = 'level'
      then 'credit_underwriter'::tci.user_role
  end
$$;
comment on function tci.task_work_role(tci.task_type, jsonb) is
  'The department role a task addressed to a person is worked in (NULL: a personal notice, visible in every workspace). Filled into tci.tasks.target_role by open_task (0077).';

-- ---------------------------------------------------------------------------
-- 2. open_task: the 0069 body, plus the role of a person-addressed task
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.open_task(p_task_type tci.task_type, p_object_type text, p_object_id uuid, p_title_key text, p_params jsonb DEFAULT '{}'::jsonb, p_target_role tci.user_role DEFAULT NULL::tci.user_role, p_target_user uuid DEFAULT NULL::uuid, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority tci.task_priority DEFAULT 'normal'::tci.task_priority, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.require_internal_call();
  insert into tci.tasks (
    task_type, object_type, object_id, title_key, params,
    target_role, target_user, due_at, priority, source_event_id
  ) values (
    p_task_type, p_object_type, p_object_id, p_title_key, coalesce(p_params, '{}'::jsonb),
    -- 0069: the rating tasks go to whoever rates under the current mode.
    -- 0077: a task for a person names the role its work belongs to.
    case when p_task_type in ('buyer_needs_rating', 'rating_stale', 'rating_new_statements')
              and p_target_role = 'credit_underwriter'
         then tci.rating_task_role()
         when p_target_role is null and p_target_user is not null
         then tci.task_work_role(p_task_type, coalesce(p_params, '{}'::jsonb))
         else p_target_role end,
    p_target_user, p_due_at, p_priority, p_event_id
  )
  on conflict do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Who sees a task
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.task_is_mine(p_target_role tci.user_role, p_target_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when p_target_user is not null
      then p_target_user = (select auth.uid())
           and (p_target_role is null or p_target_role in (select tci.current_user_roles()))
    else p_target_role is not null and p_target_role in (select tci.current_user_roles())
  end
$function$;
comment on function tci.task_is_mine(tci.user_role, uuid) is
  'True when the caller may work a task with this target: addressed to them (and, when it names a role, while they act in it), or addressed to the role they act in. Mirrors "tasks: read mine" (0077).';

alter policy "tasks: read mine" on tci.tasks
  using (tci.task_is_mine(target_role, target_user));

-- ---------------------------------------------------------------------------
-- 4. The rows already written
-- ---------------------------------------------------------------------------

do $$
declare
  v_before int;
  v_moved  int;
  v_left   int;
begin
  select count(*) into v_before from tci.tasks
   where target_user is not null and target_role is null
     and tci.task_work_role(task_type, params) is not null;

  update tci.tasks t
     set target_role = tci.task_work_role(t.task_type, t.params)
   where t.target_user is not null and t.target_role is null
     and tci.task_work_role(t.task_type, t.params) is not null;
  get diagnostics v_moved = row_count;

  select count(*) into v_left from tci.tasks
   where target_user is not null and target_role is null
     and tci.task_work_role(task_type, params) is not null;
  if v_moved <> v_before or v_left <> 0 then
    raise exception '0077: % person tasks to fill, % filled, % left', v_before, v_moved, v_left;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants and assertions
-- ---------------------------------------------------------------------------

revoke all on function tci.task_work_role(tci.task_type, jsonb) from public, anon;
grant execute on function tci.task_work_role(tci.task_type, jsonb) to authenticated, service_role;

do $$
begin
  -- the client's tasks stay addressed to the person alone
  if tci.task_work_role('claim_ready_to_file', '{}'::jsonb) is not null
     or tci.task_work_role('claim_info_requested', '{}'::jsonb) is not null
     or tci.task_work_role('entity_request_resolved', '{}'::jsonb) is not null
     or tci.task_work_role('rating_proposal_result', '{}'::jsonb) is not null then
    raise exception '0077: a personal notice was given a role';
  end if;
  if tci.task_work_role('limit_needs_decision', '{}'::jsonb) <> 'credit_underwriter'
     or tci.task_work_role('limit_validation', '{"stream":"commercial"}'::jsonb) <> 'commercial_underwriter'
     or tci.task_work_role('rating_proposal', '{"route":"colleague"}'::jsonb) is not null then
    raise exception '0077: task_work_role mapping drifted';
  end if;
  if position('tci.task_is_mine(target_role, target_user)' in
       (select qual from pg_policies where schemaname = 'tci' and tablename = 'tasks'
           and policyname = 'tasks: read mine')) = 0 then
    raise exception '0077: "tasks: read mine" does not read through task_is_mine';
  end if;
  if has_function_privilege('anon', 'tci.task_work_role(tci.task_type, jsonb)', 'execute') then
    raise exception '0077: anon may execute task_work_role';
  end if;
end;
$$;
