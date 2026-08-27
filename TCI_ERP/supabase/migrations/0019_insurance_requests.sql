-- 0019_insurance_requests.sql
-- What: Phase 3c-1 (part 1) - the insurance-request pipeline that precedes
--       a policy: tci.insurance_requests + its buyer package, an immutable
--       transition history, the workflow settings singleton, and the
--       tci.workflow_events stream that Phase 3c-2's Agenda will consume.
-- Why:  a submission is the unit of work that routes between departments:
--       sales resolve the entities, information_manager fills what is
--       missing, credit underwriting rates the buyers and sets limits,
--       commercial underwriting fixes the terms, sales confirm, the client
--       accepts, and only then a policy is bound.
--
-- Status machine (enforced in tci.advance_insurance_request):
--   draft             -> submitted | withdrawn
--   submitted         -> entity_resolution | underwriting | withdrawn
--   entity_resolution -> underwriting | withdrawn
--   underwriting      -> commercial_review | withdrawn
--   commercial_review -> sales_confirmation | withdrawn
--   sales_confirmation-> client_review | withdrawn
--   client_review     -> accepted | declined | withdrawn
--   accepted          -> bound
--   declined / withdrawn / bound  are terminal
-- Guards: submitted->underwriting requires every buyer resolved;
--   underwriting->commercial_review requires a credit-stage decision for
--   every buyer in the package (checked against tci.credit_limit_decisions).
--
-- workflow_events catalogue (event_type), all with object_type
-- 'insurance_request' unless noted:
--   request.created            a submission was raised
--   request.status_changed     any transition (payload: from, to, comment)
--   request.assigned           an assignee changed (payload: field, user)
--   request.buyer_added        a buyer entered the package
--   request.buyer_resolved     a buyer reached resolution_status 'ready'
--   limit.credit_decided       object_type 'credit_limit_decision' (0020)
--   limit.commercial_adjusted  object_type 'credit_limit_decision' (0020)
--   limit.released             object_type 'credit_limit_decision' (0020)
--   limit.held                 object_type 'credit_limit_decision' (0020)

-- ---------------------------------------------------------------------------
-- Workflow settings (single row, admin-editable)
-- ---------------------------------------------------------------------------

create table tci.workflow_settings (
  id                  boolean primary key default true,
  sales_window_hours  int not null default 24 check (sales_window_hours >= 0),
  updated_by          uuid references auth.users (id),
  updated_at          timestamptz not null default now(),

  constraint workflow_settings_singleton check (id)
);

comment on table tci.workflow_settings is
  'Single-row workflow knobs. sales_window_hours drives the silent-consent release of limit decisions to the client.';

insert into tci.workflow_settings (id) values (true);

alter table tci.workflow_settings enable row level security;

create policy "workflow_settings: staff read"
  on tci.workflow_settings for select to authenticated using (tci.is_staff());
create policy "workflow_settings: admin write"
  on tci.workflow_settings for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

grant select on tci.workflow_settings to authenticated;
grant update on tci.workflow_settings to authenticated;
grant all on tci.workflow_settings to service_role;

-- Read once per query; SECURITY DEFINER so the client role can rely on the
-- window without being able to read (or change) the settings row.
create function tci.sales_window_hours()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sales_window_hours from tci.workflow_settings where id), 24)
$$;

revoke execute on function tci.sales_window_hours() from public, anon;
grant execute on function tci.sales_window_hours() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Workflow events (append-only; the Agenda of Phase 3c-2 reads this)
-- ---------------------------------------------------------------------------

create table tci.workflow_events (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null,
  object_type text not null,
  object_id   uuid not null,
  actor       uuid references auth.users (id) default auth.uid(),
  target_role tci.user_role,
  target_user uuid references auth.users (id),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table tci.workflow_events is
  'Append-only workflow event stream. No consumer yet - Phase 3c-2 builds the Agenda on top. Event types are catalogued in the 0019 migration header.';

create index workflow_events_object_idx on tci.workflow_events (object_type, object_id, created_at desc);
create index workflow_events_target_idx on tci.workflow_events (target_role, created_at desc);

alter table tci.workflow_events enable row level security;

create policy "workflow_events: staff read"
  on tci.workflow_events for select to authenticated using (tci.is_staff());
-- Written by the workflow functions (SECURITY INVOKER), never by hand.
create policy "workflow_events: staff append"
  on tci.workflow_events for insert to authenticated with check (tci.is_staff());

grant select, insert on tci.workflow_events to authenticated;
grant all on tci.workflow_events to service_role;

create function tci.emit_workflow_event(
  p_event_type  text,
  p_object_type text,
  p_object_id   uuid,
  p_payload     jsonb default '{}'::jsonb,
  p_target_role tci.user_role default null,
  p_target_user uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into tci.workflow_events
    (event_type, object_type, object_id, actor, target_role, target_user, payload)
  values
    (p_event_type, p_object_type, p_object_id, (select auth.uid()), p_target_role,
     p_target_user, coalesce(p_payload, '{}'::jsonb))
$$;

revoke execute on function tci.emit_workflow_event(text, text, uuid, jsonb, tci.user_role, uuid)
  from public, anon;
grant execute on function tci.emit_workflow_event(text, text, uuid, jsonb, tci.user_role, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Insurance requests
-- ---------------------------------------------------------------------------

create type tci.insurance_request_status as enum (
  'draft', 'submitted', 'entity_resolution', 'underwriting', 'commercial_review',
  'sales_confirmation', 'client_review', 'accepted', 'declined', 'withdrawn', 'bound'
);

create type tci.buyer_resolution_status as enum
  ('pending_entity', 'ready', 'rating_done', 'limit_done');

create sequence tci.insurance_request_seq;

create table tci.insurance_requests (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references tci.legal_entities (id),
  request_number    text not null unique,
  status            tci.insurance_request_status not null default 'draft',

  -- Proposed terms: null at draft, filled by commercial underwriting.
  product_structure              tci.product_structure,
  currency_code                  char(3) references tci.currencies (code),
  insured_percentage             numeric(5,2),
  premium_rate_pct               numeric(8,5),
  minimum_premium                numeric(18,2),
  max_liability_amount           numeric(18,2),
  max_liability_premium_multiple numeric(6,2),
  discretionary_limit            numeric(18,2),
  nql_amount                     numeric(18,2),
  deductible_each_loss           numeric(18,2),
  aggregate_first_loss           numeric(18,2),
  waiting_period_days            int,
  max_extension_period_days      int,
  max_payment_terms_days         int,
  declaration_frequency          tci.declaration_frequency,
  estimated_annual_turnover      numeric(18,2),

  created_by        uuid not null references auth.users (id) default auth.uid(),
  created_by_role   tci.user_role,
  assigned_sales      uuid references auth.users (id),
  assigned_commercial uuid references auth.users (id),
  assigned_credit     uuid references auth.users (id),

  submitted_at      timestamptz,
  decided_at        timestamptz,
  decline_reason    text,
  bound_policy_id   uuid references tci.policies (id),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table tci.insurance_requests is
  'Insurance submissions: the pipeline that precedes a policy. Status transitions go through tci.advance_insurance_request only.';

create index insurance_requests_entity_idx on tci.insurance_requests (entity_id);
create index insurance_requests_status_idx on tci.insurance_requests (status);

create trigger insurance_requests_set_updated_at
  before update on tci.insurance_requests
  for each row execute function tci.set_updated_at();

-- IR-<year>-<4 digits>, numbered from one shared sequence (documented: the
-- counter does not reset per year - uniqueness matters more than density).
create function tci.set_insurance_request_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.request_number is null or new.request_number = '' then
    new.request_number := 'IR-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('tci.insurance_request_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger insurance_requests_number
  before insert on tci.insurance_requests
  for each row execute function tci.set_insurance_request_number();

-- The buyer package inside a submission.
create table tci.insurance_request_buyers (
  id                           uuid primary key default gen_random_uuid(),
  request_id                   uuid not null references tci.insurance_requests (id) on delete cascade,
  entity_id                    uuid references tci.legal_entities (id),
  -- Free-text name kept for buyers not yet resolved to a legal entity.
  proposed_name                text,
  requested_amount             numeric(18,2) not null check (requested_amount > 0),
  requested_payment_terms_days int,
  resolution_status            tci.buyer_resolution_status not null default 'pending_entity',
  created_by                   uuid not null references auth.users (id) default auth.uid(),
  created_at                   timestamptz not null default now(),

  constraint request_buyers_identified check (entity_id is not null or proposed_name is not null),
  constraint request_buyers_resolved_has_entity
    check (resolution_status = 'pending_entity' or entity_id is not null)
);

create index insurance_request_buyers_request_idx on tci.insurance_request_buyers (request_id);
create index insurance_request_buyers_entity_idx on tci.insurance_request_buyers (entity_id);

create table tci.insurance_request_history (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references tci.insurance_requests (id) on delete cascade,
  from_status tci.insurance_request_status not null,
  to_status   tci.insurance_request_status not null,
  changed_by  uuid not null references auth.users (id) default auth.uid(),
  changed_at  timestamptz not null default now(),
  comment     text
);

create index insurance_request_history_request_idx
  on tci.insurance_request_history (request_id, changed_at desc);

-- Limit requests raised inside a submission carry it; standalone in-force
-- requests leave it null.
alter table tci.credit_limit_requests
  add column insurance_request_id uuid references tci.insurance_requests (id);

create index credit_limit_requests_insurance_idx
  on tci.credit_limit_requests (insurance_request_id);

-- ---------------------------------------------------------------------------
-- RLS: staff by department; the client sees its OWN submissions and may
-- write only while the ball is in its court ('draft' / 'client_review').
-- ---------------------------------------------------------------------------

alter table tci.insurance_requests enable row level security;
alter table tci.insurance_request_buyers enable row level security;
alter table tci.insurance_request_history enable row level security;

create policy "insurance_requests: staff read"
  on tci.insurance_requests for select to authenticated using (tci.is_staff());
create policy "insurance_requests: workflow write"
  on tci.insurance_requests for all to authenticated
  using (tci.has_role('admin', 'sales', 'commercial_underwriter', 'credit_underwriter'))
  with check (tci.has_role('admin', 'sales', 'commercial_underwriter', 'credit_underwriter'));
create policy "insurance_requests: client reads own"
  on tci.insurance_requests for select to authenticated
  using (
    tci.has_role('client')
    and entity_id in (
      select pu.entity_id from tci.policyholder_users pu where pu.user_id = (select auth.uid())
    )
  );
create policy "insurance_requests: client writes own while in its court"
  on tci.insurance_requests for update to authenticated
  using (
    tci.has_role('client')
    and status in ('draft', 'client_review')
    and entity_id in (
      select pu.entity_id from tci.policyholder_users pu where pu.user_id = (select auth.uid())
    )
  )
  with check (
    tci.has_role('client')
    and status in ('draft', 'client_review', 'accepted', 'declined')
  );

create policy "request_buyers: staff read"
  on tci.insurance_request_buyers for select to authenticated using (tci.is_staff());
create policy "request_buyers: workflow write"
  on tci.insurance_request_buyers for all to authenticated
  using (tci.has_role('admin', 'sales', 'commercial_underwriter', 'credit_underwriter'))
  with check (tci.has_role('admin', 'sales', 'commercial_underwriter', 'credit_underwriter'));
create policy "request_buyers: client reads own"
  on tci.insurance_request_buyers for select to authenticated
  using (
    tci.has_role('client')
    and request_id in (
      select r.id from tci.insurance_requests r
      join tci.policyholder_users pu on pu.entity_id = r.entity_id
      where pu.user_id = (select auth.uid())
    )
  );

create policy "request_history: staff read"
  on tci.insurance_request_history for select to authenticated using (tci.is_staff());
create policy "request_history: workflow append"
  on tci.insurance_request_history for insert to authenticated
  with check (tci.is_staff() or tci.has_role('client'));
create policy "request_history: client reads own"
  on tci.insurance_request_history for select to authenticated
  using (
    tci.has_role('client')
    and request_id in (
      select r.id from tci.insurance_requests r
      join tci.policyholder_users pu on pu.entity_id = r.entity_id
      where pu.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on tci.insurance_requests to authenticated;
grant select, insert, update, delete on tci.insurance_request_buyers to authenticated;
grant select, insert on tci.insurance_request_history to authenticated;
grant all on tci.insurance_requests, tci.insurance_request_buyers,
  tci.insurance_request_history to service_role;

-- ---------------------------------------------------------------------------
-- Status machine
-- ---------------------------------------------------------------------------

-- Every buyer in the package resolved to a legal entity?
create function tci.request_entities_resolved(p_request_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select not exists (
    select 1 from tci.insurance_request_buyers b
    where b.request_id = p_request_id
      and (b.entity_id is null or b.resolution_status = 'pending_entity')
  )
$$;

-- Every buyer carries an effective CREDIT-stage decision?
create function tci.request_credit_complete(p_request_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from tci.insurance_request_buyers b where b.request_id = p_request_id)
     and not exists (
    select 1
    from tci.insurance_request_buyers b
    where b.request_id = p_request_id
      and not exists (
        select 1
        from tci.credit_limit_requests r
        join tci.credit_limit_decisions d on d.request_id = r.id
        where r.insurance_request_id = p_request_id
          and r.entity_id = b.entity_id
          and d.lifecycle = 'effective'
      )
  )
$$;

create function tci.advance_insurance_request(
  p_request_id uuid,
  p_to_status  tci.insurance_request_status,
  p_comment    text default null
)
returns tci.insurance_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request tci.insurance_requests%rowtype;
  v_from    tci.insurance_request_status;
  v_ok      boolean := false;
begin
  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found then
    raise exception 'insurance request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  v_from := v_request.status;

  -- Transition table
  v_ok := case
    when v_from = 'draft'              and p_to_status in ('submitted', 'withdrawn') then true
    when v_from = 'submitted'          and p_to_status in ('entity_resolution', 'underwriting', 'withdrawn') then true
    when v_from = 'entity_resolution'  and p_to_status in ('underwriting', 'withdrawn') then true
    when v_from = 'underwriting'       and p_to_status in ('commercial_review', 'withdrawn') then true
    when v_from = 'commercial_review'  and p_to_status in ('sales_confirmation', 'withdrawn') then true
    when v_from = 'sales_confirmation' and p_to_status in ('client_review', 'withdrawn') then true
    when v_from = 'client_review'      and p_to_status in ('accepted', 'declined', 'withdrawn') then true
    when v_from = 'accepted'           and p_to_status = 'bound' then true
    else false
  end;
  if not v_ok then
    raise exception 'invalid insurance request transition: % -> %', v_from, p_to_status
      using errcode = 'P0001';
  end if;

  -- Role gates per target state
  if p_to_status = 'withdrawn' then
    if not (v_request.created_by = (select auth.uid()) or tci.has_role('admin')) then
      raise exception 'only the creator or an admin may withdraw a submission'
        using errcode = 'P0004';
    end if;
  elsif p_to_status in ('accepted', 'declined') then
    if not tci.has_role('client', 'admin', 'sales') then
      raise exception 'only the client (or sales/admin on its behalf) may accept or decline'
        using errcode = 'P0004';
    end if;
  elsif p_to_status = 'client_review' then
    if not tci.has_role('admin', 'sales') then
      raise exception 'only sales may release a submission to the client'
        using errcode = 'P0004';
    end if;
  elsif p_to_status = 'sales_confirmation' then
    if not tci.has_role('admin', 'commercial_underwriter') then
      raise exception 'only commercial underwriting may finish the commercial review'
        using errcode = 'P0004';
    end if;
  elsif not tci.is_staff() then
    raise exception 'only staff may move a submission' using errcode = 'P0004';
  end if;

  -- Content guards
  if p_to_status = 'underwriting' and not tci.request_entities_resolved(p_request_id) then
    raise exception 'every buyer must be resolved to a company before underwriting'
      using errcode = 'P0001';
  end if;
  if p_to_status = 'commercial_review' and not tci.request_credit_complete(p_request_id) then
    raise exception 'every buyer needs a credit decision before the commercial review'
      using errcode = 'P0001';
  end if;
  if p_to_status = 'declined' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'a decline needs a reason' using errcode = 'P0001';
  end if;

  update tci.insurance_requests
     set status = p_to_status,
         submitted_at = case when p_to_status = 'submitted' then now() else submitted_at end,
         decided_at = case when p_to_status in ('accepted', 'declined') then now() else decided_at end,
         decline_reason = case when p_to_status = 'declined' then p_comment else decline_reason end
   where id = p_request_id
   returning * into v_request;

  insert into tci.insurance_request_history (request_id, from_status, to_status, comment)
  values (p_request_id, v_from, p_to_status, p_comment);

  perform tci.emit_workflow_event(
    'request.status_changed', 'insurance_request', p_request_id,
    jsonb_build_object('from', v_from, 'to', p_to_status, 'comment', p_comment),
    case p_to_status
      when 'entity_resolution'  then 'sales'::tci.user_role
      when 'underwriting'       then 'credit_underwriter'::tci.user_role
      when 'commercial_review'  then 'commercial_underwriter'::tci.user_role
      when 'sales_confirmation' then 'sales'::tci.user_role
      when 'client_review'      then 'client'::tci.user_role
      else null
    end
  );

  return v_request;
end;
$$;

revoke execute on function tci.advance_insurance_request(uuid, tci.insurance_request_status, text)
  from public, anon;
grant execute on function tci.advance_insurance_request(uuid, tci.insurance_request_status, text)
  to authenticated, service_role;

-- Resolve a package buyer onto a legal entity (creating the company is a
-- separate, ordinary insert through the registry - dedup rules apply there).
create function tci.resolve_request_buyer(p_buyer_row_id uuid, p_entity_id uuid)
returns tci.insurance_request_buyers
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row tci.insurance_request_buyers%rowtype;
begin
  if not tci.has_role('admin', 'sales', 'information_manager', 'credit_underwriter') then
    raise exception 'not allowed to resolve submission buyers' using errcode = 'P0004';
  end if;

  update tci.insurance_request_buyers
     set entity_id = p_entity_id, resolution_status = 'ready'
   where id = p_buyer_row_id
   returning * into v_row;
  if not found then
    raise exception 'package buyer % not found or not accessible', p_buyer_row_id
      using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'request.buyer_resolved', 'insurance_request', v_row.request_id,
    jsonb_build_object('buyer_row_id', v_row.id, 'entity_id', p_entity_id),
    'credit_underwriter'::tci.user_role
  );
  return v_row;
end;
$$;

revoke execute on function tci.resolve_request_buyer(uuid, uuid) from public, anon;
grant execute on function tci.resolve_request_buyer(uuid, uuid) to authenticated, service_role;
