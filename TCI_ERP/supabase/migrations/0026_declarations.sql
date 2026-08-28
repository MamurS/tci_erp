-- What: turnover declarations per policy and buyer - tci.declarations,
--       tci.declaration_lines, the DL/uncovered classification, the status
--       machine (submit / accept / dispute / correct) and the reporting views.
-- Why:  Phase 4. A whole-turnover policy prices on declared insurable sales,
--       so the declaration is the document everything downstream reads:
--       premium is earned from it (0027) and compliance is measured by it.
--
-- Modelled on Allianz Trade practice, with two rules the owner fixed:
--
--   * Turnover against a buyer WITH an approved, released limit is covered in
--     full. A credit limit caps the outstanding BALANCE, not the flow of sales
--     through a period, so capping declared turnover at the limit would
--     understate cover and therefore premium. Only the discretionary limit is
--     compared against turnover, because that is the rule the owner stated.
--   * Turnover against a buyer with NO limit is covered only up to the
--     policy's discretionary limit. Anything above it is UNCOVERED EXCESS:
--     the policyholder sold more than they were allowed to self-assess, and
--     that slice is not insured. It is never folded into the covered figure -
--     the split is computed, stored on acceptance and shown separately.
--
-- History is immutable, as everywhere else: a correction does not edit the
-- accepted declaration, it supersedes it and the pair stays readable.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type tci.declaration_status as enum (
  'draft',      -- being filled in, by the client or by staff on their behalf
  'submitted',  -- with the insurer, awaiting acceptance
  'accepted',   -- agreed; premium is earned from it
  'disputed',   -- the insurer has questioned it; the ball is with the client
  'corrected'   -- superseded by a later declaration for the same period
);

comment on type tci.declaration_status is
  '"corrected" marks the OLD row of a correction pair: it is the superseded one, never the live one for the period.';

create type tci.coverage_basis as enum (
  'limit',            -- an approved, released credit limit covers this buyer
  'discretionary',    -- no limit; turnover fits inside the discretionary limit
  'uncovered_excess'  -- no limit; turnover exceeds the DL, the excess is uninsured
);

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table tci.declarations (
  id                       uuid primary key default gen_random_uuid(),
  policy_id                uuid not null references tci.policies (id) on delete cascade,
  period_start             date not null,
  period_end               date not null,
  status                   tci.declaration_status not null default 'draft',
  -- The policy currency at the time of declaring. Copied rather than joined so
  -- a later policy amendment cannot silently restate a historic declaration.
  currency_code            char(3) not null references tci.currencies (code),
  -- Maintained by trigger from the lines; never written by hand.
  total_insurable_turnover numeric(18,2) not null default 0,
  note                     text,
  submitted_by             uuid references auth.users (id),
  submitted_at             timestamptz,
  accepted_by              uuid references auth.users (id),
  accepted_at              timestamptz,
  disputed_by              uuid references auth.users (id),
  disputed_at              timestamptz,
  dispute_note             text,
  -- The correction chain. The NEW declaration points back at the one it
  -- replaces; the old one moves to status 'corrected'.
  supersedes_id            uuid references tci.declarations (id),
  superseded_at            timestamptz,
  created_by               uuid not null default auth.uid() references auth.users (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint declarations_period_ordered check (period_end >= period_start),
  constraint declarations_supersede_pairs check (
    (status = 'corrected') = (superseded_at is not null)
  ),
  constraint declarations_no_self_supersede check (supersedes_id is distinct from id)
);

-- One LIVE declaration per (policy, period). A superseded row keeps its place
-- in history without blocking the correction that replaced it.
create unique index declarations_live_period_uq
  on tci.declarations (policy_id, period_start)
  where status <> 'corrected';

create index declarations_policy_idx on tci.declarations (policy_id, period_start desc);
create index declarations_status_idx on tci.declarations (status) where status in ('submitted', 'disputed');

comment on table tci.declarations is
  'Periodic turnover declaration for a policy. One live row per (policy, period_start); corrections supersede rather than overwrite.';
comment on column tci.declarations.total_insurable_turnover is
  'Sum of the lines, maintained by trigger. The covered/uncovered split lives on the lines and in tci.v_declaration_totals.';

create table tci.declaration_lines (
  id                 uuid primary key default gen_random_uuid(),
  declaration_id     uuid not null references tci.declarations (id) on delete cascade,
  entity_id          uuid not null references tci.legal_entities (id),
  insurable_turnover numeric(18,2) not null check (insurable_turnover >= 0),
  -- What the policyholder reports as still unpaid at period end. Optional:
  -- not every policyholder reports ageing with the declaration, and a NULL
  -- here means "not reported", never zero.
  overdue_amount     numeric(18,2) check (overdue_amount >= 0),
  line_note          text,
  -- Frozen on acceptance by tci.accept_declaration. NULL while the
  -- declaration is still open, when the split is computed live instead:
  -- limits move, and an accepted declaration must not be re-classified by a
  -- revocation that happened afterwards.
  coverage_basis     tci.coverage_basis,
  covered_amount     numeric(18,2),
  uncovered_excess   numeric(18,2),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint declaration_lines_split_together check (
    (coverage_basis is null) = (covered_amount is null)
    and (coverage_basis is null) = (uncovered_excess is null)
  ),
  constraint declaration_lines_split_adds_up check (
    coverage_basis is null
    or covered_amount + uncovered_excess = insurable_turnover
  ),
  constraint declaration_lines_one_per_buyer unique (declaration_id, entity_id)
);

create index declaration_lines_declaration_idx on tci.declaration_lines (declaration_id);
create index declaration_lines_entity_idx on tci.declaration_lines (entity_id);

comment on column tci.declaration_lines.overdue_amount is
  'Amounts past due at period end as reported by the policyholder. NULL means not reported - never treat it as zero.';
comment on column tci.declaration_lines.covered_amount is
  'Insured slice, frozen when the declaration is accepted. Premium is earned on this, not on insurable_turnover.';

-- ---------------------------------------------------------------------------
-- 3. Classification: the one place the DL/uncovered rule lives
-- ---------------------------------------------------------------------------

-- Does this buyer hold an approved, client-visible limit under this policy?
-- Released matters: a decision still inside the sales window has not reached
-- the policyholder, so they cannot have relied on it when they shipped.
create function tci.buyer_has_effective_limit(p_policy_id uuid, p_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from tci.v_effective_limits v
     where v.policy_id = p_policy_id
       and v.entity_id = p_entity_id
       and v.outcome in ('approved', 'partial')
       and v.client_visible
       and coalesce(v.approved_amount, 0) > 0
  )
$$;

-- SECURITY DEFINER on purpose: the coverage split is a fact about the policy,
-- so it must read the same to staff and to the policyholder. If this ran as
-- the caller, a client - who cannot select tci.credit_limit_decisions - would
-- see every line fall back to the discretionary basis and would be told their
-- turnover was uncovered when it was not. It returns one boolean and leaks
-- nothing else about the decision behind it.
comment on function tci.buyer_has_effective_limit(uuid, uuid) is
  'True when the buyer holds an approved, released limit under the policy. SECURITY DEFINER on purpose: the coverage split is a fact about the policy and must read the same to staff and to the policyholder. Returns one boolean and leaks nothing else about the decision behind it.';

-- The classification itself: pure, so the frontend can mirror it exactly and
-- a contract test can lock the mirror to this text.
create function tci.classify_declaration_line(
  p_has_limit           boolean,
  p_insurable_turnover  numeric,
  p_discretionary_limit numeric
)
returns table (
  coverage_basis   tci.coverage_basis,
  covered_amount   numeric,
  uncovered_excess numeric
)
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    case
      when p_has_limit then 'limit'::tci.coverage_basis
      when p_insurable_turnover <= coalesce(p_discretionary_limit, 0)
        then 'discretionary'::tci.coverage_basis
      else 'uncovered_excess'::tci.coverage_basis
    end,
    case
      when p_has_limit then p_insurable_turnover
      when p_insurable_turnover <= coalesce(p_discretionary_limit, 0) then p_insurable_turnover
      else coalesce(p_discretionary_limit, 0)
    end,
    case
      when p_has_limit then 0::numeric
      when p_insurable_turnover <= coalesce(p_discretionary_limit, 0) then 0::numeric
      else p_insurable_turnover - coalesce(p_discretionary_limit, 0)
    end
$$;

comment on function tci.classify_declaration_line(boolean, numeric, numeric) is
  'The DL/uncovered rule. With an approved limit the whole turnover is covered (a limit caps balance, not flow). Without one, cover stops at the discretionary limit and the rest is uncovered excess.';

-- ---------------------------------------------------------------------------
-- 4. Derived totals on the parent
-- ---------------------------------------------------------------------------

create function tci.sync_declaration_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_declaration_id uuid := coalesce(new.declaration_id, old.declaration_id);
begin
  update tci.declarations d
     set total_insurable_turnover = coalesce((
           select sum(l.insurable_turnover)
             from tci.declaration_lines l
            where l.declaration_id = v_declaration_id
         ), 0),
         updated_at = now()
   where d.id = v_declaration_id;
  return null;
end;
$$;

create trigger declaration_lines_sync_total
  after insert or update or delete on tci.declaration_lines
  for each row execute function tci.sync_declaration_total();

-- ---------------------------------------------------------------------------
-- 5. Views
-- ---------------------------------------------------------------------------

-- Lines with the split resolved: frozen values once accepted, live values
-- while the declaration is still open. `is_frozen` says which you are looking
-- at, so no screen has to guess.
create view tci.v_declaration_lines
with (security_invoker = true) as
select
  l.id,
  l.declaration_id,
  d.policy_id,
  l.entity_id,
  e.name as entity_name,
  d.status as declaration_status,
  d.currency_code,
  l.insurable_turnover,
  l.overdue_amount,
  l.line_note,
  (l.coverage_basis is not null) as is_frozen,
  coalesce(l.coverage_basis, c.coverage_basis)     as coverage_basis,
  coalesce(l.covered_amount, c.covered_amount)     as covered_amount,
  coalesce(l.uncovered_excess, c.uncovered_excess) as uncovered_excess,
  l.created_at,
  l.updated_at
from tci.declaration_lines l
join tci.declarations d on d.id = l.declaration_id
join tci.legal_entities e on e.id = l.entity_id
join tci.policies p on p.id = d.policy_id
cross join lateral tci.classify_declaration_line(
  tci.buyer_has_effective_limit(d.policy_id, l.entity_id),
  l.insurable_turnover,
  p.discretionary_limit
) c;

comment on view tci.v_declaration_lines is
  'Declaration lines with the coverage split resolved: frozen once accepted, computed live before that. is_frozen tells them apart.';

create view tci.v_declaration_totals
with (security_invoker = true) as
select
  d.id as declaration_id,
  d.policy_id,
  d.period_start,
  d.period_end,
  d.status,
  d.currency_code,
  d.total_insurable_turnover,
  coalesce(sum(v.covered_amount), 0)   as covered_turnover,
  coalesce(sum(v.uncovered_excess), 0) as uncovered_excess,
  count(v.id)::int                     as line_count,
  count(*) filter (where v.coverage_basis = 'uncovered_excess')::int as uncovered_line_count,
  coalesce(sum(v.overdue_amount), 0)   as reported_overdue,
  bool_or(v.is_frozen)                 as split_frozen
from tci.declarations d
left join tci.v_declaration_lines v on v.declaration_id = d.id
group by d.id, d.policy_id, d.period_start, d.period_end, d.status,
         d.currency_code, d.total_insurable_turnover;

comment on view tci.v_declaration_totals is
  'Per-declaration roll-up. covered_turnover is the premium base; uncovered_excess is turnover the policyholder shipped outside cover.';

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
-- Staff only on the base tables. Clients reach declarations exclusively
-- through the tci.v_client_* views and tci.client_* functions of 0029 - the
-- same doctrine as 0025: a row policy chooses rows, never columns, and staff
-- and clients share the `authenticated` database role.

alter table tci.declarations enable row level security;
alter table tci.declaration_lines enable row level security;

create policy "declarations: staff read"
  on tci.declarations for select to authenticated
  using (tci.is_staff());

create policy "declarations: staff write"
  on tci.declarations for insert to authenticated
  with check (tci.has_role('sales', 'commercial_underwriter', 'admin'));

create policy "declarations: staff update"
  on tci.declarations for update to authenticated
  using (tci.has_role('sales', 'commercial_underwriter', 'admin'))
  with check (tci.has_role('sales', 'commercial_underwriter', 'admin'));

create policy "declaration_lines: staff read"
  on tci.declaration_lines for select to authenticated
  using (tci.is_staff());

create policy "declaration_lines: staff write"
  on tci.declaration_lines for insert to authenticated
  with check (tci.has_role('sales', 'commercial_underwriter', 'admin'));

create policy "declaration_lines: staff update"
  on tci.declaration_lines for update to authenticated
  using (tci.has_role('sales', 'commercial_underwriter', 'admin'))
  with check (tci.has_role('sales', 'commercial_underwriter', 'admin'));

create policy "declaration_lines: staff delete"
  on tci.declaration_lines for delete to authenticated
  using (tci.has_role('sales', 'commercial_underwriter', 'admin'));

grant select, insert, update on tci.declarations to authenticated;
grant select, insert, update, delete on tci.declaration_lines to authenticated;
grant select on tci.v_declaration_lines, tci.v_declaration_totals to authenticated;
grant all on tci.declarations, tci.declaration_lines to service_role;

-- ---------------------------------------------------------------------------
-- 7. Status machine
-- ---------------------------------------------------------------------------
-- The transitions, once, in SQL. The UI mirrors them to grey out a button;
-- this is what enforces them.
--
--   draft     -> submitted
--   submitted -> accepted | disputed
--   disputed  -> submitted            (the client answers and resubmits)
--   accepted  -> corrected            (only via tci.correct_declaration)
--   disputed  -> corrected            (same)

create function tci.declaration_transition_allowed(
  p_from tci.declaration_status,
  p_to   tci.declaration_status
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('draft',     'submitted'),
    ('submitted', 'accepted'),
    ('submitted', 'disputed'),
    ('disputed',  'submitted'),
    ('accepted',  'corrected'),
    ('disputed',  'corrected')
  )
$$;

create function tci.submit_declaration(p_declaration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dec tci.declarations%rowtype;
  v_lines int;
begin
  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;

  if not tci.declaration_transition_allowed(v_dec.status, 'submitted') then
    raise exception 'a declaration cannot go from % to submitted', v_dec.status
      using errcode = 'P0001';
  end if;

  select count(*) into v_lines
    from tci.declaration_lines where declaration_id = p_declaration_id;
  if v_lines = 0 then
    raise exception 'a declaration cannot be submitted with no lines'
      using errcode = 'P0001';
  end if;

  update tci.declarations
     set status = 'submitted',
         submitted_by = coalesce(submitted_by, (select auth.uid())),
         submitted_at = now(),
         updated_at = now()
   where id = p_declaration_id
   returning * into v_dec;

  perform tci.emit_workflow_event(
    'declaration.submitted', 'declaration', v_dec.id,
    jsonb_build_object(
      'policy_id', v_dec.policy_id,
      'period_start', v_dec.period_start,
      'period_end', v_dec.period_end,
      'total', v_dec.total_insurable_turnover),
    'commercial_underwriter'::tci.user_role);

  return jsonb_build_object('result', 'submitted', 'declaration_id', v_dec.id);
end;
$$;

-- Acceptance freezes the coverage split. From here the declaration is
-- evidence, not a draft: 0027 replaces this function to also write the
-- premium entry, on exactly this frozen basis.
create function tci.accept_declaration(p_declaration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dec tci.declarations%rowtype;
  v_policy tci.policies%rowtype;
begin
  if not tci.has_role('commercial_underwriter', 'admin') then
    raise exception 'only commercial underwriting may accept a declaration'
      using errcode = 'P0004';
  end if;

  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  if not tci.declaration_transition_allowed(v_dec.status, 'accepted') then
    raise exception 'a declaration cannot go from % to accepted', v_dec.status
      using errcode = 'P0001';
  end if;

  select * into v_policy from tci.policies where id = v_dec.policy_id;

  -- Freeze the split exactly as it stands now.
  -- The classification is computed in a subquery over its OWN alias and then
  -- joined back by id: an UPDATE ... FROM LATERAL cannot reference the row
  -- being updated, which is what a lateral over `l` would need.
  update tci.declaration_lines l
     set coverage_basis   = c.coverage_basis,
         covered_amount   = c.covered_amount,
         uncovered_excess = c.uncovered_excess,
         updated_at       = now()
    from (
      select src.id,
             cl.coverage_basis,
             cl.covered_amount,
             cl.uncovered_excess
        from tci.declaration_lines src
        cross join lateral tci.classify_declaration_line(
               tci.buyer_has_effective_limit(v_dec.policy_id, src.entity_id),
               src.insurable_turnover,
               v_policy.discretionary_limit
             ) cl
       where src.declaration_id = p_declaration_id
    ) c
   where l.id = c.id;

  update tci.declarations
     set status = 'accepted',
         accepted_by = (select auth.uid()),
         accepted_at = now(),
         updated_at = now()
   where id = p_declaration_id
   returning * into v_dec;

  perform tci.emit_workflow_event(
    'declaration.accepted', 'declaration', v_dec.id,
    jsonb_build_object('policy_id', v_dec.policy_id, 'period_start', v_dec.period_start),
    'sales'::tci.user_role);

  -- Shipping outside cover is a commercial conversation, so it is reported
  -- as its own event rather than buried in the acceptance.
  if exists (
    select 1 from tci.v_declaration_lines v
     where v.declaration_id = p_declaration_id
       and v.coverage_basis = 'uncovered_excess'
  ) then
    perform tci.emit_workflow_event(
      'declaration.uncovered_excess', 'declaration', v_dec.id,
      jsonb_build_object(
        'policy_id', v_dec.policy_id,
        'uncovered_excess', (select uncovered_excess from tci.v_declaration_totals
                              where declaration_id = p_declaration_id)),
      'commercial_underwriter'::tci.user_role);
  end if;

  return jsonb_build_object('result', 'accepted', 'declaration_id', v_dec.id);
end;
$$;

create function tci.dispute_declaration(p_declaration_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dec tci.declarations%rowtype;
begin
  if not tci.has_role('commercial_underwriter', 'sales', 'admin') then
    raise exception 'not allowed to dispute a declaration' using errcode = 'P0004';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'a dispute needs a reason the policyholder can act on'
      using errcode = 'P0001';
  end if;

  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  if not tci.declaration_transition_allowed(v_dec.status, 'disputed') then
    raise exception 'a declaration cannot go from % to disputed', v_dec.status
      using errcode = 'P0001';
  end if;

  update tci.declarations
     set status = 'disputed',
         disputed_by = (select auth.uid()),
         disputed_at = now(),
         dispute_note = p_note,
         updated_at = now()
   where id = p_declaration_id
   returning * into v_dec;

  perform tci.emit_workflow_event(
    'declaration.disputed', 'declaration', v_dec.id,
    jsonb_build_object('policy_id', v_dec.policy_id, 'note', p_note),
    'client'::tci.user_role);

  return jsonb_build_object('result', 'disputed', 'declaration_id', v_dec.id);
end;
$$;

-- A correction is a NEW declaration for the same period that supersedes the
-- old one. The old row keeps its lines, its acceptance and its premium entry;
-- the delta between the two is what the screens show.
create function tci.correct_declaration(p_declaration_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old tci.declarations%rowtype;
  v_new tci.declarations%rowtype;
begin
  select * into v_old from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  if not tci.declaration_transition_allowed(v_old.status, 'corrected') then
    raise exception 'only an accepted or disputed declaration can be corrected (this one is %)',
      v_old.status using errcode = 'P0001';
  end if;

  -- Supersede FIRST. declarations_live_period_uq allows one non-corrected row
  -- per (policy, period), so inserting the correction while the original is
  -- still live violates it and no declaration could ever be corrected.
  update tci.declarations
     set status = 'corrected', superseded_at = now(), updated_at = now()
   where id = v_old.id;

  insert into tci.declarations (
    policy_id, period_start, period_end, status, currency_code,
    note, supersedes_id
  ) values (
    v_old.policy_id, v_old.period_start, v_old.period_end, 'draft',
    v_old.currency_code, p_note, v_old.id
  ) returning * into v_new;

  -- Carry the lines over so the correction starts from what was declared,
  -- WITHOUT the frozen split: the new declaration will be classified on its
  -- own facts when it is accepted.
  insert into tci.declaration_lines (
    declaration_id, entity_id, insurable_turnover, overdue_amount, line_note
  )
  select v_new.id, l.entity_id, l.insurable_turnover, l.overdue_amount, l.line_note
    from tci.declaration_lines l
   where l.declaration_id = v_old.id;

  perform tci.emit_workflow_event(
    'declaration.corrected', 'declaration', v_new.id,
    jsonb_build_object('policy_id', v_new.policy_id, 'supersedes', v_old.id),
    'commercial_underwriter'::tci.user_role);

  return jsonb_build_object(
    'result', 'corrected', 'declaration_id', v_new.id, 'supersedes', v_old.id);
end;
$$;

grant execute on function tci.submit_declaration(uuid) to authenticated;
grant execute on function tci.accept_declaration(uuid) to authenticated;
grant execute on function tci.dispute_declaration(uuid, text) to authenticated;
grant execute on function tci.correct_declaration(uuid, text) to authenticated;
grant execute on function tci.buyer_has_effective_limit(uuid, uuid) to authenticated;
grant execute on function tci.classify_declaration_line(boolean, numeric, numeric) to authenticated;
grant execute on function tci.declaration_transition_allowed(tci.declaration_status, tci.declaration_status) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Assertions - the migration proves its own shape
-- ---------------------------------------------------------------------------

do $$
declare
  v_basis tci.coverage_basis;
  v_covered numeric;
  v_excess numeric;
begin
  -- With a limit: everything is covered, whatever the DL says.
  select * into v_basis, v_covered, v_excess
    from tci.classify_declaration_line(true, 1000, 100);
  if v_basis <> 'limit' or v_covered <> 1000 or v_excess <> 0 then
    raise exception 'classification with a limit is wrong: % % %', v_basis, v_covered, v_excess;
  end if;

  -- No limit, inside the DL.
  select * into v_basis, v_covered, v_excess
    from tci.classify_declaration_line(false, 80, 100);
  if v_basis <> 'discretionary' or v_covered <> 80 or v_excess <> 0 then
    raise exception 'classification inside the DL is wrong: % % %', v_basis, v_covered, v_excess;
  end if;

  -- No limit, over the DL: cover stops at the DL.
  select * into v_basis, v_covered, v_excess
    from tci.classify_declaration_line(false, 250, 100);
  if v_basis <> 'uncovered_excess' or v_covered <> 100 or v_excess <> 150 then
    raise exception 'classification over the DL is wrong: % % %', v_basis, v_covered, v_excess;
  end if;

  -- Exactly at the DL is still covered.
  select * into v_basis, v_covered, v_excess
    from tci.classify_declaration_line(false, 100, 100);
  if v_basis <> 'discretionary' or v_excess <> 0 then
    raise exception 'classification exactly at the DL is wrong: % %', v_basis, v_excess;
  end if;

  if tci.declaration_transition_allowed('accepted', 'submitted') then
    raise exception 'accepted -> submitted must not be allowed';
  end if;
  if not tci.declaration_transition_allowed('disputed', 'submitted') then
    raise exception 'disputed -> submitted must be allowed';
  end if;
end
$$;
