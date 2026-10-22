-- What: auto decisions on credit limits — the Auto Decision Threshold (ADT),
--       after Allianz Trade / Euler Hermes practice.
--         * tci.buyer_adt              per BUYER (a legal entity), set by a
--                                      credit underwriter at the buyer's
--                                      review: the maximum amount of one auto
--                                      decision, how many auto decisions, the
--                                      rating band it was set at. One live row
--                                      per buyer (active or suspended); a new
--                                      setting REPLACES it, nothing is edited,
--                                      so the rows are the history. Used =
--                                      the auto decisions charged to the row,
--                                      counted, never a stored counter
--         * tci.buyer_adt_blocks       the manual ban on auto decisions
--         * tci.auto_decision_attempts every evaluation: decided or not, the
--                                      reasons (i18n keys), and the snapshot of
--                                      rating, recommended limit and ADT at
--                                      that moment
--         * the rule                   evaluated when a limit request is
--                                      SUBMITTED (a tenth trigger on
--                                      tci.workflow_events, after the Agenda
--                                      opened its task), ALL of: the global
--                                      switch is on; the buyer has an active
--                                      ADT with auto decisions left; the
--                                      request is on an ACTIVE policy; the
--                                      requested limit <= the ADT amount; the
--                                      recommended limit of the latest rating
--                                      >= the requested limit; and no stop
--                                      factor — an open NOA, a claim, a revoked
--                                      (suspended) limit, the group over its
--                                      limit with this amount, a manual ban,
--                                      financials older than the configured
--                                      age. Otherwise the request goes to a
--                                      credit underwriter as before, with the
--                                      reasons recorded. No partial auto
--                                      decisions
--         * the auto decision          approved for the requested amount, the
--                                      policy's maximum payment terms, valid
--                                      for the configured number of months,
--                                      system-generated (no author), released
--                                      AT ONCE (no commercial stage, no sales
--                                      window), charging ONE auto decision
--                                      whatever the amount
--         * suspension                 a downgrade below the band the ADT was
--                                      set at, a new stop factor or stale
--                                      financials suspend it; the credit desk
--                                      gets «Пересмотр байера / обновить ADT»
--                                      (adt_review), also when it is used up
--         * workflow_settings          auto_decisions_enabled (OFF), the
--                                      validity in months (12) and the
--                                      maximum age of financials (15 months)
-- Why:  owner request (2026-10-22). Switch it on only after the rating
--       engine is calibrated and the analytics service is hosted.
--
-- Who sees what: the ADT parameters, the attempts and the report are for
-- credit underwriting and admin only — not for sales, commercial
-- underwriting or clients. An auto decision itself is an ordinary decision
-- row marked system_reason_key = 'limits.auto.adt'.

-- ---------------------------------------------------------------------------
-- 1. Settings, types, task type
-- ---------------------------------------------------------------------------
alter type tci.task_type add value if not exists 'adt_review';

alter table tci.workflow_settings
  add column auto_decisions_enabled boolean not null default false,
  add column adt_limit_validity_months integer not null default 12
    check (adt_limit_validity_months between 1 and 60),
  add column adt_financials_max_age_months integer not null default 15
    check (adt_financials_max_age_months between 3 and 60);

comment on column tci.workflow_settings.auto_decisions_enabled is
  'Auto decisions (ADT, 0061) run only while this is true. Off by default: switch on after the rating engine is calibrated and the analytics service is hosted.';

create type tci.adt_status as enum ('active', 'suspended', 'replaced', 'disabled');

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table tci.buyer_adt (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references tci.legal_entities (id),
  max_amount        numeric(18,2) not null check (max_amount > 0),
  currency_code     char(3) not null references tci.currencies (code),
  total_count       integer not null check (total_count between 1 and 1000),
  grade_band        tci.grade_band not null,
  assessment_id     uuid references tci.credit_assessments (id),
  comment           text,
  status            tci.adt_status not null default 'active',
  suspended_reason  text,
  suspended_at      timestamptz,
  ended_at          timestamptz,
  ended_by          uuid references auth.users (id),
  set_by            uuid not null references auth.users (id),
  set_at            timestamptz not null default now(),
  constraint buyer_adt_suspension check ((status = 'suspended') = (suspended_reason is not null)),
  constraint buyer_adt_ended check ((status in ('replaced', 'disabled')) = (ended_at is not null))
);
create unique index buyer_adt_live_uq on tci.buyer_adt (entity_id) where status in ('active', 'suspended');
create index buyer_adt_entity_idx on tci.buyer_adt (entity_id, set_at desc);

comment on table tci.buyer_adt is
  'Auto Decision Threshold per buyer (0061): the largest single auto decision and how many. One live row per buyer; a new setting replaces it (history = the rows). Used = auto decisions charged (credit_limit_decisions.adt_id).';

create table tci.buyer_adt_blocks (
  entity_id   uuid primary key references tci.legal_entities (id),
  blocked     boolean not null,
  reason      text,
  set_by      uuid not null references auth.users (id),
  set_at      timestamptz not null default now()
);
comment on table tci.buyer_adt_blocks is
  'The manual ban on auto decisions for a buyer (0061). Current state; every change is also a workflow event.';

create table tci.auto_decision_attempts (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references tci.credit_limit_requests (id),
  entity_id     uuid not null references tci.legal_entities (id),
  policy_id     uuid references tci.policies (id),
  adt_id        uuid references tci.buyer_adt (id),
  decided       boolean not null,
  decision_id   uuid references tci.credit_limit_decisions (id),
  reasons       text[] not null default '{}',
  snapshot      jsonb not null default '{}'::jsonb,
  attempted_at  timestamptz not null default now(),
  constraint auto_decision_attempts_shape check (decided = (decision_id is not null)
                                                 and (decided = (cardinality(reasons) = 0)))
);
create index auto_decision_attempts_request_idx on tci.auto_decision_attempts (request_id, attempted_at desc);
create index auto_decision_attempts_entity_idx on tci.auto_decision_attempts (entity_id, attempted_at desc);

comment on table tci.auto_decision_attempts is
  'Every ADT evaluation of a submitted limit request (0061): decided, or why not (i18n keys under limits.auto.reasons.*), with the snapshot of rating, recommended limit and ADT at that moment. Append-only.';

alter table tci.credit_limit_decisions
  add column adt_id uuid references tci.buyer_adt (id);
comment on column tci.credit_limit_decisions.adt_id is
  'The ADT an auto decision was charged to (0061); null for every decision made by a person.';
create index credit_limit_decisions_adt_idx on tci.credit_limit_decisions (adt_id) where adt_id is not null;

-- Nothing is edited by hand: no API write grant on any of the three; the
-- live ADT row changes only through the functions below.
alter table tci.buyer_adt enable row level security;
alter table tci.buyer_adt_blocks enable row level security;
alter table tci.auto_decision_attempts enable row level security;

create policy "buyer_adt: credit desk" on tci.buyer_adt for select to authenticated
  using (tci.has_role('admin', 'credit_underwriter'));
create policy "buyer_adt_blocks: credit desk" on tci.buyer_adt_blocks for select to authenticated
  using (tci.has_role('admin', 'credit_underwriter'));
create policy "auto_decision_attempts: credit desk" on tci.auto_decision_attempts for select to authenticated
  using (tci.has_role('admin', 'credit_underwriter'));

grant select on tci.buyer_adt, tci.buyer_adt_blocks, tci.auto_decision_attempts to authenticated;
grant select on tci.buyer_adt, tci.buyer_adt_blocks, tci.auto_decision_attempts to service_role;

-- ---------------------------------------------------------------------------
-- 3. Pure helpers
-- ---------------------------------------------------------------------------
-- Band order, best first; unrated counts as the worst.
create function tci.band_rank(p_band tci.grade_band)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_band when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'D' then 4 else 5 end
$$;

-- An amount in UZS, or NULL when its currency has no rate (never raises).
create function tci.uzs_or_null(p_amount numeric, p_ccy char(3))
returns numeric
language sql
stable
set search_path = ''
as $$ select p_amount * tci.latest_uzs_rate(p_ccy) $$;

-- Auto decisions charged to an ADT row.
create function tci.adt_used(p_adt_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select count(*)::int from tci.credit_limit_decisions d where d.adt_id = p_adt_id $$;

-- ---------------------------------------------------------------------------
-- 4. Stop factors and staleness for a buyer
-- ---------------------------------------------------------------------------
-- The reasons (i18n keys) no auto decision may be made for this buyer now,
-- whatever the request: open NOA, claims, a revoked limit in force, a ban,
-- stale or missing financials. Request-specific checks are in the rule.
create function tci.adt_buyer_stops(p_entity_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out     text[] := '{}';
  v_age     integer;
  v_latest  date;
begin
  perform tci.require_internal_call();
  if exists (select 1 from tci.overdue_notifications n where n.entity_id = p_entity_id and n.status = 'open') then
    v_out := v_out || 'open_noa'::text;
  end if;
  if exists (select 1 from tci.claims c where c.entity_id = p_entity_id and c.status not in ('draft', 'withdrawn')) then
    v_out := v_out || 'claims'::text;
  end if;
  if exists (select 1 from tci.credit_limit_decisions d
               join tci.credit_limit_requests r on r.id = d.request_id
              where r.entity_id = p_entity_id and d.outcome = 'revoked' and d.lifecycle = 'effective') then
    v_out := v_out || 'limit_revoked'::text;
  end if;
  if exists (select 1 from tci.buyer_adt_blocks b where b.entity_id = p_entity_id and b.blocked) then
    v_out := v_out || 'manual_block'::text;
  end if;
  select s.adt_financials_max_age_months into v_age from tci.workflow_settings s where s.id;
  select max(f.period_end_date) into v_latest from tci.financial_statements f where f.entity_id = p_entity_id;
  if v_latest is null then
    v_out := v_out || 'no_financials'::text;
  elsif v_latest < (current_date - make_interval(months => v_age))::date then
    v_out := v_out || 'stale_financials'::text;
  end if;
  return v_out;
end;
$$;

-- Suspends the live ADT of a buyer (with the first reason) and asks the
-- credit desk to review it. Idempotent: an already suspended row is left as
-- it is.
create function tci.suspend_buyer_adt(p_entity_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_adt tci.buyer_adt%rowtype;
begin
  perform tci.require_internal_call();
  select * into v_adt from tci.buyer_adt where entity_id = p_entity_id and status = 'active' for update;
  if not found then
    return false;
  end if;
  update tci.buyer_adt
     set status = 'suspended', suspended_reason = p_reason, suspended_at = now()
   where id = v_adt.id;
  perform tci.emit_workflow_event('adt.suspended', 'legal_entity', p_entity_id,
    jsonb_build_object('adt_id', v_adt.id, 'reason', p_reason), 'credit_underwriter'::tci.user_role);
  return true;
end;
$$;

-- Re-checks a buyer's live ADT against the facts: a downgrade below the band
-- it was set at, or any stop factor, suspends it.
create function tci.recheck_buyer_adt(p_entity_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adt   tci.buyer_adt%rowtype;
  v_band  tci.grade_band;
  v_stops text[];
begin
  perform tci.require_internal_call();
  select * into v_adt from tci.buyer_adt where entity_id = p_entity_id and status = 'active';
  if not found then
    return false;
  end if;
  select tci.grade_band_for_assessment(a.id) into v_band
    from tci.credit_assessments a where a.entity_id = p_entity_id order by a.created_at desc limit 1;
  if v_band is not null and tci.band_rank(v_band) > tci.band_rank(v_adt.grade_band) then
    return tci.suspend_buyer_adt(p_entity_id, 'downgrade');
  end if;
  v_stops := tci.adt_buyer_stops(p_entity_id);
  if cardinality(v_stops) > 0 then
    return tci.suspend_buyer_adt(p_entity_id, v_stops[1]);
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Setting, disabling, banning (credit underwriting / admin)
-- ---------------------------------------------------------------------------
create function tci.set_buyer_adt(
  p_entity_id     uuid,
  p_max_amount    numeric,
  p_currency      char(3),
  p_total_count   integer,
  p_assessment_id uuid default null,
  p_comment       text default null)
returns tci.buyer_adt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assessment uuid;
  v_band       tci.grade_band;
  v_amount_uzs numeric;
  v_row        tci.buyer_adt%rowtype;
begin
  perform tci.require_role('admin', 'credit_underwriter');
  perform tci.begin_trusted_call();
  if p_max_amount is null or p_max_amount <= 0 or p_total_count is null or p_total_count < 1 then
    raise exception 'adt_invalid: the ADT needs a positive amount and at least one decision' using errcode = 'P0001';
  end if;
  -- The band of the buyer's latest rating (or the one named): an ADT is set
  -- at a review, on the rating it confirms.
  if p_assessment_id is not null then
    select a.id into v_assessment from tci.credit_assessments a
     where a.id = p_assessment_id and a.entity_id = p_entity_id;
    if not found then
      raise exception 'adt_assessment_mismatch: that rating is not this buyer''s' using errcode = 'P0001';
    end if;
  else
    select a.id into v_assessment from tci.credit_assessments a
     where a.entity_id = p_entity_id order by a.created_at desc limit 1;
  end if;
  if v_assessment is null then
    raise exception 'adt_no_rating: rate the buyer before setting an ADT' using errcode = 'P0001';
  end if;
  v_band := tci.grade_band_for_assessment(v_assessment);

  -- Not above the setter's own authority for that band.
  v_amount_uzs := tci.uzs_or_null(p_max_amount, p_currency);
  if v_amount_uzs is null then
    raise exception 'adt_fx_missing: no UZS rate for %', p_currency using errcode = 'P0001';
  end if;
  if not tci.has_role('admin') and v_amount_uzs > tci.my_authority_uzs(v_band) then
    raise exception 'adt_beyond_authority: the ADT amount is beyond your authority for rating band %', v_band
      using errcode = 'P0001';
  end if;

  update tci.buyer_adt
     set status = 'replaced', ended_at = now(), ended_by = (select auth.uid()),
         suspended_reason = null, suspended_at = null
   where entity_id = p_entity_id and status in ('active', 'suspended');

  insert into tci.buyer_adt (entity_id, max_amount, currency_code, total_count, grade_band,
                             assessment_id, comment, set_by)
  values (p_entity_id, p_max_amount, p_currency, p_total_count, v_band, v_assessment,
          nullif(btrim(p_comment), ''), (select auth.uid()))
  returning * into v_row;

  perform tci.emit_workflow_event('adt.set', 'legal_entity', p_entity_id,
    jsonb_build_object('adt_id', v_row.id, 'max_amount', p_max_amount, 'currency', p_currency,
                       'total_count', p_total_count, 'grade_band', v_band), null);
  return v_row;
end;
$$;

create function tci.disable_buyer_adt(p_entity_id uuid, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin', 'credit_underwriter');
  perform tci.begin_trusted_call();
  update tci.buyer_adt
     set status = 'disabled', ended_at = now(), ended_by = (select auth.uid()),
         suspended_reason = null, suspended_at = null
   where entity_id = p_entity_id and status in ('active', 'suspended');
  if not found then
    raise exception 'adt_none: this buyer has no ADT' using errcode = 'P0002';
  end if;
  perform tci.emit_workflow_event('adt.disabled', 'legal_entity', p_entity_id,
    jsonb_build_object('comment', nullif(btrim(p_comment), '')), null);
end;
$$;

create function tci.set_buyer_adt_block(p_entity_id uuid, p_blocked boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin', 'credit_underwriter');
  perform tci.begin_trusted_call();
  if p_blocked and coalesce(btrim(p_reason), '') = '' then
    raise exception 'adt_block_reason: say why auto decisions are banned for this buyer' using errcode = 'P0001';
  end if;
  insert into tci.buyer_adt_blocks (entity_id, blocked, reason, set_by)
  values (p_entity_id, p_blocked, nullif(btrim(p_reason), ''), (select auth.uid()))
  on conflict (entity_id) do update
     set blocked = excluded.blocked, reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  perform tci.emit_workflow_event(case when p_blocked then 'adt.blocked' else 'adt.unblocked' end,
    'legal_entity', p_entity_id, jsonb_build_object('reason', nullif(btrim(p_reason), '')), null);
  if p_blocked then
    perform tci.suspend_buyer_adt(p_entity_id, 'manual_block');
  end if;
end;
$$;

create function tci.set_auto_decision_settings(
  p_enabled boolean, p_validity_months integer default null, p_financials_max_age_months integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin');
  update tci.workflow_settings
     set auto_decisions_enabled = coalesce(p_enabled, false),
         adt_limit_validity_months = coalesce(p_validity_months, adt_limit_validity_months),
         adt_financials_max_age_months = coalesce(p_financials_max_age_months, adt_financials_max_age_months),
         updated_by = (select auth.uid()), updated_at = now()
   where id;
  return tci.auto_decision_settings();
end;
$$;

create function tci.auto_decision_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin', 'credit_underwriter');
  return (select jsonb_build_object(
            'enabled', s.auto_decisions_enabled,
            'validity_months', s.adt_limit_validity_months,
            'financials_max_age_months', s.adt_financials_max_age_months)
            from tci.workflow_settings s where s.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The rule
-- ---------------------------------------------------------------------------
create function tci.try_auto_decision(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings   tci.workflow_settings%rowtype;
  v_request    tci.credit_limit_requests%rowtype;
  v_policy     tci.policies%rowtype;
  v_adt        tci.buyer_adt%rowtype;
  v_assessment tci.credit_assessments%rowtype;
  v_reasons    text[] := '{}';
  v_used       integer := 0;
  v_req_uzs    numeric;
  v_adt_uzs    numeric;
  v_rec_uzs    numeric;
  v_group      jsonb;
  v_snapshot   jsonb;
  v_decision   tci.credit_limit_decisions%rowtype;
  v_band       tci.grade_band;
begin
  perform tci.require_internal_call();
  select * into v_settings from tci.workflow_settings where id;
  if not v_settings.auto_decisions_enabled then
    return jsonb_build_object('result', 'disabled');      -- nothing recorded: the feature is off
  end if;

  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found or v_request.status <> 'submitted' then
    return jsonb_build_object('result', 'not_submitted');
  end if;

  select * into v_adt from tci.buyer_adt
   where entity_id = v_request.entity_id and status in ('active', 'suspended') for update;
  if not found then
    v_reasons := v_reasons || 'no_adt'::text;
  else
    -- A buyer whose facts moved since: suspend first, then judge.
    perform tci.recheck_buyer_adt(v_request.entity_id);
    select * into v_adt from tci.buyer_adt where id = v_adt.id;
    v_used := tci.adt_used(v_adt.id);
    if v_adt.status = 'suspended' then
      v_reasons := v_reasons || 'adt_suspended'::text;
    end if;
    if v_used >= v_adt.total_count then
      v_reasons := v_reasons || 'adt_exhausted'::text;
    end if;
  end if;

  if v_request.policy_id is null then
    v_reasons := v_reasons || 'no_policy'::text;
  else
    select * into v_policy from tci.policies where id = v_request.policy_id;
    if v_policy.status <> 'active' then
      v_reasons := v_reasons || 'policy_not_active'::text;
    end if;
  end if;

  v_req_uzs := tci.uzs_or_null(v_request.requested_amount, v_request.currency_code);
  if v_adt.id is not null then
    v_adt_uzs := tci.uzs_or_null(v_adt.max_amount, v_adt.currency_code);
    if v_req_uzs is null or v_adt_uzs is null then
      v_reasons := v_reasons || 'fx_missing'::text;
    elsif v_req_uzs > v_adt_uzs then
      v_reasons := v_reasons || 'above_adt_amount'::text;
    end if;
  end if;

  select * into v_assessment from tci.credit_assessments a
   where a.entity_id = v_request.entity_id order by a.created_at desc limit 1;
  if not found then
    v_reasons := v_reasons || 'no_rating'::text;
  else
    v_band := tci.grade_band_for_assessment(v_assessment.id);
    v_rec_uzs := tci.uzs_or_null(v_assessment.suggested_limit, v_assessment.limit_currency);
    if v_rec_uzs is null or v_req_uzs is null then
      v_reasons := v_reasons || 'fx_missing'::text;
    elsif v_rec_uzs < v_req_uzs then
      v_reasons := v_reasons || 'above_recommended'::text;
    end if;
  end if;

  v_reasons := v_reasons || tci.adt_buyer_stops(v_request.entity_id);

  if v_req_uzs is not null then
    v_group := tci.group_exposure_preflight(
      v_request.entity_id, v_request.requested_amount, v_request.currency_code,
      tci.limit_scope(v_request.policy_id, v_request.insurance_request_id));
    if coalesce((v_group ->> 'over_limit')::boolean, false) then
      v_reasons := v_reasons || 'group_limit'::text;
    end if;
  end if;

  -- One reason once, in the order found.
  select coalesce(array_agg(r order by first_pos), '{}') into v_reasons
    from (select r, min(o) as first_pos from unnest(v_reasons) with ordinality as u(r, o) group by r) x;

  v_snapshot := jsonb_build_object(
    'rating_grade', v_assessment.rating_grade, 'rating_score', v_assessment.rating_score,
    'grade_band', v_band, 'assessment_id', v_assessment.id,
    'recommended_limit', v_assessment.suggested_limit, 'recommended_currency', v_assessment.limit_currency,
    'requested_amount', v_request.requested_amount, 'requested_currency', v_request.currency_code,
    'adt_id', v_adt.id, 'adt_max_amount', v_adt.max_amount, 'adt_currency', v_adt.currency_code,
    'adt_total', v_adt.total_count, 'adt_used_before', v_used,
    'adt_remaining_before', case when v_adt.id is null then null else v_adt.total_count - v_used end,
    'group', v_group);

  if cardinality(v_reasons) > 0 then
    insert into tci.auto_decision_attempts (request_id, entity_id, policy_id, adt_id, decided, reasons, snapshot)
    values (p_request_id, v_request.entity_id, v_request.policy_id, v_adt.id, false, v_reasons, v_snapshot);
    return jsonb_build_object('result', 'to_underwriter', 'reasons', to_jsonb(v_reasons));
  end if;

  -- All conditions hold: the auto decision, released at once.
  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, valid_until,
    based_on_assessment_id, payment_terms_days, decided_by, system_generated, system_reason_key,
    released_at, release_kind, adt_id)
  values (
    p_request_id, 'approved', v_request.requested_amount, v_request.currency_code, current_date,
    (current_date + make_interval(months => v_settings.adt_limit_validity_months))::date,
    v_assessment.id, v_policy.max_payment_terms_days, null, true, 'limits.auto.adt',
    now(), 'immediate', v_adt.id)
  returning * into v_decision;

  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r
   where r.id = d.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(v_request.policy_id, v_request.insurance_request_id)
     and r.entity_id = v_request.entity_id;

  update tci.credit_limit_requests set status = 'decided', decided_at = now() where id = p_request_id;

  insert into tci.auto_decision_attempts (request_id, entity_id, policy_id, adt_id, decided, decision_id, reasons, snapshot)
  values (p_request_id, v_request.entity_id, v_request.policy_id, v_adt.id, true, v_decision.id, '{}',
          v_snapshot || jsonb_build_object('adt_remaining_after', v_adt.total_count - v_used - 1));

  perform tci.emit_workflow_event('limit.auto_decided', 'credit_limit_decision', v_decision.id,
    jsonb_build_object('request_id', p_request_id, 'entity_id', v_request.entity_id,
                       'amount', v_request.requested_amount, 'currency', v_request.currency_code,
                       'adt_id', v_adt.id, 'remaining', v_adt.total_count - v_used - 1),
    'client'::tci.user_role);

  -- Used up: the credit desk reviews the buyer.
  if v_adt.total_count - v_used - 1 <= 0 then
    perform tci.emit_workflow_event('adt.exhausted', 'legal_entity', v_request.entity_id,
      jsonb_build_object('adt_id', v_adt.id), 'credit_underwriter'::tci.user_role);
  end if;

  return jsonb_build_object('result', 'auto_decided', 'decision_id', v_decision.id,
                            'remaining', v_adt.total_count - v_used - 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The tenth trigger: evaluate on submission; react to new facts
-- ---------------------------------------------------------------------------
-- Named to fire AFTER workflow_events_to_tasks (triggers fire in name
-- order), so the request's own Agenda task exists and the auto decision
-- closes it like any decision.
create function tci.handle_adt_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity uuid;
  v_name   text;
begin
  if new.event_type not in ('limit.request_submitted', 'rating.created', 'noa.filed', 'claim.created',
                            'limit.auto_decided', 'adt.suspended', 'adt.exhausted', 'adt.set', 'adt.disabled') then
    return null;
  end if;
  perform tci.begin_trusted_call();

  if new.event_type = 'limit.request_submitted' then
    perform tci.try_auto_decision(new.object_id);

  elsif new.event_type = 'limit.auto_decided' then
    -- The auto decision is final for this request: nothing is left to decide.
    perform tci.close_tasks(array['limit_needs_decision', 'limit_escalated']::tci.task_type[],
                            (new.payload ->> 'request_id')::uuid);

  elsif new.event_type in ('rating.created', 'noa.filed', 'claim.created') then
    v_entity := case new.event_type
                  when 'rating.created' then (new.payload ->> 'entity_id')::uuid
                  when 'noa.filed' then (select n.entity_id from tci.overdue_notifications n where n.id = new.object_id)
                  else (select c.entity_id from tci.claims c where c.id = new.object_id) end;
    if v_entity is not null then
      perform tci.recheck_buyer_adt(v_entity);
    end if;

  elsif new.event_type in ('adt.suspended', 'adt.exhausted') then
    select e.name into v_name from tci.legal_entities e where e.id = new.object_id;
    perform tci.open_task(
      'adt_review', 'legal_entity', new.object_id,
      'agenda.tasks.adt_review_' || case when new.event_type = 'adt.exhausted' then 'exhausted'
                                         else new.payload ->> 'reason' end,
      jsonb_build_object('entity_id', new.object_id, 'entity_name', v_name,
                         'reason', coalesce(new.payload ->> 'reason', 'exhausted')),
      'credit_underwriter'::tci.user_role, null, null, 'high', new.id);

  elsif new.event_type in ('adt.set', 'adt.disabled') then
    perform tci.close_tasks(array['adt_review']::tci.task_type[], new.object_id);
  end if;
  return null;
end;
$$;

create trigger workflow_events_zz_auto_decisions
  after insert on tci.workflow_events
  for each row execute function tci.handle_adt_event();

-- Stale financials are a matter of time: found lazily, like every other
-- time-based Agenda kind (called from refresh_agenda).
create function tci.refresh_adt_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_n   integer := 0;
begin
  perform tci.require_internal_call();
  for v_row in select a.entity_id from tci.buyer_adt a where a.status = 'active' loop
    if tci.recheck_buyer_adt(v_row.entity_id) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Reading: the buyer's ADT block and the report (credit desk only)
-- ---------------------------------------------------------------------------
create function tci.buyer_adt_state(p_entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_live tci.buyer_adt%rowtype;
begin
  perform tci.require_role('admin', 'credit_underwriter');
  select * into v_live from tci.buyer_adt where entity_id = p_entity_id and status in ('active', 'suspended');
  return jsonb_build_object(
    'enabled', (select s.auto_decisions_enabled from tci.workflow_settings s where s.id),
    'live', case when v_live.id is null then null else jsonb_build_object(
        'id', v_live.id, 'status', v_live.status, 'max_amount', v_live.max_amount,
        'currency', v_live.currency_code, 'total', v_live.total_count,
        'used', tci.adt_used(v_live.id), 'remaining', v_live.total_count - tci.adt_used(v_live.id),
        'grade_band', v_live.grade_band, 'suspended_reason', v_live.suspended_reason,
        'suspended_at', v_live.suspended_at, 'comment', v_live.comment,
        'set_by', v_live.set_by, 'set_by_name', tci.staff_name(v_live.set_by), 'set_at', v_live.set_at) end,
    'block', (select jsonb_build_object('blocked', b.blocked, 'reason', b.reason, 'set_at', b.set_at,
                                        'set_by_name', tci.staff_name(b.set_by))
                from tci.buyer_adt_blocks b where b.entity_id = p_entity_id),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'status', a.status, 'max_amount', a.max_amount, 'currency', a.currency_code,
        'total', a.total_count, 'used', tci.adt_used(a.id), 'grade_band', a.grade_band,
        'set_by_name', tci.staff_name(a.set_by), 'set_at', a.set_at, 'ended_at', a.ended_at,
        'suspended_reason', a.suspended_reason, 'comment', a.comment) order by a.set_at desc)
        from tci.buyer_adt a where a.entity_id = p_entity_id), '[]'::jsonb));
end;
$$;

-- Auto decisions, for the report and the buyer's list: who, for whom, how
-- much, charged to which ADT, and what is left of it now.
create view tci.v_auto_decisions
with (security_invoker = true) as
select att.id as attempt_id, att.attempted_at as decided_at, att.request_id, att.decision_id,
       att.entity_id as buyer_id, buyer.name as buyer_name,
       att.policy_id, pol.policy_number, pol.entity_id as policyholder_id, holder.name as policyholder_name,
       d.approved_amount as amount, d.currency_code, d.lifecycle, d.valid_until,
       att.adt_id, a.max_amount as adt_max_amount, a.currency_code as adt_currency,
       a.total_count as adt_total, a.status as adt_status,
       a.total_count - (select count(*) from tci.credit_limit_decisions x where x.adt_id = a.id)::int as adt_remaining_now,
       att.snapshot
  from tci.auto_decision_attempts att
  join tci.credit_limit_decisions d on d.id = att.decision_id
  join tci.legal_entities buyer on buyer.id = att.entity_id
  left join tci.policies pol on pol.id = att.policy_id
  left join tci.legal_entities holder on holder.id = pol.entity_id
  left join tci.buyer_adt a on a.id = att.adt_id
 where att.decided;

comment on view tci.v_auto_decisions is
  'Auto decisions (ADT, 0061) with buyer, policyholder, amount and the ADT left now. Security invoker: the attempts and ADT tables show rows to the credit desk and admin only.';

grant select on tci.v_auto_decisions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
revoke all on function tci.band_rank(tci.grade_band) from public, anon;
grant execute on function tci.band_rank(tci.grade_band) to authenticated, service_role;
revoke all on function tci.uzs_or_null(numeric, char) from public, anon;
grant execute on function tci.uzs_or_null(numeric, char) to authenticated, service_role;
revoke all on function tci.adt_used(uuid) from public, anon, authenticated;
revoke all on function tci.adt_buyer_stops(uuid) from public, anon, authenticated;
revoke all on function tci.suspend_buyer_adt(uuid, text) from public, anon, authenticated;
revoke all on function tci.recheck_buyer_adt(uuid) from public, anon, authenticated;
revoke all on function tci.try_auto_decision(uuid) from public, anon, authenticated;
revoke all on function tci.handle_adt_event() from public, anon, authenticated;
revoke all on function tci.refresh_adt_tasks() from public, anon, authenticated;
revoke all on function tci.set_buyer_adt(uuid, numeric, char, integer, uuid, text) from public, anon;
grant execute on function tci.set_buyer_adt(uuid, numeric, char, integer, uuid, text) to authenticated;
revoke all on function tci.disable_buyer_adt(uuid, text) from public, anon;
grant execute on function tci.disable_buyer_adt(uuid, text) to authenticated;
revoke all on function tci.set_buyer_adt_block(uuid, boolean, text) from public, anon;
grant execute on function tci.set_buyer_adt_block(uuid, boolean, text) to authenticated;
revoke all on function tci.set_auto_decision_settings(boolean, integer, integer) from public, anon;
grant execute on function tci.set_auto_decision_settings(boolean, integer, integer) to authenticated;
revoke all on function tci.auto_decision_settings() from public, anon;
grant execute on function tci.auto_decision_settings() to authenticated;
revoke all on function tci.buyer_adt_state(uuid) from public, anon;
grant execute on function tci.buyer_adt_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. refresh_agenda: the 0058 body unchanged plus one call (stale
--     financials suspend an ADT lazily)
-- ---------------------------------------------------------------------------
create or replace function tci.refresh_agenda()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_opened int := 0;
  v_row record;
  v_client uuid;
begin
  perform tci.begin_trusted_call();
  if not tci.is_staff() then
    raise exception 'only staff have an agenda' using errcode = '42501';
  end if;

  -- (1) Effective limits expiring within 30 days need a review decision.
  for v_row in
    select v.entity_id, v.policy_id, v.valid_until, v.approved_amount, v.currency_code
    from tci.v_effective_limits v
    where v.valid_until is not null
      and v.valid_until <= current_date + 30
      and v.outcome in ('approved', 'partial')
  loop
    perform tci.open_task(
      'limit_review_due', 'legal_entity', v_row.entity_id,
      'agenda.tasks.limit_review_due',
      jsonb_build_object(
        'entity_id', v_row.entity_id,
        'policy_id', v_row.policy_id,
        'valid_until', v_row.valid_until,
        'amount', v_row.approved_amount,
        'currency', v_row.currency_code),
      'credit_underwriter'::tci.user_role, null,
      v_row.valid_until::timestamptz,
      case when v_row.valid_until <= current_date + 7 then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'limit_review_due'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_effective_limits v
        where v.entity_id = t.object_id
          and v.valid_until is not null
          and v.valid_until <= current_date + 30
          and v.outcome in ('approved', 'partial')
     );

  -- (2) A company carrying an effective limit on a rating older than a year.
  for v_row in
    select distinct v.entity_id
    from tci.v_effective_limits v
    where v.outcome in ('approved', 'partial')
      and not exists (
        select 1 from tci.credit_assessments a
         where a.entity_id = v.entity_id
           and a.created_at > now() - interval '12 months'
      )
  loop
    perform tci.open_task(
      'rating_stale', 'legal_entity', v_row.entity_id,
      'agenda.tasks.rating_stale',
      jsonb_build_object('entity_id', v_row.entity_id),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'rating_stale'
     and t.status = 'open'
     and exists (
       select 1 from tci.credit_assessments a
        where a.entity_id = t.object_id
          and a.created_at > now() - interval '12 months'
     );

  -- (3) NEW: the declaration period that has CLOSED and has not been declared.
  -- Keyed on the policy, not on a declaration row, because the whole point is
  -- that the declaration does not exist yet.
  for v_row in
    select p.id as policy_id,
           p.policy_number,
           p.declaration_frequency,
           tci.declaration_period_start(
             (tci.declaration_period_start(current_date, p.declaration_frequency)
              - interval '1 day')::date,
             p.declaration_frequency) as period_start
    from tci.policies p
    where p.status = 'active'
      -- Only chase a period the policy was actually live for: a policy
      -- incepted this month owes nothing for last month.
      and tci.declaration_period_start(
            (tci.declaration_period_start(current_date, p.declaration_frequency)
             - interval '1 day')::date,
            p.declaration_frequency)
          >= tci.declaration_period_start(p.inception_date, p.declaration_frequency)
  loop
    if not exists (
      select 1 from tci.declarations d
       where d.policy_id = v_row.policy_id
         and d.period_start = v_row.period_start
         and d.status <> 'corrected'
    ) then
      perform tci.open_task(
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'declaration_overdue' else 'declaration_due' end::tci.task_type,
        'policy', v_row.policy_id,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'agenda.tasks.declaration_overdue' else 'agenda.tasks.declaration_due' end,
        jsonb_build_object(
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'period_start', v_row.period_start,
          'period_end', tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency)),
        'sales'::tci.user_role, null,
        (tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30)::timestamptz,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'high' else 'normal' end::tci.task_priority,
        null);
      v_opened := v_opened + 1;
    end if;
  end loop;

  -- Retire chasing tasks once the period HAS been declared, or the policy
  -- stopped being active.
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('declaration_due', 'declaration_overdue')
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.declarations d
          where d.policy_id = t.object_id
            and d.period_start = (t.params->>'period_start')::date
            and d.status <> 'corrected'
       )
       or not exists (
         select 1 from tci.policies p where p.id = t.object_id and p.status = 'active'
       )
     );

  -- (4) instalments falling due, and instalments already past due. Since
  -- 0056 an instalment is owed while it has an OUTSTANDING amount, whatever
  -- its billing status, and the task carries what is still owed.
  for v_row in
    select vi.id, vi.policy_id, vi.sequence, vi.due_date, vi.outstanding, vi.amount,
           vi.invoice_number, p.policy_number, p.currency_code
    from tci.v_premium_instalments vi
    join tci.policies p on p.id = vi.policy_id
    where vi.derived_status <> 'cancelled'
      and vi.outstanding > 0
      and vi.due_date <= current_date + 14
  loop
    perform tci.open_task(
      case when v_row.due_date < current_date
           then 'instalment_overdue' else 'instalment_due' end::tci.task_type,
      'premium_instalment', v_row.id,
      case when v_row.due_date < current_date
           then 'agenda.tasks.instalment_overdue' else 'agenda.tasks.instalment_due' end,
      jsonb_build_object(
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'sequence', v_row.sequence,
        'due_date', v_row.due_date,
        'amount', v_row.outstanding,
        'scheduled', v_row.amount,
        'invoice_number', v_row.invoice_number,
        'currency', v_row.currency_code),
      'commercial_underwriter'::tci.user_role, null,
      v_row.due_date::timestamptz,
      case when v_row.due_date < current_date then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  -- An open task follows what is still owed (a part payment lowers it).
  -- (The owed set is materialised once: the view's allocation is a window
  -- over each policy, which a per-task lookup would recompute.)
  with owed as materialized (
    select vi.id, vi.outstanding from tci.v_premium_instalments vi where vi.outstanding > 0
  )
  update tci.tasks t
     set params = t.params || jsonb_build_object('amount', owed.outstanding)
    from owed
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and owed.id = t.object_id
     and (t.params->>'amount')::numeric is distinct from owed.outstanding;

  with chased as materialized (
    select vi.id from tci.v_premium_instalments vi
     where vi.derived_status <> 'cancelled'
       and vi.outstanding > 0
       and vi.due_date <= current_date + 14
  )
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and not exists (select 1 from chased c where c.id = t.object_id);

  -- (5) NEW: an open overdue notification whose waiting period has run. The
  -- debt is now claimable, so the policyholder is told they may file and
  -- claims is told to expect it. Neither is a claim: only the policyholder
  -- decides that a debt is a loss.
  for v_row in
    select n.id, n.policy_id, n.entity_id, n.first_due_date, n.overdue_amount,
           n.currency_code, p.policy_number, p.waiting_period_days,
           (n.first_due_date + p.waiting_period_days) as claimable_from
    from tci.overdue_notifications n
    join tci.policies p on p.id = n.policy_id
    where n.status = 'open'
      and current_date >= n.first_due_date + p.waiting_period_days
      and not exists (
        select 1 from tci.claims c
         where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
  loop
    perform tci.open_task(
      'noa_matured_to_claim', 'overdue_notification', v_row.id,
      'agenda.tasks.noa_matured_to_claim',
      jsonb_build_object(
        'noa_id', v_row.id,
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'entity_id', v_row.entity_id,
        'amount', v_row.overdue_amount,
        'currency', v_row.currency_code,
        'claimable_from', v_row.claimable_from),
      'claims'::tci.user_role, null, v_row.claimable_from::timestamptz, 'normal', null);
    v_opened := v_opened + 1;

    -- Addressed to the individual portal users, never to the client role:
    -- every policyholder holds that role, so a role-targeted task would show
    -- them each other's files.
    for v_client in select tci.policyholder_user_ids(v_row.policy_id) loop
      perform tci.open_task(
        'claim_ready_to_file', 'overdue_notification', v_row.id,
        'agenda.tasks.claim_ready_to_file',
        jsonb_build_object(
          'noa_id', v_row.id,
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'entity_id', v_row.entity_id,
          'amount', v_row.overdue_amount,
          'currency', v_row.currency_code,
          'claimable_from', v_row.claimable_from),
        null, v_client, v_row.claimable_from::timestamptz, 'normal', null);
      v_opened := v_opened + 1;
    end loop;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('noa_matured_to_claim', 'claim_ready_to_file')
     and t.status = 'open'
     and not exists (
       select 1 from tci.overdue_notifications n
        where n.id = t.object_id
          and n.status = 'open'
          and not exists (
            select 1 from tci.claims c
             where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
     );

  -- (6) NEW: retire the reinstatement review once the buyer holds a live limit
  -- again, or the claim file is closed. The credit underwriter's decision IS
  -- the completion signal, so this type needs no button either.
  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        join tci.v_effective_limits v
          on v.policy_id = c.policy_id and v.entity_id = c.entity_id
       where c.id = t.object_id
         and v.outcome in ('approved', 'partial')
     );
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        where c.id = t.object_id and c.status in ('closed', 'withdrawn')
     );

  -- (7) NEW (Phase 6): a group whose exposure has crossed the warning share of
  -- its group limit. Keyed on the ULTIMATE PARENT, which is the group's
  -- identity - there is no group record to key on.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           gl.max_amount, gl.currency_code,
           tci.to_uzs(gl.max_amount, gl.currency_code) as limit_uzs
      from tci.v_group_exposure ge
      join tci.group_limits gl
        on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
       and gl.valid_from <= current_date
       and (gl.valid_to is null or gl.valid_to >= current_date)
     where tci.to_uzs(gl.max_amount, gl.currency_code) > 0
       and ge.exposure_uzs
           >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
  loop
    perform tci.open_task(
      'group_exposure_near_limit', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_exposure_near_limit',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'exposure_uzs', v_row.exposure_uzs,
        'limit_uzs', v_row.limit_uzs,
        'utilisation_pct', round(v_row.exposure_uzs * 100 / v_row.limit_uzs, 1)),
      'credit_underwriter'::tci.user_role, null, null, 'high', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_exposure_near_limit'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_group_exposure ge
        join tci.group_limits gl
          on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
         and gl.valid_from <= current_date
         and (gl.valid_to is null or gl.valid_to >= current_date)
       where ge.ultimate_parent_id = t.object_id
         and tci.to_uzs(gl.max_amount, gl.currency_code) > 0
         and ge.exposure_uzs
             >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
     );

  -- (8) NEW (Phase 6): a group carrying limits with NO group limit set. Not an
  -- error - most single-company "groups" never need one - so it is only raised
  -- where the group actually has more than one member.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           ge.members_with_limits
      from tci.v_group_exposure ge
     where ge.members_with_limits > 1
       and not exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = ge.ultimate_parent_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
  loop
    perform tci.open_task(
      'group_limit_missing', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_limit_missing',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'members_with_limits', v_row.members_with_limits,
        'exposure_uzs', v_row.exposure_uzs),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_limit_missing'
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = t.object_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
       or not exists (
         select 1 from tci.v_group_exposure ge
          where ge.ultimate_parent_id = t.object_id and ge.members_with_limits > 1)
     );

  -- (9) 0055: new statements since the rating. A buyer with live credit
  -- business whose latest statements cover a LATER period than the ones its
  -- current rating was calculated on: the rating is a period behind. The
  -- params carry what the system note says — which statements, who added
  -- them and when, and what the current rating rests on.
  for v_row in
    select w.entity_id, w.assessment_id, w.grade, w.rated_at, w.rated_period_end,
           w.limits_in_force, ca.rating_score,
           fs.id as statement_id, fs.statement_kind, fs.fiscal_year, fs.fiscal_quarter,
           fs.period_end_date, fs.report_type, fs.created_by, fs.created_at
      from tci.v_rating_worklist w
      left join tci.credit_assessments ca on ca.id = w.assessment_id
      join lateral (
        select s.* from tci.financial_statements s
         where s.entity_id = w.entity_id
         order by s.period_end_date desc, s.created_at desc
         limit 1
      ) fs on true
     where w.reason = 'new_statement'
  loop
    perform tci.open_task(
      'rating_new_statements', 'legal_entity', v_row.entity_id,
      'agenda.tasks.rating_new_statements',
      jsonb_build_object(
        'entity_id', v_row.entity_id,
        'statement_id', v_row.statement_id,
        'statement_kind', v_row.statement_kind,
        'fiscal_year', v_row.fiscal_year,
        'fiscal_quarter', v_row.fiscal_quarter,
        'period_end', v_row.period_end_date,
        'report_type', v_row.report_type,
        'added_by', v_row.created_by,
        'added_at', v_row.created_at,
        'assessment_id', v_row.assessment_id,
        'grade', v_row.grade,
        'score', v_row.rating_score,
        'rated_at', v_row.rated_at,
        'rated_period_end', v_row.rated_period_end,
        'limits_in_force', v_row.limits_in_force),
      'credit_underwriter'::tci.user_role, null,
      -- The clock starts when the Agenda first sees the work, not when the
      -- statements were typed in: a backlog must not arrive months overdue.
      greatest(v_row.created_at, now()) + interval '7 days',
      case when v_row.limits_in_force > 0 then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  -- Rated since (done), or no longer live business / statements removed
  -- (cancelled).
  update tci.tasks t
     set status = case when exists (
                          select 1 from tci.credit_assessments a
                           where a.entity_id = t.object_id and a.created_at >= t.created_at)
                       then 'done' else 'cancelled' end::tci.task_status,
         completed_at = now()
   where t.task_type = 'rating_new_statements'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_rating_worklist w
        where w.entity_id = t.object_id and w.reason = 'new_statement');

  -- (0058) Commercial offers close to, or past, their last valid day.
  v_opened := v_opened + tci.refresh_offer_tasks();
  v_opened := v_opened + tci.refresh_adt_tasks();

  return v_opened;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 11. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if (select auto_decisions_enabled from tci.workflow_settings where id) then
    raise exception '0061: auto decisions must start switched OFF';
  end if;
  if position('refresh_adt_tasks' in pg_get_functiondef('tci.refresh_agenda()'::regprocedure)) = 0 then
    raise exception '0061: refresh_agenda does not look for stale ADT financials';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'tci' and table_name in ('buyer_adt', 'buyer_adt_blocks', 'auto_decision_attempts')
                and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception '0061: an ADT table is writable through the API';
  end if;
  if has_function_privilege('authenticated', 'tci.try_auto_decision(uuid)', 'execute')
     or has_function_privilege('authenticated', 'tci.adt_buyer_stops(uuid)', 'execute') then
    raise exception '0061: the auto-decision rule is reachable through the API';
  end if;
  -- The trigger must fire after the Agenda opened the request's task.
  if not ('workflow_events_zz_auto_decisions' > 'workflow_events_to_tasks') then
    raise exception '0061: the auto-decision trigger would fire before the Agenda mapping';
  end if;
end;
$$;
