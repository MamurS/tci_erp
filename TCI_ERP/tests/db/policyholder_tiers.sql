-- tests/db/policyholder_tiers.sql — migration 0094: policyholder tiers from
-- insured turnover and premium, the manual tier, with role impersonation,
-- rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000094a1', 'tier-cu@t'),
  ('99999999-0000-4000-8000-0000000094a2', 'tier-sales@t'),
  ('99999999-0000-4000-8000-0000000094a3', 'tier-admin@t'),
  ('99999999-0000-4000-8000-0000000094a4', 'tier-client@t'),
  ('99999999-0000-4000-8000-0000000094a5', 'tier-credit@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000094a1', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000094a2', 'sales'),
  ('99999999-0000-4000-8000-0000000094a3', 'admin'),
  ('99999999-0000-4000-8000-0000000094a4', 'client'),
  ('99999999-0000-4000-8000-0000000094a5', 'credit_underwriter');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'Tier ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'tier-%@t'
on conflict (user_id) do update set must_change_password = false;

insert into tci.fx_rates (currency_code, rate_to_uzs, rate_date, source)
values ('USD', 12000, current_date, 'manual')
on conflict do nothing;

-- e1: declared turnover in USD; e2: no declaration, estimate only, premium in
-- UZS; e3: a draft policy only (not a policyholder for tiers).
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000094e1', 'Tier One LLC', 'UZ', '99999999-0000-4000-8000-0000000094a1'),
  ('99999999-0000-4000-8000-0000000094e2', 'Tier Two LLC', 'UZ', '99999999-0000-4000-8000-0000000094a1'),
  ('99999999-0000-4000-8000-0000000094e3', 'Tier Three LLC', 'UZ', '99999999-0000-4000-8000-0000000094a1'),
  ('99999999-0000-4000-8000-0000000094e9', 'Tier Buyer LLC', 'UZ', '99999999-0000-4000-8000-0000000094a1');

insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by,
  max_liability_amount, estimated_annual_turnover)
values
  ('99999999-0000-4000-8000-0000000094f1', '99999999-0000-4000-8000-0000000094e1', 'TIER-P1', 'whole_turnover', 'draft',
   current_date - 200, current_date + 165, 'USD', 90, 0, 0.15, 1000, 0, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000094a1', 1000000, 1000000),
  ('99999999-0000-4000-8000-0000000094f2', '99999999-0000-4000-8000-0000000094e2', 'TIER-P2', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 700000000, 0, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000094a1', 1000000000, 70000000000),
  ('99999999-0000-4000-8000-0000000094f3', '99999999-0000-4000-8000-0000000094e3', 'TIER-P3', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 1, 0, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000094a1', 1000000, 1);
update tci.policies set status = 'active'
 where id in ('99999999-0000-4000-8000-0000000094f1', '99999999-0000-4000-8000-0000000094f2');

-- e1: two accepted declarations in the window (covered 20 m + 5 m USD = 300 bn
-- UZS: gold), one outside it, and an uncovered excess that does not count.
insert into tci.declarations (id, policy_id, period_start, period_end, status, currency_code, created_by) values
  ('99999999-0000-4000-8000-0000000094d1', '99999999-0000-4000-8000-0000000094f1', current_date - 90, current_date - 60, 'accepted', 'USD', '99999999-0000-4000-8000-0000000094a1'),
  ('99999999-0000-4000-8000-0000000094d2', '99999999-0000-4000-8000-0000000094f1', current_date - 59, current_date - 30, 'accepted', 'USD', '99999999-0000-4000-8000-0000000094a1'),
  ('99999999-0000-4000-8000-0000000094d3', '99999999-0000-4000-8000-0000000094f1', current_date - 500, current_date - 400, 'accepted', 'USD', '99999999-0000-4000-8000-0000000094a1');
insert into tci.declaration_lines (declaration_id, entity_id, insurable_turnover, coverage_basis, covered_amount, uncovered_excess) values
  ('99999999-0000-4000-8000-0000000094d1', '99999999-0000-4000-8000-0000000094e9', 21000000, 'limit', 20000000, 1000000),
  ('99999999-0000-4000-8000-0000000094d2', '99999999-0000-4000-8000-0000000094e9', 5000000, 'limit', 5000000, 0),
  ('99999999-0000-4000-8000-0000000094d3', '99999999-0000-4000-8000-0000000094e9', 900000000, 'limit', 900000000, 0);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

create function pg_temp.refused(p_sql text, p_state text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'policyholder_tiers: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'policyholder_tiers: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_cu     constant uuid := '99999999-0000-4000-8000-0000000094a1';
  c_sales  constant uuid := '99999999-0000-4000-8000-0000000094a2';
  c_admin  constant uuid := '99999999-0000-4000-8000-0000000094a3';
  c_client constant uuid := '99999999-0000-4000-8000-0000000094a4';
  c_credit constant uuid := '99999999-0000-4000-8000-0000000094a5';
  e1 constant uuid := '99999999-0000-4000-8000-0000000094e1';
  e2 constant uuid := '99999999-0000-4000-8000-0000000094e2';
  e3 constant uuid := '99999999-0000-4000-8000-0000000094e3';
  r record;
  v_id uuid;
begin
  -- Automatic tiers, read by sales.
  perform pg_temp.act(c_sales);
  select * into r from tci.v_policyholder_tiers where entity_id = e1;
  if r.turnover_basis <> 'declared' or r.turnover_uzs <> 300000000000 or r.declarations_counted <> 2
     or r.turnover_tier <> 'gold' or r.premium_tier <> 'bronze' or r.automatic_tier <> 'gold'
     or r.tier <> 'gold' or r.is_manual then
    raise exception 'policyholder_tiers: e1 was %', row_to_json(r);
  end if;
  select * into r from tci.v_policyholder_tiers where entity_id = e2;
  if r.turnover_basis <> 'estimated' or r.turnover_uzs <> 70000000000 or r.turnover_tier <> 'silver'
     or r.premium_uzs <> 700000000 or r.premium_tier <> 'gold' or r.tier <> 'gold' then
    raise exception 'policyholder_tiers: e2 was %', row_to_json(r);
  end if;
  if exists (select 1 from tci.v_policyholder_tiers where entity_id = e3) then
    raise exception 'policyholder_tiers: a company with a draft policy only got a tier';
  end if;

  -- Only commercial underwriting sets a tier by hand.
  perform pg_temp.refused(format('select tci.set_policyholder_tier(%L, ''platinum'', ''Strategic account'')', e1), '42501', 'sales sets a tier');
  perform pg_temp.act(c_credit);
  perform pg_temp.refused(format('select tci.set_policyholder_tier(%L, ''platinum'', ''Strategic account'')', e1), '42501', 'credit sets a tier');
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('select tci.set_policyholder_tier(%L, ''platinum'', ''Strategic account'')', e1), '42501', 'admin sets a tier');
  perform pg_temp.act(c_client);
  perform pg_temp.refused(format('select tci.set_policyholder_tier(%L, ''platinum'', ''Strategic account'')', e1), '42501', 'a client sets a tier');
  if exists (select 1 from tci.v_policyholder_tiers) or exists (select 1 from tci.policyholder_tier_overrides) then
    raise exception 'policyholder_tiers: a client reads tiers';
  end if;

  perform pg_temp.act(c_cu);
  perform pg_temp.refused(format('select tci.set_policyholder_tier(%L, ''diamond'', ''Strategic account'')', e1), 'P0001', 'an unknown tier', 'tier_unknown');
  perform pg_temp.refused(format('select tci.set_policyholder_tier(%L, ''platinum'', '' '')', e1), 'P0001', 'no reason', 'tier_reason_required');
  perform pg_temp.refused(format('select tci.set_policyholder_tier(%L, ''platinum'', ''Strategic account'', current_date - 2)', e1), 'P0001', 'a past end date', 'tier_until_past');
  perform pg_temp.refused(format('select tci.set_policyholder_tier(%L, ''platinum'', ''Strategic account'')', e3), 'P0001', 'not a policyholder', 'tier_not_policyholder');
  perform pg_temp.refused(format('select tci.end_policyholder_tier_override(%L, ''Back to normal'')', e1), 'P0002', 'nothing to end', 'tier_no_override');

  -- Up by hand, then down by hand: the second ends the first.
  v_id := tci.set_policyholder_tier(e1, 'platinum', 'Strategic account', current_date + 90);
  select * into r from tci.v_policyholder_tiers where entity_id = e1;
  if r.tier <> 'platinum' or not r.is_manual or r.automatic_tier <> 'gold' or r.override_until <> current_date + 90 then
    raise exception 'policyholder_tiers: the manual tier did not win: %', row_to_json(r);
  end if;
  perform tci.set_policyholder_tier(e1, 'silver', 'Payment discipline under review');
  if (select count(*) from tci.policyholder_tier_overrides where entity_id = e1) <> 2
     or (select ended_at is null from tci.policyholder_tier_overrides where id = v_id)
     or (select tier from tci.v_policyholder_tiers where entity_id = e1) <> 'silver' then
    raise exception 'policyholder_tiers: the second manual tier did not replace the first';
  end if;

  -- Back to automatic.
  perform tci.end_policyholder_tier_override(e1, 'Review closed');
  select * into r from tci.v_policyholder_tiers where entity_id = e1;
  if r.tier <> 'gold' or r.is_manual then
    raise exception 'policyholder_tiers: the tier did not return to automatic';
  end if;

  -- The record is never changed; no API role writes it.
  perform pg_temp.refused(format('update tci.policyholder_tier_overrides set tier = ''gold'' where id = %L', v_id), '42501', 'a direct update');
  perform pg_temp.refused(format('insert into tci.policyholder_tier_overrides (entity_id, tier, reason, set_by) values (%L, ''gold'', ''Direct'', %L)', e1, c_cu), '42501', 'a direct insert');
  perform set_config('role', 'postgres', true);
  perform pg_temp.refused(format('update tci.policyholder_tier_overrides set reason = ''rewritten'' where id = %L', v_id), 'P0001', 'the owner rewrites', 'tier_override_immutable');

  -- Thresholds: admin only, rising.
  perform pg_temp.act(c_cu);
  perform pg_temp.refused('select tci.set_policyholder_tier_thresholds(''{}''::jsonb)', '42501', 'commercial sets thresholds');
  perform pg_temp.act(c_admin);
  perform pg_temp.refused('select tci.set_policyholder_tier_thresholds(''{"silver": {"turnover_uzs": 5, "premium_uzs": 1}, "gold": {"turnover_uzs": 4, "premium_uzs": 2}, "platinum": {"turnover_uzs": 6, "premium_uzs": 3}}''::jsonb)',
                          'P0001', 'falling thresholds', 'tier_thresholds_invalid');
  perform tci.set_policyholder_tier_thresholds('{"silver": {"turnover_uzs": 1000, "premium_uzs": 1000}, "gold": {"turnover_uzs": 2000, "premium_uzs": 2000}, "platinum": {"turnover_uzs": 100000000000, "premium_uzs": 900000000000}}'::jsonb);
  perform pg_temp.act(c_sales);
  if (select tier from tci.v_policyholder_tiers where entity_id = e2) <> 'gold'
     or (select tier from tci.v_policyholder_tiers where entity_id = e1) <> 'platinum' then
    raise exception 'policyholder_tiers: new thresholds did not apply';
  end if;

  raise notice 'policyholder_tiers: OK — tiers from declared or estimated insured turnover and premium in UZS (equal qualifies, the higher measure wins), drafts left out; commercial underwriting alone sets a tier by hand with a reason and an optional end, a new one ends the old, «back to automatic» ends it; overrides immutable and staff-only; thresholds admin-only and rising';
end $$;

rollback;
