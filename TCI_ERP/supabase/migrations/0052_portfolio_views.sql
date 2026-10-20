-- What: two read-only portfolio views behind the role workspaces.
--         * tci.v_policy_portfolio  one row per policy: terms, premium
--           (minimum, earned, due, paid, overdue), claims (count, open,
--           claimed, paid, outstanding, insurer's recoveries), incurred
--           loss and the loss ratio, and the in-force credit limits on it
--           in UZS — the commercial underwriting portfolio.
--         * tci.v_credit_portfolio  one row per in-force credit limit (the
--           effective approved / partial decision on a bound policy) with
--           the buyer, the policyholder, the amount in UZS, the review date,
--           the band the decision was based on and the buyer's CURRENT
--           rating — the credit underwriting portfolio.
-- Why:  the workspaces need portfolio figures, and how a loss ratio or an
--       in-force limit is defined is business logic: it belongs in SQL, not
--       in the screen. The screens only group these rows.
--
-- Definitions (the view comments repeat them):
--   premium base   = greatest(earned premium, minimum premium) — what the
--                    policy owes for the period, as v_policy_premium has it
--                    (no refund below the minimum)
--   incurred       = indemnity paid + indemnity approved but not yet paid
--                    - the insurer's share of recoveries
--   loss ratio %   = incurred / premium base x 100, NULL while the base is 0
--   in force       = v_effective_limits, outcome approved or partial, on a
--                    bound policy (a pre-bind limit is not exposure — the same
--                    rule as v_buyer_exposure and v_group_exposure)
--   amount in UZS  = amount x tci.latest_uzs_rate(currency); a currency with
--                    no rate gives NULL and is COUNTED, never treated as zero
--
-- Both views are security_invoker over staff-only tables: a client selecting
-- them gets no rows, and they read through nothing a client view relies on.

-- ---------------------------------------------------------------------------
-- 1. Policies
-- ---------------------------------------------------------------------------
create view tci.v_policy_portfolio
with (security_invoker = true) as
select
  p.id                              as policy_id,
  p.policy_number,
  p.status,
  p.product_structure,
  p.entity_id                       as policyholder_entity_id,
  e.name                            as policyholder_name,
  e.country_code                    as policyholder_country,
  p.currency_code,
  p.inception_date,
  p.expiry_date,
  p.expiry_date - current_date      as days_to_expiry,
  p.insured_percentage,
  p.max_liability_amount,
  p.discretionary_limit,
  p.minimum_premium,
  pr.earned_premium,
  pr.premium_due_total,
  pr.instalments_paid               as premium_paid,
  pr.instalments_overdue            as premium_overdue,
  greatest(coalesce(pr.earned_premium, 0), coalesce(p.minimum_premium, 0)) as premium_base,
  coalesce(c.claims_count, 0)       as claims_count,
  coalesce(c.open_claims, 0)        as open_claims,
  coalesce(c.claimed, 0)            as claimed_total,
  coalesce(c.paid, 0)               as indemnity_paid,
  coalesce(c.outstanding, 0)        as indemnity_outstanding,
  coalesce(c.recovered, 0)          as recoveries_insurer,
  coalesce(c.paid, 0) + coalesce(c.outstanding, 0) - coalesce(c.recovered, 0) as incurred,
  case
    when greatest(coalesce(pr.earned_premium, 0), coalesce(p.minimum_premium, 0)) > 0
    then round(
      (coalesce(c.paid, 0) + coalesce(c.outstanding, 0) - coalesce(c.recovered, 0)) * 100
        / greatest(coalesce(pr.earned_premium, 0), coalesce(p.minimum_premium, 0)), 1)
  end                               as loss_ratio_pct,
  coalesce(l.limits_count, 0)       as limits_count,
  l.limits_uzs,
  coalesce(l.limits_missing_rates, 0) as limits_missing_rates
from tci.policies p
join tci.legal_entities e on e.id = p.entity_id
left join tci.v_policy_premium pr on pr.policy_id = p.id
left join lateral (
  select count(*) filter (where cp.status <> 'draft')                                  as claims_count,
         count(*) filter (where cp.status not in ('draft', 'declined', 'paid', 'closed', 'withdrawn')) as open_claims,
         sum(cp.claimed_amount) filter (where cp.status <> 'draft')                    as claimed,
         sum(cp.paid_total)                                                            as paid,
         sum(cp.outstanding_indemnity)                                                 as outstanding,
         sum(cp.recovery_insurer)                                                      as recovered
    from tci.v_claim_position cp
   where cp.policy_id = p.id
) c on true
left join lateral (
  select count(*)                                                                     as limits_count,
         sum(v.approved_amount * tci.latest_uzs_rate(v.currency_code))                as limits_uzs,
         count(*) filter (where tci.latest_uzs_rate(v.currency_code) is null)         as limits_missing_rates
    from tci.v_effective_limits v
   where v.policy_id = p.id
     and v.outcome in ('approved', 'partial')
) l on true;

comment on view tci.v_policy_portfolio is
  'One row per policy for the commercial portfolio. premium_base = greatest(earned, minimum premium); incurred = indemnity paid + approved-but-unpaid - insurer recoveries; loss_ratio_pct = incurred / premium_base x 100 (NULL while the base is 0). Amounts are in the policy currency except limits_uzs, where a missing rate is counted in limits_missing_rates, never treated as zero.';

grant select on tci.v_policy_portfolio to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Credit limits in force
-- ---------------------------------------------------------------------------
create view tci.v_credit_portfolio
with (security_invoker = true) as
select
  v.decision_id,
  v.request_id,
  v.policy_id,
  pol.policy_number,
  pol.entity_id                     as policyholder_entity_id,
  ph.name                           as policyholder_name,
  v.entity_id                       as buyer_entity_id,
  b.name                            as buyer_name,
  b.country_code                    as buyer_country,
  v.outcome,
  v.stage,
  v.commercially_adjusted,
  v.approved_amount,
  v.currency_code,
  v.approved_amount * tci.latest_uzs_rate(v.currency_code) as amount_uzs,
  v.payment_terms_days,
  v.valid_from,
  v.valid_until,
  v.valid_until - current_date      as days_to_review,
  v.decided_at,
  tci.grade_band_for_assessment(v.based_on_assessment_id) as decision_band,
  a.id                              as current_assessment_id,
  a.rating_grade                    as current_grade,
  a.rating_score                    as current_score,
  a.created_at                      as rated_at,
  tci.grade_band_for_assessment(a.id) as current_band
from tci.v_effective_limits v
join tci.policies pol on pol.id = v.policy_id
join tci.legal_entities ph on ph.id = pol.entity_id
join tci.legal_entities b on b.id = v.entity_id
left join lateral (
  select ca.id, ca.rating_grade, ca.rating_score, ca.created_at
    from tci.credit_assessments ca
   where ca.entity_id = v.entity_id
   order by ca.created_at desc
   limit 1
) a on true
where v.policy_id is not null
  and v.outcome in ('approved', 'partial');

comment on view tci.v_credit_portfolio is
  'One row per in-force credit limit (effective approved / partial decision on a bound policy). amount_uzs = amount x latest UZS rate, NULL when the currency has no rate (count it, never treat it as zero). decision_band is the band of the assessment the decision was based on; current_band / current_grade come from the buyer''s latest assessment.';

grant select on tci.v_credit_portfolio to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  -- staff read them, anon never does
  if not has_table_privilege('authenticated', 'tci.v_policy_portfolio', 'select')
     or not has_table_privilege('authenticated', 'tci.v_credit_portfolio', 'select') then
    raise exception '0052: the portfolio views must be readable by authenticated';
  end if;
  if has_table_privilege('anon', 'tci.v_policy_portfolio', 'select')
     or has_table_privilege('anon', 'tci.v_credit_portfolio', 'select') then
    raise exception '0052: anon can read a portfolio view';
  end if;
  -- they run as the caller, so row policies decide what anyone sees
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'tci'::regnamespace
     and c.relname in ('v_policy_portfolio', 'v_credit_portfolio')
     and not coalesce('security_invoker=true' = any (c.reloptions), false);
  if v_bad is not null then
    raise exception '0052: not security_invoker: %', v_bad;
  end if;
  -- every function they call stays executable by the querying role
  if not has_function_privilege('authenticated', 'tci.latest_uzs_rate(character)', 'execute')
     or not has_function_privilege('authenticated', 'tci.grade_band_for_assessment(uuid)', 'execute') then
    raise exception '0052: a function the portfolio views call is closed to authenticated';
  end if;
end;
$$;
