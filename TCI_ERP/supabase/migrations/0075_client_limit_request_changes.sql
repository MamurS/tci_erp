-- 0075_client_limit_request_changes.sql
--
-- What: the policyholder may change or withdraw a credit limit request from
--       the portal.
--         * WITHDRAW (tci.client_withdraw_limit_request): any open request —
--           submitted, information gathering, under review, on validation —
--           and any buyer proposal still being identified. Pending
--           validation steps of a withdrawn request are cancelled at once,
--           with their tasks, whichever path withdrew it (staff or portal).
--         * AMEND (tci.client_amend_limit_request): amount, payment terms and
--           justification, but ONLY before underwriting has it — a request
--           'submitted' or in 'information_gathering', or a proposal still
--           'pending_entity'. The change is a row of
--           tci.limit_request_amendments (who, when, from, to; never changed),
--           and an amended request is SUBMITTED AGAIN: its open tasks are
--           cancelled and 'limit.request_submitted' is emitted, so the band-
--           aware decision task, the information routing and the auto
--           decision all run on the new amount.
--         * REPLACE (tci.client_replace_limit_request): once underwriting has
--           it ('under_review', 'escalated'), a change is a withdrawal and a
--           new request in ONE transaction — nothing is withdrawn unless the
--           new request goes. The new request names the one it replaces
--           (replaces_request_id) and carries the change as an amendment of
--           kind 'replaced'.
--       credit_limit_requests gains withdrawn_by / withdrawn_via, written by
--       a trigger on 'limit.request_withdrawn' from the event's actor.
-- Why:  the request is the policyholder's; pulling one back or correcting an
--       amount should not need a phone call. But the amount drives the band,
--       the authority, the validation level and the auto decision, so it never
--       changes under an underwriter's hands: once taken, a change is a new
--       request the desk sees arrive, and the old one is closed.

-- ---------------------------------------------------------------------------
-- 1. Columns, the proposal's new status, the amendment record
-- ---------------------------------------------------------------------------

alter table tci.credit_limit_requests
  add column withdrawn_by uuid references auth.users (id),
  add column withdrawn_via text
    constraint credit_limit_requests_withdrawn_via_check check (withdrawn_via in ('staff', 'portal')),
  add column replaces_request_id uuid references tci.credit_limit_requests (id);

comment on column tci.credit_limit_requests.withdrawn_by is
  'Who withdrew the request (0075): the actor of its limit.request_withdrawn event.';
comment on column tci.credit_limit_requests.withdrawn_via is
  'Where the withdrawal came from (0075): the policyholder''s portal or a staff screen.';
comment on column tci.credit_limit_requests.replaces_request_id is
  'The request the policyholder withdrew to send this one instead (0075, tci.client_replace_limit_request).';

alter table tci.client_buyer_proposals
  add column withdraw_comment text;

alter table tci.client_buyer_proposals
  drop constraint client_buyer_proposals_status_check,
  add constraint client_buyer_proposals_status_check
    check (status in ('pending_entity', 'resolved', 'rejected', 'withdrawn')),
  drop constraint proposal_resolution_recorded,
  add constraint proposal_resolution_recorded check (
    (status = 'pending_entity' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null and resolved_entity_id is not null)
    or (status in ('rejected', 'withdrawn') and resolved_at is not null)
  );

create table tci.limit_request_amendments (
  id                     uuid primary key default gen_random_uuid(),
  request_id             uuid references tci.credit_limit_requests (id),
  proposal_id            uuid references tci.client_buyer_proposals (id),
  kind                   text not null default 'amended'
    constraint limit_request_amendments_kind_check check (kind in ('amended', 'replaced')),
  -- The request a 'replaced' row stands for (withdrawn in the same transaction).
  replaced_request_id    uuid references tci.credit_limit_requests (id),
  amended_by             uuid not null references auth.users (id),
  amended_at             timestamptz not null default now(),
  -- The status the request or proposal was in when it changed.
  status_at              text not null,
  currency_code          char(3) not null references tci.currencies (code),
  from_amount            numeric(18,2) not null,
  to_amount              numeric(18,2) not null check (to_amount > 0),
  from_payment_terms_days integer,
  to_payment_terms_days  integer check (to_payment_terms_days >= 0),
  from_justification     text,
  to_justification       text,
  constraint limit_request_amendments_subject check (num_nonnulls(request_id, proposal_id) = 1),
  constraint limit_request_amendments_replaced check ((kind = 'replaced') = (replaced_request_id is not null))
);

comment on table tci.limit_request_amendments is
  'A policyholder''s change to a limit request or a buyer proposal before underwriting took it, or the change carried by a replacing request (0075). Written only by the client_* functions, never changed.';

create index limit_request_amendments_request_idx on tci.limit_request_amendments (request_id) where request_id is not null;
create index limit_request_amendments_proposal_idx on tci.limit_request_amendments (proposal_id) where proposal_id is not null;

alter table tci.limit_request_amendments enable row level security;
create policy "limit_request_amendments: staff read" on tci.limit_request_amendments
  for select to authenticated using (tci.is_staff());
grant select on tci.limit_request_amendments to authenticated;
grant select, insert on tci.limit_request_amendments to service_role;

create function tci.guard_limit_request_amendment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a limit request amendment is never changed' using errcode = '42501';
end;
$$;

create trigger limit_request_amendments_immutable
  before update or delete on tci.limit_request_amendments
  for each row execute function tci.guard_limit_request_amendment();

-- ---------------------------------------------------------------------------
-- 2. A withdrawal, whichever path: who, from where, and the validation steps
-- ---------------------------------------------------------------------------
-- A request withdrawn while on validation left its step pending until a
-- validator answered (0060/0071 cancel it lazily then), so the validators'
-- tasks stayed open for a request nobody wanted any more. The step is moot
-- the moment the request is withdrawn; it is cancelled here, its tasks with it.

create function tci.handle_limit_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step   tci.limit_validations%rowtype;
  v_author uuid;
begin
  if new.event_type <> 'limit.request_withdrawn' then
    return null;
  end if;
  perform tci.begin_trusted_call();

  update tci.credit_limit_requests
     set withdrawn_by = new.actor,
         withdrawn_via = case when new.payload ->> 'via' = 'portal' then 'portal' else 'staff' end
   where id = new.object_id;

  for v_step in
    select * from tci.limit_validations v
     where v.request_id = new.object_id and v.status = 'pending'
  loop
    update tci.limit_validations
       set status = 'cancelled', resolved_by = new.actor, resolved_at = now()
     where id = v_step.id;
    select proposed_by into v_author from tci.limit_validations where id = v_step.chain_id;
    perform tci.emit_validation_resolved(v_step, 'cancelled', null, null, v_author);
  end loop;
  return null;
end;
$$;

create trigger workflow_events_zx_limit_withdrawal
  after insert on tci.workflow_events
  for each row execute function tci.handle_limit_withdrawal();

-- ---------------------------------------------------------------------------
-- 3. The portal's three actions
-- ---------------------------------------------------------------------------

-- Open = what a policyholder may withdraw; before underwriting = what they
-- may still amend. src/features/portal/requestChanges.ts mirrors both.
create function tci.client_request_open(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('submitted', 'information_gathering', 'under_review', 'escalated', 'pending_entity')
$$;

create function tci.client_request_amendable(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('submitted', 'information_gathering', 'pending_entity')
$$;

create function tci.client_withdraw_limit_request(p_id uuid, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_proposal tci.client_buyer_proposals%rowtype;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = '42501';
  end if;

  select r.* into v_request
    from tci.credit_limit_requests r join tci.policies p on p.id = r.policy_id
   where r.id = p_id and p.entity_id in (select tci.my_client_entities())
     for update of r;
  if found then
    if not tci.client_request_open(v_request.status::text) then
      raise exception 'limit_request_not_open: this request is already %', v_request.status
        using errcode = 'P0001';
    end if;
    update tci.credit_limit_requests
       set status = 'withdrawn', withdrawn_at = now(), withdraw_comment = v_comment
     where id = v_request.id;
    -- Closes the request's limit tasks (0067) and cancels a pending validation
    -- step (section 2).
    perform tci.emit_workflow_event(
      'limit.request_withdrawn', 'credit_limit_request', v_request.id,
      jsonb_build_object('entity_id', v_request.entity_id, 'via', 'portal', 'comment', v_comment), null);
    return jsonb_build_object('kind', 'request', 'id', v_request.id, 'status', 'withdrawn');
  end if;

  select pr.* into v_proposal
    from tci.client_buyer_proposals pr join tci.policies p on p.id = pr.policy_id
   where pr.id = p_id and p.entity_id in (select tci.my_client_entities())
     for update of pr;
  if not found then
    raise exception 'limit request not found' using errcode = 'P0002';
  end if;
  if not tci.client_request_open(v_proposal.status) then
    raise exception 'limit_request_not_open: this request is already %', v_proposal.status
      using errcode = 'P0001';
  end if;
  update tci.client_buyer_proposals
     set status = 'withdrawn', withdraw_comment = v_comment,
         resolved_by = (select auth.uid()), resolved_at = now()
   where id = v_proposal.id;
  perform tci.close_tasks(array['buyer_needs_entity']::tci.task_type[], v_proposal.id, 'cancelled');
  perform tci.emit_workflow_event(
    'client.buyer_proposal_withdrawn', 'client_buyer_proposal', v_proposal.id,
    jsonb_build_object('name', v_proposal.proposed_name, 'comment', v_comment), null);
  return jsonb_build_object('kind', 'proposal', 'id', v_proposal.id, 'status', 'withdrawn');
end;
$$;

create function tci.client_amend_limit_request(
  p_id                 uuid,
  p_amount             numeric,
  p_payment_terms_days integer,
  p_justification      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_proposal tci.client_buyer_proposals%rowtype;
  v_just     text := nullif(btrim(coalesce(p_justification, '')), '');
  v_status   text;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amendment_amount_invalid: a limit request needs a positive amount' using errcode = 'P0001';
  end if;
  if p_payment_terms_days is not null and p_payment_terms_days < 0 then
    raise exception 'amendment_terms_invalid: payment terms cannot be negative' using errcode = 'P0001';
  end if;

  select r.* into v_request
    from tci.credit_limit_requests r join tci.policies p on p.id = r.policy_id
   where r.id = p_id and p.entity_id in (select tci.my_client_entities())
     for update of r;
  if found then
    if not tci.client_request_open(v_request.status::text) then
      raise exception 'limit_request_not_open: this request is already %', v_request.status
        using errcode = 'P0001';
    end if;
    if not tci.client_request_amendable(v_request.status::text) then
      raise exception 'limit_request_in_review: underwriting has this request; withdraw it and request again'
        using errcode = 'P0001';
    end if;
    if (p_amount, p_payment_terms_days, v_just)
       is not distinct from (v_request.requested_amount, v_request.requested_payment_terms_days, v_request.justification) then
      raise exception 'amendment_unchanged: nothing was changed' using errcode = 'P0001';
    end if;

    insert into tci.limit_request_amendments (
      request_id, amended_by, status_at, currency_code, from_amount, to_amount,
      from_payment_terms_days, to_payment_terms_days, from_justification, to_justification
    ) values (
      v_request.id, (select auth.uid()), v_request.status::text, v_request.currency_code,
      v_request.requested_amount, p_amount, v_request.requested_payment_terms_days,
      p_payment_terms_days, v_request.justification, v_just
    );
    update tci.credit_limit_requests
       set requested_amount = p_amount, requested_payment_terms_days = p_payment_terms_days,
           justification = v_just, status = 'submitted'
     where id = v_request.id;

    -- Submitted again: the old amount's tasks go, and the ordinary signal
    -- opens the decision task for the underwriters whose authority covers the
    -- NEW amount, routes to information gathering if the buyer still lacks
    -- data (0067), and lets an auto decision try (0061).
    perform tci.close_tasks(
      array['limit_needs_decision', 'limit_information_needed', 'limit_escalated']::tci.task_type[],
      v_request.id, 'cancelled');
    perform tci.emit_workflow_event(
      'limit.request_amended', 'credit_limit_request', v_request.id,
      jsonb_build_object('entity_id', v_request.entity_id, 'currency', v_request.currency_code,
                         'from_amount', v_request.requested_amount, 'to_amount', p_amount,
                         'from_terms', v_request.requested_payment_terms_days, 'to_terms', p_payment_terms_days),
      null);
    perform tci.emit_workflow_event(
      'limit.request_submitted', 'credit_limit_request', v_request.id,
      jsonb_build_object('entity_id', v_request.entity_id, 'amount', p_amount,
                         'currency', v_request.currency_code, 'from_client', true, 'amended', true),
      'credit_underwriter'::tci.user_role);

    select status::text into v_status from tci.credit_limit_requests where id = v_request.id;
    return jsonb_build_object('kind', 'request', 'id', v_request.id, 'status', v_status);
  end if;

  select pr.* into v_proposal
    from tci.client_buyer_proposals pr join tci.policies p on p.id = pr.policy_id
   where pr.id = p_id and p.entity_id in (select tci.my_client_entities())
     for update of pr;
  if not found then
    raise exception 'limit request not found' using errcode = 'P0002';
  end if;
  if not tci.client_request_open(v_proposal.status) then
    raise exception 'limit_request_not_open: this request is already %', v_proposal.status
      using errcode = 'P0001';
  end if;
  if (p_amount, p_payment_terms_days, v_just)
     is not distinct from (v_proposal.requested_amount, v_proposal.requested_payment_terms_days, v_proposal.justification) then
    raise exception 'amendment_unchanged: nothing was changed' using errcode = 'P0001';
  end if;

  insert into tci.limit_request_amendments (
    proposal_id, amended_by, status_at, currency_code, from_amount, to_amount,
    from_payment_terms_days, to_payment_terms_days, from_justification, to_justification
  ) values (
    v_proposal.id, (select auth.uid()), v_proposal.status, v_proposal.currency_code,
    v_proposal.requested_amount, p_amount, v_proposal.requested_payment_terms_days,
    p_payment_terms_days, v_proposal.justification, v_just
  );
  -- The proposal carries no amount anyone acts on yet: resolving it copies
  -- whatever it says then (tci.resolve_buyer_proposal).
  update tci.client_buyer_proposals
     set requested_amount = p_amount, requested_payment_terms_days = p_payment_terms_days,
         justification = v_just
   where id = v_proposal.id;
  perform tci.emit_workflow_event(
    'client.buyer_proposal_amended', 'client_buyer_proposal', v_proposal.id,
    jsonb_build_object('from_amount', v_proposal.requested_amount, 'to_amount', p_amount,
                       'currency', v_proposal.currency_code),
    null);
  return jsonb_build_object('kind', 'proposal', 'id', v_proposal.id, 'status', v_proposal.status);
end;
$$;

create function tci.client_replace_limit_request(
  p_id                 uuid,
  p_amount             numeric,
  p_payment_terms_days integer,
  p_justification      text,
  p_comment            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old  tci.credit_limit_requests%rowtype;
  v_just text := nullif(btrim(coalesce(p_justification, '')), '');
  v_new  jsonb;
  v_id   uuid;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = '42501';
  end if;

  select r.* into v_old
    from tci.credit_limit_requests r join tci.policies p on p.id = r.policy_id
   where r.id = p_id and p.entity_id in (select tci.my_client_entities())
     for update of r;
  if not found then
    raise exception 'limit request not found' using errcode = 'P0002';
  end if;
  if not tci.client_request_open(v_old.status::text) then
    raise exception 'limit_request_not_open: this request is already %', v_old.status
      using errcode = 'P0001';
  end if;
  if (p_amount, p_payment_terms_days, v_just)
     is not distinct from (v_old.requested_amount, v_old.requested_payment_terms_days, v_old.justification) then
    raise exception 'amendment_unchanged: nothing was changed' using errcode = 'P0001';
  end if;

  -- One transaction: if the new request is refused (the policy is no longer
  -- active, the amount is invalid), the old one is not withdrawn either.
  perform tci.client_withdraw_limit_request(p_id, p_comment);
  v_new := tci.client_request_limit(
    v_old.policy_id, v_old.entity_id, null, null, null,
    p_amount, v_old.currency_code, p_payment_terms_days, v_just);
  v_id := (v_new ->> 'id')::uuid;

  update tci.credit_limit_requests set replaces_request_id = v_old.id where id = v_id;
  insert into tci.limit_request_amendments (
    request_id, kind, replaced_request_id, amended_by, status_at, currency_code,
    from_amount, to_amount, from_payment_terms_days, to_payment_terms_days,
    from_justification, to_justification
  ) values (
    v_id, 'replaced', v_old.id, (select auth.uid()), v_old.status::text, v_old.currency_code,
    v_old.requested_amount, p_amount, v_old.requested_payment_terms_days, p_payment_terms_days,
    v_old.justification, v_just
  );

  return jsonb_build_object('kind', 'request', 'id', v_id, 'replaced', v_old.id,
    'status', (select status::text from tci.credit_limit_requests where id = v_id));
end;
$$;

-- Staff read the changes of a request, its proposal's included (a proposal
-- amended before it was identified becomes this request). Invoker: RLS on
-- the amendments is the gate.
create function tci.limit_request_changes(p_request_id uuid)
returns setof tci.limit_request_amendments
language sql
stable
set search_path = ''
as $$
  select a.* from tci.limit_request_amendments a
   where a.request_id = p_request_id
      or a.proposal_id in (select pr.id from tci.client_buyer_proposals pr
                            where pr.resolved_request_id = p_request_id)
   order by a.amended_at, a.id
$$;

-- ---------------------------------------------------------------------------
-- 4. What the portal reads: may it still change, may it withdraw
-- ---------------------------------------------------------------------------

create or replace view tci.v_client_limit_requests as
 select r.id,
    'request'::text as kind,
    r.policy_id,
    p.policy_number,
    r.entity_id as buyer_id,
    b.name as buyer_name,
    null::text as proposed_name,
    r.requested_amount,
    r.currency_code,
    r.requested_payment_terms_days,
    r.justification,
    r.status::text as status,
    r.created_at,
    r.decided_at,
    tci.client_request_amendable(r.status::text) as may_amend,
    tci.client_request_open(r.status::text) as may_withdraw,
    (select max(a.amended_at) from tci.limit_request_amendments a where a.request_id = r.id) as amended_at,
    r.replaces_request_id
   from tci.credit_limit_requests r
     join tci.policies p on p.id = r.policy_id
     join tci.legal_entities b on b.id = r.entity_id
  where p.entity_id in (select tci.my_client_entities())
union all
 select pr.id,
    'proposal'::text as kind,
    pr.policy_id,
    p.policy_number,
    pr.resolved_entity_id as buyer_id,
    null::text as buyer_name,
    pr.proposed_name,
    pr.requested_amount,
    pr.currency_code,
    pr.requested_payment_terms_days,
    pr.justification,
    pr.status,
    pr.created_at,
    pr.resolved_at as decided_at,
    tci.client_request_amendable(pr.status) as may_amend,
    tci.client_request_open(pr.status) as may_withdraw,
    (select max(a.amended_at) from tci.limit_request_amendments a where a.proposal_id = pr.id) as amended_at,
    null::uuid as replaces_request_id
   from tci.client_buyer_proposals pr
     join tci.policies p on p.id = pr.policy_id
  where p.entity_id in (select tci.my_client_entities());

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke all on function tci.guard_limit_request_amendment() from public, anon, authenticated;
revoke all on function tci.handle_limit_withdrawal() from public, anon, authenticated;
revoke all on function tci.client_request_open(text) from public, anon;
revoke all on function tci.client_request_amendable(text) from public, anon;
grant execute on function tci.client_request_open(text), tci.client_request_amendable(text)
  to authenticated, service_role;

revoke all on function tci.client_withdraw_limit_request(uuid, text) from public, anon;
revoke all on function tci.client_amend_limit_request(uuid, numeric, integer, text) from public, anon;
revoke all on function tci.client_replace_limit_request(uuid, numeric, integer, text, text) from public, anon;
revoke all on function tci.limit_request_changes(uuid) from public, anon;
grant execute on function
  tci.client_withdraw_limit_request(uuid, text),
  tci.client_amend_limit_request(uuid, numeric, integer, text),
  tci.client_replace_limit_request(uuid, numeric, integer, text, text),
  tci.limit_request_changes(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'tci' and table_name = 'limit_request_amendments'
                and grantee in ('authenticated', 'anon') and privilege_type <> 'SELECT') then
    raise exception '0075: an API role may write tci.limit_request_amendments';
  end if;
  if has_function_privilege('anon', 'tci.client_withdraw_limit_request(uuid, text)', 'execute')
     or has_function_privilege('anon', 'tci.client_amend_limit_request(uuid, numeric, integer, text)', 'execute')
     or has_function_privilege('anon', 'tci.client_replace_limit_request(uuid, numeric, integer, text, text)', 'execute') then
    raise exception '0075: anon may execute a client_* request function';
  end if;
  -- The view still carries no internal column.
  if exists (select 1 from information_schema.columns
              where table_schema = 'tci' and table_name = 'v_client_limit_requests'
                and column_name in ('requested_by', 'withdrawn_by', 'withdraw_comment', 'resolved_by', 'reject_reason')) then
    raise exception '0075: v_client_limit_requests exposes an internal column';
  end if;
  if not tci.client_request_amendable('submitted') or tci.client_request_amendable('under_review')
     or not tci.client_request_open('escalated') or tci.client_request_open('decided') then
    raise exception '0075: the open / amendable predicates are wrong';
  end if;
end;
$$;
