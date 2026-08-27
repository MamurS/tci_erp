-- 0017_authority_matrix.sql
-- What: Phase 3b (part 2) - the 2D authority matrix. Replaces the
--       amount-only tci.underwriting_authorities with tci.authority_grants
--       (user x scope x grade band x amount x currency x validity) and makes
--       limit decisions resolve authority PER GRADE BAND.
-- Why:  underwriting authority is not one number: the same underwriter may
--       sign a large limit on an A-grade buyer and only a small one on a D.
--       'commercial' rows are dormant until Phase 3c but share the schema so
--       both underwriting streams use one matrix.
--
-- Grade bands are the FAMILIES of the engine grades (A1/A2 -> A, B1/B2 -> B,
-- C1/C2 -> C, D -> D), i.e. the first character of the grade code; a decision
-- without an assessment (or with an unknown grade) falls into 'unrated'. Only
-- the band NAMES are fixed here - the score thresholds and the grade codes
-- themselves stay owned by credit_engine and are served by the analytics
-- service (GET /grade-scale, which also returns each band's family).
--
-- Authority resolution (mirrored in the UI preflight, authority.ts):
--   my_authority_uzs(band) = MAX over the caller's currently valid 'credit'
--   grants for that band, converted to UZS by the Phase 2b fx rule
--   (latest rate_date <= today, 'cbu' preferred; missing rate raises P0003).
--   ADMIN IS UNLIMITED and never consults the matrix. There is no 'senior'
--   role any more: an escalated request is decidable by ANY credit
--   underwriter whose band authority covers the amount (or by an admin).
--
-- Migration of existing grants: every old amount-only row becomes five
-- 'credit' rows - one per band (A, B, C, D, unrated) - at the same amount,
-- currency and validity, i.e. exactly the authority the user had before.

create type tci.authority_scope as enum ('credit', 'commercial');
create type tci.grade_band as enum ('A', 'B', 'C', 'D', 'unrated');

create table tci.authority_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  applies_to    tci.authority_scope not null,
  grade_band    tci.grade_band not null,
  max_amount    numeric(18,2) not null check (max_amount > 0),
  currency_code char(3) not null references tci.currencies (code),
  valid_from    date not null default current_date,
  valid_to      date,
  created_by    uuid not null references auth.users (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint authority_grants_period check (valid_to is null or valid_to >= valid_from)
);

comment on table tci.authority_grants is
  'Underwriting authority matrix: per user, per stream (credit|commercial), per grade band, an amount in a currency valid over a period. Admin is unlimited and has no rows.';

create index authority_grants_user_idx on tci.authority_grants (user_id, applies_to, grade_band);

create trigger authority_grants_set_updated_at
  before update on tci.authority_grants
  for each row execute function tci.set_updated_at();

alter table tci.authority_grants enable row level security;

create policy "authority_grants: read own"
  on tci.authority_grants for select to authenticated
  using (user_id = (select auth.uid()));
create policy "authority_grants: admin manage"
  on tci.authority_grants for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

grant select, insert, update, delete on tci.authority_grants to authenticated;
grant all on tci.authority_grants to service_role;

-- Expand each legacy amount-only grant across every band.
insert into tci.authority_grants
  (user_id, applies_to, grade_band, max_amount, currency_code, valid_from, valid_to, created_by, created_at)
select a.user_id, 'credit', b.band, a.max_amount, a.currency_code,
       a.valid_from, a.valid_to, a.created_by, a.created_at
from tci.underwriting_authorities a
cross join (values ('A'::tci.grade_band), ('B'), ('C'), ('D'), ('unrated')) as b(band);

do $$
declare v_old int; v_new int;
begin
  select count(*) into v_old from tci.underwriting_authorities;
  select count(*) into v_new from tci.authority_grants;
  if v_new <> v_old * 5 then
    raise exception 'authority migration mismatch: % legacy rows -> % grants (expected %)',
      v_old, v_new, v_old * 5;
  end if;
  raise notice 'authority matrix: % legacy rows expanded into % grants', v_old, v_new;
end $$;

drop table tci.underwriting_authorities;

-- ---------------------------------------------------------------------------
-- Resolution helpers
-- ---------------------------------------------------------------------------

-- Band of an assessment: the family (first character) of its grade code.
-- No assessment, no grade, or an unknown family -> 'unrated'.
create function tci.grade_band_for_assessment(p_assessment_id uuid)
returns tci.grade_band
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select case upper(left(a.rating_grade, 1))
               when 'A' then 'A'::tci.grade_band
               when 'B' then 'B'::tci.grade_band
               when 'C' then 'C'::tci.grade_band
               when 'D' then 'D'::tci.grade_band
               else 'unrated'::tci.grade_band
             end
      from tci.credit_assessments a
      where a.id = p_assessment_id
    ),
    'unrated'::tci.grade_band
  )
$$;

-- The caller's credit authority for one band, in UZS. 0 when no grant.
drop function tci.my_authority_uzs();

create function tci.my_authority_uzs(p_band tci.grade_band)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0)
  from tci.authority_grants g
  where g.user_id = (select auth.uid())
    and g.applies_to = 'credit'
    and g.grade_band = p_band
    and g.valid_from <= current_date
    and (g.valid_to is null or g.valid_to >= current_date)
$$;

revoke execute on function tci.my_authority_uzs(tci.grade_band),
  tci.grade_band_for_assessment(uuid) from public, anon;
grant execute on function tci.my_authority_uzs(tci.grade_band),
  tci.grade_band_for_assessment(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Band-aware decision + revocation
-- ---------------------------------------------------------------------------

create or replace function tci.decide_limit_request(
  p_request_id    uuid,
  p_outcome       tci.decision_outcome,
  p_amount        numeric default null,
  p_currency      char(3) default null,
  p_valid_from    date default current_date,
  p_valid_until   date default null,
  p_conditions    jsonb default '[]'::jsonb,
  p_comment       text default null,
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

  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r
   where r.id = d.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and r.policy_id = v_request.policy_id
     and r.entity_id = v_request.entity_id;

  update tci.credit_limit_requests
     set status = 'decided', decided_at = now()
   where id = p_request_id;

  return jsonb_build_object(
    'result', 'decided', 'decision_id', v_decision.id, 'grade_band', v_band);
end;
$$;

create or replace function tci.revoke_effective_limit(
  p_policy_id uuid,
  p_entity_id uuid,
  p_comment   text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_effective tci.credit_limit_decisions%rowtype;
  v_new tci.credit_limit_decisions%rowtype;
  v_band tci.grade_band;
begin
  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may revoke' using errcode = 'P0004';
  end if;

  select d.* into v_effective
  from tci.credit_limit_decisions d
  join tci.credit_limit_requests r on r.id = d.request_id
  where r.policy_id = p_policy_id and r.entity_id = p_entity_id
    and d.lifecycle = 'effective'
    and d.outcome in ('approved', 'partial')
  order by d.decided_at desc
  limit 1
  for update of d;
  if not found then
    raise exception 'no effective approved limit for this (policy, entity)'
      using errcode = 'P0002';
  end if;

  -- The band of the limit being revoked decides which authority applies.
  v_band := tci.grade_band_for_assessment(v_effective.based_on_assessment_id);

  if not tci.has_role('admin')
     and tci.to_uzs(v_effective.approved_amount, v_effective.currency_code)
         > tci.my_authority_uzs(v_band) then
    raise exception 'revoking this limit exceeds your authority for grade band %', v_band
      using errcode = 'P0004';
  end if;

  update tci.credit_limit_decisions set lifecycle = 'revoked_lc' where id = v_effective.id;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, comment
  ) values (
    v_effective.request_id, 'revoked', 0, v_effective.currency_code, current_date, p_comment
  ) returning * into v_new;

  return jsonb_build_object('result', 'revoked', 'decision_id', v_new.id, 'grade_band', v_band);
end;
$$;
