-- 0094_policyholder_tiers.sql
--
-- What: policyholder TIERS — bronze, silver, gold, platinum — set
--       automatically from two measures of the policyholder's business with
--       us, both in UZS at the latest rate (tci.latest_uzs_rate):
--
--         insured turnover = the COVERED turnover of its accepted
--           declarations whose period ended in the last twelve months, on any
--           of its policies (a renewal does not reset it); with no accepted
--           declaration in that window, the estimated annual turnover of its
--           current (active or suspended) policies stands in, and the basis
--           says so;
--         premium = the premium base of its current policies:
--           greatest(earned premium, minimum premium), as the portfolio
--           (0052) defines it.
--
--       Each measure reaches the highest tier whose threshold it meets
--       (equal qualifies); the AUTOMATIC tier is the higher of the two. An
--       amount in a currency without a rate is left out and COUNTED
--       (missing_rates), never read as zero. Thresholds are an admin setting
--       (workflow_settings.policyholder_tier_thresholds, set_policyholder_
--       tier_thresholds), ascending from silver to platinum.
--
--       Commercial underwriting may set a tier BY HAND — up or down, with a
--       reason and optionally until a date — and end it; the manual tier
--       wins while it is live. Every override is a row of
--       tci.policyholder_tier_overrides: never edited, only ended once.
--       tci.v_policyholder_tiers (security invoker, staff) answers per
--       policyholder: both measures, their bases and tiers, the automatic
--       tier, the live override and the tier in force.
--
--       Nothing reads a tier to decide anything — not a limit, a premium or
--       an authority; it is a service class for the people who look after
--       the client. Clients do not see it.
-- Why:  owner request 2026-10-27: tiers set from insured turnover and
--       premium, with a manual change by commercial underwriters.

-- ---------------------------------------------------------------------------
-- 1. Tiers and thresholds
-- ---------------------------------------------------------------------------

create function tci.policyholder_tiers() returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select array['bronze', 'silver', 'gold', 'platinum']
$$;
revoke all on function tci.policyholder_tiers() from public, anon;
grant execute on function tci.policyholder_tiers() to authenticated, service_role;

-- Thresholds: {silver|gold|platinum: {turnover_uzs, premium_uzs}}, each > 0
-- and each measure strictly rising from silver to platinum.
create function tci.policyholder_tier_thresholds_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_tier text;
  v_measure text;
  v_prev numeric;
  v_value numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  foreach v_measure in array array['turnover_uzs', 'premium_uzs'] loop
    v_prev := 0;
    foreach v_tier in array array['silver', 'gold', 'platinum'] loop
      if jsonb_typeof(p -> v_tier) <> 'object' or jsonb_typeof(p -> v_tier -> v_measure) <> 'number' then
        return false;
      end if;
      v_value := (p -> v_tier ->> v_measure)::numeric;
      if v_value <= v_prev then
        return false;
      end if;
      v_prev := v_value;
    end loop;
  end loop;
  return true;
end $$;
revoke all on function tci.policyholder_tier_thresholds_valid(jsonb) from public, anon;
grant execute on function tci.policyholder_tier_thresholds_valid(jsonb) to authenticated, service_role;

-- Defaults (UZS): silver from 60 bn turnover or 120 m premium, gold from
-- 300 bn or 600 m, platinum from 1 200 bn or 2.4 bn — roughly USD 5 / 25 /
-- 100 million of insured sales, USD 10 / 50 / 200 thousand of premium.
alter table tci.workflow_settings
  add column policyholder_tier_thresholds jsonb not null default
    '{"silver":   {"turnover_uzs": 60000000000,   "premium_uzs": 120000000},
      "gold":     {"turnover_uzs": 300000000000,  "premium_uzs": 600000000},
      "platinum": {"turnover_uzs": 1200000000000, "premium_uzs": 2400000000}}'::jsonb
    constraint workflow_settings_tier_thresholds_valid check (tci.policyholder_tier_thresholds_valid(policyholder_tier_thresholds));

comment on column tci.workflow_settings.policyholder_tier_thresholds is
  '0094: the policyholder tier thresholds in UZS — {silver|gold|platinum: {turnover_uzs, premium_uzs}}, rising; a measure reaches the highest tier whose threshold it meets (equal qualifies), and the automatic tier is the higher of the two measures''.';

-- The tier one measure reaches (equal qualifies).
create function tci.policyholder_tier_for(p_amount numeric, p_measure text, p_thresholds jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_amount is null then 'bronze'
    when p_amount >= (p_thresholds -> 'platinum' ->> p_measure)::numeric then 'platinum'
    when p_amount >= (p_thresholds -> 'gold' ->> p_measure)::numeric then 'gold'
    when p_amount >= (p_thresholds -> 'silver' ->> p_measure)::numeric then 'silver'
    else 'bronze'
  end
$$;
revoke all on function tci.policyholder_tier_for(numeric, text, jsonb) from public, anon;
grant execute on function tci.policyholder_tier_for(numeric, text, jsonb) to authenticated, service_role;

-- The higher of two tiers.
create function tci.policyholder_tier_max(a text, b text) returns text
language sql immutable set search_path = '' as $$
  select case
    when array_position(tci.policyholder_tiers(), a) >= array_position(tci.policyholder_tiers(), b) then a
    else b
  end
$$;
revoke all on function tci.policyholder_tier_max(text, text) from public, anon;
grant execute on function tci.policyholder_tier_max(text, text) to authenticated, service_role;

create function tci.set_policyholder_tier_thresholds(p_thresholds jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform tci.require_role('admin');
  if not tci.policyholder_tier_thresholds_valid(p_thresholds) then
    raise exception 'tier_thresholds_invalid: every threshold above zero and rising from silver to platinum'
      using errcode = 'P0001';
  end if;
  update tci.workflow_settings
     set policyholder_tier_thresholds = jsonb_build_object(
           'silver', jsonb_build_object('turnover_uzs', (p_thresholds -> 'silver' ->> 'turnover_uzs')::numeric,
                                        'premium_uzs', (p_thresholds -> 'silver' ->> 'premium_uzs')::numeric),
           'gold', jsonb_build_object('turnover_uzs', (p_thresholds -> 'gold' ->> 'turnover_uzs')::numeric,
                                      'premium_uzs', (p_thresholds -> 'gold' ->> 'premium_uzs')::numeric),
           'platinum', jsonb_build_object('turnover_uzs', (p_thresholds -> 'platinum' ->> 'turnover_uzs')::numeric,
                                          'premium_uzs', (p_thresholds -> 'platinum' ->> 'premium_uzs')::numeric))
   where id;
  return (select policyholder_tier_thresholds from tci.workflow_settings where id);
end $$;
revoke all on function tci.set_policyholder_tier_thresholds(jsonb) from public, anon;
grant execute on function tci.set_policyholder_tier_thresholds(jsonb) to authenticated;

-- Staff read the thresholds (the explanation on the card names them).
create function tci.policyholder_tier_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform tci.require_staff();
  return (select policyholder_tier_thresholds from tci.workflow_settings where id);
end $$;
revoke all on function tci.policyholder_tier_settings() from public, anon;
grant execute on function tci.policyholder_tier_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Manual tiers
-- ---------------------------------------------------------------------------

create table tci.policyholder_tier_overrides (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references tci.legal_entities (id),
  tier        text not null check (tier = any (tci.policyholder_tiers())),
  reason      text not null check (char_length(btrim(reason)) between 3 and 2000),
  valid_until date,
  set_by      uuid not null references auth.users (id),
  set_at      timestamptz not null default clock_timestamp(),
  ended_at    timestamptz,
  ended_by    uuid references auth.users (id),
  end_reason  text check (end_reason is null or char_length(btrim(end_reason)) between 3 and 2000),
  constraint policyholder_tier_overrides_end_together check ((ended_at is null) = (ended_by is null))
);
create unique index policyholder_tier_overrides_one_open on tci.policyholder_tier_overrides (entity_id) where ended_at is null;
create index policyholder_tier_overrides_entity on tci.policyholder_tier_overrides (entity_id, set_at desc);
comment on table tci.policyholder_tier_overrides is
  '0094: tiers set by hand by commercial underwriting, with the reason and an optional end date. A row is never edited; it is ended once (by its successor or by «return to automatic»). Live = not ended and valid_until not passed (Tashkent day).';

create function tci.guard_policyholder_tier_override() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.ended_at is not null
     or new.id <> old.id or new.entity_id <> old.entity_id or new.tier <> old.tier
     or new.reason <> old.reason or new.valid_until is distinct from old.valid_until
     or new.set_by <> old.set_by or new.set_at <> old.set_at then
    raise exception 'tier_override_immutable: a manual tier is ended, never changed' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function tci.guard_policyholder_tier_override() from public, anon, authenticated;
-- No API role may remove a row (no grant); the trigger keeps the rest.
create trigger policyholder_tier_overrides_immutable before update on tci.policyholder_tier_overrides
  for each row execute function tci.guard_policyholder_tier_override();

alter table tci.policyholder_tier_overrides enable row level security;
create policy "policyholder_tier_overrides: staff read" on tci.policyholder_tier_overrides
  for select to authenticated using (tci.is_staff());
grant select on tci.policyholder_tier_overrides to authenticated, service_role;

-- Today in Tashkent: a manual tier «until 31 December» holds all that day.
create function tci.tier_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Tashkent')::date
$$;
revoke all on function tci.tier_today() from public, anon;
grant execute on function tci.tier_today() to authenticated, service_role;

-- A company is a policyholder for tiers when it holds a policy that is not a draft.
create function tci.is_policyholder(p_entity uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from tci.policies p where p.entity_id = p_entity and p.status <> 'draft')
$$;
revoke all on function tci.is_policyholder(uuid) from public, anon;
grant execute on function tci.is_policyholder(uuid) to authenticated, service_role;

create function tci.set_policyholder_tier(p_entity uuid, p_tier text, p_reason text, p_valid_until date default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
begin
  perform tci.require_role('commercial_underwriter');
  if not (p_tier = any (tci.policyholder_tiers())) then
    raise exception 'tier_unknown: %', p_tier using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'tier_reason_required: say why the tier is set by hand' using errcode = 'P0001';
  end if;
  if char_length(btrim(p_reason)) > 2000 then
    raise exception 'tier_reason_too_long' using errcode = 'P0001';
  end if;
  if p_valid_until is not null and p_valid_until < tci.tier_today() then
    raise exception 'tier_until_past: the end date has passed' using errcode = 'P0001';
  end if;
  perform 1 from tci.legal_entities e where e.id = p_entity for update;
  if not found then
    raise exception 'entity_not_found' using errcode = 'P0002';
  end if;
  if not tci.is_policyholder(p_entity) then
    raise exception 'tier_not_policyholder: the company holds no policy' using errcode = 'P0001';
  end if;

  update tci.policyholder_tier_overrides
     set ended_at = clock_timestamp(), ended_by = v_me, end_reason = btrim(p_reason)
   where entity_id = p_entity and ended_at is null;
  insert into tci.policyholder_tier_overrides (entity_id, tier, reason, valid_until, set_by)
  values (p_entity, p_tier, btrim(p_reason), p_valid_until, v_me)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function tci.set_policyholder_tier(uuid, text, text, date) from public, anon;
grant execute on function tci.set_policyholder_tier(uuid, text, text, date) to authenticated;

create function tci.end_policyholder_tier_override(p_entity uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform tci.require_role('commercial_underwriter');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'tier_reason_required: say why the tier returns to automatic' using errcode = 'P0001';
  end if;
  update tci.policyholder_tier_overrides
     set ended_at = clock_timestamp(), ended_by = (select auth.uid()), end_reason = btrim(p_reason)
   where entity_id = p_entity and ended_at is null;
  if not found then
    raise exception 'tier_no_override: the tier is already automatic' using errcode = 'P0002';
  end if;
  return true;
end $$;
revoke all on function tci.end_policyholder_tier_override(uuid, text) from public, anon;
grant execute on function tci.end_policyholder_tier_override(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The tiers
-- ---------------------------------------------------------------------------

create view tci.v_policyholder_tiers
with (security_invoker = true) as
with holders as (
  select distinct p.entity_id from tci.policies p where p.status <> 'draft'
),
declared as (
  select p.entity_id,
         sum(l.covered_amount * tci.latest_uzs_rate(d.currency_code))            as turnover_uzs,
         count(distinct d.id)                                                     as declarations,
         count(*) filter (where tci.latest_uzs_rate(d.currency_code) is null)     as missing
    from tci.declarations d
    join tci.policies p on p.id = d.policy_id
    join tci.declaration_lines l on l.declaration_id = d.id
   where d.status = 'accepted'
     and d.period_end > (current_date - interval '12 months')
     and l.covered_amount is not null
   group by p.entity_id
),
current_policies as (
  select p.entity_id,
         count(*)                                                                  as policies,
         sum(p.estimated_annual_turnover * tci.latest_uzs_rate(p.currency_code))   as estimated_uzs,
         count(*) filter (where p.estimated_annual_turnover is not null
                            and tci.latest_uzs_rate(p.currency_code) is null)       as estimated_missing,
         sum(greatest(coalesce(pr.earned_premium, 0), coalesce(p.minimum_premium, 0))
             * tci.latest_uzs_rate(p.currency_code))                               as premium_uzs,
         count(*) filter (where tci.latest_uzs_rate(p.currency_code) is null)      as premium_missing
    from tci.policies p
    left join tci.v_policy_premium pr on pr.policy_id = p.id
   where p.status in ('active', 'suspended')
   group by p.entity_id
),
settings as (
  select policyholder_tier_thresholds as th from tci.workflow_settings where id
),
measured as (
  select h.entity_id,
         coalesce(cp.policies, 0)::int                                             as current_policies,
         case when d.entity_id is not null then 'declared'
              when cp.estimated_uzs is not null then 'estimated'
              else 'none' end                                                      as turnover_basis,
         case when d.entity_id is not null then d.turnover_uzs
              else cp.estimated_uzs end                                            as turnover_uzs,
         coalesce(d.declarations, 0)::int                                          as declarations_counted,
         cp.premium_uzs,
         (case when d.entity_id is not null then d.missing else coalesce(cp.estimated_missing, 0) end
          + coalesce(cp.premium_missing, 0))::int                                  as missing_rates,
         s.th
    from holders h
    cross join settings s
    left join declared d on d.entity_id = h.entity_id
    left join current_policies cp on cp.entity_id = h.entity_id
),
tiered as (
  select m.*,
         tci.policyholder_tier_for(m.turnover_uzs, 'turnover_uzs', m.th) as turnover_tier,
         tci.policyholder_tier_for(m.premium_uzs, 'premium_uzs', m.th)   as premium_tier
    from measured m
)
select t.entity_id,
       e.name                                                   as entity_name,
       t.current_policies,
       t.turnover_basis,
       round(t.turnover_uzs, 2)                                 as turnover_uzs,
       t.declarations_counted,
       round(t.premium_uzs, 2)                                  as premium_uzs,
       t.missing_rates,
       t.turnover_tier,
       t.premium_tier,
       tci.policyholder_tier_max(t.turnover_tier, t.premium_tier) as automatic_tier,
       o.id                                                     as override_id,
       o.tier                                                   as override_tier,
       o.reason                                                 as override_reason,
       o.valid_until                                            as override_until,
       o.set_by                                                 as override_set_by,
       o.set_at                                                 as override_set_at,
       coalesce(o.tier, tci.policyholder_tier_max(t.turnover_tier, t.premium_tier)) as tier,
       (o.id is not null)                                       as is_manual
  from tiered t
  join tci.legal_entities e on e.id = t.entity_id
  left join tci.policyholder_tier_overrides o
         on o.entity_id = t.entity_id and o.ended_at is null
        and (o.valid_until is null or o.valid_until >= tci.tier_today());

comment on view tci.v_policyholder_tiers is
  '0094: per policyholder (a company with a policy that is not a draft) — insured turnover (covered turnover of accepted declarations ending in the last 12 months, else the estimated annual turnover of its current policies) and premium (greatest(earned, minimum) of its current policies), both in UZS at the latest rate with missing rates counted, the tier each reaches, the automatic tier (the higher), the live manual tier and the tier in force. Staff only (security invoker over staff-read tables).';
grant select on tci.v_policyholder_tiers to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Checks
-- ---------------------------------------------------------------------------

do $$
declare th jsonb := (select policyholder_tier_thresholds from tci.workflow_settings where id);
begin
  -- equal qualifies, the higher of the two measures counts
  if tci.policyholder_tier_for(60000000000, 'turnover_uzs', th) <> 'silver'
     or tci.policyholder_tier_for(59999999999.99, 'turnover_uzs', th) <> 'bronze'
     or tci.policyholder_tier_for(null, 'premium_uzs', th) <> 'bronze'
     or tci.policyholder_tier_for(2400000000, 'premium_uzs', th) <> 'platinum'
     or tci.policyholder_tier_max('silver', 'gold') <> 'gold'
     or tci.policyholder_tier_max('platinum', 'bronze') <> 'platinum' then
    raise exception '0094: the tier rule is wrong';
  end if;
  if tci.policyholder_tier_thresholds_valid('{"silver": {"turnover_uzs": 2, "premium_uzs": 1}, "gold": {"turnover_uzs": 1, "premium_uzs": 2}, "platinum": {"turnover_uzs": 3, "premium_uzs": 3}}') then
    raise exception '0094: falling thresholds were accepted';
  end if;
  if has_table_privilege('authenticated', 'tci.policyholder_tier_overrides', 'insert')
     or has_table_privilege('authenticated', 'tci.policyholder_tier_overrides', 'update') then
    raise exception '0094: manual tiers are written only through set_policyholder_tier';
  end if;
  -- a tier decides nothing: no business function reads it
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tci'
       and (p.prosrc like '%policyholder_tier_overrides%' or p.prosrc like '%v_policyholder_tiers%')
       and p.proname not in ('set_policyholder_tier', 'end_policyholder_tier_override')
  ) then
    raise exception '0094: a function other than the tier writers reads the tiers';
  end if;
end $$;
