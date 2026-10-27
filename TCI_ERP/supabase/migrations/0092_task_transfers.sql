-- 0092_task_transfers.sql
--
-- What: an Agenda task can be handed to a colleague (owner request
--       2026-10-27), one or many at a time. tci.transfer_tasks(tasks, to,
--       note) moves each task the caller may work to the named colleague:
--       the task becomes theirs by name, in the department it belongs to
--       (target_user = the colleague, target_role = the task's role, or the
--       caller's acting role for a task addressed to a person alone), its
--       snooze is cleared, and the hand-over is recorded in
--       tci.task_transfers (immutable) with the note, which also lands on
--       the task as a comment. tci.task_transfer_candidates(tasks) lists the
--       colleagues who hold the role every selected task needs.
--
--       Refused: a task the caller may not work (42501), a closed one, one
--       to oneself, to someone without the role or not active, and the two
--       types addressed by eligibility — limit_validation and
--       rating_proposal go to the members of an authority level or the
--       colleagues who may answer, and the first eligible answer closes
--       every copy; handing one to someone else would hand a decision to a
--       person the rules did not choose. A client's task is never moved.
--       When the colleague already has the same task open (the per-person
--       copies of a band-aware task), the moved copy is closed as cancelled
--       instead — they have it.
-- Why:  absence, workload and expertise: the even distribution and the
--       band-aware routing pick a person, and a person sometimes needs to
--       pass the work on, with a word about why.

create table tci.task_transfers (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references tci.tasks (id),
  from_user      uuid references auth.users (id),
  from_role      tci.user_role,
  to_user        uuid not null references auth.users (id),
  to_role        tci.user_role not null,
  merged         boolean not null default false,
  note           text check (note is null or char_length(btrim(note)) between 1 and 2000),
  transferred_by uuid not null references auth.users (id),
  transferred_at timestamptz not null default now()
);
create index task_transfers_task on tci.task_transfers (task_id, transferred_at);
comment on table tci.task_transfers is
  '0092: every hand-over of an Agenda task to a colleague: from whom (person and/or department), to whom, in which role, whether it merged into a copy the colleague already had, and the note. Written only by tci.transfer_tasks; never changed.';

create function tci.guard_task_transfer() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'task_transfer_immutable: a hand-over is recorded, never changed' using errcode = 'P0001';
end $$;
create trigger task_transfers_immutable before update on tci.task_transfers
  for each row execute function tci.guard_task_transfer();
revoke all on function tci.guard_task_transfer() from public, anon, authenticated;

alter table tci.task_transfers enable row level security;
create policy "task_transfers: staff read" on tci.task_transfers for select to authenticated using (tci.is_staff());
grant select on tci.task_transfers to authenticated, service_role;

-- The types addressed by eligibility, never handed on by hand.
create function tci.task_transfer_blocked(p_type tci.task_type) returns boolean
language sql immutable set search_path = '' as $$
  select p_type in ('limit_validation', 'rating_proposal')
$$;
revoke all on function tci.task_transfer_blocked(tci.task_type) from public, anon;
grant execute on function tci.task_transfer_blocked(tci.task_type) to authenticated, service_role;

-- Whether a person may take on work in a role: holds it, active, staff.
create function tci.may_take_task(p_user uuid, p_role tci.user_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_role is not null and p_role <> 'client'
     and exists (select 1 from tci.user_roles ur
                  join auth.users u on u.id = ur.user_id
                 where ur.user_id = p_user and ur.role = p_role
                   and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now()))
$$;
revoke all on function tci.may_take_task(uuid, tci.user_role) from public, anon, authenticated;
grant execute on function tci.may_take_task(uuid, tci.user_role) to service_role;

-- The colleagues who may take every one of the given tasks.
create function tci.task_transfer_candidates(p_tasks uuid[])
returns table (user_id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
declare v_roles tci.user_role[];
begin
  perform tci.require_staff();
  select coalesce(array_agg(distinct coalesce(t.target_role, tci.acting_role())), '{}')
    into v_roles
    from tci.tasks t
   where t.id = any (coalesce(p_tasks, '{}')) and t.status = 'open'
     and tci.task_is_mine(t.target_role, t.target_user)
     and not tci.task_transfer_blocked(t.task_type);
  if cardinality(v_roles) = 0 then
    return;
  end if;
  return query
    select u.id, p.full_name, u.email::text
      from auth.users u
      left join tci.user_profiles p on p.user_id = u.id
     where u.id <> (select auth.uid())
       and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
       and not exists (select 1 from unnest(v_roles) r where not tci.may_take_task(u.id, r))
     order by coalesce(p.full_name, u.email::text);
end $$;
revoke all on function tci.task_transfer_candidates(uuid[]) from public, anon;
grant execute on function tci.task_transfer_candidates(uuid[]) to authenticated;

create function tci.transfer_tasks(p_tasks uuid[], p_to uuid, p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := (select auth.uid());
  v_task   tci.tasks%rowtype;
  v_id     uuid;
  v_role   tci.user_role;
  v_merged boolean;
  v_note   text := nullif(btrim(p_note), '');
  v_count  integer := 0;
begin
  perform tci.require_staff();
  if p_tasks is null or cardinality(p_tasks) = 0 then
    raise exception 'task_transfer_none: choose the tasks to hand over' using errcode = 'P0001';
  end if;
  if cardinality(p_tasks) > 200 then
    raise exception 'task_transfer_too_many: at most 200 tasks at a time' using errcode = 'P0001';
  end if;
  if p_to is null or p_to = v_me then
    raise exception 'task_transfer_self: choose a colleague' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'task_transfer_note_too_long' using errcode = 'P0001';
  end if;
  perform tci.begin_trusted_call();

  foreach v_id in array (select array_agg(distinct x) from unnest(p_tasks) x) loop
    select * into v_task from tci.tasks t where t.id = v_id for update;
    if not found or not tci.task_is_mine(v_task.target_role, v_task.target_user) then
      raise exception 'task_transfer_not_yours: % is not a task you may work', v_id using errcode = '42501';
    end if;
    if v_task.status <> 'open' then
      raise exception 'task_transfer_closed: the task is no longer open' using errcode = 'P0001';
    end if;
    if tci.task_transfer_blocked(v_task.task_type) or v_task.target_role = 'client' then
      raise exception 'task_transfer_not_allowed: this task goes to whoever the rules make eligible'
        using errcode = 'P0001';
    end if;
    v_role := coalesce(v_task.target_role, tci.acting_role());
    if not tci.may_take_task(p_to, v_role) then
      raise exception 'task_transfer_wrong_colleague: the colleague does not work in this department'
        using errcode = 'P0001';
    end if;

    v_merged := exists (select 1 from tci.tasks t
                         where t.task_type = v_task.task_type and t.object_id = v_task.object_id
                           and t.target_user = p_to and t.status = 'open' and t.id <> v_task.id);
    if v_merged then
      update tci.tasks
         set status = 'cancelled', completed_at = now(), completed_by = v_me
       where id = v_task.id;
    else
      update tci.tasks
         set target_user = p_to, target_role = v_role, snoozed_until = null, snoozed_by = null
       where id = v_task.id;
    end if;

    insert into tci.task_transfers (task_id, from_user, from_role, to_user, to_role, merged, note, transferred_by)
    values (v_task.id, v_task.target_user, v_task.target_role, p_to, v_role, v_merged, v_note, v_me);
    if v_note is not null and not v_merged then
      insert into tci.task_comments (task_id, author_id, body) values (v_task.id, v_me, v_note);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function tci.transfer_tasks(uuid[], uuid, text) from public, anon;
grant execute on function tci.transfer_tasks(uuid[], uuid, text) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'tci.task_transfers', 'insert')
     or has_table_privilege('authenticated', 'tci.task_transfers', 'update')
     or has_function_privilege('authenticated', 'tci.may_take_task(uuid, tci.user_role)', 'execute') then
    raise exception '0092: task transfers are written only through tci.transfer_tasks';
  end if;
end $$;
