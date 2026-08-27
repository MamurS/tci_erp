-- 0023_nullable_policy_bind.sql
-- What: credit_limit_requests.policy_id becomes NULLABLE, so a submission for
--       NEW business can carry limit requests and credit decisions before any
--       policy exists; plus tci.bind_insurance_request, which turns an
--       accepted submission into a policy and adopts those limits into it.
-- Why:  Phase 3c-1 shipped the submission pipeline against a NOT NULL
--       policy_id, so the underwriting -> commercial_review guard could only
--       be satisfied for renewals of a live policy. That gap is closed here.
--
-- The grouping key. policy_id was load-bearing in eight places; every one of
-- them now keys on tci.limit_scope(policy_id, insurance_request_id) instead:
--
--   1. credit_limit_requests_open_uq   NULLs are distinct in a btree, so the
--                                      one-open-request rule would silently
--                                      stop applying to submission requests.
--   2. decide_limit_request            supersede matched on r.policy_id =
--                                      v_request.policy_id; NULL = NULL is
--                                      NULL, so nothing got superseded and
--                                      two effective decisions could coexist.
--   3. apply_emergency_release         same comparison when looking up the
--                                      amount the client currently has, so a
--                                      reduction would not be detected.
--   4. v_effective_limits              distinct on treats NULLs as EQUAL, so
--                                      two different submissions for the same
--                                      buyer collapsed into one row.
--   5. v_buyer_exposure                count(distinct policy_id) skips NULLs.
--   6. submit_limit_request            required an ACTIVE policy, which a
--                                      submission request does not have.
--   7. limit_requests client RLS       policy_id IN (...) is NULL for a
--   8. limit_decisions client RLS      submission request, so the client saw
--                                      nothing; both now also resolve through
--                                      the submission's applicant entity.
--
-- Chosen scheme: coalesce(policy_id, insurance_request_id).
--   * an in-force request scopes to its policy   -> one open request per
--     (policy, buyer), exactly as before;
--   * a submission request scopes to the submission -> one open request per
--     (submission, buyer);
--   * a renewal raised INSIDE a submission carries both, and policy_id wins,
--     which is right: the live policy is what must not have two open
--     requests for one buyer.
-- Rejected: a provisional policy row created at underwriting and activated at
-- bind. It would have put half-real policies in tci.policies, visible to every
-- policy screen and to the client, to avoid one nullable column.

-- ---------------------------------------------------------------------------
-- The scope key
-- ---------------------------------------------------------------------------

create function tci.limit_scope(p_policy_id uuid, p_insurance_request_id uuid)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$ select coalesce(p_policy_id, p_insurance_request_id) $$;

comment on function tci.limit_scope(uuid, uuid) is
  'The grouping key for a limit request: its policy when it has one, else the submission that raised it. IMMUTABLE so it can key an index.';

alter table tci.credit_limit_requests alter column policy_id drop not null;

-- A request with neither a policy nor a submission belongs to nothing.
alter table tci.credit_limit_requests
  add constraint credit_limit_requests_scoped
  check (policy_id is not null or insurance_request_id is not null);

drop index tci.credit_limit_requests_open_uq;
create unique index credit_limit_requests_open_uq
  on tci.credit_limit_requests (tci.limit_scope(policy_id, insurance_request_id), entity_id)
  where status in ('draft', 'submitted', 'under_review', 'escalated');

comment on index tci.credit_limit_requests_open_uq is
  'One OPEN limit request per (scope, buyer), where scope is the policy or, before bind, the submission.';

-- ---------------------------------------------------------------------------
-- Submitting a request that has no policy yet
-- ---------------------------------------------------------------------------

create or replace function tci.submit_limit_request(p_request_id uuid)
returns tci.credit_limit_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request tci.credit_limit_requests%rowtype;
  v_policy_status tci.policy_status;
  v_request_status tci.insurance_request_status;
begin
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'only draft requests can be submitted (current: %)', v_request.status
      using errcode = 'P0001';
  end if;

  if v_request.policy_id is not null then
    -- In-force path, unchanged: limits attach to an ACTIVE policy.
    select status into v_policy_status from tci.policies where id = v_request.policy_id;
    if v_policy_status is distinct from 'active' then
      raise exception 'policy is not active (current: %) - limit requests bind to active policies',
        v_policy_status using errcode = 'P0001';
    end if;
  else
    -- Submission path: the submission must still be open for underwriting.
    select status into v_request_status
      from tci.insurance_requests where id = v_request.insurance_request_id;
    if v_request_status is null then
      raise exception 'limit request % belongs to no policy and no submission', p_request_id
        using errcode = 'P0001';
    end if;
    if v_request_status in ('declined', 'withdrawn', 'bound') then
      raise exception 'submission is % - it can no longer take limit requests', v_request_status
        using errcode = 'P0001';
    end if;
  end if;

  update tci.credit_limit_requests
     set status = 'submitted', submitted_at = now()
   where id = p_request_id
   returning * into v_request;
  return v_request;
end;
$$;

-- ---------------------------------------------------------------------------
-- Supersede and emergency-release, keyed on the scope
-- ---------------------------------------------------------------------------

-- Taken VERBATIM from the deployed definition, with ONE change: the supersede
-- predicate. It matched on r.policy_id = v_request.policy_id, and NULL = NULL
-- is NULL, so for a submission request nothing was superseded and two
-- effective decisions could coexist for the same buyer.
--
-- Nothing else here is touched on purpose. In particular this function does
-- NOT emit limit.credit_decided - the credit_limit_decisions_emit_event
-- AFTER INSERT trigger does - and a decline still refuses a non-null amount
-- rather than silently discarding it.
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

    -- Admin is unlimited; everyone else is bounded by their band authority.
    if not tci.has_role('admin') then
      v_amount_uzs := tci.to_uzs(p_amount, v_currency);
      v_authority_uzs := tci.my_authority_uzs(v_band);
      if v_amount_uzs > v_authority_uzs then
        update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;
        return jsonb_build_object(
          'result', 'escalated',
          'grade_band', v_band,
          'amount_uzs', v_amount_uzs,
          'authority_uzs', v_authority_uzs
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

  -- THE ONE CHANGE: supersede over the SCOPE, not the policy.
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

-- Same fix on the reduction lookup: without it a pre-bind reduction would not
-- be recognised as one, and would sit in the sales window instead of reaching
-- the client immediately.
create or replace function tci.apply_emergency_release()
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
    select d.approved_amount into v_prev_amount
    from tci.credit_limit_decisions d
    join tci.credit_limit_requests r on r.id = d.request_id
    join tci.credit_limit_requests nr on nr.id = new.request_id
    where tci.limit_scope(r.policy_id, r.insurance_request_id)
          = tci.limit_scope(nr.policy_id, nr.insurance_request_id)
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

-- ---------------------------------------------------------------------------
-- Views: group by the scope, not the policy
-- ---------------------------------------------------------------------------

drop view tci.v_buyer_exposure;
drop view tci.v_effective_limits;

create view tci.v_effective_limits
with (security_invoker = true) as
select distinct on (tci.limit_scope(r.policy_id, r.insurance_request_id), r.entity_id)
  d.id            as decision_id,
  r.policy_id,
  r.entity_id,
  d.request_id,
  r.insurance_request_id,
  tci.limit_scope(r.policy_id, r.insurance_request_id) as scope_id,
  -- true while the limit lives inside a submission and no policy exists yet
  (r.policy_id is null) as pre_bind,
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
  coalesce(parent.id, d.id)                           as credit_decision_id,
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
order by tci.limit_scope(r.policy_id, r.insurance_request_id), r.entity_id,
         (d.stage = 'commercial') desc, d.decided_at desc;

-- Exposure is IN-FORCE insured risk, so pre-bind limits are excluded: until a
-- policy exists nothing has been underwritten. For existing data this changes
-- nothing (every row had a policy); it only defines the new case.
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
  and v.policy_id is not null
group by v.entity_id;

grant select on tci.v_effective_limits, tci.v_buyer_exposure to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Client visibility: through the policy, or before bind through the submission
-- ---------------------------------------------------------------------------

drop policy "limit_requests: client reads own" on tci.credit_limit_requests;
create policy "limit_requests: client reads own"
  on tci.credit_limit_requests for select to authenticated
  using (
    tci.has_role('client')
    and (
      policy_id in (
        select p.id from tci.policies p
        join tci.policyholder_users pu on pu.entity_id = p.entity_id
        where pu.user_id = (select auth.uid())
      )
      or insurance_request_id in (
        select ir.id from tci.insurance_requests ir
        join tci.policyholder_users pu on pu.entity_id = ir.entity_id
        where pu.user_id = (select auth.uid())
      )
    )
  );

drop policy "limit_decisions: client reads own released" on tci.credit_limit_decisions;
create policy "limit_decisions: client reads own released"
  on tci.credit_limit_decisions for select to authenticated
  using (
    tci.has_role('client')
    and tci.decision_is_released(released_at, decided_at, held)
    and request_id in (
      select r.id from tci.credit_limit_requests r
      left join tci.policies p on p.id = r.policy_id
      left join tci.insurance_requests ir on ir.id = r.insurance_request_id
      join tci.policyholder_users pu
        on pu.entity_id = coalesce(p.entity_id, ir.entity_id)
      where pu.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Bind: an accepted submission becomes a policy
-- ---------------------------------------------------------------------------

-- Projects the submission's proposed terms into a real policy, adopts every
-- limit request the package raised, and advances the submission to 'bound'.
-- One transaction; re-binding is refused rather than silently duplicating.
create function tci.bind_insurance_request(
  p_request_id     uuid,
  p_policy_number  text,
  p_inception_date date,
  p_expiry_date    date
)
returns tci.policies
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request tci.insurance_requests%rowtype;
  v_policy  tci.policies%rowtype;
  v_missing text[];
  v_adopted int;
begin
  if not tci.has_role('admin', 'commercial_underwriter') then
    raise exception 'only commercial underwriting may issue a policy'
      using errcode = 'P0004';
  end if;

  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found then
    raise exception 'submission % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;

  -- Idempotency guard: an explicit refusal, never a second policy.
  if v_request.bound_policy_id is not null then
    raise exception 'submission % is already bound to policy %',
      v_request.request_number, v_request.bound_policy_id using errcode = 'P0001';
  end if;
  if v_request.status <> 'accepted' then
    raise exception 'only an accepted submission can be bound (current: %)', v_request.status
      using errcode = 'P0001';
  end if;

  -- Every term the policy table requires must have been agreed. Naming the
  -- missing ones beats a bare not-null violation from the insert.
  v_missing := array_remove(array[
    case when v_request.product_structure is null then 'product_structure' end,
    case when v_request.currency_code is null then 'currency_code' end,
    case when v_request.insured_percentage is null then 'insured_percentage' end,
    case when v_request.nql_amount is null then 'nql_amount' end,
    case when v_request.premium_rate_pct is null then 'premium_rate_pct' end,
    case when v_request.minimum_premium is null then 'minimum_premium' end,
    case when v_request.discretionary_limit is null then 'discretionary_limit' end,
    case when v_request.waiting_period_days is null then 'waiting_period_days' end,
    case when v_request.max_extension_period_days is null then 'max_extension_period_days' end,
    case when v_request.max_payment_terms_days is null then 'max_payment_terms_days' end,
    case when v_request.declaration_frequency is null then 'declaration_frequency' end
  ], null);
  if array_length(v_missing, 1) > 0 then
    raise exception 'the submission is missing agreed terms: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_policy_number), '') = '' then
    raise exception 'a policy needs a number' using errcode = 'P0001';
  end if;
  if p_expiry_date <= p_inception_date then
    raise exception 'the expiry date must be after the inception date'
      using errcode = 'P0001';
  end if;

  insert into tci.policies (
    entity_id, policy_number, product_structure, status,
    inception_date, expiry_date, currency_code, insured_percentage,
    max_liability_amount, max_liability_premium_multiple, nql_amount,
    deductible_each_loss, aggregate_first_loss, premium_rate_pct,
    minimum_premium, estimated_annual_turnover, discretionary_limit,
    waiting_period_days, max_extension_period_days, max_payment_terms_days,
    declaration_frequency, notes
  ) values (
    v_request.entity_id, btrim(p_policy_number), v_request.product_structure, 'draft',
    p_inception_date, p_expiry_date, v_request.currency_code, v_request.insured_percentage,
    v_request.max_liability_amount, v_request.max_liability_premium_multiple, v_request.nql_amount,
    v_request.deductible_each_loss, v_request.aggregate_first_loss, v_request.premium_rate_pct,
    v_request.minimum_premium, v_request.estimated_annual_turnover, v_request.discretionary_limit,
    v_request.waiting_period_days, v_request.max_extension_period_days, v_request.max_payment_terms_days,
    v_request.declaration_frequency,
    -- notes stays the user's field. Provenance is structural - the submission
    -- carries bound_policy_id - and the UI renders it translated; writing an
    -- English sentence in here would leak untranslatable text onto the policy.
    null
  ) returning * into v_policy;

  -- Adopt the package's limits. Their scope moves from the submission to the
  -- policy, which is exactly what the coalesce() key is built to allow.
  update tci.credit_limit_requests
     set policy_id = v_policy.id
   where insurance_request_id = p_request_id
     and policy_id is null;
  get diagnostics v_adopted = row_count;

  update tci.insurance_requests
     set bound_policy_id = v_policy.id
   where id = p_request_id;

  -- The status machine owns the transition, its history row and its event.
  -- No comment: the history row already says `bound`, and a rendered English
  -- sentence would show up untranslated in every locale's timeline. The
  -- policy number travels on the request.bound payload below instead.
  perform tci.advance_insurance_request(p_request_id, 'bound', null);

  perform tci.emit_workflow_event(
    'request.bound', 'insurance_request', p_request_id,
    jsonb_build_object(
      'policy_id', v_policy.id,
      'policy_number', v_policy.policy_number,
      'limits_adopted', v_adopted),
    'sales'::tci.user_role);

  return v_policy;
end;
$$;

revoke execute on function tci.bind_insurance_request(uuid, text, date, date) from public, anon;
grant execute on function tci.bind_insurance_request(uuid, text, date, date)
  to authenticated, service_role;

comment on function tci.bind_insurance_request(uuid, text, date, date) is
  'Issues the policy an accepted submission agreed to: projects the proposed terms, adopts the package limit requests onto the new policy, advances to bound. Refuses a second bind.';

-- ---------------------------------------------------------------------------
-- In-migration assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_orphans int;
  v_scope_nulls int;
  v_dupes int;
begin
  -- Every existing request kept a scope (they all had a policy before).
  select count(*) into v_orphans from tci.credit_limit_requests
   where policy_id is null and insurance_request_id is null;
  if v_orphans > 0 then
    raise exception '0023: % request(s) ended up with no scope', v_orphans;
  end if;

  select count(*) into v_scope_nulls from tci.credit_limit_requests
   where tci.limit_scope(policy_id, insurance_request_id) is null;
  if v_scope_nulls > 0 then
    raise exception '0023: % request(s) have a null scope key', v_scope_nulls;
  end if;

  -- The one-open-request rule still holds over the new key.
  select count(*) into v_dupes from (
    select tci.limit_scope(policy_id, insurance_request_id) as scope, entity_id
      from tci.credit_limit_requests
     where status in ('draft', 'submitted', 'under_review', 'escalated')
     group by 1, 2 having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '0023: % (scope, buyer) pair(s) have more than one open request', v_dupes;
  end if;

  raise notice '0023 assertions passed';
end $$;
