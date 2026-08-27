-- 0020_two_stage_decisions.sql
-- What: Phase 3c-1 (part 2) - limit decisions become TWO-STAGE and gain a
--       release mechanism with a sales window and silent consent.
-- Why:  credit underwriting owns the risk view (rating, amount, validity,
--       conditions); commercial underwriting may then re-shape ONLY the
--       commercial variables - approved amount and payment terms - within
--       its own authority. Sales get a window to discuss before the client
--       sees a decision, but can never change the terms. Actions that make
--       a limit WORSE for the client are emergency risk actions and reach
--       the client immediately.
--
-- Stage precedence: for one (policy, entity) at most one credit-stage row
-- and at most one commercial-stage adjustment of it are 'effective' at a
-- time; BOTH are kept so the chain stays visible. The EFFECTIVE limit is
-- the commercial row when present, else the credit row. A newer credit
-- decision supersedes the whole previous chain (decide_limit_request
-- already flips every effective row for the pair to 'superseded').
--
-- Release rules (lazy, NO cron - evaluated in the view and in RLS):
--   released_at set                      -> visible to the client
--   held = true                          -> NOT visible, clock suspended
--   otherwise now() >= decided_at + tci.sales_window_hours()  -> visible
--                                           (silent consent)
--   release_kind: 'sales_confirmed' (sales pressed confirm),
--                 'silent_consent'  (window elapsed, nobody objected),
--                 'immediate'       (emergency: reduction or revocation)
-- Emergency bypass: a decision whose approved amount is BELOW the current
-- effective amount for the pair, and every revocation, is released at once
-- (released_at = now(), release_kind = 'immediate') and skips both the
-- commercial stage and the sales window.

create type tci.decision_stage as enum ('credit', 'commercial');
create type tci.release_kind as enum ('sales_confirmed', 'silent_consent', 'immediate');

alter table tci.credit_limit_decisions
  add column stage              tci.decision_stage not null default 'credit',
  add column adjusts_decision_id uuid references tci.credit_limit_decisions (id),
  add column payment_terms_days int,
  add column released_at        timestamptz,
  add column release_kind       tci.release_kind,
  add column held               boolean not null default false,
  add column hold_comment       text;

comment on column tci.credit_limit_decisions.stage is
  'credit = the underwriting decision; commercial = an adjustment of amount/payment terms only.';
comment on column tci.credit_limit_decisions.adjusts_decision_id is
  'For stage=commercial: the credit-stage decision being adjusted.';

-- A commercial adjustment must point at the credit decision it adjusts.
alter table tci.credit_limit_decisions
  add constraint decisions_stage_parent check (
    (stage = 'credit' and adjusts_decision_id is null)
    or (stage = 'commercial' and adjusts_decision_id is not null)
  );

create index credit_limit_decisions_stage_idx on tci.credit_limit_decisions (stage, lifecycle);

-- Sales may release/hold, so they need those two columns - and ONLY those.
grant update (lifecycle, released_at, release_kind, held, hold_comment)
  on tci.credit_limit_decisions to authenticated;

-- ---------------------------------------------------------------------------
-- Release predicate (shared by the views and the client RLS policies)
-- ---------------------------------------------------------------------------

create function tci.decision_is_released(
  p_released_at timestamptz,
  p_decided_at  timestamptz,
  p_held        boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_released_at is not null
     or (
       not coalesce(p_held, false)
       and now() >= p_decided_at + make_interval(hours => tci.sales_window_hours())
     )
$$;

revoke execute on function tci.decision_is_released(timestamptz, timestamptz, boolean)
  from public, anon;
grant execute on function tci.decision_is_released(timestamptz, timestamptz, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Commercial-stage adjustment
-- ---------------------------------------------------------------------------

-- Adjust ONLY the amount and the payment terms of an effective credit
-- decision, in either direction, within the caller's 'commercial' authority
-- for the SAME grade band. Rating, conditions and validity are untouchable.
create function tci.adjust_limit_commercial(
  p_decision_id        uuid,
  p_new_amount         numeric,
  p_new_payment_terms  int default null,
  p_comment            text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_credit   tci.credit_limit_decisions%rowtype;
  v_request  tci.credit_limit_requests%rowtype;
  v_new      tci.credit_limit_decisions%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_is_reduction boolean;
begin
  if not tci.has_role('admin', 'commercial_underwriter') then
    raise exception 'only commercial underwriting may adjust a limit'
      using errcode = 'P0004';
  end if;

  select * into v_credit from tci.credit_limit_decisions
   where id = p_decision_id for update;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;
  if v_credit.stage <> 'credit' then
    raise exception 'only a credit-stage decision can be adjusted commercially'
      using errcode = 'P0001';
  end if;
  if v_credit.lifecycle <> 'effective' then
    raise exception 'decision is % and can no longer be adjusted', v_credit.lifecycle
      using errcode = 'P0001';
  end if;
  if v_credit.outcome not in ('approved', 'partial') then
    raise exception 'only an approved or partial limit can be adjusted'
      using errcode = 'P0001';
  end if;
  if p_new_amount is null or p_new_amount <= 0 then
    raise exception 'the adjusted amount must be positive' using errcode = 'P0001';
  end if;

  select * into v_request from tci.credit_limit_requests where id = v_credit.request_id;

  -- Authority: the COMMERCIAL grants of the caller, same band as the credit
  -- decision. Admin is unlimited.
  v_band := tci.grade_band_for_assessment(v_credit.based_on_assessment_id);
  if not tci.has_role('admin') then
    v_amount_uzs := tci.to_uzs(p_new_amount, v_credit.currency_code);
    select coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0)
      into v_authority_uzs
      from tci.authority_grants g
     where g.user_id = (select auth.uid())
       and g.applies_to = 'commercial'
       and g.grade_band = v_band
       and g.valid_from <= current_date
       and (g.valid_to is null or g.valid_to >= current_date);
    if v_amount_uzs > v_authority_uzs then
      raise exception 'adjustment exceeds your commercial authority for grade band % (% > %)',
        v_band, v_amount_uzs, v_authority_uzs using errcode = 'P0004';
    end if;
  end if;

  -- A reduction below what the client already has is an emergency action:
  -- it reaches the client at once, skipping the sales window.
  v_is_reduction := p_new_amount < v_credit.approved_amount;

  -- Supersede a previous commercial adjustment of the same credit decision.
  update tci.credit_limit_decisions
     set lifecycle = 'superseded'
   where adjusts_decision_id = p_decision_id
     and lifecycle = 'effective';

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, valid_until,
    based_on_assessment_id, comment, stage, adjusts_decision_id, payment_terms_days,
    released_at, release_kind
  ) values (
    v_credit.request_id, v_credit.outcome, p_new_amount, v_credit.currency_code,
    v_credit.valid_from, v_credit.valid_until,      -- validity is NOT adjustable
    v_credit.based_on_assessment_id, p_comment, 'commercial', p_decision_id,
    coalesce(p_new_payment_terms, v_credit.payment_terms_days),
    case when v_is_reduction then now() else null end,
    case when v_is_reduction then 'immediate'::tci.release_kind else null end
  ) returning * into v_new;

  perform tci.emit_workflow_event(
    'limit.commercial_adjusted', 'credit_limit_decision', v_new.id,
    jsonb_build_object(
      'credit_decision_id', p_decision_id,
      'from_amount', v_credit.approved_amount,
      'to_amount', p_new_amount,
      'grade_band', v_band,
      'is_reduction', v_is_reduction
    ),
    case when v_is_reduction then 'client'::tci.user_role else 'sales'::tci.user_role end
  );

  return jsonb_build_object(
    'result', 'adjusted',
    'decision_id', v_new.id,
    'grade_band', v_band,
    'is_reduction', v_is_reduction,
    'released_immediately', v_is_reduction
  );
end;
$$;

revoke execute on function tci.adjust_limit_commercial(uuid, numeric, int, text) from public, anon;
grant execute on function tci.adjust_limit_commercial(uuid, numeric, int, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sales release / hold  (sales can NEVER change terms - only these two)
-- ---------------------------------------------------------------------------

create function tci.release_decision(p_decision_id uuid, p_comment text default null)
returns tci.credit_limit_decisions
language plpgsql
security invoker
set search_path = ''
as $$
declare v_row tci.credit_limit_decisions%rowtype;
begin
  if not tci.has_role('admin', 'sales') then
    raise exception 'only sales may release a decision to the client' using errcode = 'P0004';
  end if;
  update tci.credit_limit_decisions
     set released_at = coalesce(released_at, now()),
         release_kind = coalesce(release_kind, 'sales_confirmed'),
         held = false,
         hold_comment = null
   where id = p_decision_id
   returning * into v_row;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'limit.released', 'credit_limit_decision', p_decision_id,
    jsonb_build_object('release_kind', v_row.release_kind, 'comment', p_comment),
    'client'::tci.user_role
  );
  return v_row;
end;
$$;

-- Hold suspends the silent-consent clock: while held the decision is not
-- client-visible no matter how much time passes.
create function tci.hold_decision(p_decision_id uuid, p_comment text)
returns tci.credit_limit_decisions
language plpgsql
security invoker
set search_path = ''
as $$
declare v_row tci.credit_limit_decisions%rowtype;
begin
  if not tci.has_role('admin', 'sales') then
    raise exception 'only sales may hold a decision' using errcode = 'P0004';
  end if;
  if coalesce(btrim(p_comment), '') = '' then
    raise exception 'a hold needs a comment saying what must be discussed'
      using errcode = 'P0001';
  end if;

  select * into v_row from tci.credit_limit_decisions where id = p_decision_id for update;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;
  if v_row.released_at is not null then
    raise exception 'the client has already seen this decision - it cannot be held'
      using errcode = 'P0001';
  end if;

  update tci.credit_limit_decisions
     set held = true, hold_comment = p_comment
   where id = p_decision_id
   returning * into v_row;

  perform tci.emit_workflow_event(
    'limit.held', 'credit_limit_decision', p_decision_id,
    jsonb_build_object('comment', p_comment),
    'commercial_underwriter'::tci.user_role
  );
  return v_row;
end;
$$;

revoke execute on function tci.release_decision(uuid, text), tci.hold_decision(uuid, text)
  from public, anon;
grant execute on function tci.release_decision(uuid, text), tci.hold_decision(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Emergency bypass on the credit side: a decision that REDUCES the current
-- effective amount, and every revocation, is released immediately.
-- ---------------------------------------------------------------------------

create function tci.apply_emergency_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_amount numeric;
begin
  if new.outcome = 'revoked' then
    new.released_at := now();
    new.release_kind := 'immediate';
    return new;
  end if;

  if new.stage = 'credit' and new.outcome in ('approved', 'partial') then
    -- The amount the client currently has on this (policy, entity), if any.
    select d.approved_amount into v_prev_amount
    from tci.credit_limit_decisions d
    join tci.credit_limit_requests r on r.id = d.request_id
    join tci.credit_limit_requests nr on nr.id = new.request_id
    where r.policy_id = nr.policy_id
      and r.entity_id = nr.entity_id
      and d.lifecycle = 'effective'
      and d.id <> new.id
      and d.outcome in ('approved', 'partial')
    order by (d.stage = 'commercial') desc, d.decided_at desc
    limit 1;

    if v_prev_amount is not null and new.approved_amount < v_prev_amount then
      new.released_at := now();
      new.release_kind := 'immediate';
    end if;
  end if;

  return new;
end;
$$;

create trigger credit_limit_decisions_emergency_release
  before insert on tci.credit_limit_decisions
  for each row execute function tci.apply_emergency_release();

-- ---------------------------------------------------------------------------
-- Views: stage precedence + the release state
-- ---------------------------------------------------------------------------

drop view tci.v_buyer_exposure;
drop view tci.v_effective_limits;

-- One row per (policy, entity): the governing decision (commercial when
-- present, else credit) with the credit-stage figures kept alongside so the
-- "credit X -> commercial Y" pairing can be rendered everywhere.
create view tci.v_effective_limits
with (security_invoker = true) as
select distinct on (r.policy_id, r.entity_id)
  d.id            as decision_id,
  r.policy_id,
  r.entity_id,
  d.request_id,
  r.insurance_request_id,
  r.requested_amount,
  d.outcome,
  d.approved_amount,
  d.currency_code,
  d.valid_from,
  d.valid_until,
  d.based_on_assessment_id,
  d.comment,
  d.decided_by,
  d.decided_at,
  d.stage,
  d.payment_terms_days,
  -- The credit-stage figures behind this limit (same row when stage=credit).
  coalesce(parent.id, d.id)                          as credit_decision_id,
  coalesce(parent.approved_amount, d.approved_amount) as credit_amount,
  (d.stage = 'commercial')                            as commercially_adjusted,
  d.released_at,
  d.release_kind,
  d.held,
  d.hold_comment,
  tci.decision_is_released(d.released_at, d.decided_at, d.held) as client_visible,
  (select count(*) from tci.decision_conditions c
    where c.decision_id = coalesce(parent.id, d.id))::int as conditions_count
from tci.credit_limit_decisions d
join tci.credit_limit_requests r on r.id = d.request_id
left join tci.credit_limit_decisions parent on parent.id = d.adjusts_decision_id
where d.lifecycle = 'effective'
  and (d.valid_until is null or d.valid_until >= current_date)
order by r.policy_id, r.entity_id, (d.stage = 'commercial') desc, d.decided_at desc;

create view tci.v_buyer_exposure
with (security_invoker = true) as
select
  v.entity_id,
  count(distinct v.policy_id)::int as policies_count,
  sum(v.approved_amount * tci.latest_uzs_rate(v.currency_code))
    filter (where tci.latest_uzs_rate(v.currency_code) is not null)
    as exposure_uzs,
  count(*) filter (where tci.latest_uzs_rate(v.currency_code) is null)::int
    as missing_rates
from tci.v_effective_limits v
where v.outcome in ('approved', 'partial')
group by v.entity_id;

grant select on tci.v_effective_limits, tci.v_buyer_exposure to authenticated, service_role;

-- The client only ever sees RELEASED decisions.
drop policy "limit_decisions: client reads own" on tci.credit_limit_decisions;
create policy "limit_decisions: client reads own released"
  on tci.credit_limit_decisions for select to authenticated
  using (
    tci.has_role('client')
    and tci.decision_is_released(released_at, decided_at, held)
    and request_id in (
      select r.id from tci.credit_limit_requests r
      join tci.policies p on p.id = r.policy_id
      join tci.policyholder_users pu on pu.entity_id = p.entity_id
      where pu.user_id = (select auth.uid())
    )
  );

-- Emit an event for every credit decision so the Agenda can pick it up.
create function tci.emit_credit_decision_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.emit_workflow_event(
    case when new.stage = 'commercial' then 'limit.commercial_adjusted'
         else 'limit.credit_decided' end,
    'credit_limit_decision', new.id,
    jsonb_build_object(
      'outcome', new.outcome,
      'amount', new.approved_amount,
      'stage', new.stage,
      'release_kind', new.release_kind
    ),
    case when new.release_kind = 'immediate' then 'client'::tci.user_role
         else 'sales'::tci.user_role end
  );
  return new;
end;
$$;

create trigger credit_limit_decisions_emit_event
  after insert on tci.credit_limit_decisions
  for each row execute function tci.emit_credit_decision_event();
