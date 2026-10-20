-- Tests for migration 0052: the portfolio views behind the role workspaces.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/portfolio.sql
--
-- One transaction, rolled back. API roles are impersonated; the
-- internal-call token is cleared at every actor switch. Every UPDATE carries
-- a WHERE clause (the canonical tooling holds one without).

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000000c2', 'p-commercial@t'),
  ('99999999-0000-4000-8000-0000000000c1', 'p-credit@t'),
  ('99999999-0000-4000-8000-0000000000c5', 'p-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000000c2', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000000c1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000000c5', 'client');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000000c2"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000000e1', 'P Holder LLC', 'UZ', '99999999-0000-4000-8000-0000000000c2'),
  ('99999999-0000-4000-8000-0000000000e2', 'P Buyer One', 'DE', '99999999-0000-4000-8000-0000000000c2'),
  ('99999999-0000-4000-8000-0000000000e3', 'P Buyer Two', 'KZ', '99999999-0000-4000-8000-0000000000c2');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000000f1', '99999999-0000-4000-8000-0000000000e1', 'P-1', 'whole_turnover',
  'draft', current_date - 30, current_date + 60, 'USD', 90, 0, 0.15, 10000, 25000, 30, 60, 90, 'monthly',
  '99999999-0000-4000-8000-0000000000c2', 1000000);

create temp table pick on commit drop as
  select (select code from tci.currencies c where tci.latest_uzs_rate(c.code) is null order by code limit 1) as no_rate_ccy;

insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
values ('99999999-0000-4000-8000-0000000000a1', '99999999-0000-4000-8000-0000000000f1',
        '99999999-0000-4000-8000-0000000000e2', 50000, 'UZS', 'decided', '99999999-0000-4000-8000-0000000000c2');
insert into tci.credit_limit_decisions (id, request_id, outcome, approved_amount, currency_code, lifecycle, decided_by,
  payment_terms_days, valid_until)
values ('99999999-0000-4000-8000-0000000000d1', '99999999-0000-4000-8000-0000000000a1', 'approved', 40000, 'UZS',
        'effective', '99999999-0000-4000-8000-0000000000c1', 60, current_date + 20);
-- a second limit in a currency with no rate (when one exists): counted, not zero
insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
select '99999999-0000-4000-8000-0000000000a2', '99999999-0000-4000-8000-0000000000f1',
       '99999999-0000-4000-8000-0000000000e3', 9000, no_rate_ccy, 'decided', '99999999-0000-4000-8000-0000000000c2'
  from pick where no_rate_ccy is not null;
insert into tci.credit_limit_decisions (id, request_id, outcome, approved_amount, currency_code, lifecycle, decided_by)
select '99999999-0000-4000-8000-0000000000d2', '99999999-0000-4000-8000-0000000000a2', 'partial', 7000, no_rate_ccy,
       'effective', '99999999-0000-4000-8000-0000000000c1'
  from pick where no_rate_ccy is not null;

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant select on pg_temp.pick to authenticated;

do $$
declare
  v_p   tci.v_policy_portfolio%rowtype;
  v_n   int;
  v_ccy text;
  v_l   tci.v_credit_portfolio%rowtype;
  v_expect_count   int;
  v_expect_missing int;
begin
  select no_rate_ccy into v_ccy from pg_temp.pick;
  v_expect_count   := case when v_ccy is null then 1 else 2 end;
  v_expect_missing := case when v_ccy is null then 0 else 1 end;

  -- 1. the commercial underwriter reads the policy row; the base is the minimum premium
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c2');
  select * into v_p from tci.v_policy_portfolio where policy_id = '99999999-0000-4000-8000-0000000000f1';
  if not found then raise exception 'portfolio: staff cannot see the policy row'; end if;
  if v_p.premium_base <> 10000 or v_p.loss_ratio_pct <> 0 or v_p.incurred <> 0 or v_p.claims_count <> 0 then
    raise exception 'portfolio: base %, loss ratio %, incurred %, claims % (expected 10000, 0, 0, 0)',
      v_p.premium_base, v_p.loss_ratio_pct, v_p.incurred, v_p.claims_count;
  end if;
  if v_p.days_to_expiry <> 60 or v_p.policyholder_name <> 'P Holder LLC' then
    raise exception 'portfolio: unexpected expiry % or holder %', v_p.days_to_expiry, v_p.policyholder_name;
  end if;
  -- limits: the UZS one in full, the rateless one counted and left out of the sum
  if v_p.limits_count <> v_expect_count
     or v_p.limits_uzs <> 40000
     or v_p.limits_missing_rates <> v_expect_missing then
    raise exception 'portfolio: limits % / % UZS / % missing', v_p.limits_count, v_p.limits_uzs, v_p.limits_missing_rates;
  end if;

  -- 2. the credit underwriter reads the in-force limits
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c1');
  select * into v_l from tci.v_credit_portfolio where decision_id = '99999999-0000-4000-8000-0000000000d1';
  if v_l.amount_uzs <> 40000 or v_l.days_to_review <> 20 or v_l.buyer_name <> 'P Buyer One'
     or v_l.policyholder_name <> 'P Holder LLC' or v_l.current_band <> 'unrated' or v_l.decision_band <> 'unrated' then
    raise exception 'portfolio: unexpected credit row %', row_to_json(v_l);
  end if;
  if v_ccy is not null then
    select * into v_l from tci.v_credit_portfolio where decision_id = '99999999-0000-4000-8000-0000000000d2';
    if v_l.amount_uzs is not null then
      raise exception 'portfolio: a limit with no rate must have a NULL UZS amount, got %', v_l.amount_uzs;
    end if;
  end if;

  -- 3. a declined decision is not in force
  perform set_config('role', 'postgres', true);
  update tci.credit_limit_decisions set outcome = 'declined', approved_amount = null
   where id = '99999999-0000-4000-8000-0000000000d1';
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c1');
  select count(*) into v_n from tci.v_credit_portfolio where decision_id = '99999999-0000-4000-8000-0000000000d1';
  if v_n <> 0 then raise exception 'portfolio: a declined decision is shown as in force'; end if;

  -- 4. a client sees nothing in either view
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c5');
  if exists (select 1 from tci.v_policy_portfolio) or exists (select 1 from tci.v_credit_portfolio) then
    raise exception 'portfolio: a client can read a portfolio view';
  end if;
  perform set_config('role', 'postgres', true);
end $$;

do $$ begin raise notice 'portfolio: OK — premium base, loss ratio, limits in UZS with missing rates counted, staff-only'; end $$;
rollback;
