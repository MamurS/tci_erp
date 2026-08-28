-- What: claims - tci.claims, tci.claim_invoices, tci.claim_status_history, the
--       CL-YYYY-NNNN numbering, the SQL status machine and its content guards.
-- Why:  Phase 5. A claim is what an overdue account becomes when the buyer
--       does not pay at all. Three things are deliberate here:
--
--   * A CLAIM IS FILED, NEVER GENERATED. An NOA maturing past the waiting
--     period produces an Agenda task ("this can be claimed now"), not a claim.
--     Only the policyholder decides that a debt is a loss.
--   * THE WAITING PERIOD IS A GUARD, NOT A NOTE. Protracted default has to
--     ripen: the claim cannot be submitted before first due date +
--     waiting_period_days. Insolvency does NOT wait - the loss is crystallised
--     by the insolvency itself, which is Allianz Trade practice and the reason
--     cause_of_loss changes the guard rather than just labelling the file.
--   * BLOCKERS ARE KEYS, NOT SENTENCES. tci.claim_submission_blockers returns
--     i18n keys; the UI renders them in the viewer's language and the database
--     never holds rendered text. Same rule as tci.tasks.title_key.
--
-- The document checklist is the fourth guard and lives in 0035, which REPLACES
-- tci.claim_submission_blockers to add it. The seam is deliberate: documents
-- need a Storage bucket, and the status machine must not wait for it.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type tci.claim_status as enum (
  'draft',               -- being assembled by the policyholder
  'submitted',           -- filed, not yet picked up
  'under_assessment',    -- claims is working it
  'info_requested',      -- ball back with the policyholder; ageing pauses
  'approved',            -- indemnity agreed in full
  'partially_approved',  -- indemnity agreed on part of the claim
  'declined',            -- no indemnity
  'paid',                -- indemnity settled
  'closed',              -- file closed (after paid, declined or withdrawn)
  'withdrawn'            -- taken back by the policyholder
);

create type tci.claim_cause_of_loss as enum (
  'protracted_default',  -- the buyer simply has not paid
  'insolvency',          -- formal insolvency of the buyer
  'other'
);

comment on type tci.claim_cause_of_loss is
  'Why the debt became a loss. Drives the waiting period (insolvency waives it) and the required-document checklist (0035).';

-- ---------------------------------------------------------------------------
-- 2. Claims
-- ---------------------------------------------------------------------------

create sequence tci.claim_seq;

create table tci.claims (
  id             uuid primary key default gen_random_uuid(),
  claim_number   text not null unique,
  policy_id      uuid not null references tci.policies (id) on delete cascade,
  entity_id      uuid not null references tci.legal_entities (id),
  -- The NOA this claim grew out of, when there was one. Nullable: an
  -- insolvency can surface without an overdue ever having been reported.
  overdue_notification_id uuid references tci.overdue_notifications (id),
  status         tci.claim_status not null default 'draft',
  cause_of_loss  tci.claim_cause_of_loss not null default 'protracted_default',
  -- Required for cause = insolvency, checked at SUBMISSION rather than by a
  -- table constraint: a draft is allowed to be incomplete.
  insolvency_reference text,
  -- Maintained by trigger from tci.claim_invoices. Never typed: a claimed
  -- amount that disagrees with the invoices behind it is a defect, and the
  -- only way to be sure it cannot happen is to not let anyone write it.
  claimed_amount numeric(18,2) not null default 0 check (claimed_amount >= 0),
  currency_code  char(3) not null references tci.currencies (code),

  filed_by       uuid references auth.users (id),
  filed_at       timestamptz,
  assessed_by    uuid references auth.users (id),
  assessed_at    timestamptz,
  decision_reason text,

  -- The frozen indemnity, written by tci.approve_claim (0034). Snapshotted for
  -- the same reason the declaration coverage split is frozen on acceptance:
  -- money moved on these numbers, so a later limit revocation must not restate
  -- what was approved last month.
  approved_indemnity numeric(18,2) check (approved_indemnity >= 0),
  indemnity_trace    jsonb,
  -- How much of the policy aggregate first loss this claim absorbed, frozen
  -- with the rest. 0034 is what writes it; the column lives here so the whole
  -- freeze - amount, trace and consumption - is one shape.
  afl_consumed       numeric(18,2) check (afl_consumed >= 0),

  -- Assessment ageing, with info_requested excluded. info_requested_at marks
  -- the current pause; assessment_paused accumulates the closed ones.
  info_requested_at timestamptz,
  assessment_paused interval not null default '0'::interval,

  created_by     uuid not null references auth.users (id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Filed once it leaves draft - except straight to withdrawn, which is how a
  -- policyholder abandons a draft they never sent.
  constraint claims_filed_recorded check (
    filed_at is not null or status in ('draft', 'withdrawn')
  ),
  constraint claims_pause_matches_status check (
    (status = 'info_requested') = (info_requested_at is not null)
  ),
  constraint claims_indemnity_recorded check (
    approved_indemnity is null or indemnity_trace is not null
  )
);

comment on table tci.claims is
  'Indemnity claims. claimed_amount is derived from tci.claim_invoices by trigger; approved_indemnity and indemnity_trace are frozen at approval.';
comment on column tci.claims.assessment_paused is
  'Time already spent in info_requested. Assessment ageing subtracts it, so waiting on the policyholder never counts against the assessor.';

-- One live claim per (policy, buyer). A second loss on the same buyer under
-- the same policy belongs on the open file, exactly as a second overdue
-- belongs on the open NOA.
create unique index claims_live_uq
  on tci.claims (policy_id, entity_id)
  where status not in ('declined', 'closed', 'withdrawn');

-- An NOA escalates into at most one claim.
create unique index claims_noa_uq
  on tci.claims (overdue_notification_id)
  where overdue_notification_id is not null and status <> 'withdrawn';

create index claims_policy_idx on tci.claims (policy_id, created_at desc);
create index claims_entity_idx on tci.claims (entity_id, created_at desc);
create index claims_status_idx on tci.claims (status, created_at desc);

create function tci.set_claim_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.claim_number is null or new.claim_number = '' then
    new.claim_number := 'CL-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('tci.claim_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger claims_number
  before insert on tci.claims
  for each row execute function tci.set_claim_number();

-- ---------------------------------------------------------------------------
-- 3. The invoices behind the claim
-- ---------------------------------------------------------------------------

create table tci.claim_invoices (
  id             uuid primary key default gen_random_uuid(),
  claim_id       uuid not null references tci.claims (id) on delete cascade,
  invoice_number text not null,
  invoice_date   date not null,
  -- The date cover is judged on. Credit insurance attaches at SHIPMENT: a
  -- limit in force when the goods left is what matters, not the limit today.
  shipment_date  date not null,
  due_date       date not null,
  amount         numeric(18,2) not null check (amount > 0),
  currency_code  char(3) not null references tci.currencies (code),
  paid_amount    numeric(18,2) not null default 0 check (paid_amount >= 0),
  -- The part the BUYER contests on commercial grounds (short delivery, quality,
  -- a credit note). Trade credit insurance covers non-payment, not commercial
  -- disputes, so this comes off before cover is even considered.
  disputed_amount numeric(18,2) not null default 0 check (disputed_amount >= 0),
  outstanding_amount numeric(18,2) generated always as (amount - paid_amount) stored,
  claimable_amount   numeric(18,2)
    generated always as (amount - paid_amount - disputed_amount) stored,
  -- The credit period actually granted, derived so it cannot be mistyped and
  -- then compared against the policy's max_payment_terms_days.
  payment_terms_days int generated always as ((due_date - invoice_date)) stored,
  -- The policyholder's own note; assessment notes live on the verdict (0033).
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint claim_invoices_paid_within_amount check (paid_amount + disputed_amount <= amount),
  constraint claim_invoices_due_after_invoice check (due_date >= invoice_date),
  constraint claim_invoices_number_per_claim unique (claim_id, invoice_number)
);

comment on table tci.claim_invoices is
  'The unpaid invoices a claim is made of. shipment_date drives coverage (0033); outstanding, claimable and payment_terms_days are derived, never typed.';

create index claim_invoices_claim_idx on tci.claim_invoices (claim_id, due_date);

-- claimed_amount follows the invoices, always.
create function tci.sync_claim_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_claim uuid := coalesce(new.claim_id, old.claim_id);
begin
  update tci.claims c
     set claimed_amount = coalesce(
           (select sum(i.outstanding_amount) from tci.claim_invoices i
             where i.claim_id = v_claim), 0),
         updated_at = now()
   where c.id = v_claim;
  return null;
end;
$$;

create trigger claim_invoices_sync_amount
  after insert or update or delete on tci.claim_invoices
  for each row execute function tci.sync_claim_amount();

-- ---------------------------------------------------------------------------
-- 4. History
-- ---------------------------------------------------------------------------

create table tci.claim_status_history (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references tci.claims (id) on delete cascade,
  from_status tci.claim_status not null,
  to_status   tci.claim_status not null,
  changed_by  uuid not null references auth.users (id) default auth.uid(),
  changed_at  timestamptz not null default now(),
  comment     text
);

create index claim_status_history_claim_idx
  on tci.claim_status_history (claim_id, changed_at desc);

comment on table tci.claim_status_history is
  'Append-only. Every claim transition, with the actor and their comment. Never updated in place.';

-- ---------------------------------------------------------------------------
-- 5. When a claim may be submitted
-- ---------------------------------------------------------------------------
-- Returns i18n KEYS, not sentences. Empty array = ready. 0035 replaces this
-- function to append the missing-document keys; everything else stays.

create function tci.claim_eligible_from(p_claim_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Insolvency crystallises the loss: no waiting period.
    when c.cause_of_loss = 'insolvency' then null
    else coalesce(
      (select n.first_due_date from tci.overdue_notifications n
        where n.id = c.overdue_notification_id),
      (select min(i.due_date) from tci.claim_invoices i where i.claim_id = c.id)
    ) + p.waiting_period_days
  end
  from tci.claims c
  join tci.policies p on p.id = c.policy_id
  where c.id = p_claim_id
$$;

comment on function tci.claim_eligible_from(uuid) is
  'The first day a claim may be submitted: the NOA''s first due date (or the oldest invoice due date) plus the policy waiting period. NULL for insolvency, which waives it.';

-- Every appended key is cast to text explicitly. `text[] || 'literal'` is
-- ambiguous - Postgres resolves the unknown literal as an ARRAY and dies with
-- "malformed array literal" the first time a blocker actually fires.
create function tci.claim_submission_blockers(p_claim_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claim    tci.claims%rowtype;
  v_blockers text[] := '{}';
  v_from     date;
begin
  select * into v_claim from tci.claims where id = p_claim_id;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from tci.claim_invoices where claim_id = p_claim_id) then
    v_blockers := v_blockers || 'claims.blocker.noInvoices'::text;
  end if;

  if exists (
    select 1 from tci.claim_invoices
     where claim_id = p_claim_id and currency_code <> v_claim.currency_code
  ) then
    v_blockers := v_blockers || 'claims.blocker.currencyMismatch'::text;
  end if;

  if coalesce(v_claim.claimed_amount, 0) <= 0 then
    v_blockers := v_blockers || 'claims.blocker.nothingOutstanding'::text;
  end if;

  if v_claim.cause_of_loss = 'insolvency'
     and coalesce(trim(v_claim.insolvency_reference), '') = '' then
    v_blockers := v_blockers || 'claims.blocker.insolvencyReference'::text;
  end if;

  v_from := tci.claim_eligible_from(p_claim_id);
  if v_from is not null and current_date < v_from then
    v_blockers := v_blockers || 'claims.blocker.waitingPeriod'::text;
  end if;

  return v_blockers;
end;
$$;

comment on function tci.claim_submission_blockers(uuid) is
  'i18n keys for everything standing between this claim and submission. Empty = ready. Replaced in 0035 to add the document checklist.';

-- ---------------------------------------------------------------------------
-- 6. The status machine
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because the client files and responds through it and must
-- never hold direct write rights on tci.claims. Every path checks the caller
-- itself: staff by role, the client by policyholder mapping.

create function tci.claim_actor_may_act(p_claim tci.claims, p_client_ok boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when tci.has_role('claims', 'admin') then true
    when p_client_ok and tci.has_role('client') then exists (
      select 1 from tci.policies p
       where p.id = p_claim.policy_id
         and p.entity_id in (select tci.my_client_entities())
    )
    else false
  end
$$;

comment on function tci.claim_actor_may_act(tci.claims, boolean) is
  'Claims and admin always; the owning policyholder only where the transition is theirs to make (p_client_ok).';

create function tci.change_claim_status(
  p_claim_id uuid,
  p_to       tci.claim_status,
  p_comment  text default null
)
returns tci.claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim tci.claims%rowtype;
  v_from  tci.claim_status;
  v_ok    boolean := false;
  v_blockers text[];
begin
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  -- A client may only ever see its own claim; refusing with "not found"
  -- rather than "forbidden" keeps other policyholders' claim ids private.
  if tci.has_role('client') and not tci.claim_actor_may_act(v_claim, true) then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if not tci.is_staff() and not tci.has_role('client') then
    raise exception 'not permitted' using errcode = 'P0004';
  end if;
  v_from := v_claim.status;

  v_ok := case
    when v_from = 'draft'              and p_to in ('submitted', 'withdrawn') then true
    when v_from = 'submitted'          and p_to in ('under_assessment', 'info_requested', 'declined', 'withdrawn') then true
    when v_from = 'under_assessment'   and p_to in ('info_requested', 'approved', 'partially_approved', 'declined') then true
    when v_from = 'info_requested'     and p_to in ('under_assessment', 'declined', 'withdrawn') then true
    when v_from in ('approved', 'partially_approved') and p_to in ('paid', 'closed') then true
    when v_from = 'paid'               and p_to = 'closed' then true
    when v_from = 'declined'           and p_to = 'closed' then true
    when v_from = 'withdrawn'          and p_to = 'closed' then true
    else false
  end;
  if not v_ok then
    raise exception 'invalid claim transition: % -> %', v_from, p_to
      using errcode = 'P0001';
  end if;

  -- Who may drive which transition
  if p_to = 'submitted' then
    -- The policyholder files. Sales files on their behalf when they phone in;
    -- claims can too, to enter a paper filing.
    if not (tci.claim_actor_may_act(v_claim, true) or tci.has_role('sales')) then
      raise exception 'only the policyholder, sales or claims may file a claim'
        using errcode = 'P0004';
    end if;
    v_blockers := tci.claim_submission_blockers(p_claim_id);
    if array_length(v_blockers, 1) > 0 then
      raise exception 'this claim is not ready to be filed: %', array_to_string(v_blockers, ', ')
        using errcode = 'P0001', detail = array_to_string(v_blockers, ',');
    end if;
  elsif p_to = 'withdrawn' then
    if not (tci.claim_actor_may_act(v_claim, true) or tci.has_role('sales')) then
      raise exception 'only the policyholder, sales or claims may withdraw a claim'
        using errcode = 'P0004';
    end if;
  elsif p_to = 'under_assessment' and v_from = 'info_requested' then
    -- Answering an information request is the policyholder's move; claims may
    -- also resume assessment itself when the answer arrives another way.
    if not tci.claim_actor_may_act(v_claim, true) then
      raise exception 'only the policyholder or claims may resume assessment'
        using errcode = 'P0004';
    end if;
  else
    if not tci.has_role('claims', 'admin') then
      raise exception 'only the claims department may move a claim to %', p_to
        using errcode = 'P0004';
    end if;
  end if;

  -- A refusal needs a reason on the record. A PARTIAL approval does not: its
  -- justification is the coverage verdicts and the indemnity trace, which are
  -- richer than any sentence and are frozen onto the claim by 0034.
  if p_to = 'declined'
     and coalesce(trim(coalesce(p_comment, v_claim.decision_reason)), '') = '' then
    raise exception 'declining a claim requires a reason' using errcode = 'P0001';
  end if;

  update tci.claims
     set status = p_to,
         filed_at = case when p_to = 'submitted' then now() else filed_at end,
         filed_by = case when p_to = 'submitted' then coalesce(filed_by, (select auth.uid())) else filed_by end,
         assessed_by = case when p_to in ('approved', 'partially_approved', 'declined')
                            then (select auth.uid()) else assessed_by end,
         assessed_at = case when p_to in ('approved', 'partially_approved', 'declined')
                            then now() else assessed_at end,
         decision_reason = case when p_to in ('approved', 'partially_approved', 'declined')
                                then coalesce(p_comment, decision_reason) else decision_reason end,
         -- The ageing clock: opening a pause stamps it, closing one banks it.
         info_requested_at = case when p_to = 'info_requested' then now() else null end,
         assessment_paused = case
           when v_from = 'info_requested' and info_requested_at is not null
             then assessment_paused + (now() - info_requested_at)
           else assessment_paused
         end,
         updated_at = now()
   where id = p_claim_id
   returning * into v_claim;

  insert into tci.claim_status_history (claim_id, from_status, to_status, changed_by, comment)
  values (p_claim_id, v_from, p_to, (select auth.uid()), p_comment);

  perform tci.emit_workflow_event(
    'claim.status_changed', 'claim', p_claim_id,
    jsonb_build_object(
      'from', v_from, 'to', p_to, 'comment', p_comment,
      'claim_number', v_claim.claim_number,
      'policy_id', v_claim.policy_id,
      'entity_id', v_claim.entity_id,
      'claimed_amount', v_claim.claimed_amount,
      'currency', v_claim.currency_code),
    case
      when p_to in ('submitted', 'under_assessment') then 'claims'::tci.user_role
      when p_to in ('info_requested', 'approved', 'partially_approved', 'declined', 'paid')
        then 'client'::tci.user_role
      else null
    end);

  return v_claim;
end;
$$;

comment on function tci.change_claim_status(uuid, tci.claim_status, text) is
  'The only way a claim changes status. Enforces the transition table, the role gate per target and the submission blockers, and writes history + a workflow event.';

revoke execute on function tci.change_claim_status(uuid, tci.claim_status, text) from public, anon;
grant execute on function tci.change_claim_status(uuid, tci.claim_status, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Opening a claim
-- ---------------------------------------------------------------------------

create function tci.open_claim(
  p_policy_id     uuid,
  p_entity_id     uuid,
  p_cause         tci.claim_cause_of_loss default 'protracted_default',
  p_noa_id        uuid default null,
  p_insolvency_reference text default null
)
returns tci.claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy tci.policies%rowtype;
  v_claim  tci.claims%rowtype;
  v_noa    tci.overdue_notifications%rowtype;
begin
  if not (tci.has_role('claims', 'sales', 'admin') or tci.has_role('client')) then
    raise exception 'not permitted to open a claim' using errcode = 'P0004';
  end if;

  select * into v_policy from tci.policies where id = p_policy_id;
  if not found then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  if tci.has_role('client')
     and v_policy.entity_id not in (select tci.my_client_entities()) then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  -- Cover has to have existed. A claim under a draft policy is nonsense; a
  -- claim under an expired or cancelled one is normal - the loss happened
  -- while it was in force.
  if v_policy.status = 'draft' then
    raise exception 'a claim needs a policy that was in force' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_entity_id) then
    raise exception 'buyer not found' using errcode = 'P0002';
  end if;

  if p_noa_id is not null then
    select * into v_noa from tci.overdue_notifications where id = p_noa_id;
    if not found then
      raise exception 'overdue notification not found' using errcode = 'P0002';
    end if;
    if v_noa.policy_id <> p_policy_id or v_noa.entity_id <> p_entity_id then
      raise exception 'that overdue notification belongs to a different policy or buyer'
        using errcode = 'P0001';
    end if;
  end if;

  insert into tci.claims (
    policy_id, entity_id, overdue_notification_id, cause_of_loss,
    insolvency_reference, currency_code
  ) values (
    p_policy_id, p_entity_id, p_noa_id, p_cause,
    nullif(trim(coalesce(p_insolvency_reference, '')), ''), v_policy.currency_code
  ) returning * into v_claim;

  perform tci.emit_workflow_event(
    'claim.created', 'claim', v_claim.id,
    jsonb_build_object(
      'claim_number', v_claim.claim_number,
      'policy_id', p_policy_id, 'entity_id', p_entity_id,
      'cause_of_loss', p_cause, 'noa_id', p_noa_id),
    null);

  return v_claim;
end;
$$;

comment on function tci.open_claim(uuid, uuid, tci.claim_cause_of_loss, uuid, text) is
  'Opens a draft claim. Staff or the owning policyholder. A claim under an expired or cancelled policy is legitimate - the loss happened while it was in force.';

revoke execute on function tci.open_claim(uuid, uuid, tci.claim_cause_of_loss, uuid, text) from public, anon;
grant execute on function tci.open_claim(uuid, uuid, tci.claim_cause_of_loss, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The staff view, with ageing
-- ---------------------------------------------------------------------------

create view tci.v_claims
with (security_invoker = true) as
select
  c.id,
  c.claim_number,
  c.policy_id,
  p.policy_number,
  p.entity_id                     as policyholder_entity_id,
  ph.name                         as policyholder_name,
  c.entity_id                     as buyer_entity_id,
  b.name                          as buyer_name,
  c.overdue_notification_id,
  c.status,
  c.cause_of_loss,
  c.insolvency_reference,
  c.claimed_amount,
  c.currency_code,
  c.approved_indemnity,
  -- The trace frozen at approval. Exposed so the screen can show exactly how
  -- the figure that was paid was derived, not a fresh recomputation of it.
  c.indemnity_trace,
  c.afl_consumed,
  c.filed_by,
  c.filed_at,
  c.assessed_by,
  c.assessed_at,
  c.decision_reason,
  c.info_requested_at,
  p.insured_percentage,
  p.waiting_period_days,
  p.max_extension_period_days,
  p.noa_window_days,
  p.max_payment_terms_days,
  p.discretionary_limit,
  p.nql_amount,
  p.deductible_each_loss,
  p.aggregate_first_loss,
  p.max_liability_amount,
  p.inception_date,
  p.expiry_date,
  tci.claim_eligible_from(c.id) as eligible_from,
  (select count(*) from tci.claim_invoices i where i.claim_id = c.id)::int as invoice_count,
  -- Days since filing, with time spent waiting on the policyholder removed.
  case when c.filed_at is null then null else
    extract(epoch from (
      now() - c.filed_at - c.assessment_paused
      - coalesce(now() - c.info_requested_at, '0'::interval)
    )) / 86400.0
  end::numeric(10,2) as assessment_age_days,
  -- The NOA's lateness travels with the claim: a late notification can
  -- prejudice cover, so it must be visible on the claim, not only on the NOA.
  n.reported_late   as noa_reported_late,
  n.days_late       as noa_days_late,
  n.first_due_date  as noa_first_due_date,
  c.created_by,
  c.created_at,
  c.updated_at
from tci.claims c
join tci.policies p on p.id = c.policy_id
join tci.legal_entities ph on ph.id = p.entity_id
join tci.legal_entities b on b.id = c.entity_id
left join tci.v_overdue_notifications n on n.id = c.overdue_notification_id;

comment on view tci.v_claims is
  'Claims with the policy terms the assessment needs, ageing net of info_requested pauses, and the originating NOA''s lateness.';

grant select on tci.v_claims to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------
-- Staff read everything; claims, sales and admin write. Clients reach claims
-- ONLY through the v_client_* views and client_* functions of 0036 - there is
-- no client policy on these tables, by design (see CLAUDE.md, Client
-- visibility): a row policy decides which rows, never which columns.

alter table tci.claims enable row level security;
alter table tci.claim_invoices enable row level security;
alter table tci.claim_status_history enable row level security;

create policy "claims: staff read"
  on tci.claims for select to authenticated using (tci.is_staff());
create policy "claims: staff write"
  on tci.claims for insert to authenticated
  with check (tci.has_role('claims', 'sales', 'admin'));
create policy "claims: staff update"
  on tci.claims for update to authenticated
  using (tci.has_role('claims', 'admin'))
  with check (tci.has_role('claims', 'admin'));

create policy "claim_invoices: staff read"
  on tci.claim_invoices for select to authenticated using (tci.is_staff());
create policy "claim_invoices: staff write"
  on tci.claim_invoices for all to authenticated
  using (tci.has_role('claims', 'sales', 'admin'))
  with check (tci.has_role('claims', 'sales', 'admin'));

create policy "claim_status_history: staff read"
  on tci.claim_status_history for select to authenticated using (tci.is_staff());
create policy "claim_status_history: staff append"
  on tci.claim_status_history for insert to authenticated with check (tci.is_staff());

grant select, insert, update, delete on tci.claims to authenticated;
grant select, insert, update, delete on tci.claim_invoices to authenticated;
grant select, insert on tci.claim_status_history to authenticated;
grant all on tci.claims, tci.claim_invoices, tci.claim_status_history to service_role;
grant usage on sequence tci.claim_seq to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('tci.claims') is null or to_regclass('tci.claim_invoices') is null then
    raise exception 'claims tables missing';
  end if;
  if to_regclass('tci.claims_live_uq') is null then
    raise exception 'the one-live-claim-per-buyer index is missing';
  end if;
  -- The status machine must be the only writer of history: no default that
  -- would let a hand-written UPDATE slip a transition past it.
  if not exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'tci' and pr.proname = 'change_claim_status'
  ) then
    raise exception 'change_claim_status missing';
  end if;
end;
$$;
