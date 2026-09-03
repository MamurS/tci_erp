-- What: the Phase 6 Agenda and the combined group financial picture - two new
--       task types generated lazily by tci.refresh_agenda, and the per-member
--       and aggregate financial views the Группа tab draws.
-- Why:  Phase 6. Two things a credit underwriter needs to be TOLD rather than
--       have to go looking for:
--
--   * a group approaching its limit, before the decision that breaches it;
--   * a group that carries limits on several members and has NO group limit at
--     all, which is the case the whole phase exists to stop being invisible.
--
-- Both are lazy, recomputed on read, and retire themselves - the Phase 3c-2
-- discipline, with no cron anywhere.
--
-- THE COMBINED FIGURES ARE A SUM, NOT A CONSOLIDATION. There are no
-- intra-group eliminations: if A sells to B, the revenue is counted twice and
-- the receivable and the payable both stand. That is stated on the view, in
-- its comment, and on the screen, because a number labelled "group revenue"
-- that quietly means something else is worse than no number. The count of
-- members WITHOUT statements is returned beside every total for the same
-- reason: a group total drawn from two of five members is not a group total.

-- ---------------------------------------------------------------------------
-- 1. New task types
-- ---------------------------------------------------------------------------
--
--   group_exposure_near_limit  credit_underwriter  high    AUTO lazily, once exposure falls back
--   group_limit_missing        credit_underwriter  normal  AUTO lazily, once a group limit exists
--
-- Both close themselves, so neither needs a button and tci.complete_task keeps
-- refusing every type but the three manual ones.

alter type tci.task_type add value 'group_exposure_near_limit';
alter type tci.task_type add value 'group_limit_missing';

-- ---------------------------------------------------------------------------
-- 2. Lazy generation
-- ---------------------------------------------------------------------------
-- Sections (1) to (6) are carried over VERBATIM from 0036; (7) and (8) are new.

create or replace function tci.refresh_agenda()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened int := 0;
  v_row record;
  v_client uuid;
begin
  if not tci.is_staff() then
    raise exception 'only staff have an agenda' using errcode = 'P0004';
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

  -- (4) NEW: instalments falling due, and instalments already past due.
  for v_row in
    select pi.id, pi.policy_id, pi.sequence, pi.due_date, pi.amount, p.policy_number,
           p.currency_code
    from tci.premium_instalments pi
    join tci.policies p on p.id = pi.policy_id
    where pi.status in ('pending', 'invoiced')
      and pi.due_date <= current_date + 14
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
        'amount', v_row.amount,
        'currency', v_row.currency_code),
      'commercial_underwriter'::tci.user_role, null,
      v_row.due_date::timestamptz,
      case when v_row.due_date < current_date then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and not exists (
       select 1 from tci.premium_instalments pi
        where pi.id = t.object_id
          and pi.status in ('pending', 'invoiced')
          and pi.due_date <= current_date + 14
     );

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

  return v_opened;
end;
$$;

comment on function tci.refresh_agenda() is
  'Lazily generates and retires every time-based task kind: limit review due, stale rating, declaration due/overdue, instalment due/overdue, NOA matured to claim, the reinstatement review, and the two group controls. Called on read - there is no cron.';

-- ---------------------------------------------------------------------------
-- 3. The combined financial picture
-- ---------------------------------------------------------------------------
-- One row per group member that HAS a statement, carrying its latest one. The
-- Группа tab ranks members from this; the aggregate below sums it.
--
-- "Latest" is the most recent period_end_date, then the most recently created
-- - so a restated year supersedes the original without deleting it.

create view tci.v_group_member_financials
with (security_invoker = true) as
select distinct on (e.id)
  e.id                    as member_id,
  e.name                  as member_name,
  fs.id                   as statement_id,
  fs.fiscal_year,
  fs.period_end_date,
  fs.currency_code,
  fs.report_type,
  i.revenue,
  i.net_profit,
  b.total_assets,
  b.total_equity,
  b.total_non_current_assets,
  -- Gross debt: interest-bearing borrowings, long and short. Trade payables
  -- are not debt - they are the ordinary course of business - and folding them
  -- in would overstate leverage for every trading company.
  (coalesce(b.long_term_borrowings, 0) + coalesce(b.short_term_borrowings, 0)) as gross_debt
from tci.legal_entities e
join tci.financial_statements fs on fs.entity_id = e.id
left join tci.income_statements i on i.statement_id = fs.id
left join tci.balance_sheets b on b.statement_id = fs.id
order by e.id, fs.period_end_date desc nulls last, fs.created_at desc;

comment on view tci.v_group_member_financials is
  'Each company''s LATEST statement figures. Gross debt is interest-bearing borrowings only - trade payables are the ordinary course of business, not debt.';

grant select on tci.v_group_member_financials to authenticated, service_role;

-- The aggregate, per group. A SUM of the entities we hold statements for, with
-- no intra-group eliminations - see the header. members_missing_statements is
-- part of the answer, not a footnote.
create view tci.v_group_financials
with (security_invoker = true) as
select
  g.ultimate_parent_id,
  count(*)::int                                    as members_total,
  count(f.member_id)::int                          as members_with_statements,
  (count(*) - count(f.member_id))::int              as members_missing_statements,
  count(distinct f.currency_code)::int              as currencies,
  sum(f.revenue)                                    as revenue,
  sum(f.net_profit)                                 as net_profit,
  sum(f.total_assets)                               as total_assets,
  sum(f.total_equity)                               as total_equity,
  sum(f.total_non_current_assets)                   as long_term_assets,
  sum(f.gross_debt)                                 as gross_debt
from (
  select distinct ultimate_parent_id, member_id from tci.v_entity_group
) g
left join tci.v_group_member_financials f on f.member_id = g.member_id
group by g.ultimate_parent_id;

comment on view tci.v_group_financials is
  'A SIMPLE SUM of the latest statements of the group members we hold statements for. NOT an IFRS consolidation: there are no intra-group eliminations, so inter-company revenue and balances are counted twice. members_missing_statements says how incomplete the picture is, and the UI must show it.';

grant select on tci.v_group_financials to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_src text; v_n int;
begin
  select prosrc into v_src from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname = 'tci' and pr.proname = 'refresh_agenda';
  if v_src not like '%group_exposure_near_limit%' or v_src not like '%group_limit_missing%' then
    raise exception '0041: refresh_agenda does not generate the group tasks';
  end if;
  -- The six earlier lazy kinds must still be there: this is a carry-forward,
  -- not a rewrite.
  foreach v_src in array array['limit_review_due', 'rating_stale', 'declaration_due',
                               'instalment_due', 'noa_matured_to_claim',
                               'claim_limit_reinstatement']
  loop
    if (select prosrc from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
         where n.nspname = 'tci' and pr.proname = 'refresh_agenda') not like '%' || v_src || '%' then
      raise exception '0041: refresh_agenda lost the % generation', v_src;
    end if;
  end loop;

  -- The combined picture must never be described as a consolidation.
  if obj_description('tci.v_group_financials'::regclass) not like '%NOT an IFRS consolidation%' then
    raise exception '0041: the combined figures must be labelled as a simple sum';
  end if;
end;
$$;
