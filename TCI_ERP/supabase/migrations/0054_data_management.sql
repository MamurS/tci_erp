-- What: the information manager's desk — requests for data, routed to a
--       person, and a list of the data that has gone stale.
--         * tci.entity_requests          a request for a company that is not
--           in the registry (new_company) or for fresh statements of one
--           that is (statements_update), numbered DR-YYYY-NNNN
--         * tci.request_entity / tci.request_statements_update
--                                        any staff member files one
--         * tci.pick_information_manager the least-loaded information
--           manager, who the request is assigned to
--         * tci.take_entity_request / tci.assign_entity_request /
--           tci.resolve_entity_request   the information manager's actions
--         * three Agenda task types, opened and closed by a FOURTH event
--           trigger (tci.handle_data_event), the same discipline as 0029,
--           0036 and 0041
--         * tci.v_data_freshness         companies with live business whose
--           data needs work: no statements, statements older than fifteen
--           months, or registry fields missing
--         * tci.staff_directory()        names of staff, so a request can
--           say who asked and who holds it
-- Why:  a search that finds nothing used to end there. Now it becomes a
--       request in a named person's Agenda, and the requester is told when
--       the company exists. Who gets it, what counts as "done", and when
--       data is stale are workflow rules: they live here, not in the screen.
--
-- DISTRIBUTION. A new request goes to the active information manager with
-- the FEWEST open requests (new or in progress); ties go to the one assigned
-- longest ago, then to the lowest id, so the choice is stable. "Active"
-- means holding the role, not banned and not deleted. With nobody active the
-- request is not lost: its task is addressed to the ROLE, and anyone who
-- takes it becomes its holder. An information manager or an admin may hand a
-- request to another information manager.
--
-- History is the workflow event stream (data.entity_requested,
-- data.entity_request_assigned, data.entity_request_resolved): the table row
-- carries only the current state.

-- ---------------------------------------------------------------------------
-- 1. New task types
-- ---------------------------------------------------------------------------
--
--   entity_requested         the assignee (user) or information_manager   high    AUTO data.entity_request_resolved
--   statements_requested     the assignee (user) or information_manager   normal  AUTO data.entity_request_resolved
--   entity_request_resolved  the requester (user)                         normal  MANUAL — the only new manual type
--
-- entity_request_resolved tells the person who asked that the work is done;
-- nothing downstream happens on its own, so they close it themselves.

alter type tci.task_type add value 'entity_requested';
alter type tci.task_type add value 'statements_requested';
alter type tci.task_type add value 'entity_request_resolved';

-- ---------------------------------------------------------------------------
-- 2. The request
-- ---------------------------------------------------------------------------

create type tci.entity_request_kind as enum ('new_company', 'statements_update');

-- new / in_progress are open; created, linked, updated and rejected are the
-- four ways a request ends: a company was registered, the request turned
-- out to be a company we already had, the statements were brought up to
-- date, or the request was refused with a reason.
create type tci.entity_request_status as enum (
  'new', 'in_progress', 'created', 'linked', 'updated', 'rejected'
);

create sequence tci.entity_request_seq;

create table tci.entity_requests (
  id                  uuid primary key default gen_random_uuid(),
  request_number      text not null unique,
  kind                tci.entity_request_kind not null,
  -- new_company: what the requester typed; statements_update: the company
  requested_name      text,
  country_code        char(2) references tci.countries (code),
  registration_number text,
  entity_id           uuid references tci.legal_entities (id) on delete restrict,
  note                text,
  source              text not null default 'search'
                      check (source in ('search', 'company_card')),
  status              tci.entity_request_status not null default 'new',
  requested_by        uuid not null references auth.users (id),
  assigned_to         uuid references auth.users (id),
  assigned_at         timestamptz,
  resolved_by         uuid references auth.users (id),
  resolved_at         timestamptz,
  resolution_note     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint entity_requests_shape check (
    (kind = 'new_company' and requested_name is not null and btrim(requested_name) <> ''
       and country_code is not null)
    or (kind = 'statements_update' and entity_id is not null)
  ),
  constraint entity_requests_resolution check (
    (status in ('new', 'in_progress') and resolved_at is null)
    or (status in ('created', 'linked', 'updated') and resolved_at is not null and entity_id is not null)
    or (status = 'rejected' and resolved_at is not null and resolution_note is not null)
  )
);

comment on table tci.entity_requests is
  'A request for data: a company that is not in the registry, or fresh statements for one that is. Written only through tci.request_entity, tci.request_statements_update, tci.take_entity_request, tci.assign_entity_request and tci.resolve_entity_request; its history is the data.* workflow events.';

create index entity_requests_open_idx on tci.entity_requests (assigned_to, status)
  where status in ('new', 'in_progress');
create index entity_requests_requester_idx on tci.entity_requests (requested_by, created_at desc);
-- One open new_company request per (country, name) and one open
-- statements_update request per company: a second requester joins the first.
create unique index entity_requests_open_company_uq on tci.entity_requests (country_code, lower(btrim(requested_name)))
  where kind = 'new_company' and status in ('new', 'in_progress');
create unique index entity_requests_open_statements_uq on tci.entity_requests (entity_id)
  where kind = 'statements_update' and status in ('new', 'in_progress');

create function tci.set_entity_request_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_number is null or new.request_number = '' then
    new.request_number := 'DR-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('tci.entity_request_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger entity_requests_number
  before insert on tci.entity_requests
  for each row execute function tci.set_entity_request_number();

-- A trigger function is never called through the API (0046: every new tci
-- function revokes PUBLIC and anon explicitly).
revoke all on function tci.set_entity_request_number() from public, anon, authenticated;

create trigger entity_requests_set_updated_at
  before update on tci.entity_requests
  for each row execute function tci.set_updated_at();

alter table tci.entity_requests enable row level security;

-- The requester follows their own requests; information managers and
-- admins see all of them. Nobody writes the table directly.
create policy "entity_requests: read own or as information manager"
  on tci.entity_requests for select to authenticated
  using (
    tci.is_staff()
    and (requested_by = (select auth.uid()) or tci.has_role('information_manager', 'admin'))
  );

revoke all on tci.entity_requests from public, anon, authenticated;
grant select on tci.entity_requests to authenticated;
grant all on tci.entity_requests to service_role;
grant usage on sequence tci.entity_request_seq to service_role;

-- ---------------------------------------------------------------------------
-- 3. Who gets it
-- ---------------------------------------------------------------------------

create function tci.pick_information_manager()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Reads user_roles and auth.users of OTHER people, which no caller may:
  -- that is why it is a definer function, and why only workflow code may
  -- call it (the token gate in the plpgsql wrapper below).
  select ur.user_id
    from tci.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'information_manager'
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until <= now())
   order by
     (select count(*) from tci.entity_requests r
       where r.assigned_to = ur.user_id and r.status in ('new', 'in_progress')),
     (select max(r.assigned_at) from tci.entity_requests r where r.assigned_to = ur.user_id) nulls first,
     ur.user_id
   limit 1
$$;

-- The callable form: workflow code only.
create function tci.next_information_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_internal_call();
  return tci.pick_information_manager();
end;
$$;

revoke all on function tci.pick_information_manager() from public, anon, authenticated;
revoke all on function tci.next_information_manager() from public, anon;
grant execute on function tci.next_information_manager() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Filing a request
-- ---------------------------------------------------------------------------
-- Returns { result, request_id, request_number, entity_id, assigned_to }:
--   exists            the registration number is already in the registry —
--                     nothing is filed, entity_id says where it is
--   already_requested an open request for the same company exists — the
--                     caller is pointed at it instead of filing a second one
--   requested         filed and routed

create function tci.request_entity(
  p_name                text,
  p_country_code        text,
  p_registration_number text default null,
  p_note                text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text := nullif(btrim(p_name), '');
  v_country text := upper(nullif(btrim(p_country_code), ''));
  v_reg     text := nullif(btrim(p_registration_number), '');
  v_entity  uuid;
  v_row     tci.entity_requests%rowtype;
  v_user    uuid;
begin
  perform tci.require_staff();
  if v_name is null then
    raise exception 'a company name is required' using errcode = 'P0001';
  end if;
  if v_country is null or not exists (select 1 from tci.countries c where c.code = v_country) then
    raise exception 'unknown country %', p_country_code using errcode = 'P0001';
  end if;

  if v_reg is not null then
    select e.id into v_entity from tci.legal_entities e
     where e.country_code = v_country and e.registration_number = v_reg;
    if found then
      return jsonb_build_object('result', 'exists', 'entity_id', v_entity);
    end if;
  end if;

  select * into v_row from tci.entity_requests r
   where r.kind = 'new_company' and r.status in ('new', 'in_progress')
     and r.country_code = v_country
     and (lower(btrim(r.requested_name)) = lower(v_name)
          or (v_reg is not null and r.registration_number = v_reg))
   limit 1;
  if found then
    return jsonb_build_object('result', 'already_requested', 'request_id', v_row.id,
                              'request_number', v_row.request_number, 'assigned_to', v_row.assigned_to);
  end if;

  perform tci.begin_trusted_call();
  v_user := tci.pick_information_manager();
  insert into tci.entity_requests (kind, requested_name, country_code, registration_number, note,
                                   source, requested_by, assigned_to, assigned_at)
  values ('new_company', v_name, v_country, v_reg, nullif(btrim(p_note), ''),
          'search', (select auth.uid()), v_user, case when v_user is not null then now() end)
  returning * into v_row;

  perform tci.emit_workflow_event('data.entity_requested', 'entity_request', v_row.id,
    jsonb_build_object('kind', 'new_company', 'name', v_name, 'country', v_country,
                       'request_number', v_row.request_number),
    case when v_user is null then 'information_manager'::tci.user_role end, v_user);

  return jsonb_build_object('result', 'requested', 'request_id', v_row.id,
                            'request_number', v_row.request_number, 'assigned_to', v_user);
end;
$$;

create function tci.request_statements_update(p_entity_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity tci.legal_entities%rowtype;
  v_row    tci.entity_requests%rowtype;
  v_user   uuid;
begin
  perform tci.require_staff();
  select * into v_entity from tci.legal_entities e where e.id = p_entity_id;
  if not found then
    raise exception 'company % not found', p_entity_id using errcode = 'P0002';
  end if;

  select * into v_row from tci.entity_requests r
   where r.kind = 'statements_update' and r.entity_id = p_entity_id
     and r.status in ('new', 'in_progress');
  if found then
    return jsonb_build_object('result', 'already_requested', 'request_id', v_row.id,
                              'request_number', v_row.request_number, 'assigned_to', v_row.assigned_to);
  end if;

  perform tci.begin_trusted_call();
  v_user := tci.pick_information_manager();
  insert into tci.entity_requests (kind, requested_name, country_code, entity_id, note, source,
                                   requested_by, assigned_to, assigned_at)
  values ('statements_update', v_entity.name, v_entity.country_code, p_entity_id,
          nullif(btrim(p_note), ''), 'company_card', (select auth.uid()), v_user,
          case when v_user is not null then now() end)
  returning * into v_row;

  perform tci.emit_workflow_event('data.entity_requested', 'entity_request', v_row.id,
    jsonb_build_object('kind', 'statements_update', 'name', v_entity.name,
                       'country', v_entity.country_code, 'entity_id', p_entity_id,
                       'request_number', v_row.request_number),
    case when v_user is null then 'information_manager'::tci.user_role end, v_user);

  return jsonb_build_object('result', 'requested', 'request_id', v_row.id,
                            'request_number', v_row.request_number, 'assigned_to', v_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Working a request
-- ---------------------------------------------------------------------------

-- Take it: the caller becomes its holder and starts on it.
create function tci.take_entity_request(p_request_id uuid)
returns tci.entity_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  tci.entity_requests%rowtype;
  v_me   uuid := (select auth.uid());
begin
  perform tci.require_role('information_manager', 'admin');
  select * into v_row from tci.entity_requests where id = p_request_id for update;
  if not found then
    raise exception 'request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_row.status not in ('new', 'in_progress') then
    raise exception 'this data request is already % (%)', v_row.status, v_row.request_number using errcode = 'P0001';
  end if;

  perform tci.begin_trusted_call();
  if v_row.assigned_to is distinct from v_me then
    update tci.entity_requests
       set assigned_to = v_me, assigned_at = now(), status = 'in_progress'
     where id = p_request_id
     returning * into v_row;
    perform tci.emit_workflow_event('data.entity_request_assigned', 'entity_request', p_request_id,
      jsonb_build_object('to', v_me, 'kind', v_row.kind, 'name', v_row.requested_name,
                         'country', v_row.country_code, 'request_number', v_row.request_number),
      null, v_me);
  elsif v_row.status = 'new' then
    update tci.entity_requests set status = 'in_progress' where id = p_request_id
     returning * into v_row;
  end if;
  return v_row;
end;
$$;

-- Hand it to another information manager.
create function tci.assign_entity_request(p_request_id uuid, p_user_id uuid)
returns tci.entity_requests
language plpgsql
security definer
set search_path = ''
as $$
declare v_row tci.entity_requests%rowtype;
begin
  perform tci.require_role('information_manager', 'admin');
  select * into v_row from tci.entity_requests where id = p_request_id for update;
  if not found then
    raise exception 'request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_row.status not in ('new', 'in_progress') then
    raise exception 'this data request is already % (%)', v_row.status, v_row.request_number using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.user_roles ur
                  where ur.user_id = p_user_id and ur.role = 'information_manager') then
    raise exception 'the assignee must hold the information_manager role' using errcode = 'P0001';
  end if;
  if v_row.assigned_to = p_user_id then
    return v_row;
  end if;

  perform tci.begin_trusted_call();
  update tci.entity_requests
     set assigned_to = p_user_id, assigned_at = now(), status = 'new'
   where id = p_request_id
   returning * into v_row;
  perform tci.emit_workflow_event('data.entity_request_assigned', 'entity_request', p_request_id,
    jsonb_build_object('to', p_user_id, 'kind', v_row.kind, 'name', v_row.requested_name,
                       'country', v_row.country_code, 'request_number', v_row.request_number),
    null, p_user_id);
  return v_row;
end;
$$;

-- End it. created / linked name the company; updated is for statements;
-- rejected needs a reason the requester will read.
create function tci.resolve_entity_request(
  p_request_id uuid,
  p_outcome    text,
  p_entity_id  uuid default null,
  p_note       text default null
)
returns tci.entity_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    tci.entity_requests%rowtype;
  v_entity uuid;
  v_note   text := nullif(btrim(p_note), '');
begin
  perform tci.require_role('information_manager', 'admin');
  select * into v_row from tci.entity_requests where id = p_request_id for update;
  if not found then
    raise exception 'request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_row.status not in ('new', 'in_progress') then
    raise exception 'this data request is already % (%)', v_row.status, v_row.request_number using errcode = 'P0001';
  end if;
  if p_outcome not in ('created', 'linked', 'updated', 'rejected') then
    raise exception 'unknown outcome %', p_outcome using errcode = 'P0001';
  end if;
  if p_outcome in ('created', 'linked') and v_row.kind <> 'new_company' then
    raise exception 'a statements request ends as updated or rejected' using errcode = 'P0001';
  end if;
  if p_outcome = 'updated' and v_row.kind <> 'statements_update' then
    raise exception 'a company request ends as created, linked or rejected' using errcode = 'P0001';
  end if;
  if p_outcome = 'rejected' and v_note is null then
    raise exception 'a rejected request needs a reason' using errcode = 'P0001';
  end if;

  v_entity := case when p_outcome = 'updated' then v_row.entity_id else p_entity_id end;
  if p_outcome in ('created', 'linked') then
    if v_entity is null or not exists (select 1 from tci.legal_entities e where e.id = v_entity) then
      raise exception 'name the company the request was resolved with' using errcode = 'P0001';
    end if;
  end if;

  perform tci.begin_trusted_call();
  update tci.entity_requests
     set status = p_outcome::tci.entity_request_status,
         entity_id = coalesce(v_entity, entity_id),
         resolved_by = (select auth.uid()),
         resolved_at = now(),
         resolution_note = v_note,
         assigned_to = coalesce(assigned_to, (select auth.uid()))
   where id = p_request_id
   returning * into v_row;

  perform tci.emit_workflow_event('data.entity_request_resolved', 'entity_request', p_request_id,
    jsonb_build_object('outcome', p_outcome, 'kind', v_row.kind, 'name', v_row.requested_name,
                       'entity_id', v_row.entity_id, 'request_number', v_row.request_number,
                       'requested_by', v_row.requested_by),
    null, v_row.requested_by);
  return v_row;
end;
$$;

revoke all on function
  tci.request_entity(text, text, text, text),
  tci.request_statements_update(uuid, text),
  tci.take_entity_request(uuid),
  tci.assign_entity_request(uuid, uuid),
  tci.resolve_entity_request(uuid, text, uuid, text)
  from public, anon;
grant execute on function
  tci.request_entity(text, text, text, text),
  tci.request_statements_update(uuid, text),
  tci.take_entity_request(uuid),
  tci.assign_entity_request(uuid, uuid),
  tci.resolve_entity_request(uuid, text, uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The Agenda mapping — a FOURTH trigger on tci.workflow_events
-- ---------------------------------------------------------------------------

create function tci.handle_data_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  tci.entity_requests%rowtype;
  v_type text;
begin
  perform tci.begin_trusted_call();
  if new.object_type <> 'entity_request' then
    return null;
  end if;
  select * into v_row from tci.entity_requests where id = new.object_id;
  if not found then
    return null;
  end if;
  v_type := case v_row.kind when 'new_company' then 'entity_requested' else 'statements_requested' end;

  if new.event_type in ('data.entity_requested', 'data.entity_request_assigned') then
    -- Whoever held it before is no longer asked to.
    perform tci.close_tasks(array['entity_requested', 'statements_requested']::tci.task_type[],
                            new.object_id, 'cancelled');
    perform tci.open_task(
      v_type::tci.task_type, 'entity_request', new.object_id,
      'agenda.tasks.' || v_type,
      jsonb_build_object('request_number', v_row.request_number, 'name', v_row.requested_name,
                         'country', v_row.country_code),
      case when v_row.assigned_to is null then 'information_manager'::tci.user_role end,
      v_row.assigned_to,
      now() + interval '2 days',
      case v_row.kind when 'new_company' then 'high' else 'normal' end::tci.task_priority,
      new.id);

  elsif new.event_type = 'data.entity_request_resolved' then
    perform tci.close_tasks(array['entity_requested', 'statements_requested']::tci.task_type[],
                            new.object_id, 'done');
    -- The requester is told — unless they resolved it themselves.
    if v_row.requested_by is distinct from v_row.resolved_by then
      perform tci.open_task(
        'entity_request_resolved', 'entity_request', new.object_id,
        'agenda.tasks.entity_request_resolved_' || v_row.status::text,
        jsonb_build_object('request_number', v_row.request_number, 'name', v_row.requested_name,
                           'entity_id', v_row.entity_id, 'note', v_row.resolution_note),
        null, v_row.requested_by, null, 'normal', new.id);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function tci.handle_data_event() from public, anon, authenticated;

create trigger workflow_events_to_data_tasks
  after insert on tci.workflow_events
  for each row execute function tci.handle_data_event();

comment on function tci.handle_data_event() is
  'Agenda mapping for data requests (0054): opens entity_requested / statements_requested for the assignee (or the information_manager role when nobody is active), moves it on reassignment, closes it on resolution and tells the requester with entity_request_resolved.';

-- tci.complete_task: the three manual types of 0036, plus entity_request_resolved.
create or replace function tci.complete_task(p_task_id uuid)
returns tci.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare v_task tci.tasks%rowtype;
begin
  select * into v_task from tci.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task % not found or not yours', p_task_id using errcode = 'P0002';
  end if;
  if v_task.status <> 'open' then
    raise exception 'task is already %', v_task.status using errcode = 'P0001';
  end if;
  if v_task.task_type not in
     ('submission_declined', 'uncovered_excess_review', 'claim_declined_review',
      'entity_request_resolved') then
    raise exception 'task type % closes itself when its object moves on', v_task.task_type
      using errcode = 'P0001';
  end if;

  update tci.tasks
     set status = 'done', completed_by = (select auth.uid()), completed_at = now()
   where id = p_task_id
   returning * into v_task;
  return v_task;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Names of colleagues
-- ---------------------------------------------------------------------------
-- A request says who asked and who holds it, and the reassign picker lists
-- the information managers. user_profiles and auth.users are readable only
-- row-by-row as oneself, so this is a gated definer function returning only
-- what a colleague may see: id, name, e-mail and roles — of STAFF only.

create function tci.staff_directory()
returns table (user_id uuid, full_name text, email text, roles tci.user_role[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff();
  return query
    select u.id, p.full_name, u.email::text,
           array_agg(ur.role order by ur.role)
      from auth.users u
      join tci.user_roles ur on ur.user_id = u.id
      left join tci.user_profiles p on p.user_id = u.id
     where u.deleted_at is null
     group by u.id, p.full_name, u.email
    having not (array_agg(ur.role) <@ array['client']::tci.user_role[]);
end;
$$;

revoke all on function tci.staff_directory() from public, anon;
grant execute on function tci.staff_directory() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Data freshness
-- ---------------------------------------------------------------------------
-- Companies with LIVE business — an open limit request, an in-force limit,
-- a buyer in a live submission, or an active / suspended policy — whose data
-- needs the information manager:
--   no_statements     nothing to analyse or rate
--   stale_statements  the latest statement ends more than fifteen months ago
--                     (a year's accounts plus the time to file them)
--   missing_registry  registration number, address or industry is missing
-- One row per company with its FIRST reason in that order, and the gaps as
-- flags so the screen can say exactly what is missing.
create view tci.v_data_freshness
with (security_invoker = true) as
with live as (
  select r.entity_id from tci.credit_limit_requests r
   where r.status in ('draft', 'submitted', 'under_review', 'escalated')
  union
  select v.entity_id from tci.v_effective_limits v
   where v.outcome in ('approved', 'partial')
  union
  select ib.entity_id
    from tci.insurance_request_buyers ib
    join tci.insurance_requests ir on ir.id = ib.request_id
   where ib.entity_id is not null
     and ir.status not in ('draft', 'declined', 'withdrawn', 'bound')
  union
  select p.entity_id from tci.policies p where p.status in ('active', 'suspended')
),
facts as (
  select
    e.id                                     as entity_id,
    e.name,
    e.country_code,
    e.registration_number is null            as missing_registration,
    nullif(btrim(e.address), '') is null     as missing_address,
    e.industry_id is null                    as missing_industry,
    st.statements_count,
    st.latest_period_end,
    st.latest_entered_at,
    exists (select 1 from tci.policies p where p.entity_id = e.id) as is_policyholder,
    exists (select 1 from tci.credit_limit_requests r where r.entity_id = e.id) as is_buyer,
    (select r.id from tci.entity_requests r
      where r.entity_id = e.id and r.kind = 'statements_update'
        and r.status in ('new', 'in_progress') limit 1)        as open_request_id
  from live l
  join tci.legal_entities e on e.id = l.entity_id
  left join lateral (
    select count(*)::int               as statements_count,
           max(fs.period_end_date)     as latest_period_end,
           max(fs.created_at)          as latest_entered_at
      from tci.financial_statements fs
     where fs.entity_id = e.id
  ) st on true
)
select
  f.*,
  case
    when f.statements_count = 0                                   then 'no_statements'
    when f.latest_period_end < current_date - interval '15 months' then 'stale_statements'
    when f.missing_registration or f.missing_address or f.missing_industry then 'missing_registry'
  end as reason
from facts f
where f.statements_count = 0
   or f.latest_period_end < current_date - interval '15 months'
   or f.missing_registration or f.missing_address or f.missing_industry;

comment on view tci.v_data_freshness is
  'Companies with live business whose data needs work, with the first reason: no_statements, stale_statements (latest period ends more than 15 months ago) or missing_registry (registration number, address or industry). security_invoker over staff-only tables.';

grant select on tci.v_data_freshness to authenticated, service_role;
revoke all on tci.v_data_freshness from anon;

-- ---------------------------------------------------------------------------
-- 9. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  -- the table is read-only to the API roles
  if has_table_privilege('authenticated', 'tci.entity_requests', 'insert')
     or has_table_privilege('authenticated', 'tci.entity_requests', 'update')
     or has_table_privilege('authenticated', 'tci.entity_requests', 'delete')
     or has_table_privilege('anon', 'tci.entity_requests', 'select') then
    raise exception '0054: tci.entity_requests must be written only through its functions';
  end if;

  -- the picker reads other people's rows: closed to every API role
  if has_function_privilege('authenticated', 'tci.pick_information_manager()', 'execute')
     or has_function_privilege('anon', 'tci.pick_information_manager()', 'execute') then
    raise exception '0054: tci.pick_information_manager must not be callable by an API role';
  end if;

  -- every new definer function executable by authenticated opens with a gate
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and p.prosecdef
     and p.proname in ('request_entity', 'request_statements_update', 'take_entity_request',
                       'assign_entity_request', 'resolve_entity_request', 'staff_directory',
                       'next_information_manager')
     and p.prosrc !~ 'perform tci\.require_(staff|role|internal_call)\(';
  if v_bad is not null then
    raise exception '0054: ungated: %', v_bad;
  end if;

  -- nothing new is executable by anon
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace
     and p.proname in ('request_entity', 'request_statements_update', 'take_entity_request',
                       'assign_entity_request', 'resolve_entity_request', 'staff_directory',
                       'next_information_manager', 'pick_information_manager', 'handle_data_event',
                       'set_entity_request_number')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0054: anon can execute %', v_bad;
  end if;

  -- the freshness view runs as the caller, and is readable by staff
  if not exists (select 1 from pg_class c where c.relnamespace = 'tci'::regnamespace
                  and c.relname = 'v_data_freshness'
                  and 'security_invoker=true' = any (c.reloptions)) then
    raise exception '0054: v_data_freshness must be security_invoker';
  end if;

  -- complete_task accepts exactly the four manual types
  if position('''entity_request_resolved''' in pg_get_functiondef('tci.complete_task(uuid)'::regprocedure)) = 0 then
    raise exception '0054: complete_task does not accept entity_request_resolved';
  end if;
end;
$$;
