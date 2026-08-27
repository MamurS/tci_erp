-- 0025_client_portal.sql
-- What: the client portal's data layer - narrow SECURITY DEFINER views that
--       expose only what a policyholder may see, SECURITY DEFINER functions
--       for the three things a client may DO, a table for buyer proposals,
--       and the removal of the base-table client policies those replace.
-- Why:  Phase 3d. The client role, the policyholder_users mapping and the
--       release rules all existed; what did not exist was a surface a client
--       could safely be pointed at.
--
-- The audit that drove this (every table a client could reach before today):
--
--   policies, credit_limit_requests, credit_limit_decisions,
--   decision_conditions, insurance_requests, insurance_request_buyers,
--   insurance_request_history, policyholder_users, user_profiles, user_roles,
--   countries, currencies, industries
--
-- Four of those were wrong, and all four for the same reason: a row policy
-- decides WHICH ROWS, never WHICH COLUMNS, and staff and clients share the
-- `authenticated` database role, so a column grant cannot separate them.
--
--   1. decision_conditions had NO release check at all, so the conditions
--      attached to a HELD decision were readable by the client the hold was
--      meant to hide it from.
--   2. decision_conditions joined policies with an INNER join, so conditions
--      on a pre-bind (submission-scoped) decision were invisible - the
--      mirror-image bug, introduced when 0023 made policy_id nullable.
--   3. insurance_request_history exposes `comment`, which is staff-written
--      free text about the client's own submission.
--   4. credit_limit_decisions exposes `comment`, `hold_comment`, `decided_by`
--      and `based_on_assessment_id` - the underwriter's reasoning and the
--      existence of an internal rating.
--
-- So the shape here is: DROP the client SELECT policies, and give the portal
-- SECURITY DEFINER views that carry their own has_role('client') +
-- policyholder_users gate and select only safe columns. A client reading a
-- base table directly now gets nothing at all, which is a much easier
-- property to keep true than "every column of every table is safe".
--
-- The same reasoning removes the client UPDATE policy on insurance_requests:
-- it constrained the STATUS but not the columns, so a raw PATCH could have
-- rewritten premium_rate_pct while the submission sat in client_review.
-- Accepting or returning a submission now goes through a function that only
-- ever touches the status.

-- ---------------------------------------------------------------------------
-- 1. Buyer proposals
-- ---------------------------------------------------------------------------

-- A client asking for a limit on a company we do not have in the registry.
--
-- Why a table of its own rather than a nullable credit_limit_requests.entity_id:
-- that column is NOT NULL and load-bearing in the open-request unique index,
-- v_effective_limits and v_buyer_exposure. Making it nullable would repeat the
-- whole of 0023 for a much smaller payoff, and would put half-identified rows
-- into the table the exposure figures are computed from. A proposal is a
-- different thing from a limit request: it is a request to IDENTIFY a company,
-- and it becomes a limit request once someone has.
--
-- A client never inserts into tci.legal_entities. The registry is staff-owned;
-- this is the queue that feeds it.
create table tci.client_buyer_proposals (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references tci.policies (id) on delete cascade,
  -- What the client typed.
  proposed_name text not null,
  proposed_registration_number text,
  proposed_country_code char(2) references tci.countries (code),
  -- What they want once it exists.
  requested_amount numeric(18,2) not null check (requested_amount > 0),
  currency_code char(3) not null references tci.currencies (code),
  requested_payment_terms_days integer check (requested_payment_terms_days >= 0),
  justification text,
  -- Filled in by whoever resolves it.
  status text not null default 'pending_entity'
    check (status in ('pending_entity', 'resolved', 'rejected')),
  resolved_entity_id uuid references tci.legal_entities (id),
  resolved_request_id uuid references tci.credit_limit_requests (id),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  reject_reason text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  constraint proposal_resolution_recorded check (
    (status = 'pending_entity' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null and resolved_entity_id is not null)
    or (status = 'rejected' and resolved_at is not null)
  )
);

comment on table tci.client_buyer_proposals is
  'A client asking for a limit on a company not yet in the registry. Resolving one creates the company and raises the real limit request; a client never writes tci.legal_entities.';

create index client_buyer_proposals_open_idx
  on tci.client_buyer_proposals (policy_id) where status = 'pending_entity';
create index client_buyer_proposals_created_idx
  on tci.client_buyer_proposals (created_at desc);

alter table tci.client_buyer_proposals enable row level security;

create policy "buyer_proposals: staff read"
  on tci.client_buyer_proposals for select to authenticated
  using (tci.is_staff());

-- Resolution goes through tci.resolve_buyer_proposal; this covers the
-- information manager editing a proposal in place if they ever need to.
create policy "buyer_proposals: resolver writes"
  on tci.client_buyer_proposals for update to authenticated
  using (tci.has_role('admin', 'information_manager', 'sales', 'credit_underwriter'))
  with check (tci.has_role('admin', 'information_manager', 'sales', 'credit_underwriter'));

-- Deliberately NO client policy: the client reads its proposals through
-- tci.v_client_limit_requests and writes them through
-- tci.client_request_limit, both of which are SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- 2. The gate every client-facing view shares
-- ---------------------------------------------------------------------------

-- The entities the caller is a portal user of. SECURITY DEFINER because the
-- views below are, and because a client may only ever read its OWN mapping
-- row; this returns exactly that set and nothing else.
create function tci.my_client_entities()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pu.entity_id
    from tci.policyholder_users pu
   where pu.user_id = (select auth.uid())
     and tci.has_role('client')
$$;

comment on function tci.my_client_entities() is
  'The companies the calling CLIENT user represents. Empty for staff - the portal views are for the portal.';

revoke execute on function tci.my_client_entities() from public, anon;
grant execute on function tci.my_client_entities() to authenticated, service_role;

-- When a client may see the proposed terms of its own submission. Before the
-- submission reaches the client the terms are a working draft between
-- commercial underwriting and sales; showing a rate that has not been agreed
-- would be worse than showing nothing. Immutable so the views can inline it.
create function tci.submission_terms_visible(p_status tci.insurance_request_status)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_status in ('client_review', 'accepted', 'declined', 'bound')
$$;

comment on function tci.submission_terms_visible(tci.insurance_request_status) is
  'True once a submission has reached the client. Mirrored by machine.ts so the portal and the database agree on when terms appear.';

revoke execute on function tci.submission_terms_visible(tci.insurance_request_status) from public, anon;
grant execute on function tci.submission_terms_visible(tci.insurance_request_status) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Client-facing views
-- ---------------------------------------------------------------------------
-- Every one of these is SECURITY DEFINER (the default for a view whose owner
-- is postgres and which is not marked security_invoker) and carries its own
-- gate, exactly like tci.v_admin_users does. They exist so that the set of
-- columns a client can see is written down in one place and can be read at a
-- glance, instead of being an emergent property of thirteen row policies.

-- 3a. My policies -----------------------------------------------------------
-- The wording terms the client is insured under. No internal columns exist on
-- tci.policies, so this is the whole row minus the audit trail.
create view tci.v_client_policies as
select
  p.id,
  p.entity_id,
  e.name              as entity_name,
  p.policy_number,
  p.status,
  p.product_structure,
  p.inception_date,
  p.expiry_date,
  p.currency_code,
  p.insured_percentage,
  p.max_liability_amount,
  p.max_liability_premium_multiple,
  p.nql_amount,
  p.deductible_each_loss,
  p.aggregate_first_loss,
  p.premium_rate_pct,
  p.minimum_premium,
  p.estimated_annual_turnover,
  p.discretionary_limit,
  p.waiting_period_days,
  p.max_extension_period_days,
  p.max_payment_terms_days,
  p.declaration_frequency
from tci.policies p
join tci.legal_entities e on e.id = p.entity_id
where p.entity_id in (select tci.my_client_entities());

-- 3b. My credit limits ------------------------------------------------------
-- The effective, RELEASED limit per buyer. Deliberately absent: `comment`
-- (the underwriter's reasoning), `hold_comment`, `decided_by`,
-- `based_on_assessment_id` and everything about the rating that produced it.
--
-- A held decision is invisible here because tci.decision_is_released is false
-- for it, and because the supersede chain means the client keeps seeing the
-- PREVIOUS effective decision until the new one is released - which is the
-- whole point of the sales window.
create view tci.v_client_limits as
select
  d.id                as decision_id,
  r.id                as request_id,
  r.policy_id,
  p.policy_number,
  r.entity_id         as buyer_id,
  b.name              as buyer_name,
  b.country_code      as buyer_country_code,
  r.requested_amount,
  d.outcome,
  d.approved_amount,
  d.currency_code,
  d.valid_from,
  d.valid_until,
  d.payment_terms_days,
  d.decided_at,
  d.released_at,
  d.release_kind,
  (select count(*) from tci.decision_conditions c where c.decision_id = d.id)::int
                      as conditions_count
from tci.credit_limit_decisions d
join tci.credit_limit_requests r on r.id = d.request_id
join tci.policies p on p.id = r.policy_id
join tci.legal_entities b on b.id = r.entity_id
where d.lifecycle = 'effective'
  and (d.valid_until is null or d.valid_until >= current_date)
  and tci.decision_is_released(d.released_at, d.decided_at, d.held)
  and p.entity_id in (select tci.my_client_entities());

-- 3c. The conditions attached to those limits -------------------------------
-- Same release gate as the limit itself, which is what the dropped policy was
-- missing.
create view tci.v_client_limit_conditions as
select
  c.id,
  c.decision_id,
  c.condition_type,
  c.description
from tci.decision_conditions c
join tci.credit_limit_decisions d on d.id = c.decision_id
join tci.credit_limit_requests r on r.id = d.request_id
join tci.policies p on p.id = r.policy_id
where tci.decision_is_released(d.released_at, d.decided_at, d.held)
  and p.entity_id in (select tci.my_client_entities());

-- 3d. What a limit used to be ----------------------------------------------
-- Superseded and expired decisions, so a client can see how a limit moved.
-- Only ever decisions that WERE released: a held decision that was superseded
-- before its window elapsed never became visible and does not become visible
-- retrospectively.
create view tci.v_client_limit_history as
select
  d.id                as decision_id,
  r.policy_id,
  r.entity_id         as buyer_id,
  b.name              as buyer_name,
  d.outcome,
  d.approved_amount,
  d.currency_code,
  d.valid_from,
  d.valid_until,
  d.payment_terms_days,
  d.decided_at,
  d.released_at,
  d.lifecycle,
  d.lifecycle <> 'effective' as superseded
from tci.credit_limit_decisions d
join tci.credit_limit_requests r on r.id = d.request_id
join tci.policies p on p.id = r.policy_id
join tci.legal_entities b on b.id = r.entity_id
where d.released_at is not null
  and p.entity_id in (select tci.my_client_entities());

-- 3e. My limit requests, including the ones still being identified ----------
-- One list, two sources: real limit requests, and buyer proposals that have
-- not become one yet. The client asked for the same thing either way.
create view tci.v_client_limit_requests as
select
  r.id,
  'request'::text     as kind,
  r.policy_id,
  p.policy_number,
  r.entity_id         as buyer_id,
  b.name              as buyer_name,
  null::text          as proposed_name,
  r.requested_amount,
  r.currency_code,
  r.requested_payment_terms_days,
  r.justification,
  r.status::text      as status,
  r.created_at,
  r.decided_at
from tci.credit_limit_requests r
join tci.policies p on p.id = r.policy_id
join tci.legal_entities b on b.id = r.entity_id
where p.entity_id in (select tci.my_client_entities())
union all
select
  pr.id,
  'proposal'::text,
  pr.policy_id,
  p.policy_number,
  pr.resolved_entity_id,
  null::text,
  pr.proposed_name,
  pr.requested_amount,
  pr.currency_code,
  pr.requested_payment_terms_days,
  pr.justification,
  pr.status,
  pr.created_at,
  pr.resolved_at
from tci.client_buyer_proposals pr
join tci.policies p on p.id = pr.policy_id
where p.entity_id in (select tci.my_client_entities());

-- 3f. My submissions --------------------------------------------------------
-- The proposed terms are the point of the client_review step, so they are
-- exposed - but only from client_review onwards. Before that they are a
-- working draft between commercial underwriting and sales, and showing a
-- client a rate that has not been agreed yet would be worse than showing
-- nothing. `notes`, `decline_reason` beyond the client's own view, and the
-- assigned_* staff columns are not here at all.
create view tci.v_client_submissions as
select
  ir.id,
  ir.entity_id,
  e.name              as entity_name,
  ir.request_number,
  ir.status,
  ir.created_at,
  ir.submitted_at,
  ir.decided_at,
  ir.bound_policy_id,
  -- Terms: visible once the submission has reached the client.
  case when tci.submission_terms_visible(ir.status) then ir.product_structure end
                      as product_structure,
  case when tci.submission_terms_visible(ir.status) then ir.currency_code end
                      as currency_code,
  case when tci.submission_terms_visible(ir.status) then ir.insured_percentage end
                      as insured_percentage,
  case when tci.submission_terms_visible(ir.status) then ir.premium_rate_pct end
                      as premium_rate_pct,
  case when tci.submission_terms_visible(ir.status) then ir.minimum_premium end
                      as minimum_premium,
  case when tci.submission_terms_visible(ir.status) then ir.max_liability_amount end
                      as max_liability_amount,
  case when tci.submission_terms_visible(ir.status) then ir.max_liability_premium_multiple end
                      as max_liability_premium_multiple,
  case when tci.submission_terms_visible(ir.status) then ir.discretionary_limit end
                      as discretionary_limit,
  case when tci.submission_terms_visible(ir.status) then ir.nql_amount end
                      as nql_amount,
  case when tci.submission_terms_visible(ir.status) then ir.deductible_each_loss end
                      as deductible_each_loss,
  case when tci.submission_terms_visible(ir.status) then ir.aggregate_first_loss end
                      as aggregate_first_loss,
  case when tci.submission_terms_visible(ir.status) then ir.waiting_period_days end
                      as waiting_period_days,
  case when tci.submission_terms_visible(ir.status) then ir.max_extension_period_days end
                      as max_extension_period_days,
  case when tci.submission_terms_visible(ir.status) then ir.max_payment_terms_days end
                      as max_payment_terms_days,
  case when tci.submission_terms_visible(ir.status) then ir.declaration_frequency end
                      as declaration_frequency,
  case when tci.submission_terms_visible(ir.status) then ir.estimated_annual_turnover end
                      as estimated_annual_turnover
from tci.insurance_requests ir
join tci.legal_entities e on e.id = ir.entity_id
where ir.entity_id in (select tci.my_client_entities());

-- 3g. The buyer package on my submission ------------------------------------
create view tci.v_client_submission_buyers as
select
  b.id,
  b.request_id,
  b.entity_id,
  coalesce(e.name, b.proposed_name) as buyer_name,
  b.requested_amount,
  b.requested_payment_terms_days
from tci.insurance_request_buyers b
join tci.insurance_requests ir on ir.id = b.request_id
left join tci.legal_entities e on e.id = b.entity_id
where ir.entity_id in (select tci.my_client_entities());

-- 3h. How my submission moved ----------------------------------------------
-- Statuses and timestamps only. The `comment` column is staff-written free
-- text ("waiting on Navoi's 2025 accounts", "rate too thin, ask sales") and
-- is the single most likely place for something a client should not read.
create view tci.v_client_submission_history as
select
  h.id,
  h.request_id,
  h.from_status,
  h.to_status,
  h.changed_at
from tci.insurance_request_history h
join tci.insurance_requests ir on ir.id = h.request_id
where ir.entity_id in (select tci.my_client_entities());

-- ---------------------------------------------------------------------------
-- 4. Grants on the views
-- ---------------------------------------------------------------------------
-- Each view carries its own gate in the WHERE clause (my_client_entities()
-- returns nothing for a non-client), so granting SELECT to authenticated is
-- safe and is what makes them reachable through PostgREST.

grant select on tci.v_client_policies             to authenticated;
grant select on tci.v_client_limits               to authenticated;
grant select on tci.v_client_limit_conditions     to authenticated;
grant select on tci.v_client_limit_history        to authenticated;
grant select on tci.v_client_limit_requests       to authenticated;
grant select on tci.v_client_submissions          to authenticated;
grant select on tci.v_client_submission_buyers    to authenticated;
grant select on tci.v_client_submission_history   to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What a client may DO
-- ---------------------------------------------------------------------------

-- 5a. Find a buyer ----------------------------------------------------------
-- The buyer picker searches the shared registry, which a client cannot read
-- as a table. This is deliberately the narrowest possible window onto it:
--
--   * a minimum query length, so it cannot be used to enumerate the registry
--     one letter at a time;
--   * a hard row cap;
--   * four columns, none of which say anything about the company's rating,
--     financials, or whether it is one of our policyholders.
--
-- It still lets a client confirm that a company they can already name is
-- known to us. That is inherent to a buyer picker over a shared registry and
-- is the trade the owner asked for; it is called out in the phase report.
create function tci.client_search_entities(p_query text, p_limit int default 10)
returns table (id uuid, name text, country_code char(2), registration_number text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, e.country_code, e.registration_number
    from tci.legal_entities e
   where tci.has_role('client')
     and length(btrim(coalesce(p_query, ''))) >= 3
     and (
       e.name ilike '%' || btrim(p_query) || '%'
       or e.registration_number = btrim(p_query)
     )
   order by e.name
   limit least(greatest(coalesce(p_limit, 10), 1), 25)
$$;

comment on function tci.client_search_entities(text, int) is
  'Buyer picker for the portal: a narrow, capped window onto the registry. Never exposes rating, financials or entity role.';

revoke execute on function tci.client_search_entities(text, int) from public, anon;
grant execute on function tci.client_search_entities(text, int) to authenticated, service_role;

-- 5b. Ask for a limit -------------------------------------------------------
-- Two paths, one entry point. A known buyer becomes a real limit request,
-- submitted straight away; an unknown one becomes a proposal for an
-- information manager to identify. The client never writes legal_entities and
-- never chooses which path it is on beyond naming a company or picking one.
create function tci.client_request_limit(
  p_policy_id       uuid,
  p_entity_id       uuid,
  p_proposed_name   text,
  p_registration_number text,
  p_country_code    char(2),
  p_amount          numeric,
  p_currency        char(3),
  p_payment_terms_days int,
  p_justification   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy tci.policies%rowtype;
  v_request tci.credit_limit_requests%rowtype;
  v_proposal tci.client_buyer_proposals%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'only a portal user may raise a limit request this way'
      using errcode = 'P0004';
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
         and r.status in ('draft', 'submitted', 'under_review', 'escalated')
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
$$;

comment on function tci.client_request_limit(uuid, uuid, text, text, char, numeric, char, int, text) is
  'The portal''s single entry point for asking for a limit: a known buyer becomes a submitted limit request, an unknown one a buyer proposal for an information manager.';

revoke execute on function tci.client_request_limit(uuid, uuid, text, text, char, numeric, char, int, text) from public, anon;
grant execute on function tci.client_request_limit(uuid, uuid, text, text, char, numeric, char, int, text) to authenticated, service_role;

-- 5c. Answer a submission ---------------------------------------------------
-- Replaces the dropped UPDATE policy. Only the status is ever written, and
-- only from client_review.
create function tci.client_respond_to_submission(
  p_request_id uuid,
  p_action     text,
  p_comment    text default null
)
returns tci.insurance_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request tci.insurance_requests%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'only a portal user may answer a submission this way'
      using errcode = 'P0004';
  end if;

  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found or v_request.entity_id not in (select tci.my_client_entities()) then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'client_review' then
    raise exception 'this submission is not with you (it is %)', v_request.status
      using errcode = 'P0001';
  end if;

  if p_action = 'accept' then
    return tci.advance_insurance_request(p_request_id, 'accepted', null);

  elsif p_action = 'decline' then
    if coalesce(btrim(p_comment), '') = '' then
      raise exception 'a decline needs a reason' using errcode = 'P0001';
    end if;
    return tci.advance_insurance_request(p_request_id, 'declined', btrim(p_comment));

  elsif p_action = 'request_changes' then
    if coalesce(btrim(p_comment), '') = '' then
      raise exception 'say what should change' using errcode = 'P0001';
    end if;
    -- Back to sales, not a decline: the client still wants the cover, on
    -- different terms. The status machine gained this transition below.
    return tci.advance_insurance_request(p_request_id, 'sales_confirmation', btrim(p_comment));
  end if;

  raise exception 'unknown action %', p_action using errcode = 'P0001';
end;
$$;

comment on function tci.client_respond_to_submission(uuid, text, text) is
  'accept / decline / request_changes on a submission in client_review. The only way a client changes a submission, and it only ever writes the status.';

revoke execute on function tci.client_respond_to_submission(uuid, text, text) from public, anon;
grant execute on function tci.client_respond_to_submission(uuid, text, text) to authenticated, service_role;

-- 5d. Resolving a proposal (staff side) -------------------------------------
-- Either the company is already in the registry and the information manager
-- points at it, or they create it here. Either way the proposal becomes a
-- real, submitted limit request under the original policy, so from this point
-- on it is indistinguishable from one raised for a known buyer.
create function tci.resolve_buyer_proposal(
  p_proposal_id uuid,
  p_entity_id   uuid default null,
  p_new_name    text default null,
  p_new_country char(2) default null,
  p_new_registration_number text default null,
  p_new_legal_form text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_proposal tci.client_buyer_proposals%rowtype;
  v_entity_id uuid;
  v_request tci.credit_limit_requests%rowtype;
begin
  if not tci.has_role('admin', 'information_manager', 'sales', 'credit_underwriter') then
    raise exception 'not allowed to resolve buyer proposals' using errcode = 'P0004';
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
       and r.status in ('draft', 'submitted', 'under_review', 'escalated')
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
$$;

comment on function tci.resolve_buyer_proposal(uuid, uuid, text, char, text, text) is
  'Turns a client buyer proposal into a real limit request, creating the company if it is genuinely new. SECURITY INVOKER: the caller must be able to write tci.legal_entities in their own right.';

revoke execute on function tci.resolve_buyer_proposal(uuid, uuid, text, char, text, text) from public, anon;
grant execute on function tci.resolve_buyer_proposal(uuid, uuid, text, char, text, text) to authenticated, service_role;

create function tci.reject_buyer_proposal(p_proposal_id uuid, p_reason text)
returns tci.client_buyer_proposals
language plpgsql
security invoker
set search_path = ''
as $$
declare v_proposal tci.client_buyer_proposals%rowtype;
begin
  if not tci.has_role('admin', 'information_manager', 'sales', 'credit_underwriter') then
    raise exception 'not allowed to resolve buyer proposals' using errcode = 'P0004';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'a rejection needs a reason' using errcode = 'P0001';
  end if;

  update tci.client_buyer_proposals
     set status = 'rejected', reject_reason = btrim(p_reason),
         resolved_by = (select auth.uid()), resolved_at = now()
   where id = p_proposal_id and status = 'pending_entity'
   returning * into v_proposal;
  if not found then
    raise exception 'proposal % not found or already resolved', p_proposal_id
      using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'client.buyer_proposal_resolved', 'client_buyer_proposal', p_proposal_id,
    jsonb_build_object('rejected', true), null);

  return v_proposal;
end;
$$;

revoke execute on function tci.reject_buyer_proposal(uuid, text) from public, anon;
grant execute on function tci.reject_buyer_proposal(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Remove the base-table client policies these views replace
-- ---------------------------------------------------------------------------
-- After this, a client selecting from any of these tables directly gets zero
-- rows. Everything the portal needs comes from the views above.

drop policy "policies: client reads own"                on tci.policies;
drop policy "limit_requests: client reads own"          on tci.credit_limit_requests;
drop policy "limit_decisions: client reads own released" on tci.credit_limit_decisions;
drop policy "decision_conditions: client reads own"     on tci.decision_conditions;
drop policy "insurance_requests: client reads own"      on tci.insurance_requests;
drop policy "request_buyers: client reads own"          on tci.insurance_request_buyers;
drop policy "request_history: client reads own"         on tci.insurance_request_history;

-- The column-level hole: this permitted any UPDATE, not just the status.
drop policy "insurance_requests: client writes own while in its court"
  on tci.insurance_requests;

-- History rows are written by advance_insurance_request, which the client now
-- reaches only through a SECURITY DEFINER function, so the client arm of this
-- policy has nothing left to do.
drop policy "request_history: workflow append" on tci.insurance_request_history;
create policy "request_history: workflow append"
  on tci.insurance_request_history for insert to authenticated
  with check (tci.is_staff());

-- ---------------------------------------------------------------------------
-- 7. The status machine gains "back to sales"
-- ---------------------------------------------------------------------------
-- A client in client_review previously had two answers, yes and no. The
-- portal gives it a third that matches how this actually goes: the cover is
-- wanted, the terms are not. That returns the submission to sales_confirmation
-- with a comment, which re-opens sales' Agenda task through the existing
-- mapping - no new task type, no new queue.
--
-- Everything else in this function is the deployed body of 0019 unchanged.
-- The role gate for sales_confirmation had to learn the difference between
-- the two ways in: commercial underwriting finishing its review, and a client
-- handing the file back.
create or replace function tci.advance_insurance_request(
  p_request_id uuid,
  p_to_status tci.insurance_request_status,
  p_comment text default null
)
returns tci.insurance_requests
language plpgsql
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

  v_ok := case
    when v_from = 'draft'              and p_to_status in ('submitted', 'withdrawn') then true
    when v_from = 'submitted'          and p_to_status in ('entity_resolution', 'underwriting', 'withdrawn') then true
    when v_from = 'entity_resolution'  and p_to_status in ('underwriting', 'withdrawn') then true
    when v_from = 'underwriting'       and p_to_status in ('commercial_review', 'withdrawn') then true
    when v_from = 'commercial_review'  and p_to_status in ('sales_confirmation', 'withdrawn') then true
    when v_from = 'sales_confirmation' and p_to_status in ('client_review', 'withdrawn') then true
    -- NEW in 0025: the client can hand it back to sales instead of answering.
    when v_from = 'client_review'      and p_to_status in ('accepted', 'declined', 'sales_confirmation', 'withdrawn') then true
    when v_from = 'accepted'           and p_to_status = 'bound' then true
    else false
  end;
  if not v_ok then
    raise exception 'invalid insurance request transition: % -> %', v_from, p_to_status
      using errcode = 'P0001';
  end if;

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
    -- Two ways in, two different gates: commercial underwriting finishing the
    -- review, or the client returning the file for changes.
    if v_from = 'client_review' then
      if not tci.has_role('client', 'admin', 'sales') then
        raise exception 'only the client (or sales/admin on its behalf) may ask for changes'
          using errcode = 'P0004';
      end if;
      if coalesce(btrim(p_comment), '') = '' then
        raise exception 'say what should change' using errcode = 'P0001';
      end if;
    elsif not tci.has_role('admin', 'commercial_underwriter') then
      raise exception 'only commercial underwriting may finish the commercial review'
        using errcode = 'P0004';
    end if;
  elsif not tci.is_staff() then
    raise exception 'only staff may move a submission' using errcode = 'P0004';
  end if;

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

-- ---------------------------------------------------------------------------
-- 8. The Agenda picks up buyer proposals
-- ---------------------------------------------------------------------------
-- No new task type: `buyer_needs_entity` already means "somebody must identify
-- this company" and already targets information_manager. A proposal is the
-- same job arriving from a different door, so it reuses the type with its own
-- object_type. src/features/agenda/catalogue.ts routes it accordingly.
--
-- Everything else in this function is the deployed body of 0024 unchanged.
create or replace function tci.handle_workflow_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer     tci.insurance_request_buyers%rowtype;
  v_request   tci.insurance_requests%rowtype;
  v_decision  tci.credit_limit_decisions%rowtype;
  v_limit_req tci.credit_limit_requests%rowtype;
  v_entity_id uuid;
  v_targeted  boolean := false;
  v_user      uuid;
  v_band      tci.grade_band;
  v_due       timestamptz;
  v_from      text;
  v_to        text;
begin
  case new.event_type

  -- A buyer entered the package by name: somebody must identify the company.
  when 'request.buyer_added' then
    select * into v_buyer from tci.insurance_request_buyers
     where id = (new.payload->>'buyer_row_id')::uuid;
    if found and v_buyer.entity_id is null then
      select * into v_request from tci.insurance_requests where id = new.object_id;
      perform tci.open_task(
        'buyer_needs_entity', 'insurance_request', new.object_id,
        'agenda.tasks.buyer_needs_entity',
        -- request_number so the Agenda row reads as a whole sentence without
        -- a second lookup: information_manager may not see the submission.
        jsonb_build_object('buyer_row_id', v_buyer.id, 'name', v_buyer.proposed_name,
                           'request_number', v_request.request_number),
        'information_manager'::tci.user_role, null, null, 'high', new.id);
    end if;

  -- NEW in 0025: the same job, arriving from the portal instead.
  when 'client.buyer_proposed' then
    perform tci.open_task(
      'buyer_needs_entity', 'client_buyer_proposal', new.object_id,
      'agenda.tasks.buyer_proposed',
      jsonb_build_object(
        'name', new.payload->>'name',
        'registration_number', new.payload->>'registration_number'),
      'information_manager'::tci.user_role, null, null, 'high', new.id);

  when 'client.buyer_proposal_resolved' then
    perform tci.close_tasks(array['buyer_needs_entity']::tci.task_type[], new.object_id);

  -- Identified: that task is done, and the buyer may now need a rating.
  when 'request.buyer_resolved' then
    perform tci.close_tasks(array['buyer_needs_entity']::tci.task_type[], new.object_id);
    v_entity_id := (new.payload->>'entity_id')::uuid;
    if v_entity_id is not null and not exists (
      select 1 from tci.credit_assessments a
       where a.entity_id = v_entity_id
         and a.created_at > now() - interval '12 months'
    ) then
      perform tci.open_task(
        'buyer_needs_rating', 'legal_entity', v_entity_id,
        'agenda.tasks.buyer_needs_rating',
        jsonb_build_object('entity_id', v_entity_id, 'request_id', new.object_id),
        'credit_underwriter'::tci.user_role, null, null, 'normal', new.id);
    end if;

  -- A rating arrived: both rating tasks for that company are answered.
  when 'rating.created' then
    v_entity_id := (new.payload->>'entity_id')::uuid;
    perform tci.close_tasks(
      array['buyer_needs_rating', 'rating_stale']::tci.task_type[], v_entity_id);

  -- A decision is owed. Band-aware: address the underwriters who can actually
  -- take it, and fall back to the department when that cannot be resolved.
  when 'limit.request_submitted', 'limit.request_escalated' then
    select * into v_limit_req from tci.credit_limit_requests where id = new.object_id;
    v_band := coalesce((new.payload->>'grade_band')::tci.grade_band, 'unrated');
    for v_user in
      select * from tci.underwriters_covering(
        v_band, v_limit_req.requested_amount, v_limit_req.currency_code)
    loop
      v_targeted := true;
      perform tci.open_task(
        case when new.event_type = 'limit.request_escalated'
             then 'limit_escalated' else 'limit_needs_decision' end::tci.task_type,
        'credit_limit_request', new.object_id,
        case when new.event_type = 'limit.request_escalated'
             then 'agenda.tasks.limit_escalated' else 'agenda.tasks.limit_needs_decision' end,
        new.payload, null, v_user, null,
        case when new.event_type = 'limit.request_escalated'
             then 'urgent' else 'normal' end::tci.task_priority, new.id);
    end loop;
    if not v_targeted then
      perform tci.open_task(
        case when new.event_type = 'limit.request_escalated'
             then 'limit_escalated' else 'limit_needs_decision' end::tci.task_type,
        'credit_limit_request', new.object_id,
        case when new.event_type = 'limit.request_escalated'
             then 'agenda.tasks.limit_escalated' else 'agenda.tasks.limit_needs_decision' end,
        new.payload, 'credit_underwriter'::tci.user_role, null, null,
        case when new.event_type = 'limit.request_escalated'
             then 'urgent' else 'normal' end::tci.task_priority, new.id);
    end if;

  -- Decided: every task on that request is answered, however it was targeted.
  when 'limit.credit_decided' then
    select * into v_decision from tci.credit_limit_decisions where id = new.object_id;
    if found then
      perform tci.close_tasks(
        array['limit_needs_decision', 'limit_escalated']::tci.task_type[],
        v_decision.request_id);
      -- A fresh decision also retires any review task on the superseded one.
      select * into v_limit_req from tci.credit_limit_requests where id = v_decision.request_id;
      perform tci.close_tasks(
        array['limit_review_due']::tci.task_type[], v_limit_req.entity_id, 'cancelled');
    end if;

  -- Sales put a decision on hold: the decider has to answer it.
  when 'limit.held' then
    select * into v_decision from tci.credit_limit_decisions where id = new.object_id;
    if found then
      perform tci.open_task(
        'limit_held', 'credit_limit_decision', new.object_id,
        'agenda.tasks.limit_held',
        -- request_id so the Agenda row can deep-link: a decision has no page
        -- of its own, its limit request does.
        jsonb_build_object('comment', new.payload->>'comment',
                           'request_id', v_decision.request_id),
        null, v_decision.decided_by, null, 'high', new.id);
    end if;

  -- Released or re-shaped: the hold is resolved either way.
  when 'limit.released', 'limit.commercial_adjusted' then
    perform tci.close_tasks(array['limit_held']::tci.task_type[], new.object_id);
    if new.event_type = 'limit.commercial_adjusted' then
      perform tci.close_tasks(
        array['limit_held']::tci.task_type[],
        (new.payload->>'credit_decision_id')::uuid);
    end if;

  -- The submission pipeline. Each stage closes the previous stage's task, so
  -- a task cannot survive the status that raised it.
  when 'request.status_changed' then
    v_from := new.payload->>'from';
    v_to   := new.payload->>'to';
    select * into v_request from tci.insurance_requests where id = new.object_id;

    if v_from = 'commercial_review' then
      perform tci.close_tasks(
        array['submission_commercial_review']::tci.task_type[], new.object_id);
    end if;
    if v_from = 'sales_confirmation' then
      perform tci.close_tasks(
        array['submission_sales_confirmation']::tci.task_type[], new.object_id);
    end if;

    if v_to = 'commercial_review' then
      perform tci.open_task(
        'submission_commercial_review', 'insurance_request', new.object_id,
        'agenda.tasks.submission_commercial_review',
        jsonb_build_object('request_number', v_request.request_number),
        'commercial_underwriter'::tci.user_role, null, null, 'normal', new.id);

    elsif v_to = 'sales_confirmation' then
      -- due_at is the silent-consent clock made visible: the EARLIEST moment
      -- one of the package's decisions reaches the client on its own.
      select min(d.decided_at) + make_interval(hours => tci.sales_window_hours())
        into v_due
        from tci.credit_limit_decisions d
        join tci.credit_limit_requests r on r.id = d.request_id
       where r.insurance_request_id = new.object_id
         and d.lifecycle = 'effective'
         and d.released_at is null
         and not d.held;
      perform tci.open_task(
        'submission_sales_confirmation', 'insurance_request', new.object_id,
        'agenda.tasks.submission_sales_confirmation',
        -- A submission arriving here FROM client_review is the client asking
        -- for changes; the comment is what they asked for, so sales can see
        -- it on the task without opening the file.
        jsonb_build_object('request_number', v_request.request_number,
                           'client_comment',
                           case when v_from = 'client_review'
                                then new.payload->>'comment' end),
        'sales'::tci.user_role, null,
        coalesce(v_due, now() + make_interval(hours => tci.sales_window_hours())),
        'high', new.id);

    elsif v_to = 'accepted' then
      perform tci.open_task(
        'submission_accepted', 'insurance_request', new.object_id,
        'agenda.tasks.submission_accepted',
        jsonb_build_object('request_number', v_request.request_number),
        'sales'::tci.user_role, null, null, 'high', new.id);

    elsif v_to = 'declined' then
      -- The only manual one: nothing downstream happens, a human closes it.
      perform tci.open_task(
        'submission_declined', 'insurance_request', new.object_id,
        'agenda.tasks.submission_declined',
        jsonb_build_object('request_number', v_request.request_number,
                           'reason', new.payload->>'comment'),
        'sales'::tci.user_role, null, null, 'normal', new.id);

    elsif v_to = 'withdrawn' then
      -- Abandoned: nothing on it was achieved, so everything is cancelled.
      perform tci.close_tasks(
        array['submission_commercial_review', 'submission_sales_confirmation',
              'submission_accepted', 'buyer_needs_entity']::tci.task_type[],
        new.object_id, 'cancelled');

    elsif v_to = 'bound' then
      -- Off the board too, but not abandoned. Only the stage tasks are moot;
      -- submission_accepted was genuinely ANSWERED by the policy, and the
      -- request.bound arm below is what records it as done. Cancelling it here
      -- would beat that arm to the row and mislabel a completed task.
      perform tci.close_tasks(
        array['submission_commercial_review', 'submission_sales_confirmation',
              'buyer_needs_entity']::tci.task_type[],
        new.object_id, 'cancelled');
    end if;

  -- Bound: the accepted-submission task is answered by the policy existing.
  when 'request.bound' then
    perform tci.close_tasks(
      array['submission_accepted']::tci.task_type[], new.object_id);

  else
    null;  -- events with no Agenda meaning (request.created, request.assigned)
  end case;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. In-migration assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_leftover int;
  v_views    int;
  v_terms    boolean;
begin
  -- No client SELECT policy may survive on a table with staff-only columns:
  -- that is the whole point of moving to views.
  select count(*) into v_leftover
    from pg_policies
   where schemaname = 'tci'
     and tablename in ('policies', 'credit_limit_requests', 'credit_limit_decisions',
                       'decision_conditions', 'insurance_requests',
                       'insurance_request_buyers', 'insurance_request_history')
     and qual ilike '%''client''%';
  if v_leftover > 0 then
    raise exception '0025: % client policy/policies still on a base table', v_leftover;
  end if;

  -- ...and no client WRITE policy either.
  select count(*) into v_leftover
    from pg_policies
   where schemaname = 'tci'
     and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
     and coalesce(with_check, '') ilike '%''client''%';
  if v_leftover > 0 then
    raise exception '0025: % client write policy/policies remain', v_leftover;
  end if;

  select count(*) into v_views
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'tci' and c.relkind = 'v' and c.relname like 'v_client_%';
  if v_views <> 8 then
    raise exception '0025: expected 8 client views, found %', v_views;
  end if;

  -- The client views must NOT be security_invoker: they carry their own gate
  -- and read tables the client has no policy on. If one were invoker it would
  -- silently return nothing, which is a much harder bug to notice than a leak.
  select count(*) into v_leftover
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'tci' and c.relkind = 'v' and c.relname like 'v_client_%'
     and coalesce(array_to_string(c.reloptions, ','), '') ilike '%security_invoker=true%';
  if v_leftover > 0 then
    raise exception '0025: % client view(s) are security_invoker', v_leftover;
  end if;

  -- Terms are hidden before the submission reaches the client.
  select tci.submission_terms_visible('commercial_review') into v_terms;
  if v_terms then
    raise exception '0025: terms visible before client_review';
  end if;
  select tci.submission_terms_visible('client_review') into v_terms;
  if not v_terms then
    raise exception '0025: terms hidden at client_review';
  end if;

  raise notice '0025 assertions passed';
end $$;
