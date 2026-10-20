-- What: three read-only views behind the credit underwriter's workbench
--       («Кредитные лимиты» as one hub of tabs).
--         * tci.v_limit_request_queue   every OPEN limit request with the
--           band it would be decided in (the buyer's latest assessment), the
--           amount in UZS and whether the CALLER can decide it alone.
--         * tci.v_rating_worklist       buyers with live credit business
--           whose rating needs work: none yet, a newer statement than the
--           one rated, or older than twelve months.
--         * tci.v_group_limit_status    every corporate group (two or more
--           members, or a live group limit) with its in-force exposure
--           against the cap.
-- Why:  "can I decide this?", "which buyers need a rating?" and "which group
--       is near its cap?" are business rules. They belong in SQL beside
--       decide_limit_request, refresh_agenda and group_exposure_preflight,
--       not restated in the screen.
--
-- All three are security_invoker over staff-only tables: a client selecting
-- them gets no rows. They write nothing and add no function.

-- ---------------------------------------------------------------------------
-- 1. The decision queue
-- ---------------------------------------------------------------------------
-- band            = tci.grade_band_for_assessment(the buyer's latest
--                   assessment); 'unrated' without one — the band the
--                   decision form preselects and decide_limit_request uses
-- amount_uzs      = requested amount x tci.latest_uzs_rate(currency); NULL
--                   (and rate_missing) when the currency has no rate
-- my_authority_uzs= the same aggregate as tci.my_authority_uzs(band), except
--                   that a grant in a currency with no rate is skipped
--                   instead of raising: one bad grant must not empty a list.
--                   decide_limit_request still raises on it.
-- decide_alone    = admin, or amount_uzs <= my_authority_uzs. Beyond it a
--                   decision escalates (submitted / under review) or must be
--                   left to a colleague whose band authority covers it.
create view tci.v_limit_request_queue
with (security_invoker = true) as
select
  r.id                                  as request_id,
  r.status,
  r.entity_id                           as buyer_entity_id,
  b.name                                as buyer_name,
  b.country_code                        as buyer_country,
  r.policy_id,
  r.insurance_request_id,
  r.requested_amount,
  r.currency_code,
  r.submitted_at,
  a.id                                  as assessment_id,
  a.rating_grade                        as grade,
  tci.grade_band_for_assessment(a.id)   as band,
  r.requested_amount * tci.latest_uzs_rate(r.currency_code) as amount_uzs,
  (tci.latest_uzs_rate(r.currency_code) is null) as rate_missing,
  coalesce(auth_.authority_uzs, 0)      as my_authority_uzs,
  (
    tci.has_role('admin')
    or (tci.latest_uzs_rate(r.currency_code) is not null
        and r.requested_amount * tci.latest_uzs_rate(r.currency_code)
            <= coalesce(auth_.authority_uzs, 0))
  )                                     as decide_alone
from tci.credit_limit_requests r
join tci.legal_entities b on b.id = r.entity_id
left join lateral (
  select ca.id, ca.rating_grade
    from tci.credit_assessments ca
   where ca.entity_id = r.entity_id
   order by ca.created_at desc
   limit 1
) a on true
left join lateral (
  select max(g.max_amount * tci.latest_uzs_rate(g.currency_code)) as authority_uzs
    from tci.authority_grants g
   where g.user_id = (select auth.uid())
     and g.applies_to = 'credit'
     and g.grade_band = tci.grade_band_for_assessment(a.id)
     and g.valid_from <= current_date
     and (g.valid_to is null or g.valid_to >= current_date)
) auth_ on true
where r.status in ('submitted', 'under_review', 'escalated');

comment on view tci.v_limit_request_queue is
  'Open limit requests with the band they would be decided in (buyer''s latest assessment, unrated without one), amount_uzs (NULL and rate_missing when the currency has no rate) and decide_alone = admin or amount_uzs <= the caller''s credit authority for that band. A grant in a currency with no rate is skipped here; decide_limit_request raises on it.';

grant select on tci.v_limit_request_queue to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The rating worklist
-- ---------------------------------------------------------------------------
-- Live credit business = an open limit request, an effective approved /
-- partial limit (pre-bind ones included: the submission still needs the
-- rating), or a place in a live submission's buyer package.
--
-- reason (first that applies):
--   no_statements  never rated and no statement on file — the information
--                  manager has to enter financials before anyone can rate
--   no_rating      statements on file, never rated
--   new_statement  a statement for a LATER period than the one the latest
--                  rating was based on
--   stale          the latest rating is older than twelve months — the
--                  rating_stale Agenda rule of tci.refresh_agenda()
-- A buyer with none of these is not in the list.
create view tci.v_rating_worklist
with (security_invoker = true) as
with live as (
  select r.entity_id from tci.credit_limit_requests r
   where r.status in ('draft', 'submitted', 'under_review', 'escalated')
  union
  select v.entity_id from tci.v_effective_limits v
   where v.outcome in ('approved', 'partial')
  union
  select ib.entity_id
    from tci.insurance_request_buyers ib
    join tci.insurance_requests ir on ir.id = ib.request_id
   where ib.entity_id is not null
     and ir.status not in ('draft', 'declined', 'withdrawn', 'bound')
),
facts as (
  select
    e.id                                  as entity_id,
    e.name                                as buyer_name,
    e.country_code                        as buyer_country,
    a.id                                  as assessment_id,
    a.rating_grade                        as grade,
    a.created_at                          as rated_at,
    rs.period_end_date                    as rated_period_end,
    st.statements_count,
    st.latest_period_end,
    st.latest_fiscal_year,
    (select count(*) from tci.credit_limit_requests r
      where r.entity_id = e.id
        and r.status in ('submitted', 'under_review', 'escalated'))::int as open_requests,
    (select count(*) from tci.v_effective_limits v
      where v.entity_id = e.id
        and v.outcome in ('approved', 'partial'))::int                   as limits_in_force
  from live l
  join tci.legal_entities e on e.id = l.entity_id
  left join lateral (
    select ca.id, ca.rating_grade, ca.created_at, ca.statement_id
      from tci.credit_assessments ca
     where ca.entity_id = e.id
     order by ca.created_at desc
     limit 1
  ) a on true
  left join tci.financial_statements rs on rs.id = a.statement_id
  left join lateral (
    select count(*)::int             as statements_count,
           max(fs.period_end_date)   as latest_period_end,
           max(fs.fiscal_year)       as latest_fiscal_year
      from tci.financial_statements fs
     where fs.entity_id = e.id
  ) st on true
)
select
  f.*,
  tci.grade_band_for_assessment(f.assessment_id) as band,
  case
    when f.assessment_id is null and f.statements_count = 0 then 'no_statements'
    when f.assessment_id is null                            then 'no_rating'
    when f.latest_period_end > f.rated_period_end           then 'new_statement'
    when f.rated_at <= now() - interval '12 months'         then 'stale'
  end                                            as reason
from facts f
where f.assessment_id is null
   or f.latest_period_end > f.rated_period_end
   or f.rated_at <= now() - interval '12 months';

comment on view tci.v_rating_worklist is
  'Buyers with live credit business (open request, effective approved/partial limit, or a live submission package) whose rating needs work. reason, first that applies: no_statements, no_rating, new_statement (a later period than the rated one), stale (rated more than 12 months ago, as refresh_agenda''s rating_stale).';

grant select on tci.v_rating_worklist to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Groups against their limits
-- ---------------------------------------------------------------------------
-- A group is what tci.entity_group returns for its ultimate parent; a
-- standalone buyer is its own one-member "group" in v_group_exposure and is
-- left out here unless a group limit was set on it.
-- exposure as tci.v_group_exposure (rows with no rate excluded from the sum
-- and counted in missing_rates); the live limit as tci.current_group_limit;
-- limit_uzs = max_amount x latest rate (NULL without one).
-- utilisation_pct = exposure_uzs / limit_uzs x 100;
-- over_limit = exposure_uzs > limit_uzs — the same comparison
-- group_exposure_preflight makes for a NEW decision, here for the book as it
-- stands.
create view tci.v_group_limit_status
with (security_invoker = true) as
with live_limits as (
  select distinct on (gl.ultimate_parent_entity_id)
         gl.ultimate_parent_entity_id, gl.id, gl.max_amount, gl.currency_code,
         gl.valid_from, gl.valid_to
    from tci.group_limits gl
   where gl.valid_from <= current_date
     and (gl.valid_to is null or gl.valid_to >= current_date)
   order by gl.ultimate_parent_entity_id, gl.valid_from desc, gl.created_at desc
),
groups_ as (
  select ge.ultimate_parent_id from tci.v_group_exposure ge
  union
  select ll.ultimate_parent_entity_id from live_limits ll
)
select
  g.ultimate_parent_id,
  up.name                                         as ultimate_parent_name,
  up.country_code                                 as ultimate_parent_country,
  gs.members                                      as members_count,
  coalesce(ge.members_with_limits, 0)             as members_with_limits,
  coalesce(ge.limits_count, 0)                    as limits_count,
  coalesce(ge.policyholders_count, 0)             as policyholders_count,
  coalesce(ge.exposure_uzs, 0)                    as exposure_uzs,
  coalesce(ge.missing_rates, 0)                   as missing_rates,
  ll.id                                           as group_limit_id,
  ll.max_amount                                   as limit_amount,
  ll.currency_code                                as limit_currency,
  ll.valid_from                                   as limit_valid_from,
  ll.valid_to                                     as limit_valid_to,
  ll.max_amount * tci.latest_uzs_rate(ll.currency_code) as limit_uzs,
  case
    when ll.max_amount * tci.latest_uzs_rate(ll.currency_code) > 0
    then round(coalesce(ge.exposure_uzs, 0) * 100
               / (ll.max_amount * tci.latest_uzs_rate(ll.currency_code)), 1)
  end                                             as utilisation_pct,
  coalesce(coalesce(ge.exposure_uzs, 0)
           > ll.max_amount * tci.latest_uzs_rate(ll.currency_code), false) as over_limit
from groups_ g
join tci.legal_entities up on up.id = g.ultimate_parent_id
left join tci.v_group_exposure ge on ge.ultimate_parent_id = g.ultimate_parent_id
left join live_limits ll on ll.ultimate_parent_entity_id = g.ultimate_parent_id
cross join lateral (
  select count(*)::int as members from tci.entity_group(g.ultimate_parent_id)
) gs
where gs.members > 1 or ll.id is not null;

comment on view tci.v_group_limit_status is
  'Every corporate group (members_count > 1 by tci.entity_group, or a live group limit) with in-force exposure or a live limit. exposure_uzs as v_group_exposure (missing rates counted, never zero); limit_uzs = live group limit x latest rate (NULL without one); utilisation_pct = exposure / limit x 100; over_limit = exposure_uzs > limit_uzs.';

grant select on tci.v_group_limit_status to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_views constant text[] := array['v_limit_request_queue', 'v_rating_worklist', 'v_group_limit_status'];
  v_name text;
  v_bad text;
begin
  foreach v_name in array v_views loop
    if not has_table_privilege('authenticated', 'tci.' || v_name, 'select') then
      raise exception '0053: % must be readable by authenticated', v_name;
    end if;
    if has_table_privilege('anon', 'tci.' || v_name, 'select') then
      raise exception '0053: anon can read %', v_name;
    end if;
  end loop;

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'tci'::regnamespace
     and c.relname = any (v_views)
     and not coalesce('security_invoker=true' = any (c.reloptions), false);
  if v_bad is not null then
    raise exception '0053: not security_invoker: %', v_bad;
  end if;

  -- every function they call stays executable by the querying role
  if not has_function_privilege('authenticated', 'tci.latest_uzs_rate(character)', 'execute')
     or not has_function_privilege('authenticated', 'tci.grade_band_for_assessment(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'tci.has_role(tci.user_role[])', 'execute')
     or not has_function_privilege('authenticated', 'tci.entity_group(uuid)', 'execute') then
    raise exception '0053: a function the workbench views call is closed to authenticated';
  end if;

  -- the stale threshold is the Agenda's: refresh_agenda must still say 12 months
  if position('interval ''12 months''' in pg_get_functiondef('tci.refresh_agenda()'::regprocedure)) = 0 then
    raise exception '0053: refresh_agenda no longer uses the 12-month rating_stale threshold';
  end if;
end;
$$;
