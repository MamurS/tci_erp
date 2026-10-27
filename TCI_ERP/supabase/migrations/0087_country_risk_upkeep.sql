-- 0087_country_risk_upkeep.sql
--
-- What: keeping the OECD country list current (owner request 2026-10-27).
--       0. country_risk_imports.imported_at is stamped with the clock, so two
--          lists of one date imported in one transaction still order.
--       1. workflow_settings.oecd_stale_months defaults to 4 (was 6): the
--          OECD revises its list after each Participants' meeting, about
--          three times a year, so a list older than four months has most
--          likely been replaced. The live setting moves from 6 to 4 only
--          where it still holds the old default.
--       2. tci.country_risk_changes(rows) — the one comparison of a list
--          with the list in use: per country whose OECD category differs,
--          the category before and after, the approved internal category
--          (which masks the change for decisions), the direction (worse /
--          better, «not classified» counting as worse than 7) and the book
--          there: buyers with in-force limits on bound policies, their
--          limits in UZS, rates missing counted (never zero). Internal: no
--          API role executes it.
--       3. tci.country_risk_import_preview(effective, rows) — admin sees
--          that comparison before importing, and whether the file is older
--          than the list in use (then it would not take effect).
--       4. tci.import_country_risk — as 0085, plus: when the import takes
--          effect, the admin reminder is answered, and the countries it made
--          WORSE (OECD category up, or dropped from the list; not masked by
--          an internal category) where buyers hold in-force limits open ONE
--          country_downgrade_review task for credit underwriting listing
--          them (manual close, high priority).
--       5. tci.refresh_country_risk_tasks() — called by refresh_agenda (no
--          cron): while the list in use is older than oecd_stale_months, or
--          there is none, admin has one open oecd_review_due task; it is
--          retired once a newer list is imported or the setting moves.
--       6. complete_task: country_downgrade_review is the tenth manual type.
--          refresh_agenda: calls refresh_country_risk_tasks.
-- Why:  the OECD list was refreshed only if someone remembered to, and a
--       country getting worse told nobody whose buyers were affected.
--
-- Agenda (0086 types):
--   oecd_review_due          admin               normal  AUTO: a list newer than
--                                                         the threshold is in use
--   country_downgrade_review credit_underwriter  high    MANUAL

-- ---------------------------------------------------------------------------
-- 1. Setting
-- ---------------------------------------------------------------------------

alter table tci.workflow_settings alter column oecd_stale_months set default 4;
update tci.workflow_settings set oecd_stale_months = 4 where id and oecd_stale_months = 6;

-- Two lists of the same effective date are ordered by when they were
-- imported (tci.oecd_latest_import); now() is the transaction's start, so
-- two imports in one transaction tied. The clock breaks the tie, as 0085
-- does for sector reviews.
alter table tci.country_risk_imports alter column imported_at set default clock_timestamp();

-- ---------------------------------------------------------------------------
-- 2. The comparison
-- ---------------------------------------------------------------------------

-- p_rows as tci.import_country_risk takes them: [{country_code, category}].
-- Compared with the list in use (tci.oecd_latest_import); with none, every
-- row is «better» (from not classified).
create function tci.country_risk_changes(p_rows jsonb)
returns table (country_code text, oecd_before smallint, oecd_after smallint, internal_category smallint,
               direction text, buyers integer, exposure_uzs numeric, rates_missing integer)
language sql stable set search_path = '' as $$
  with prev as (
    select c.country_code::text as country_code, c.category
      from tci.country_risk_classifications c
     where c.import_id = (tci.oecd_latest_import()).id
  ),
  nxt as (
    select upper(r ->> 'country_code') as country_code, (r ->> 'category')::smallint as category
      from jsonb_array_elements(p_rows) r
  ),
  changed as (
    select coalesce(p.country_code, n.country_code) as country_code, p.category as before, n.category as after
      from prev p full join nxt n on n.country_code = p.country_code
     where p.category is distinct from n.category
  ),
  book as (
    select e.country_code::text as country_code,
           count(distinct v.entity_id)::int as buyers,
           sum(tci.to_uzs(v.approved_amount, v.currency_code)) as exposure_uzs,
           (count(*) filter (where tci.to_uzs(v.approved_amount, v.currency_code) is null))::int as rates_missing
      from tci.v_effective_limits v
      join tci.legal_entities e on e.id = v.entity_id
     where v.outcome in ('approved', 'partial') and v.policy_id is not null
     group by e.country_code
  )
  select ch.country_code, ch.before, ch.after, o.category,
         -- «not classified» (8) is worse than 7: it sends a decision to the committee.
         case when coalesce(ch.after, 8) > coalesce(ch.before, 8) then 'worse' else 'better' end,
         coalesce(bk.buyers, 0), bk.exposure_uzs, coalesce(bk.rates_missing, 0)
    from changed ch
    left join tci.country_risk_overrides o on o.country_code::text = ch.country_code and o.status = 'approved'
    left join book bk on bk.country_code = ch.country_code
$$;
revoke all on function tci.country_risk_changes(jsonb) from public, anon, authenticated;
grant execute on function tci.country_risk_changes(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The preview
-- ---------------------------------------------------------------------------

create function tci.country_risk_import_preview(p_effective date, p_rows jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_latest tci.country_risk_imports;
begin
  perform tci.require_role('admin');
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'country_import_empty: the file holds no classification' using errcode = 'P0001';
  end if;
  v_latest := tci.oecd_latest_import();
  return jsonb_build_object(
    'first_import', v_latest.id is null,
    'previous_effective', v_latest.effective_date,
    'previous_file', v_latest.file_name,
    -- an older list is stored but the one in use stays in use
    'superseded', v_latest.id is not null and p_effective is not null and p_effective < v_latest.effective_date,
    'changes', coalesce((select jsonb_agg(to_jsonb(c) order by c.direction desc, c.buyers desc, c.country_code)
                           from tci.country_risk_changes(p_rows) c), '[]'::jsonb));
end $$;
revoke all on function tci.country_risk_import_preview(date, jsonb) from public, anon;
grant execute on function tci.country_risk_import_preview(date, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The import (0085's, plus the reminder and the downgrade task)
-- ---------------------------------------------------------------------------

create or replace function tci.import_country_risk(p_effective date, p_file_name text, p_rows jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_import uuid;
  v_unknown text[];
  v_bad text[];
  v_count integer;
  v_latest tci.country_risk_imports;
  v_takes_effect boolean;
  v_worse jsonb := '[]'::jsonb;
  v_buyers integer := 0;
begin
  perform tci.require_role('admin');
  perform tci.begin_trusted_call();
  if p_effective is null or coalesce(btrim(p_file_name), '') = '' then
    raise exception 'country_import_incomplete: the effective date and the file name are required' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'country_import_empty: the file holds no classification' using errcode = 'P0001';
  end if;
  select array_agg(distinct upper(r ->> 'country_code')) into v_unknown
    from jsonb_array_elements(p_rows) r
   where not exists (select 1 from tci.countries c where c.code = upper(r ->> 'country_code'));
  if v_unknown is not null then
    raise exception 'country_import_unknown: %', array_to_string(v_unknown, ', ')
      using errcode = 'P0001', detail = array_to_string(v_unknown, ',');
  end if;
  select array_agg(r ->> 'country_code') into v_bad
    from jsonb_array_elements(p_rows) r
   where (r ->> 'category') !~ '^[0-7]$';
  if v_bad is not null then
    raise exception 'country_import_category: %', array_to_string(v_bad, ', ')
      using errcode = 'P0001', detail = array_to_string(v_bad, ',');
  end if;
  if (select count(*) from jsonb_array_elements(p_rows)) <> (select count(distinct upper(r ->> 'country_code')) from jsonb_array_elements(p_rows) r) then
    raise exception 'country_import_duplicate: a country appears twice in the file' using errcode = 'P0001';
  end if;

  -- 0087: what the new list changes, measured before it is stored.
  v_latest := tci.oecd_latest_import();
  v_takes_effect := v_latest.id is null or p_effective >= v_latest.effective_date;
  if v_latest.id is not null and v_takes_effect then
    select coalesce(jsonb_agg(jsonb_build_object('code', c.country_code, 'from', c.oecd_before, 'to', c.oecd_after,
                                                 'buyers', c.buyers, 'exposure_uzs', c.exposure_uzs,
                                                 'rates_missing', c.rates_missing)
                              order by c.buyers desc, c.country_code), '[]'::jsonb),
           coalesce(sum(c.buyers), 0)::int
      into v_worse, v_buyers
      from tci.country_risk_changes(p_rows) c
     where c.direction = 'worse' and c.internal_category is null and c.buyers > 0;
  end if;

  insert into tci.country_risk_imports (effective_date, file_name, row_count, note, imported_by)
  values (p_effective, btrim(p_file_name), jsonb_array_length(p_rows), nullif(btrim(p_note), ''), (select auth.uid()))
  returning id into v_import;
  insert into tci.country_risk_classifications (import_id, country_code, category)
  select v_import, upper(r ->> 'country_code'), (r ->> 'category')::smallint
    from jsonb_array_elements(p_rows) r;
  get diagnostics v_count = row_count;

  if v_takes_effect then
    -- 0087: the reminder is answered by a list that is now in use.
    update tci.tasks
       set status = 'done', completed_by = (select auth.uid()), completed_at = now()
     where task_type = 'oecd_review_due' and status = 'open';
  end if;
  if jsonb_array_length(v_worse) > 0 then
    perform tci.open_task('country_downgrade_review', 'country_risk_import', v_import,
      'agenda.tasks.country_downgrade_review',
      jsonb_build_object('effective_date', p_effective, 'countries', v_worse,
                         'countries_count', jsonb_array_length(v_worse), 'buyers', v_buyers),
      'credit_underwriter'::tci.user_role, null, null, 'high', null);
  end if;

  perform tci.emit_workflow_event('country_risk.imported', 'country_risk_import', v_import,
    jsonb_build_object('effective_date', p_effective, 'rows', v_count), null, null);
  return jsonb_build_object('import_id', v_import, 'rows', v_count,
                            'takes_effect', v_takes_effect, 'downgrades', jsonb_array_length(v_worse));
end $$;

-- ---------------------------------------------------------------------------
-- 5. The reminder
-- ---------------------------------------------------------------------------

-- One open task for admin while the list in use is older than the setting,
-- or there is none. The object is the list in use; with none, the nil uuid
-- stands for «no list» (tasks.object_id is not null).
create function tci.refresh_country_risk_tasks() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_latest tci.country_risk_imports;
  v_months smallint;
  v_stale boolean;
  v_object uuid;
begin
  perform tci.require_staff_or_internal();
  perform tci.begin_trusted_call();
  select s.oecd_stale_months into v_months from tci.workflow_settings s where s.id;
  v_latest := tci.oecd_latest_import();
  v_stale := v_latest.id is null
          or v_latest.effective_date < current_date - make_interval(months => v_months);
  v_object := coalesce(v_latest.id, '00000000-0000-0000-0000-000000000000'::uuid);

  -- A reminder about another list, or about a list no longer old, is retired.
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'oecd_review_due' and t.status = 'open'
     and (not v_stale or t.object_id <> v_object);
  if not v_stale
     or exists (select 1 from tci.tasks t where t.task_type = 'oecd_review_due' and t.status = 'open') then
    return 0;
  end if;

  perform tci.open_task('oecd_review_due', 'country_risk_list', v_object,
    'agenda.tasks.oecd_review_due',
    jsonb_build_object('effective_date', v_latest.effective_date, 'months', v_months),
    'admin'::tci.user_role, null, null, 'normal', null);
  return 1;
end $$;
revoke all on function tci.refresh_country_risk_tasks() from public, anon;
grant execute on function tci.refresh_country_risk_tasks() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. complete_task and refresh_agenda (the current bodies, one change each)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.complete_task(p_task_id uuid)
 RETURNS tci.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_task tci.tasks%rowtype;
begin
  perform tci.require_staff();

  select * into v_task from tci.tasks t
   where t.id = p_task_id and tci.task_is_mine(t.target_role, t.target_user)
     for update;
  if not found then
    raise exception 'task % not found or not yours', p_task_id using errcode = 'P0002';
  end if;
  if v_task.status <> 'open' then
    raise exception 'task is already %', v_task.status using errcode = 'P0001';
  end if;
  -- 0073: the proposer has read how their rating proposal ended.
  if v_task.task_type not in
     ('submission_declined', 'uncovered_excess_review', 'claim_declined_review',
      'entity_request_resolved', 'limit_validation_result', 'limit_validation_fyi',
      'rating_proposal_result',
      -- 0085: a person decides when the buyers of a downgraded sector, or a
      -- limit on a sanctioned party, have been looked at.
      'sector_downgrade_review', 'sanctions_limit_review',
      -- 0087: a person decides when the buyers in countries a new OECD
      -- list made worse have been looked at.
      'country_downgrade_review') then
    raise exception 'task type % closes itself when its object moves on', v_task.task_type
      using errcode = 'P0001';
  end if;

  update tci.tasks
     set status = 'done', completed_by = (select auth.uid()), completed_at = now()
   where id = p_task_id
   returning * into v_task;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION tci.refresh_agenda()
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
  -- (0085) The quarterly sector reviews; sanctions reviews of limits gone.
  v_opened := v_opened + tci.refresh_sector_tasks();
  -- (0087) The reminder to check the OECD for a newer list.
  v_opened := v_opened + tci.refresh_country_risk_tasks();
  perform tci.retire_sanction_tasks();

  return v_opened;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 7. Checks
-- ---------------------------------------------------------------------------

do $$
begin
  if (select column_default from information_schema.columns
       where table_schema = 'tci' and table_name = 'workflow_settings' and column_name = 'oecd_stale_months') <> '4' then
    raise exception '0087: oecd_stale_months must default to 4';
  end if;
  if pg_get_functiondef('tci.complete_task'::regproc) not like '%''country_downgrade_review''%' then
    raise exception '0087: complete_task must let a person close country_downgrade_review';
  end if;
  if pg_get_functiondef('tci.refresh_agenda'::regproc) not like '%tci.refresh_country_risk_tasks()%' then
    raise exception '0087: refresh_agenda must call refresh_country_risk_tasks';
  end if;
  if has_function_privilege('authenticated', 'tci.country_risk_changes(jsonb)', 'execute') then
    raise exception '0087: country_risk_changes is internal';
  end if;
end $$;
