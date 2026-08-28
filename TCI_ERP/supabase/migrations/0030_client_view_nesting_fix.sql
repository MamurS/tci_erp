-- What: rebuild the five Phase 4 client views so they stop reading
--       security_invoker views, and give each one a SECURITY DEFINER
--       function to read through instead.
-- Why:  `security_invoker = true` PROPAGATES. A client view that does not set
--       the option runs as its owner, but when it selects from a view that
--       DOES set it, permission checks on that inner view's base tables fall
--       back to the session user - the client - and the staff-only RLS on
--       those tables returns nothing.
--
--       The live smoke caught it: a client could file an overdue notification
--       and then see zero rows in tci.v_client_overdue_notifications, and
--       tci.v_client_declarations returned its rows with every derived total
--       NULL because the totals came through a left join on an invoker view.
--       Nothing leaked - the failure is closed, not open - but four screens
--       would have been silently empty.
--
--       A SECURITY DEFINER FUNCTION does not have this problem: inside it the
--       current user really is the owner, so an invoker view read there is
--       checked as the owner. So each client view now reads through one small
--       definer function that carries the client gate itself.
--
--       The Phase 3d client views (0025) are unaffected - every one of them
--       reads base tables directly. This was introduced in 0029 and is fixed
--       here before anything shipped on top of it.

-- ---------------------------------------------------------------------------
-- 1. Gated readers
-- ---------------------------------------------------------------------------
-- Each returns the rows of a staff view that belong to the caller's own
-- policies, and refuses anyone who is not a portal user. They are private:
-- the client views are the public surface.

create function tci.client_effective_limits()
returns setof tci.v_effective_limits
language sql
stable
security definer
set search_path = ''
as $$
  select v.* from tci.v_effective_limits v
   where tci.has_role('client')
     and v.policy_id in (
       select p.id from tci.policies p
        where p.entity_id in (select tci.my_client_entities()))
$$;

create function tci.client_declaration_lines_all()
returns setof tci.v_declaration_lines
language sql
stable
security definer
set search_path = ''
as $$
  select l.* from tci.v_declaration_lines l
   where tci.has_role('client')
     and l.policy_id in (
       select p.id from tci.policies p
        where p.entity_id in (select tci.my_client_entities()))
$$;

create function tci.client_declaration_totals()
returns setof tci.v_declaration_totals
language sql
stable
security definer
set search_path = ''
as $$
  select t.* from tci.v_declaration_totals t
   where tci.has_role('client')
     and t.policy_id in (
       select p.id from tci.policies p
        where p.entity_id in (select tci.my_client_entities()))
$$;

create function tci.client_policy_premium()
returns setof tci.v_policy_premium
language sql
stable
security definer
set search_path = ''
as $$
  select vp.* from tci.v_policy_premium vp
   where tci.has_role('client')
     and vp.entity_id in (select tci.my_client_entities())
$$;

create function tci.client_overdue_all()
returns setof tci.v_overdue_notifications
language sql
stable
security definer
set search_path = ''
as $$
  select n.* from tci.v_overdue_notifications n
   where tci.has_role('client')
     and n.policyholder_entity_id in (select tci.my_client_entities())
$$;

revoke execute on function tci.client_effective_limits() from public, anon;
revoke execute on function tci.client_declaration_lines_all() from public, anon;
revoke execute on function tci.client_declaration_totals() from public, anon;
revoke execute on function tci.client_policy_premium() from public, anon;
revoke execute on function tci.client_overdue_all() from public, anon;
grant execute on function tci.client_effective_limits() to authenticated;
grant execute on function tci.client_declaration_lines_all() to authenticated;
grant execute on function tci.client_declaration_totals() to authenticated;
grant execute on function tci.client_policy_premium() to authenticated;
grant execute on function tci.client_overdue_all() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The client views, rebuilt on the readers
-- ---------------------------------------------------------------------------

drop view tci.v_client_declarations;
create view tci.v_client_declarations as
select
  d.id,
  d.policy_id,
  p.policy_number,
  d.period_start,
  d.period_end,
  d.status,
  d.currency_code,
  d.total_insurable_turnover,
  d.note,
  d.submitted_at,
  d.accepted_at,
  -- The dispute NOTE is shown: it is addressed to the policyholder and tells
  -- them what to fix. The underwriter's other commentary is not here.
  d.disputed_at,
  d.dispute_note,
  d.supersedes_id,
  (d.status = 'corrected') as superseded,
  t.covered_turnover,
  t.uncovered_excess,
  t.line_count,
  pe.amount as premium_amount,
  pe.rate_used as premium_rate_used
from tci.declarations d
join tci.policies p on p.id = d.policy_id
left join tci.client_declaration_totals() t on t.declaration_id = d.id
left join tci.premium_entries pe on pe.declaration_id = d.id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities());

drop view tci.v_client_declaration_lines;
create view tci.v_client_declaration_lines as
select
  l.id,
  l.declaration_id,
  l.entity_id,
  l.entity_name,
  l.insurable_turnover,
  l.overdue_amount,
  l.line_note,
  l.coverage_basis,
  l.covered_amount,
  l.uncovered_excess,
  l.is_frozen
from tci.client_declaration_lines_all() l;

drop view tci.v_client_premium;
create view tci.v_client_premium as
select
  vp.policy_id,
  vp.policy_number,
  vp.currency_code,
  vp.premium_basis,
  vp.premium_rate_pct,
  vp.minimum_premium,
  vp.instalments_total,
  vp.instalments_paid,
  vp.instalments_overdue,
  vp.next_due_date,
  vp.earned_premium,
  vp.adjustment_amount,
  vp.premium_due_total,
  vp.period_closed
from tci.client_policy_premium() vp;

drop view tci.v_client_overdue_notifications;
create view tci.v_client_overdue_notifications as
select
  n.id,
  n.policy_id,
  n.policy_number,
  n.buyer_entity_id,
  n.buyer_name,
  n.first_due_date,
  n.overdue_amount,
  n.currency_code,
  n.reported_at,
  n.status,
  n.resolved_at,
  n.notify_by_date,
  n.days_past_due,
  n.reported_late,
  n.days_late,
  -- The policyholder must know their limit was suspended - that is the point
  -- of doing it immediately - but not which decision row carries it.
  n.limit_suspended
from tci.client_overdue_all() n;

drop view tci.v_client_declarable_buyers;
create view tci.v_client_declarable_buyers as
select
  v.policy_id,
  v.entity_id,
  e.name as entity_name,
  v.approved_amount,
  v.currency_code,
  v.valid_until
from tci.client_effective_limits() v
join tci.legal_entities e on e.id = v.entity_id
where v.outcome in ('approved', 'partial')
  and v.client_visible
  and coalesce(v.approved_amount, 0) > 0;

grant select on
  tci.v_client_declarations,
  tci.v_client_declaration_lines,
  tci.v_client_premium,
  tci.v_client_overdue_notifications,
  tci.v_client_declarable_buyers
to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  -- No client view may read a security_invoker view directly any more; they
  -- go through the definer readers above.
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'tci' and c.relkind = 'v' and c.relname like 'v_client_%'
     and (pg_get_viewdef(c.oid) ~ 'tci\.v_effective_limits'
       or pg_get_viewdef(c.oid) ~ 'tci\.v_declaration_lines'
       or pg_get_viewdef(c.oid) ~ 'tci\.v_declaration_totals'
       or pg_get_viewdef(c.oid) ~ 'tci\.v_policy_premium'
       or pg_get_viewdef(c.oid) ~ 'tci\.v_overdue_notifications');
  if v_bad is not null then
    raise exception 'client view(s) still read a security_invoker view directly: %', v_bad;
  end if;

  -- And none of them may have picked up security_invoker themselves.
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'tci' and c.relkind = 'v' and c.relname like 'v_client_%'
     and c.reloptions::text ilike '%security_invoker=true%';
  if v_bad is not null then
    raise exception 'client view(s) are security_invoker: %', v_bad;
  end if;
end
$$;
