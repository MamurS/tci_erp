-- What: group exposure and group limits - tci.v_group_exposure, the per-member
--       and per-policyholder breakdowns, tci.group_limits, and BLOCKING
--       enforcement inside decide_limit_request and adjust_limit_commercial.
-- Why:  Phase 6, and the point of the whole phase. A group failure hits every
--       member at once, so limits on related companies do not diversify: they
--       add up. Making that a control means four decisions, all made here.
--
--   * EXPOSURE IS SUMMED IN UZS, LIKE AUTHORITY. Group members hold limits in
--     different currencies under different policies. The standard Phase 2b fx
--     rule (tci.to_uzs / tci.latest_uzs_rate) is what makes them addable, and
--     rows whose currency has no rate are COUNTED SEPARATELY rather than
--     silently treated as zero - exactly as v_buyer_exposure does. A group
--     with missing rates is reported as incomplete, never as small.
--   * ENFORCEMENT IS BLOCKING (owner decision). Over a group limit, a decision
--     is refused and the request goes to `escalated` - the same workflow
--     status the personal authority path uses, so the request lands in front
--     of someone who can weigh it rather than vanishing.
--   * THE DECISION BEING SUPERSEDED IS EXCLUDED. Raising a buyer's limit from
--     100 to 120 adds 20 to the group, not 120. The check therefore computes
--     the exposure AS IT WOULD BE AFTER the decision, netting off whatever
--     this (scope, buyer) already contributes.
--   * RISK REDUCTIONS ARE NEVER BLOCKED. A revocation or a reduction lowers
--     exposure. Refusing one because the group is over its limit would be
--     perverse - it would trap the insurer at the higher number.
--
-- Admin may proceed regardless, and that is deliberate and documented: the
-- group limit is an underwriting control, not a security boundary, and there
-- must be a way to act in an emergency. Every admin override is still a normal
-- decision row with an author, so it is auditable.

-- ---------------------------------------------------------------------------
-- 1. Group exposure
-- ---------------------------------------------------------------------------
-- One row per member limit, keyed by the group's ultimate parent. This is the
-- grain everything else aggregates from: the group total, the per-member
-- breakdown for the Группа tab, and the per-policyholder breakdown that shows
-- WHOSE policies carry the risk.

create view tci.v_group_exposure_lines
with (security_invoker = true) as
select
  tci.ultimate_parent(v.entity_id) as ultimate_parent_id,
  v.entity_id                       as member_id,
  m.name                            as member_name,
  v.policy_id,
  p.policy_number,
  p.entity_id                       as policyholder_id,
  ph.name                           as policyholder_name,
  v.decision_id,
  v.request_id,
  v.scope_id,
  v.approved_amount,
  v.currency_code,
  tci.to_uzs(v.approved_amount, v.currency_code) as amount_uzs,
  (tci.latest_uzs_rate(v.currency_code) is null)  as rate_missing,
  v.valid_until
from tci.v_effective_limits v
join tci.legal_entities m on m.id = v.entity_id
join tci.policies p on p.id = v.policy_id
join tci.legal_entities ph on ph.id = p.entity_id
where v.outcome in ('approved', 'partial')
  -- Pre-bind limits are not exposure: nothing has been underwritten yet. Same
  -- rule as v_buyer_exposure (0023).
  and v.policy_id is not null;

comment on view tci.v_group_exposure_lines is
  'Every in-force member limit, attributed to its group''s ultimate parent, with the UZS conversion and a flag when the rate is missing.';

create view tci.v_group_exposure
with (security_invoker = true) as
select
  l.ultimate_parent_id,
  up.name                                   as ultimate_parent_name,
  count(*)::int                             as limits_count,
  count(distinct l.member_id)::int          as members_with_limits,
  count(distinct l.policy_id)::int          as policies_count,
  count(distinct l.policyholder_id)::int    as policyholders_count,
  -- The sum EXCLUDES rows whose currency has no rate, and those rows are
  -- reported beside it. A group with missing rates is incomplete, not small.
  coalesce(sum(l.amount_uzs) filter (where not l.rate_missing), 0) as exposure_uzs,
  count(*) filter (where l.rate_missing)::int as missing_rates
from tci.v_group_exposure_lines l
join tci.legal_entities up on up.id = l.ultimate_parent_id
group by l.ultimate_parent_id, up.name;

comment on view tci.v_group_exposure is
  'Total in-force insured exposure per corporate group, in UZS by the standard fx rule, with the count of rows whose currency had no rate.';

grant select on tci.v_group_exposure_lines, tci.v_group_exposure to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Group limits
-- ---------------------------------------------------------------------------
-- Keyed by the ultimate parent, which IS the group's identity - there is still
-- no group record. Immutable like decisions: setting a new limit closes the
-- previous one rather than editing it, so what the limit was when a decision
-- was taken stays readable.

create table tci.group_limits (
  id                       uuid primary key default gen_random_uuid(),
  ultimate_parent_entity_id uuid not null references tci.legal_entities (id) on delete cascade,
  max_amount               numeric(18,2) not null check (max_amount > 0),
  currency_code            char(3) not null references tci.currencies (code),
  valid_from               date not null default current_date,
  valid_to                 date,
  set_by                   uuid not null references auth.users (id) default auth.uid(),
  comment                  text,
  created_at               timestamptz not null default now(),

  -- valid_to is INCLUSIVE, so normally it is on or after valid_from. One day
  -- earlier is also allowed and means "set and removed before it ever applied":
  -- a limit imposed and lifted the same day. Without that the row could not be
  -- closed on the day it was created, and an underwriter removing a control
  -- would find it still blocking them for the rest of the day.
  constraint group_limits_window check (valid_to is null or valid_to >= valid_from - 1)
);

create unique index group_limits_live_uq
  on tci.group_limits (ultimate_parent_entity_id)
  where valid_to is null;

create index group_limits_parent_idx on tci.group_limits (ultimate_parent_entity_id, valid_from desc);

comment on table tci.group_limits is
  'A cap on total insured exposure across a corporate group, keyed by its ultimate parent. Immutable history: a new limit closes the old one.';

create function tci.current_group_limit(p_ultimate_parent_id uuid)
returns tci.group_limits
language sql
stable
security definer
set search_path = ''
as $$
  select * from tci.group_limits
   where ultimate_parent_entity_id = p_ultimate_parent_id
     and valid_from <= current_date
     and (valid_to is null or valid_to >= current_date)
   order by valid_from desc, created_at desc
   limit 1
$$;

comment on function tci.current_group_limit(uuid) is
  'The group limit in force today for this group, or no row when the group has none.';

revoke execute on function tci.current_group_limit(uuid) from public, anon;
grant execute on function tci.current_group_limit(uuid) to authenticated, service_role;

-- Setting one. Band-aware, like every other credit authority: the band comes
-- from the ULTIMATE PARENT's latest assessment, because that is the credit the
-- group's identity rests on.
create function tci.set_group_limit(
  p_ultimate_parent_id uuid,
  p_max_amount         numeric,
  p_currency           char(3),
  p_valid_from         date default current_date,
  p_comment            text default null
)
returns tci.group_limits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  tci.group_limits%rowtype;
  v_band tci.grade_band;
  v_assessment uuid;
  v_amount_uzs numeric;
  v_authority  numeric;
begin
  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may set a group limit' using errcode = 'P0004';
  end if;
  if coalesce(p_max_amount, 0) <= 0 then
    raise exception 'a group limit needs a positive amount' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_ultimate_parent_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  if not tci.has_role('admin') then
    select a.id into v_assessment
      from tci.credit_assessments a
     where a.entity_id = p_ultimate_parent_id
     order by a.created_at desc limit 1;
    v_band := tci.grade_band_for_assessment(v_assessment);
    v_amount_uzs := tci.to_uzs(p_max_amount, p_currency);
    v_authority := tci.my_authority_uzs(v_band);
    if v_amount_uzs > v_authority then
      raise exception 'a group limit of % exceeds your authority for grade band % (% > %)',
        p_max_amount, v_band, v_amount_uzs, v_authority using errcode = 'P0004';
    end if;
  end if;

  -- Close the standing limit rather than editing it.
  update tci.group_limits
     set valid_to = greatest(coalesce(p_valid_from, current_date) - 1, valid_from - 1)
   where ultimate_parent_entity_id = p_ultimate_parent_id
     and valid_to is null;

  insert into tci.group_limits (
    ultimate_parent_entity_id, max_amount, currency_code, valid_from, comment
  ) values (
    p_ultimate_parent_id, p_max_amount, p_currency,
    coalesce(p_valid_from, current_date), p_comment
  ) returning * into v_row;

  perform tci.emit_workflow_event(
    'group.limit_set', 'legal_entity', p_ultimate_parent_id,
    jsonb_build_object('amount', p_max_amount, 'currency', p_currency,
                       'group_limit_id', v_row.id),
    'credit_underwriter'::tci.user_role);

  return v_row;
end;
$$;

revoke execute on function tci.set_group_limit(uuid, numeric, char, date, text) from public, anon;
grant execute on function tci.set_group_limit(uuid, numeric, char, date, text) to authenticated, service_role;
-- Removing a group limit is a real underwriting act, so it needs its own entry
-- point: the row is CLOSED, never deleted, so what the limit was when an
-- earlier decision was taken against it stays readable.
--
-- It stops applying IMMEDIATELY. valid_to is inclusive, so "no longer in
-- force today" is yesterday - and a limit set and removed the same day gets
-- valid_to = valid_from - 1, which the window constraint permits precisely so
-- that an underwriter lifting a control is not blocked by it for the rest of
-- the day.
create function tci.end_group_limit(
  p_ultimate_parent_id uuid,
  p_valid_to           date default null
)
returns tci.group_limits
language plpgsql
security definer
set search_path = ''
as $$
declare v_row tci.group_limits%rowtype;
begin
  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may remove a group limit' using errcode = 'P0004';
  end if;
  update tci.group_limits
     set valid_to = greatest(coalesce(p_valid_to, current_date - 1), valid_from - 1)
   where ultimate_parent_entity_id = p_ultimate_parent_id
     and valid_to is null
   returning * into v_row;
  if not found then
    raise exception 'this group has no limit in force' using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'group.limit_removed', 'legal_entity', p_ultimate_parent_id,
    jsonb_build_object('group_limit_id', v_row.id, 'valid_to', v_row.valid_to),
    'credit_underwriter'::tci.user_role);

  return v_row;
end;
$$;

comment on function tci.end_group_limit(uuid, date) is
  'Closes the group limit in force, never earlier than the day it began: what the limit was when a decision was taken against it must stay readable.';

revoke execute on function tci.end_group_limit(uuid, date) from public, anon;
grant execute on function tci.end_group_limit(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The preflight
-- ---------------------------------------------------------------------------
-- ONE function computes "where would this decision leave the group", and BOTH
-- the SQL enforcement and the UI preflight call it. The screen cannot drift
-- from the rule because it is not a second implementation of it.
--
-- p_exclude_scope / p_exclude_entity net off what this (scope, buyer) already
-- contributes, because the new decision SUPERSEDES it. Without that, raising a
-- limit from 100 to 120 would be tested as if it added 120.

create function tci.group_exposure_preflight(
  p_entity_id      uuid,
  p_new_amount     numeric default null,
  p_currency       char(3) default null,
  p_exclude_scope  uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parent   uuid;
  v_exp      record;
  v_limit    tci.group_limits%rowtype;
  v_current  numeric;
  v_replaced numeric := 0;
  v_added    numeric := 0;
  v_after    numeric;
  v_limit_uzs numeric;
begin
  v_parent := tci.ultimate_parent(p_entity_id);

  select coalesce(exposure_uzs, 0) as exposure_uzs, coalesce(missing_rates, 0) as missing_rates
    into v_exp
    from tci.v_group_exposure where ultimate_parent_id = v_parent;
  v_current := coalesce(v_exp.exposure_uzs, 0);

  -- What this buyer already contributes under the scope being decided, which
  -- the new decision will supersede. v_effective_limits already carries the
  -- scope key, so this is a plain filter rather than a walk back through the
  -- decision to its request.
  if p_exclude_scope is not null then
    select coalesce(sum(l.amount_uzs) filter (where not l.rate_missing), 0)
      into v_replaced
      from tci.v_group_exposure_lines l
     where l.ultimate_parent_id = v_parent
       and l.member_id = p_entity_id
       and l.scope_id = p_exclude_scope;
  end if;

  if p_new_amount is not null then
    v_added := coalesce(tci.to_uzs(p_new_amount, p_currency), 0);
  end if;

  v_after := greatest(v_current - v_replaced, 0) + v_added;

  select * into v_limit from tci.current_group_limit(v_parent);
  v_limit_uzs := case when v_limit.id is null then null
                      else tci.to_uzs(v_limit.max_amount, v_limit.currency_code) end;

  return jsonb_build_object(
    'ultimate_parent_id', v_parent,
    'group_size', (select count(*) from tci.entity_group(p_entity_id)),
    'has_group_limit', (v_limit.id is not null),
    'group_limit_id', v_limit.id,
    'group_limit_amount', v_limit.max_amount,
    'group_limit_currency', v_limit.currency_code,
    'group_limit_uzs', v_limit_uzs,
    'exposure_uzs', v_current,
    'replaced_uzs', v_replaced,
    'added_uzs', v_added,
    'exposure_after_uzs', v_after,
    'headroom_uzs', case when v_limit_uzs is null then null else v_limit_uzs - v_after end,
    'over_limit', (v_limit_uzs is not null and v_after > v_limit_uzs),
    'utilisation_pct', case when coalesce(v_limit_uzs, 0) <= 0 then null
                            else round(v_after * 100 / v_limit_uzs, 2) end,
    'missing_rates', coalesce(v_exp.missing_rates, 0));
end;
$$;

comment on function tci.group_exposure_preflight(uuid, numeric, char, uuid) is
  'Where a decision would leave the group: current exposure, what this buyer already contributes under the scope being superseded, the new amount, and whether the result breaches the group limit. The UI preflight and the SQL enforcement both call THIS - there is no second implementation to drift.';

revoke execute on function tci.group_exposure_preflight(uuid, numeric, char, uuid) from public, anon;
grant execute on function tci.group_exposure_preflight(uuid, numeric, char, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Enforcement in the credit decision
-- ---------------------------------------------------------------------------
-- Carried over from 0024 verbatim except for the group block, which sits
-- immediately after the personal-authority check and behaves the same way:
-- refuse, escalate, and return a typed result the UI can render.

create or replace function tci.decide_limit_request(
  p_request_id uuid,
  p_outcome tci.decision_outcome,
  p_amount numeric default null,
  p_currency character default null,
  p_valid_from date default current_date,
  p_valid_until date default null,
  p_conditions jsonb default '[]'::jsonb,
  p_comment text default null,
  p_assessment_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_currency char(3);
  v_decision tci.credit_limit_decisions%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_condition jsonb;
  v_group    jsonb;
begin
  if p_outcome = 'revoked' then
    raise exception 'use tci.revoke_effective_limit to revoke an effective limit'
      using errcode = 'P0001';
  end if;

  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status not in ('submitted', 'under_review', 'escalated') then
    raise exception 'request is % and cannot be decided', v_request.status
      using errcode = 'P0001';
  end if;

  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may decide' using errcode = 'P0004';
  end if;

  v_currency := coalesce(p_currency, v_request.currency_code);
  v_band := tci.grade_band_for_assessment(p_assessment_id);

  if p_outcome in ('approved', 'partial') then
    if p_amount is null or p_amount <= 0 then
      raise exception 'approved/partial decisions require a positive amount'
        using errcode = 'P0001';
    end if;

    if not tci.has_role('admin') then
      v_amount_uzs := tci.to_uzs(p_amount, v_currency);
      v_authority_uzs := tci.my_authority_uzs(v_band);
      if v_amount_uzs > v_authority_uzs then
        update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

        perform tci.emit_workflow_event(
          'limit.request_escalated', 'credit_limit_request', p_request_id,
          jsonb_build_object(
            'entity_id', v_request.entity_id,
            'amount', p_amount,
            'currency', v_currency,
            'grade_band', v_band,
            'amount_uzs', v_amount_uzs),
          'credit_underwriter'::tci.user_role);

        return jsonb_build_object(
          'result', 'escalated',
          'grade_band', v_band,
          'amount_uzs', v_amount_uzs,
          'authority_uzs', v_authority_uzs
        );
      end if;

      -- PHASE 6: the group control. Blocking, and it escalates rather than
      -- simply failing, so the request reaches someone who can weigh the whole
      -- group. Admin is exempt (documented at the top of this migration).
      v_group := tci.group_exposure_preflight(
        v_request.entity_id, p_amount, v_currency,
        tci.limit_scope(v_request.policy_id, v_request.insurance_request_id));

      if (v_group ->> 'over_limit')::boolean then
        update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

        perform tci.emit_workflow_event(
          'limit.group_limit_breached', 'credit_limit_request', p_request_id,
          jsonb_build_object(
            'entity_id', v_request.entity_id,
            'ultimate_parent_id', v_group ->> 'ultimate_parent_id',
            'amount', p_amount,
            'currency', v_currency,
            'exposure_after_uzs', v_group ->> 'exposure_after_uzs',
            'group_limit_uzs', v_group ->> 'group_limit_uzs'),
          'credit_underwriter'::tci.user_role);

        return jsonb_build_object(
          'result', 'group_limit_exceeded',
          'grade_band', v_band,
          'group', v_group
        );
      end if;
    end if;
  elsif p_outcome = 'declined' then
    if p_amount is not null then
      raise exception 'declined decisions carry no amount' using errcode = 'P0001';
    end if;
  end if;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code,
    valid_from, valid_until, based_on_assessment_id, comment
  ) values (
    p_request_id, p_outcome, p_amount, v_currency,
    coalesce(p_valid_from, current_date), p_valid_until, p_assessment_id, p_comment
  ) returning * into v_decision;

  for v_condition in select * from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb))
  loop
    insert into tci.decision_conditions (decision_id, condition_type, description)
    values (
      v_decision.id,
      (v_condition->>'condition_type')::tci.condition_type,
      v_condition->>'description'
    );
  end loop;

  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r
   where r.id = d.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(v_request.policy_id, v_request.insurance_request_id)
     and r.entity_id = v_request.entity_id;

  update tci.credit_limit_requests
     set status = 'decided', decided_at = now()
   where id = p_request_id;

  return jsonb_build_object(
    'result', 'decided', 'decision_id', v_decision.id, 'grade_band', v_band);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Enforcement in the commercial adjustment
-- ---------------------------------------------------------------------------
-- Carried over from 0021 verbatim except for the group block. A REDUCTION is
-- never blocked: it lowers exposure, and refusing it would trap the insurer at
-- the higher number.

create or replace function tci.adjust_limit_commercial(
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
  v_new      tci.credit_limit_decisions%rowtype;
  v_request  tci.credit_limit_requests%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_is_reduction boolean;
  v_group    jsonb;
begin
  if not tci.has_role('admin', 'commercial_underwriter') then
    raise exception 'only commercial underwriting may adjust a limit'
      using errcode = 'P0004';
  end if;

  select * into v_credit from tci.credit_limit_decisions where id = p_decision_id;
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
  v_is_reduction := p_new_amount < v_credit.approved_amount;

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

    -- PHASE 6: the group control, on INCREASES only. A reduction lowers the
    -- group's exposure; blocking it because the group is over its limit would
    -- keep the insurer at the higher number.
    if not v_is_reduction then
      v_group := tci.group_exposure_preflight(
        v_request.entity_id, p_new_amount, v_credit.currency_code,
        tci.limit_scope(v_request.policy_id, v_request.insurance_request_id));
      if (v_group ->> 'over_limit')::boolean then
        raise exception 'this adjustment would take the group to % against a group limit of % (UZS)',
          v_group ->> 'exposure_after_uzs', v_group ->> 'group_limit_uzs'
          using errcode = 'P0004', detail = 'limits.errors.groupLimitExceeded';
      end if;
    end if;
  end if;

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
    v_credit.valid_from, v_credit.valid_until,
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

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------

alter table tci.group_limits enable row level security;

create policy "group_limits: staff read"
  on tci.group_limits for select to authenticated using (tci.is_staff());
create policy "group_limits: credit write"
  on tci.group_limits for all to authenticated
  using (tci.has_role('admin', 'credit_underwriter'))
  with check (tci.has_role('admin', 'credit_underwriter'));

grant select, insert, update, delete on tci.group_limits to authenticated;
grant all on tci.group_limits to service_role;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_src text;
begin
  -- The group block must sit in BOTH decision paths.
  select prosrc into v_src from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname = 'tci' and pr.proname = 'decide_limit_request';
  if v_src not like '%group_exposure_preflight%' then
    raise exception '0040: decide_limit_request does not check the group limit';
  end if;
  if v_src not like '%group_limit_exceeded%' then
    raise exception '0040: decide_limit_request does not return a typed group refusal';
  end if;
  -- ...and it must escalate, not merely fail.
  if position('group_limit_breached' in v_src) = 0 then
    raise exception '0040: a group breach must raise its own workflow event';
  end if;

  select prosrc into v_src from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname = 'tci' and pr.proname = 'adjust_limit_commercial';
  if v_src not like '%group_exposure_preflight%' then
    raise exception '0040: adjust_limit_commercial does not check the group limit';
  end if;
  -- A reduction must never be blocked.
  if v_src not like '%if not v_is_reduction then%' then
    raise exception '0040: the commercial group check is not restricted to increases';
  end if;

  -- The emergency path must be untouched by all of this.
  select prosrc into v_src from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname = 'tci' and pr.proname = 'apply_emergency_release';
  if v_src like '%group_exposure_preflight%' then
    raise exception '0040: the emergency release path must never consult a group limit';
  end if;

  -- Clients must not reach any of the group surface.
  if exists (
    select 1 from pg_policies
     where schemaname = 'tci'
       and tablename in ('entity_relationships', 'entity_relationship_suggestions', 'group_limits')
       and qual like '%client%'
  ) then
    raise exception '0040: a client-facing policy exists on the group tables';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'tci' and c.relkind = 'v' and c.relname like 'v_client_%'
       and pg_get_viewdef(c.oid) ~* '(entity_relationships|group_limits|entity_group|ultimate_parent)'
  ) then
    raise exception '0040: a client view reaches the group surface';
  end if;
end;
$$;
