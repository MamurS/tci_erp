-- 0067_information_gathering.sql
--
-- What: limit requests are ROUTED before anyone decides them (Prompt 29 §2).
--       A submitted request whose buyer lacks the minimum information — a
--       registration number, an address, an industry, and financial
--       statements for a period ending within the last N months
--       (workflow_settings.information_statement_max_age_months, default 18)
--       — moves to the new status 'information_gathering' instead of waiting
--       in the credit queue, and the information desk gets
--       'limit_information_needed' in its Agenda. When the data is complete
--       (a statement saved, the company card filled in) the request goes on
--       by itself: back to 'submitted', and the ordinary
--       'limit.request_submitted' signal opens the credit task and lets an
--       auto decision try. Credit underwriting may waive the gathering with a
--       reason (never on its own request); the waiver is a row of its own.
--       Withdrawing a request now emits 'limit.request_withdrawn', which
--       closes its open limit tasks.
-- Why:  a credit decision on a buyer we know nothing current about is the
--       decision the routing exists to prevent; the credit desk should start
--       from a complete file, and the gaps are the information manager's
--       work, not the underwriter's.
--
-- The Agenda type it adds (0066 adds the enum value):
--
--   limit_information_needed  information_manager  high  AUTO on
--                             limit.information_complete / _waived (done)
--                             or limit.request_withdrawn (cancelled)
--
-- The routing is decided in ONE place, the 'limit.request_submitted' event,
-- whichever path submitted the request (the staff form, the client portal, a
-- resolved buyer proposal): a trigger on tci.workflow_events named to fire
-- after the Agenda mapping (it cancels the decision task that mapping just
-- opened) and before the auto decision trigger (which then finds the request
-- no longer 'submitted' and does nothing). No cron: release is driven by the
-- data changes themselves, by «Проверить снова», or by the waiver.

-- ---------------------------------------------------------------------------
-- 1. Settings, the waiver record, the gaps
-- ---------------------------------------------------------------------------

alter table tci.workflow_settings
  add column information_statement_max_age_months integer not null default 18
    constraint workflow_settings_information_age_check
    check (information_statement_max_age_months between 1 and 60);

comment on column tci.workflow_settings.information_statement_max_age_months is
  'A buyer''s latest financial statement must end within this many months for a limit request to go to credit underwriting without information gathering (0067).';

create table tci.limit_information_waivers (
  request_id  uuid primary key references tci.credit_limit_requests (id),
  waived_by   uuid not null,
  waived_at   timestamptz not null default now(),
  comment     text not null check (length(btrim(comment)) between 1 and 2000),
  gaps        text[] not null
);

comment on table tci.limit_information_waivers is
  'Credit underwriting chose to decide a limit request without the information gathering asked for (0067). One row per request, written only by tci.waive_limit_information, never changed.';

alter table tci.limit_information_waivers enable row level security;
create policy "limit_information_waivers: staff read" on tci.limit_information_waivers
  for select to authenticated using (tci.is_staff());
revoke all on table tci.limit_information_waivers from public, anon, authenticated;
grant select on table tci.limit_information_waivers to authenticated;
grant select, insert on table tci.limit_information_waivers to service_role;

-- What is missing for a buyer, in a fixed order. Empty = enough to decide on.
create function tci.buyer_information_gaps(p_entity_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select array_remove(array[
           case when nullif(btrim(e.registration_number), '') is null then 'registration_number' end,
           case when nullif(btrim(e.address), '') is null then 'address' end,
           case when e.industry_id is null then 'industry' end,
           case when st.latest is null then 'no_statements'
                when st.latest < current_date - make_interval(months => coalesce(
                       (select s.information_statement_max_age_months from tci.workflow_settings s where s.id), 18))
                then 'stale_statements' end
         ]::text[], null)
    from tci.legal_entities e
    left join lateral (
      select max(fs.period_end_date) as latest
        from tci.financial_statements fs
       where fs.entity_id = e.id
    ) st on true
   where e.id = p_entity_id
$$;

comment on function tci.buyer_information_gaps(uuid) is
  'The information a buyer still lacks before a limit request on it goes to credit underwriting (0067): registration_number, address, industry, no_statements, stale_statements — in that order; empty when complete. Mirrored by src/features/limits/information.ts.';

-- ---------------------------------------------------------------------------
-- 2. Release: back to the credit queue once the gaps are closed
-- ---------------------------------------------------------------------------

create function tci.release_limit_information(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request tci.credit_limit_requests%rowtype;
begin
  perform tci.require_internal_call();
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found or v_request.status <> 'information_gathering' then
    return false;
  end if;
  if coalesce(cardinality(tci.buyer_information_gaps(v_request.entity_id)), 0) > 0 then
    return false;
  end if;

  update tci.credit_limit_requests set status = 'submitted' where id = p_request_id;
  perform tci.emit_workflow_event(
    'limit.information_complete', 'credit_limit_request', p_request_id,
    jsonb_build_object('entity_id', v_request.entity_id), 'credit_underwriter'::tci.user_role);
  -- The ordinary signal: the decision task opens, an auto decision may try.
  perform tci.emit_workflow_event(
    'limit.request_submitted', 'credit_limit_request', p_request_id,
    jsonb_build_object('entity_id', v_request.entity_id, 'amount', v_request.requested_amount,
                       'currency', v_request.currency_code, 'after_information', true),
    'credit_underwriter'::tci.user_role);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The routing, on the event
-- ---------------------------------------------------------------------------

create function tci.handle_information_routing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request tci.credit_limit_requests%rowtype;
  v_gaps    text[];
  v_name    text;
begin
  if new.event_type not in ('limit.request_submitted', 'limit.information_needed',
                            'limit.information_complete', 'limit.information_waived',
                            'limit.request_withdrawn') then
    return null;
  end if;
  perform tci.begin_trusted_call();

  if new.event_type = 'limit.request_submitted' then
    select * into v_request from tci.credit_limit_requests where id = new.object_id for update;
    if not found or v_request.status <> 'submitted' then
      return null;
    end if;
    if exists (select 1 from tci.limit_information_waivers w where w.request_id = v_request.id) then
      return null;
    end if;
    v_gaps := tci.buyer_information_gaps(v_request.entity_id);
    if coalesce(cardinality(v_gaps), 0) = 0 then
      return null;
    end if;
    update tci.credit_limit_requests set status = 'information_gathering' where id = v_request.id;
    -- The Agenda mapping opened the decision task a moment ago; nobody can
    -- decide yet, so it goes.
    perform tci.close_tasks(array['limit_needs_decision']::tci.task_type[], v_request.id, 'cancelled');
    select e.name into v_name from tci.legal_entities e where e.id = v_request.entity_id;
    perform tci.emit_workflow_event(
      'limit.information_needed', 'credit_limit_request', v_request.id,
      jsonb_build_object('entity_id', v_request.entity_id, 'entity_name', v_name,
                         'gaps', to_jsonb(v_gaps), 'amount', v_request.requested_amount,
                         'currency', v_request.currency_code),
      'information_manager'::tci.user_role);

  elsif new.event_type = 'limit.information_needed' then
    perform tci.open_task(
      'limit_information_needed', 'credit_limit_request', new.object_id,
      'agenda.tasks.limit_information_needed',
      jsonb_build_object('entity_id', new.payload -> 'entity_id', 'entity_name', new.payload -> 'entity_name',
                         'gaps', new.payload -> 'gaps', 'amount', new.payload -> 'amount',
                         'currency', new.payload -> 'currency'),
      'information_manager'::tci.user_role, null, null, 'high', new.id);

  elsif new.event_type in ('limit.information_complete', 'limit.information_waived') then
    perform tci.close_tasks(array['limit_information_needed']::tci.task_type[], new.object_id, 'done');

  elsif new.event_type = 'limit.request_withdrawn' then
    perform tci.close_tasks(
      array['limit_information_needed', 'limit_needs_decision', 'limit_escalated']::tci.task_type[],
      new.object_id, 'cancelled');
  end if;
  return null;
end;
$$;

create trigger workflow_events_zy_information_routing
  after insert on tci.workflow_events
  for each row execute function tci.handle_information_routing();

-- The data itself releases the request: a statement saved, the card filled in.
create function tci.handle_information_data_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity uuid;
  r record;
begin
  -- Two statements, not one CASE: a row of tci.legal_entities has no
  -- entity_id field, and PL/pgSQL would refuse the expression that names it.
  if tg_table_name = 'legal_entities' then
    v_entity := new.id;
  else
    v_entity := new.entity_id;
  end if;
  if not exists (select 1 from tci.credit_limit_requests c
                  where c.entity_id = v_entity and c.status = 'information_gathering') then
    return null;
  end if;
  perform tci.begin_trusted_call();
  for r in select c.id from tci.credit_limit_requests c
            where c.entity_id = v_entity and c.status = 'information_gathering'
  loop
    perform tci.release_limit_information(r.id);
  end loop;
  return null;
end;
$$;

create trigger financial_statements_release_information
  after insert or update on tci.financial_statements
  for each row execute function tci.handle_information_data_change();
create trigger legal_entities_release_information
  after update on tci.legal_entities
  for each row execute function tci.handle_information_data_change();

-- ---------------------------------------------------------------------------
-- 4. «Проверить снова» and the waiver
-- ---------------------------------------------------------------------------

create function tci.recheck_limit_information(p_request_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request tci.credit_limit_requests%rowtype;
begin
  perform tci.require_staff();
  select * into v_request from tci.credit_limit_requests where id = p_request_id;
  if not found then
    raise exception 'limit request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_request.status <> 'information_gathering' then
    raise exception 'limit_not_gathering_information: the request is %', v_request.status using errcode = 'P0001';
  end if;
  perform tci.begin_trusted_call();
  perform tci.release_limit_information(p_request_id);
  return tci.buyer_information_gaps(v_request.entity_id);
end;
$$;

comment on function tci.recheck_limit_information(uuid) is
  'Staff: re-test a request in information gathering; releases it when nothing is missing and answers what is still missing (empty = released). 0067.';

create function tci.waive_limit_information(p_request_id uuid, p_comment text)
returns tci.credit_limit_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request tci.credit_limit_requests%rowtype;
  v_refusal text;
begin
  perform tci.require_role('credit_underwriter');
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found', p_request_id using errcode = 'P0002';
  end if;
  v_refusal := tci.limit_four_eyes_refusal(p_request_id, (select auth.uid()), 'credit');
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;
  if v_request.status <> 'information_gathering' then
    raise exception 'limit_not_gathering_information: the request is %', v_request.status using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_comment, '')), '') is null then
    raise exception 'information_waiver_comment_required: say why the decision may go ahead without it'
      using errcode = 'P0001';
  end if;

  perform tci.begin_trusted_call();
  insert into tci.limit_information_waivers (request_id, waived_by, comment, gaps)
  values (p_request_id, (select auth.uid()), btrim(p_comment),
          coalesce(tci.buyer_information_gaps(v_request.entity_id), '{}'));
  update tci.credit_limit_requests set status = 'submitted' where id = p_request_id
  returning * into v_request;
  perform tci.emit_workflow_event(
    'limit.information_waived', 'credit_limit_request', p_request_id,
    jsonb_build_object('entity_id', v_request.entity_id, 'comment', btrim(p_comment)),
    'credit_underwriter'::tci.user_role);
  perform tci.emit_workflow_event(
    'limit.request_submitted', 'credit_limit_request', p_request_id,
    jsonb_build_object('entity_id', v_request.entity_id, 'amount', v_request.requested_amount,
                       'currency', v_request.currency_code, 'information_waived', true),
    'credit_underwriter'::tci.user_role);
  return v_request;
end;
$$;

comment on function tci.waive_limit_information(uuid, text) is
  'Credit underwriting: send a request in information gathering on to the credit queue without the missing information, with a reason; never on one''s own request (four eyes). The waiver is recorded in tci.limit_information_waivers. 0067.';

-- ---------------------------------------------------------------------------
-- 5. 'information_gathering' is an OPEN status everywhere the open ones are named
-- ---------------------------------------------------------------------------

drop index tci.credit_limit_requests_open_uq;
create unique index credit_limit_requests_open_uq
  on tci.credit_limit_requests (tci.limit_scope(policy_id, insurance_request_id), entity_id)
  where status in ('draft', 'submitted', 'information_gathering', 'under_review', 'escalated');

CREATE OR REPLACE FUNCTION tci.client_request_limit(p_policy_id uuid, p_entity_id uuid, p_proposed_name text, p_registration_number text, p_country_code character, p_amount numeric, p_currency character, p_payment_terms_days integer, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy tci.policies%rowtype;
  v_request tci.credit_limit_requests%rowtype;
  v_proposal tci.client_buyer_proposals%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('client') then
    raise exception 'only a portal user may raise a limit request this way'
      using errcode = '42501';
  end if;

  select * into v_policy from tci.policies where id = p_policy_id;
  if not found or v_policy.entity_id not in (select tci.my_client_entities()) then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  -- Same rule the staff path enforces in tci.submit_limit_request.
  if v_policy.status <> 'active' then
    raise exception 'limits can only be requested under an active policy (this one is %)',
      v_policy.status using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'a limit request needs a positive amount' using errcode = 'P0001';
  end if;
  if coalesce(p_currency, '') = '' then
    raise exception 'a limit request needs a currency' using errcode = 'P0001';
  end if;

  -- Path 1: a company we already know.
  if p_entity_id is not null then
    if not exists (select 1 from tci.legal_entities where id = p_entity_id) then
      raise exception 'company not found' using errcode = 'P0002';
    end if;
    if exists (
      select 1 from tci.credit_limit_requests r
       where tci.limit_scope(r.policy_id, r.insurance_request_id) = p_policy_id
         and r.entity_id = p_entity_id
         and r.status in ('draft', 'submitted', 'information_gathering', 'under_review', 'escalated')
    ) then
      raise exception 'there is already an open limit request for this buyer'
        using errcode = 'P0001';
    end if;

    insert into tci.credit_limit_requests (
      policy_id, entity_id, requested_amount, currency_code,
      requested_payment_terms_days, justification, status, submitted_at
    ) values (
      p_policy_id, p_entity_id, p_amount, p_currency,
      p_payment_terms_days, p_justification, 'submitted', now()
    ) returning * into v_request;

    -- The same event the staff path emits, so the Agenda opens the same task
    -- for the same people. The portal does not get a private workflow.
    perform tci.emit_workflow_event(
      'limit.request_submitted', 'credit_limit_request', v_request.id,
      jsonb_build_object(
        'entity_id', v_request.entity_id,
        'amount', v_request.requested_amount,
        'currency', v_request.currency_code,
        'from_client', true),
      'credit_underwriter'::tci.user_role);

    return jsonb_build_object('kind', 'request', 'id', v_request.id);
  end if;

  -- Path 2: a company we do not have.
  if coalesce(btrim(p_proposed_name), '') = '' then
    raise exception 'name the buyer, or pick one from the registry'
      using errcode = 'P0001';
  end if;

  insert into tci.client_buyer_proposals (
    policy_id, proposed_name, proposed_registration_number, proposed_country_code,
    requested_amount, currency_code, requested_payment_terms_days, justification
  ) values (
    p_policy_id, btrim(p_proposed_name), nullif(btrim(coalesce(p_registration_number,'')), ''),
    p_country_code, p_amount, p_currency, p_payment_terms_days, p_justification
  ) returning * into v_proposal;

  perform tci.emit_workflow_event(
    'client.buyer_proposed', 'client_buyer_proposal', v_proposal.id,
    jsonb_build_object(
      'name', v_proposal.proposed_name,
      'registration_number', v_proposal.proposed_registration_number,
      'policy_id', v_proposal.policy_id),
    'information_manager'::tci.user_role);

  return jsonb_build_object('kind', 'proposal', 'id', v_proposal.id);
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.resolve_buyer_proposal(p_proposal_id uuid, p_entity_id uuid DEFAULT NULL::uuid, p_new_name text DEFAULT NULL::text, p_new_country character DEFAULT NULL::bpchar, p_new_registration_number text DEFAULT NULL::text, p_new_legal_form text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_proposal tci.client_buyer_proposals%rowtype;
  v_entity_id uuid;
  v_request tci.credit_limit_requests%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('information_manager', 'sales', 'credit_underwriter') then
    raise exception 'not allowed to resolve buyer proposals' using errcode = '42501';
  end if;

  select * into v_proposal from tci.client_buyer_proposals
   where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id using errcode = 'P0002';
  end if;
  if v_proposal.status <> 'pending_entity' then
    raise exception 'this proposal is already %', v_proposal.status using errcode = 'P0001';
  end if;

  if p_entity_id is not null then
    v_entity_id := p_entity_id;
    if not exists (select 1 from tci.legal_entities where id = v_entity_id) then
      raise exception 'company not found' using errcode = 'P0002';
    end if;
  else
    if coalesce(btrim(coalesce(p_new_name, '')), '') = '' then
      raise exception 'either pick a company or give the new one a name'
        using errcode = 'P0001';
    end if;
    insert into tci.legal_entities (name, country_code, registration_number, legal_form)
    values (btrim(p_new_name),
            coalesce(p_new_country, v_proposal.proposed_country_code, 'UZ'),
            nullif(btrim(coalesce(p_new_registration_number,
                                  v_proposal.proposed_registration_number, '')), ''),
            p_new_legal_form)
    returning id into v_entity_id;
  end if;

  if exists (
    select 1 from tci.credit_limit_requests r
     where tci.limit_scope(r.policy_id, r.insurance_request_id) = v_proposal.policy_id
       and r.entity_id = v_entity_id
       and r.status in ('draft', 'submitted', 'information_gathering', 'under_review', 'escalated')
  ) then
    raise exception 'there is already an open limit request for this buyer on that policy'
      using errcode = 'P0001';
  end if;

  insert into tci.credit_limit_requests (
    policy_id, entity_id, requested_amount, currency_code,
    requested_payment_terms_days, justification, status, submitted_at
  ) values (
    v_proposal.policy_id, v_entity_id, v_proposal.requested_amount,
    v_proposal.currency_code, v_proposal.requested_payment_terms_days,
    v_proposal.justification, 'submitted', now()
  ) returning * into v_request;

  update tci.client_buyer_proposals
     set status = 'resolved',
         resolved_entity_id = v_entity_id,
         resolved_request_id = v_request.id,
         resolved_by = (select auth.uid()),
         resolved_at = now()
   where id = p_proposal_id;

  -- Closes the information manager's task...
  perform tci.emit_workflow_event(
    'client.buyer_proposal_resolved', 'client_buyer_proposal', p_proposal_id,
    jsonb_build_object('entity_id', v_entity_id, 'request_id', v_request.id),
    'credit_underwriter'::tci.user_role);
  -- ...and opens credit underwriting's, exactly as any other request would.
  perform tci.emit_workflow_event(
    'limit.request_submitted', 'credit_limit_request', v_request.id,
    jsonb_build_object(
      'entity_id', v_entity_id,
      'amount', v_request.requested_amount,
      'currency', v_request.currency_code,
      'from_proposal', p_proposal_id),
    'credit_underwriter'::tci.user_role);

  return jsonb_build_object('entity_id', v_entity_id, 'request_id', v_request.id);
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.withdraw_limit_request(p_request_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS tci.credit_limit_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request tci.credit_limit_requests%rowtype;
begin
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status not in ('draft', 'submitted', 'information_gathering', 'under_review', 'escalated') then
    raise exception 'request is already % and cannot be withdrawn', v_request.status
      using errcode = 'P0001';
  end if;

  -- The requester, or anyone who may decide (credit underwriting).
  if not (v_request.requested_by = (select auth.uid())
          or tci.has_role('credit_underwriter')) then
    raise exception 'only the requester or credit underwriting may withdraw'
      using errcode = '42501';
  end if;

  update tci.credit_limit_requests
     set status = 'withdrawn', withdrawn_at = now(), withdraw_comment = p_comment
   where id = p_request_id
   returning * into v_request;
  -- 0067: the withdrawal is an event, so the request's open limit tasks close.
  perform tci.begin_internal_call();
  perform tci.emit_workflow_event(
    'limit.request_withdrawn', 'credit_limit_request', p_request_id,
    jsonb_build_object('entity_id', v_request.entity_id), null);
  return v_request;
end;
$function$
;

-- The views that name the open statuses (each keeps security_invoker).

create or replace view tci.v_data_freshness with (security_invoker = true) as
 WITH live AS (
         SELECT r.entity_id
           FROM tci.credit_limit_requests r
          WHERE (r.status = ANY (ARRAY['draft'::tci.limit_request_status, 'submitted'::tci.limit_request_status, 'information_gathering'::tci.limit_request_status, 'under_review'::tci.limit_request_status, 'escalated'::tci.limit_request_status]))
        UNION
         SELECT v.entity_id
           FROM tci.v_effective_limits v
          WHERE (v.outcome = ANY (ARRAY['approved'::tci.decision_outcome, 'partial'::tci.decision_outcome]))
        UNION
         SELECT ib.entity_id
           FROM (tci.insurance_request_buyers ib
             JOIN tci.insurance_requests ir ON ((ir.id = ib.request_id)))
          WHERE ((ib.entity_id IS NOT NULL) AND (ir.status <> ALL (ARRAY['draft'::tci.insurance_request_status, 'declined'::tci.insurance_request_status, 'withdrawn'::tci.insurance_request_status, 'bound'::tci.insurance_request_status])))
        UNION
         SELECT p.entity_id
           FROM tci.policies p
          WHERE (p.status = ANY (ARRAY['active'::tci.policy_status, 'suspended'::tci.policy_status]))
        ), facts AS (
         SELECT e.id AS entity_id,
            e.name,
            e.country_code,
            (e.registration_number IS NULL) AS missing_registration,
            (NULLIF(btrim(e.address), ''::text) IS NULL) AS missing_address,
            (e.industry_id IS NULL) AS missing_industry,
            st.statements_count,
            st.latest_period_end,
            st.latest_entered_at,
            (EXISTS ( SELECT 1
                   FROM tci.policies p
                  WHERE (p.entity_id = e.id))) AS is_policyholder,
            (EXISTS ( SELECT 1
                   FROM tci.credit_limit_requests r
                  WHERE (r.entity_id = e.id))) AS is_buyer,
            ( SELECT r.id
                   FROM tci.entity_requests r
                  WHERE ((r.entity_id = e.id) AND (r.kind = 'statements_update'::tci.entity_request_kind) AND (r.status = ANY (ARRAY['new'::tci.entity_request_status, 'in_progress'::tci.entity_request_status])))
                 LIMIT 1) AS open_request_id
           FROM ((live l
             JOIN tci.legal_entities e ON ((e.id = l.entity_id)))
             LEFT JOIN LATERAL ( SELECT (count(*))::integer AS statements_count,
                    max(fs.period_end_date) AS latest_period_end,
                    max(fs.created_at) AS latest_entered_at
                   FROM tci.financial_statements fs
                  WHERE (fs.entity_id = e.id)) st ON (true))
        )
 SELECT entity_id,
    name,
    country_code,
    missing_registration,
    missing_address,
    missing_industry,
    statements_count,
    latest_period_end,
    latest_entered_at,
    is_policyholder,
    is_buyer,
    open_request_id,
        CASE
            WHEN (statements_count = 0) THEN 'no_statements'::text
            WHEN (latest_period_end < (CURRENT_DATE - '1 year 3 mons'::interval)) THEN 'stale_statements'::text
            WHEN (missing_registration OR missing_address OR missing_industry) THEN 'missing_registry'::text
            ELSE NULL::text
        END AS reason
   FROM facts f
  WHERE ((statements_count = 0) OR (latest_period_end < (CURRENT_DATE - '1 year 3 mons'::interval)) OR missing_registration OR missing_address OR missing_industry);

create or replace view tci.v_rating_worklist with (security_invoker = true) as
 WITH live AS (
         SELECT r.entity_id
           FROM tci.credit_limit_requests r
          WHERE (r.status = ANY (ARRAY['draft'::tci.limit_request_status, 'submitted'::tci.limit_request_status, 'information_gathering'::tci.limit_request_status, 'under_review'::tci.limit_request_status, 'escalated'::tci.limit_request_status]))
        UNION
         SELECT v.entity_id
           FROM tci.v_effective_limits v
          WHERE (v.outcome = ANY (ARRAY['approved'::tci.decision_outcome, 'partial'::tci.decision_outcome]))
        UNION
         SELECT ib.entity_id
           FROM (tci.insurance_request_buyers ib
             JOIN tci.insurance_requests ir ON ((ir.id = ib.request_id)))
          WHERE ((ib.entity_id IS NOT NULL) AND (ir.status <> ALL (ARRAY['draft'::tci.insurance_request_status, 'declined'::tci.insurance_request_status, 'withdrawn'::tci.insurance_request_status, 'bound'::tci.insurance_request_status])))
        ), facts AS (
         SELECT e.id AS entity_id,
            e.name AS buyer_name,
            e.country_code AS buyer_country,
            a.id AS assessment_id,
            a.rating_grade AS grade,
            a.created_at AS rated_at,
            rs.period_end_date AS rated_period_end,
            st.statements_count,
            st.latest_period_end,
            st.latest_fiscal_year,
            (( SELECT count(*) AS count
                   FROM tci.credit_limit_requests r
                  WHERE ((r.entity_id = e.id) AND (r.status = ANY (ARRAY['submitted'::tci.limit_request_status, 'information_gathering'::tci.limit_request_status, 'under_review'::tci.limit_request_status, 'escalated'::tci.limit_request_status])))))::integer AS open_requests,
            (( SELECT count(*) AS count
                   FROM tci.v_effective_limits v
                  WHERE ((v.entity_id = e.id) AND (v.outcome = ANY (ARRAY['approved'::tci.decision_outcome, 'partial'::tci.decision_outcome])))))::integer AS limits_in_force
           FROM ((((live l
             JOIN tci.legal_entities e ON ((e.id = l.entity_id)))
             LEFT JOIN LATERAL ( SELECT ca.id,
                    ca.rating_grade,
                    ca.created_at,
                    ca.statement_id
                   FROM tci.credit_assessments ca
                  WHERE (ca.entity_id = e.id)
                  ORDER BY ca.created_at DESC
                 LIMIT 1) a ON (true))
             LEFT JOIN tci.financial_statements rs ON ((rs.id = a.statement_id)))
             LEFT JOIN LATERAL ( SELECT (count(*))::integer AS statements_count,
                    max(fs.period_end_date) AS latest_period_end,
                    max(fs.fiscal_year) AS latest_fiscal_year
                   FROM tci.financial_statements fs
                  WHERE (fs.entity_id = e.id)) st ON (true))
        )
 SELECT entity_id,
    buyer_name,
    buyer_country,
    assessment_id,
    grade,
    rated_at,
    rated_period_end,
    statements_count,
    latest_period_end,
    latest_fiscal_year,
    open_requests,
    limits_in_force,
    tci.grade_band_for_assessment(assessment_id) AS band,
        CASE
            WHEN ((assessment_id IS NULL) AND (statements_count = 0)) THEN 'no_statements'::text
            WHEN (assessment_id IS NULL) THEN 'no_rating'::text
            WHEN (latest_period_end > rated_period_end) THEN 'new_statement'::text
            WHEN (rated_at <= (now() - '1 year'::interval)) THEN 'stale'::text
            ELSE NULL::text
        END AS reason
   FROM facts f
  WHERE ((assessment_id IS NULL) OR (latest_period_end > rated_period_end) OR (rated_at <= (now() - '1 year'::interval)));

create or replace view tci.v_limit_request_queue with (security_invoker = true) as
 SELECT r.id AS request_id,
    r.status,
    r.entity_id AS buyer_entity_id,
    b.name AS buyer_name,
    b.country_code AS buyer_country,
    r.policy_id,
    r.insurance_request_id,
    r.requested_amount,
    r.currency_code,
    r.submitted_at,
    a.id AS assessment_id,
    a.rating_grade AS grade,
    tci.grade_band_for_assessment(a.id) AS band,
    (r.requested_amount * tci.latest_uzs_rate(r.currency_code)) AS amount_uzs,
    (tci.latest_uzs_rate(r.currency_code) IS NULL) AS rate_missing,
    COALESCE(auth_.authority_uzs, (0)::numeric) AS my_authority_uzs,
    ((tci.latest_uzs_rate(r.currency_code) IS NOT NULL) AND ((r.requested_amount * tci.latest_uzs_rate(r.currency_code)) <= COALESCE(auth_.authority_uzs, (0)::numeric))) AS decide_alone,
    (r.requested_by = ( SELECT auth.uid() AS uid)) AS own_request,
        CASE
            WHEN (r.status = 'information_gathering'::tci.limit_request_status) THEN tci.buyer_information_gaps(r.entity_id)
            ELSE NULL::text[]
        END AS information_gaps
   FROM (((tci.credit_limit_requests r
     JOIN tci.legal_entities b ON ((b.id = r.entity_id)))
     LEFT JOIN LATERAL ( SELECT ca.id,
            ca.rating_grade
           FROM tci.credit_assessments ca
          WHERE (ca.entity_id = r.entity_id)
          ORDER BY ca.created_at DESC
         LIMIT 1) a ON (true))
     LEFT JOIN LATERAL ( SELECT max((g.max_amount * tci.latest_uzs_rate(g.currency_code))) AS authority_uzs
           FROM tci.authority_grants g
          WHERE ((g.user_id = ( SELECT auth.uid() AS uid)) AND (g.applies_to = 'credit'::tci.authority_scope) AND (g.grade_band = tci.grade_band_for_assessment(a.id)) AND (g.valid_from <= CURRENT_DATE) AND ((g.valid_to IS NULL) OR (g.valid_to >= CURRENT_DATE)))) auth_ ON (true))
  WHERE (r.status = ANY (ARRAY['submitted'::tci.limit_request_status, 'information_gathering'::tci.limit_request_status, 'under_review'::tci.limit_request_status, 'escalated'::tci.limit_request_status]));

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

revoke all on function tci.buyer_information_gaps(uuid) from public, anon;
grant execute on function tci.buyer_information_gaps(uuid) to authenticated, service_role;
revoke all on function tci.release_limit_information(uuid) from public, anon, authenticated;
revoke all on function tci.handle_information_routing() from public, anon, authenticated;
revoke all on function tci.handle_information_data_change() from public, anon, authenticated;
revoke all on function tci.recheck_limit_information(uuid) from public, anon;
grant execute on function tci.recheck_limit_information(uuid) to authenticated, service_role;
revoke all on function tci.waive_limit_information(uuid, text) from public, anon;
grant execute on function tci.waive_limit_information(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  if (select pg_get_indexdef('tci.credit_limit_requests_open_uq'::regclass)) not like '%information_gathering%' then
    raise exception '0067: the one-open-request index does not count information gathering as open';
  end if;

  -- The routing fires after the Agenda mapping and before the auto decision.
  if not ('workflow_events_to_validation_tasks' < 'workflow_events_zy_information_routing'
          and 'workflow_events_zy_information_routing' < 'workflow_events_zz_auto_decisions'
          and exists (select 1 from pg_trigger where tgname = 'workflow_events_zz_auto_decisions')
          and exists (select 1 from pg_trigger where tgname = 'workflow_events_to_tasks')) then
    raise exception '0067: the routing trigger is not ordered between the Agenda mapping and the auto decision';
  end if;

  for v_name in select unnest(array['client_request_limit', 'resolve_buyer_proposal', 'withdraw_limit_request']) loop
    if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'tci' and p.proname = v_name) not like '%''information_gathering''%' then
      raise exception '0067: % does not treat information gathering as open', v_name;
    end if;
  end loop;

  for v_name in select unnest(array['v_data_freshness', 'v_rating_worklist', 'v_limit_request_queue']) loop
    if not coalesce((select 'security_invoker=true' = any (c.reloptions) from pg_class c
                      where c.oid = ('tci.' || v_name)::regclass), false) then
      raise exception '0067: % lost security_invoker', v_name;
    end if;
    if pg_get_viewdef(('tci.' || v_name)::regclass) not like '%information_gathering%' then
      raise exception '0067: % does not show information gathering', v_name;
    end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid = 'tci.limit_information_waivers'::regclass) then
    raise exception '0067: RLS is not enabled on tci.limit_information_waivers';
  end if;
  if has_table_privilege('authenticated', 'tci.limit_information_waivers', 'insert')
     or has_table_privilege('authenticated', 'tci.limit_information_waivers', 'update')
     or has_table_privilege('authenticated', 'tci.limit_information_waivers', 'delete') then
    raise exception '0067: an API role can write a waiver directly';
  end if;
  if has_function_privilege('authenticated', 'tci.release_limit_information(uuid)', 'execute')
     or has_function_privilege('anon', 'tci.waive_limit_information(uuid, text)', 'execute')
     or has_function_privilege('anon', 'tci.recheck_limit_information(uuid)', 'execute') then
    raise exception '0067: the release is reachable through the API, or anon reaches the routing';
  end if;
end;
$$;
