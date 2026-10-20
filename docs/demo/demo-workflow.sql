-- ---------------------------------------------------------------------------
-- 6. The book, built the way the screens build it
-- ---------------------------------------------------------------------------

-- A policy is created as a draft and activated by commercial underwriting
-- (change_policy_status writes the history; the insert trigger generates the
-- premium instalments).
create function pg_temp.policy(
  p_key text, p_holder text, p_number text, p_structure tci.product_structure, p_ccy text,
  p_inception int, p_expiry int, p_rate numeric, p_min_premium numeric, p_dl numeric,
  p_max_liability numeric, p_nql numeric, p_frequency tci.declaration_frequency, p_activate boolean default true)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.owner();
  insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
    currency_code, insured_percentage, max_liability_amount, nql_amount, deductible_each_loss, premium_rate_pct,
    minimum_premium, estimated_annual_turnover, discretionary_limit, waiting_period_days, max_extension_period_days,
    max_payment_terms_days, declaration_frequency, created_by, created_at)
  values (v_id, pg_temp.k('ent:' || p_holder), p_number, p_structure, 'draft', current_date + p_inception,
    current_date + p_expiry, p_ccy, 90, p_max_liability, p_nql, 0, p_rate, p_min_premium, p_min_premium / p_rate * 100,
    p_dl, 30, 90, 120, p_frequency, pg_temp.k('user:commercial'), now() + make_interval(days => p_inception - 20));
  insert into demo_keys values ('pol:' || p_key, v_id);
  if p_activate then
    perform pg_temp.act('commercial');
    perform tci.change_policy_status(v_id, 'active', null);
    perform pg_temp.owner();
  end if;
  return v_id;
end $$;

-- A limit request: drafted and submitted by sales.
create function pg_temp.request(p_policy text, p_buyer text, p_amount numeric, p_ccy text,
  p_terms int, p_why text, p_submit boolean default true)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.owner();
  insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code,
    requested_payment_terms_days, justification, status, requested_by)
  values (v_id, pg_temp.k('pol:' || p_policy), pg_temp.k('ent:' || p_buyer), p_amount, p_ccy, p_terms, p_why,
    'draft', pg_temp.k('user:sales'));
  insert into demo_keys values ('req:' || p_policy || ':' || p_buyer, v_id);
  if p_submit then
    perform pg_temp.act('sales');
    perform tci.submit_limit_request(v_id);
  end if;
  perform pg_temp.owner();
  return v_id;
end $$;

-- A credit decision, by the named underwriter, on the buyer's rating, taken
-- p_days_ago days ago: decided "now" through decide_limit_request, then the
-- request and its decisions are moved into the past (owner, WHERE by id).
-- valid_until is the FINAL review date relative to today (may be past).
create function pg_temp.decide(p_policy text, p_buyer text, p_outcome tci.decision_outcome,
  p_amount numeric, p_valid_until int, p_who text, p_assessment text, p_comment text,
  p_days_ago int, p_conditions jsonb default '[]')
returns jsonb language plpgsql as $$
declare v_req uuid := pg_temp.k('req:' || p_policy || ':' || p_buyer); v_ccy text; v jsonb;
begin
  perform pg_temp.owner();
  select currency_code into v_ccy from tci.credit_limit_requests where id = v_req;
  perform pg_temp.act(p_who);
  v := tci.decide_limit_request(v_req, p_outcome, p_amount, v_ccy, current_date,
    case when p_valid_until is null then null else current_date + greatest(p_valid_until, 1) end,
    p_conditions, p_comment, pg_temp.k(p_assessment));
  perform pg_temp.owner();
  update tci.credit_limit_decisions
     set decided_at  = now() - make_interval(days => p_days_ago),
         valid_from  = current_date - p_days_ago,
         valid_until = case when p_valid_until is null then null else current_date + p_valid_until end
   where request_id = v_req;
  update tci.credit_limit_requests
     set created_at   = now() - make_interval(days => p_days_ago + 6),
         submitted_at = now() - make_interval(days => p_days_ago + 5),
         decided_at   = case when decided_at is not null then now() - make_interval(days => p_days_ago) end
   where id = v_req;
  return v;
end $$;

-- 6a. Policies -----------------------------------------------------------------
select pg_temp.policy('PL1', 'P1', 'TCI-2026-0001', 'whole_turnover', 'USD', -200, 165, 0.18, 60000, 50000, 3000000, 5000, 'monthly');
select pg_temp.policy('PL2', 'P2', 'TCI-2026-0002', 'whole_turnover', 'USD', -150, 215, 0.16, 45000, 40000, 2500000, 5000, 'quarterly');
select pg_temp.policy('PL3', 'P3', 'TCI-2026-0003', 'key_buyers', 'EUR', -100, 265, 0.22, 35000, 0, 2000000, 3000, 'monthly');
select pg_temp.policy('PL4', 'P4', 'TCI-2025-0014', 'whole_turnover', 'UZS', -320, 45, 0.20, 900000000, 600000000, 40000000000, 60000000, 'monthly');
select pg_temp.policy('PL5', 'P5', 'TCI-2025-0009', 'single_buyer', 'USD', -300, 65, 0.35, 30000, 0, 1000000, 5000, 'quarterly');
select pg_temp.policy('PL7', 'P4', 'TCI-2026-0007', 'whole_turnover', 'UZS', 45, 410, 0.19, 950000000, 600000000, 42000000000, 60000000, 'monthly', false);

-- 6b. Limit requests and credit decisions -------------------------------------
-- PL1 Samarkand Textile (USD)
select pg_temp.request('PL1', 'B1', 500000, 'USD', 90, 'Regular buyer of cotton yarn since 2019, 4–5 shipments a month.');
select pg_temp.decide('PL1', 'B1', 'approved', 500000, 12, 'credit', 'assess:B1:300', 'Strong 2024 accounts; review before year end.', 280);
select pg_temp.request('PL1', 'B3', 300000, 'USD', 60, 'New fabric line for the German market.');
select pg_temp.decide('PL1', 'B3', 'partial', 250000, 3, 'credit', 'assess:B3:280', 'Partial: margin pressure in 2024, payment terms capped at 60 days.', 300,
  '[{"condition_type": "payment_terms", "description": "Payment terms no longer than 60 days"}]');
select pg_temp.request('PL1', 'B5', 250000, 'USD', 90, 'Long-standing buyer, seasonal peaks in Q2.');
select pg_temp.decide('PL1', 'B5', 'partial', 150000, 180, 'credit', 'assess:B5:250', 'Leverage high; partial cover with quarterly reporting.', 220,
  '[{"condition_type": "reporting", "description": "Quarterly management accounts"}]');
select pg_temp.request('PL1', 'B6', 400000, 'USD', 120, 'Large Chinese distributor, prepayment history clean.');
select pg_temp.decide('PL1', 'B6', 'approved', 400000, null, 'credit', 'assess:B6:240', 'Excellent financials.', 200);
select pg_temp.request('PL1', 'B4', 900000, 'USD', 90, 'Kazakh wholesaler doubling volumes in 2026.');
select pg_temp.decide('PL1', 'B4', 'approved', 900000, 365, 'credit_jr', 'assess:B4', 'Recommend approval in full.', 3);
select pg_temp.request('PL1', 'B9', 120000, 'USD', 60, 'Italian fashion house, first order.');
select pg_temp.request('PL1', 'B7', 200000, 'USD', 90, 'Copper cathode trader, Jebel Ali.');
select pg_temp.act('credit');
select tci.start_limit_review(pg_temp.k('req:PL1:B7'));
select pg_temp.owner();
select pg_temp.request('PL1', 'B14', 80000, 'USD', 45, 'Domestic retail chain, needs financials first.', false);

-- PL2 Fergana Cotton (USD)
select pg_temp.request('PL2', 'B2', 350000, 'USD', 90, 'Sister company of Ozon Volga.');
select pg_temp.decide('PL2', 'B2', 'approved', 350000, 300, 'credit', 'assess:B2:260', 'Group checked: Ozon Holding.', 140);
select pg_temp.request('PL2', 'B4', 200000, 'USD', 60, 'Cotton fibre, monthly shipments.');
select pg_temp.decide('PL2', 'B4', 'approved', 200000, 25, 'credit', 'assess:B4', 'Within appetite.', 120);
select pg_temp.request('PL2', 'B10', 180000, 'USD', 90, 'Pharma distributor, cotton wool and gauze.');
select pg_temp.decide('PL2', 'B10', 'approved', 180000, 200, 'credit', 'assess:B10', 'Stable distributor.', 400);
select pg_temp.request('PL2', 'B8', 100000, 'USD', 120, 'Polish importer asks for 120 days.');
select pg_temp.decide('PL2', 'B8', 'declined', null, null, 'credit', 'assess:B8', 'Declined under this policy: 120 days exceeds the buyer''s usual terms.', 60);
select pg_temp.request('PL2', 'B11', 300000, 'USD', 90, 'New buyer: copper processing, Karaganda.');

-- PL3 Navoi Copper (EUR)
select pg_temp.request('PL3', 'B8', 250000, 'EUR', 60, 'Copper wire rod, Poland.');
select pg_temp.decide('PL3', 'B8', 'approved', 250000, 240, 'credit', 'assess:B8', 'Good 2025 accounts.', 90);
select pg_temp.request('PL3', 'B9', 150000, 'EUR', 60, 'Copper fittings for fashion accessories.');
select pg_temp.decide('PL3', 'B9', 'approved', 150000, -8, 'credit', 'assess:B9', 'Acceptable.', 80);
select pg_temp.request('PL3', 'B3', 200000, 'EUR', 60, 'Metal trims.');
select pg_temp.decide('PL3', 'B3', 'approved', 200000, 120, 'credit', 'assess:B3', 'Approved; commercial review to follow.', 30);
select pg_temp.request('PL3', 'B15', 300000, 'EUR', 90, 'Hamburg metals trader — accounts received, rating pending.');

-- PL4 Tashkent Pharma (UZS)
select pg_temp.request('PL4', 'B13', 6000000000, 'UZS', 60, 'Largest domestic supermarket chain.');
select pg_temp.decide('PL4', 'B13', 'approved', 6000000000, 120, 'credit', 'assess:B13:190', 'Strong domestic buyer.', 250);

-- PL5 Andijan Auto (USD, single buyer)
select pg_temp.request('PL5', 'B12', 220000, 'USD', 90, 'Korean parts supplier, sole buyer.');
select pg_temp.decide('PL5', 'B12', 'approved', 220000, 200, 'credit', 'assess:B12:300', 'Approved on 2024 accounts.', 260);
select pg_temp.request('PL5', 'B16', 150000, 'USD', 60, 'Second buyer added mid-term.');
select pg_temp.decide('PL5', 'B16', 'approved', 150000, 300, 'credit', 'assess:B16', 'Approved.', 90);

-- 6c. Fresh decisions: one still inside the sales window, one held by
--     commercial underwriting, one commercially reduced ---------------------
select pg_temp.decide('PL2', 'B11', 'partial', 250000, 365, 'credit', 'assess:B11', 'Partial pending 2026 interim accounts.', 0);
select pg_temp.request('PL3', 'B17', 90000, 'EUR', 60, 'Fresh produce importer, Dubai.');
select pg_temp.decide('PL3', 'B17', 'approved', 90000, 365, 'credit', 'assess:B17', 'Approved.', 0);
select pg_temp.act('sales');
select tci.hold_decision(
  (select d.id from tci.credit_limit_decisions d where d.request_id = pg_temp.k('req:PL3:B17') and d.stage = 'credit'),
  'Hold: the policy covers named key buyers and Dubai Fresh is not one yet — endorsement first.');
select pg_temp.act('commercial');
select tci.adjust_limit_commercial(
  (select d.id from tci.credit_limit_decisions d where d.request_id = pg_temp.k('req:PL3:B3') and d.stage = 'credit'),
  160000, 60, 'Reduced to the policyholder''s actual trading volume with this buyer.');
select pg_temp.owner();

-- 6d. Corporate groups --------------------------------------------------------
select pg_temp.act('credit');
select tci.save_entity_relationship(pg_temp.k('ent:G1'), pg_temp.k('ent:B1'), 'ownership', 100, current_date - 800, null, 'manual', 'Ozon Holding annual report 2024, note 1');
select tci.save_entity_relationship(pg_temp.k('ent:G1'), pg_temp.k('ent:B2'), 'ownership', 75, current_date - 800, null, 'manual', 'Ozon Holding annual report 2024, note 1');
select tci.save_entity_relationship(pg_temp.k('ent:G2'), pg_temp.k('ent:B5'), 'ownership', 60, current_date - 900, null, 'manual', 'Trade registry extract');
select tci.save_entity_relationship(pg_temp.k('ent:G2'), pg_temp.k('ent:B16'), 'control', null, current_date - 900, null, 'manual', 'Shareholders'' agreement');
select pg_temp.owner();

-- 6e. Submissions (insurance requests) at every stage -------------------------
create function pg_temp.submission(p_key text, p_applicant text, p_number text, p_ccy text, p_turnover numeric,
  p_rate numeric, p_min_premium numeric, p_dl numeric, p_days_ago int)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.owner();
  insert into tci.insurance_requests (id, entity_id, request_number, status, product_structure, currency_code,
    insured_percentage, premium_rate_pct, minimum_premium, max_liability_amount, discretionary_limit, nql_amount,
    waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency,
    estimated_annual_turnover, created_by, created_by_role, assigned_sales, notes, created_at)
  values (v_id, pg_temp.k('ent:' || p_applicant), p_number, 'draft', 'whole_turnover', p_ccy,
    90, p_rate, p_min_premium, p_min_premium * 40, p_dl, 5000, 30, 90, 120, 'monthly',
    p_turnover, pg_temp.k('user:sales'), 'sales', pg_temp.k('user:sales'),
    'Prospect met at the Tashkent export forum.', now() - make_interval(days => p_days_ago));
  insert into demo_keys values ('sub:' || p_key, v_id);
  return v_id;
end $$;

create function pg_temp.sub_buyer(p_sub text, p_buyer text, p_name text, p_amount numeric)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.owner();
  insert into tci.insurance_request_buyers (id, request_id, entity_id, proposed_name, requested_amount,
    requested_payment_terms_days, resolution_status, created_by)
  values (v_id, pg_temp.k('sub:' || p_sub), case when p_buyer is null then null else pg_temp.k('ent:' || p_buyer) end,
    p_name, p_amount, 90, (case when p_buyer is null then 'pending_entity' else 'ready' end)::tci.buyer_resolution_status, pg_temp.k('user:sales'));
  return v_id;
end $$;

-- a limit request inside a submission (no policy yet), submitted by sales
create function pg_temp.sub_request(p_sub text, p_buyer text, p_amount numeric, p_ccy text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.owner();
  insert into tci.credit_limit_requests (id, insurance_request_id, entity_id, requested_amount, currency_code,
    requested_payment_terms_days, justification, status, requested_by)
  values (v_id, pg_temp.k('sub:' || p_sub), pg_temp.k('ent:' || p_buyer), p_amount, p_ccy, 90,
    'Buyer from the submission package.', 'draft', pg_temp.k('user:sales'));
  insert into demo_keys values ('req:' || p_sub || ':' || p_buyer, v_id);
  perform pg_temp.act('sales');
  perform tci.submit_limit_request(v_id);
  perform pg_temp.owner();
  return v_id;
end $$;

create function pg_temp.move(p_sub text, p_to tci.insurance_request_status, p_who text, p_comment text default null)
returns void language plpgsql as $$
begin
  perform pg_temp.act(p_who);
  perform tci.advance_insurance_request(pg_temp.k('sub:' || p_sub), p_to, p_comment);
  perform pg_temp.owner();
end $$;

-- R1 Jizzakh Cement: submitted, one buyer known only by name → entity resolution
select pg_temp.submission('R1', 'S4', 'IR-2026-0011', 'USD', 6000000, 0.17, 40000, 50000, 3);
select pg_temp.sub_buyer('R1', 'B13', null, 400000);
select pg_temp.sub_buyer('R1', null, 'TOO Almaty Stroy Invest', 250000);
select pg_temp.move('R1', 'submitted', 'sales');
select pg_temp.move('R1', 'entity_resolution', 'sales');

-- R2 Khorezm Agro: in underwriting, credit decisions outstanding
select pg_temp.submission('R2', 'S1', 'IR-2026-0009', 'USD', 9000000, 0.15, 55000, 60000, 12);
select pg_temp.sub_buyer('R2', 'B4', null, 300000);
select pg_temp.sub_buyer('R2', 'B11', null, 350000);
select pg_temp.move('R2', 'submitted', 'sales');
select pg_temp.move('R2', 'underwriting', 'sales');
select pg_temp.sub_request('R2', 'B4', 300000, 'USD');
select pg_temp.sub_request('R2', 'B11', 350000, 'USD');

-- R3 Kokand Glass: credit done, in commercial review
select pg_temp.submission('R3', 'S2', 'IR-2026-0007', 'EUR', 4500000, 0.19, 30000, 40000, 20);
select pg_temp.sub_buyer('R3', 'B8', null, 200000);
select pg_temp.sub_buyer('R3', 'B9', null, 150000);
select pg_temp.move('R3', 'submitted', 'sales');
select pg_temp.move('R3', 'underwriting', 'sales');
select pg_temp.sub_request('R3', 'B8', 200000, 'EUR');
select pg_temp.sub_request('R3', 'B9', 150000, 'EUR');
select pg_temp.decide('R3', 'B8', 'approved', 200000, 365, 'credit', 'assess:B8', 'Approved for the new policy.', 8);
select pg_temp.decide('R3', 'B9', 'partial', 100000, 365, 'credit', 'assess:B9', 'Partial: thin margins.', 8);
select pg_temp.move('R3', 'commercial_review', 'credit');

-- R4 Namangan Fruit: terms with the client
select pg_temp.submission('R4', 'S3', 'IR-2026-0005', 'USD', 3000000, 0.21, 25000, 30000, 30);
select pg_temp.sub_buyer('R4', 'B10', null, 150000);
select pg_temp.sub_buyer('R4', 'B2', null, 100000);
select pg_temp.move('R4', 'submitted', 'sales');
select pg_temp.move('R4', 'underwriting', 'sales');
select pg_temp.sub_request('R4', 'B10', 150000, 'USD');
select pg_temp.sub_request('R4', 'B2', 100000, 'USD');
select pg_temp.decide('R4', 'B10', 'approved', 150000, 365, 'credit', 'assess:B10', 'Approved.', 15);
select pg_temp.decide('R4', 'B2', 'approved', 100000, 365, 'credit', 'assess:B2', 'Approved; group exposure checked.', 15);
select pg_temp.move('R4', 'commercial_review', 'credit');
select pg_temp.move('R4', 'sales_confirmation', 'commercial', 'Rate 0.21% agreed, minimum premium 25 000 USD.');
select pg_temp.move('R4', 'client_review', 'sales');

-- R5 Bukhara Food: accepted and bound → policy TCI-2026-0005 with the package limits
select pg_temp.submission('R5', 'P6', 'IR-2026-0002', 'USD', 5000000, 0.18, 35000, 40000, 75);
select pg_temp.sub_buyer('R5', 'B17', null, 180000);
select pg_temp.sub_buyer('R5', 'B16', null, 100000);
select pg_temp.move('R5', 'submitted', 'sales');
select pg_temp.move('R5', 'underwriting', 'sales');
select pg_temp.sub_request('R5', 'B17', 180000, 'USD');
select pg_temp.sub_request('R5', 'B16', 100000, 'USD');
select pg_temp.decide('R5', 'B17', 'approved', 180000, 300, 'credit', 'assess:B17', 'Approved.', 65);
select pg_temp.decide('R5', 'B16', 'approved', 100000, 300, 'credit', 'assess:B16', 'Approved.', 65);
select pg_temp.move('R5', 'commercial_review', 'credit');
select pg_temp.move('R5', 'sales_confirmation', 'commercial', 'Standard terms.');
select pg_temp.move('R5', 'client_review', 'sales');
select pg_temp.move('R5', 'accepted', 'sales', 'Client signed the offer.');
select pg_temp.act('commercial');
select tci.bind_insurance_request(pg_temp.k('sub:R5'), 'TCI-2026-0005', current_date - 60, current_date + 305);
select pg_temp.owner();
insert into demo_keys select 'pol:PL6', bound_policy_id from tci.insurance_requests where id = pg_temp.k('sub:R5');
select pg_temp.act('commercial');
select tci.change_policy_status(pg_temp.k('pol:PL6'), 'active', 'Signed policy received.');
select pg_temp.owner();

-- R6 Namangan Fruit's earlier submission: declined by the client
select pg_temp.submission('R6', 'S3', 'IR-2025-0031', 'USD', 2500000, 0.26, 30000, 30000, 210);
select pg_temp.sub_buyer('R6', 'B10', null, 120000);
select pg_temp.move('R6', 'submitted', 'sales');
select pg_temp.move('R6', 'underwriting', 'sales');
select pg_temp.sub_request('R6', 'B10', 120000, 'USD');
select pg_temp.decide('R6', 'B10', 'approved', 120000, 200, 'credit', 'assess:B10', 'Approved.', 200);
select pg_temp.move('R6', 'commercial_review', 'credit');
select pg_temp.move('R6', 'sales_confirmation', 'commercial', 'Rate 0.26%.');
select pg_temp.move('R6', 'client_review', 'sales');
select pg_temp.move('R6', 'declined', 'sales', 'Client found the rate too high and chose a bank guarantee instead.');

-- 6f. The Ozon group cap, set after the decisions it now sits under:
--     850 000 USD in force across the group against an 800 000 cap ----------
select pg_temp.act('credit');
select tci.set_group_limit(pg_temp.k('ent:G1'), 800000, 'USD', current_date - 30, 'Group appetite for Ozon after the 2025 results.');
select pg_temp.owner();

-- 6g. The policyholder's portal user (Samarkand Textile) -----------------------
insert into tci.policyholder_users (entity_id, user_id, created_by)
values (pg_temp.k('ent:P1'), pg_temp.k('user:client'), pg_temp.k('user:sales'));

-- 6h. Declarations and premium ----------------------------------------------
-- Monthly turnover per buyer; months 1..n back from the current month.
create function pg_temp.declaration(p_policy text, p_months_back int, p_lines jsonb, p_accept boolean)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_pol tci.policies%rowtype;
  v_start date;
  v_line jsonb;
begin
  perform pg_temp.owner();
  select * into v_pol from tci.policies where id = pg_temp.k('pol:' || p_policy);
  v_start := case v_pol.declaration_frequency
               when 'monthly' then (date_trunc('month', current_date) - make_interval(months => p_months_back))::date
               else (date_trunc('quarter', current_date) - make_interval(months => 3 * p_months_back))::date
             end;
  insert into tci.declarations (id, policy_id, period_start, period_end, status, currency_code, created_by, created_at)
  values (v_id, v_pol.id, v_start, tci.declaration_period_end(v_start, v_pol.declaration_frequency), 'draft',
          v_pol.currency_code, pg_temp.k('user:client'), (v_start + 35)::timestamptz);
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into tci.declaration_lines (declaration_id, entity_id, insurable_turnover, overdue_amount, line_note)
    values (v_id, pg_temp.k('ent:' || (v_line->>'buyer')), (v_line->>'turnover')::numeric,
            coalesce((v_line->>'overdue')::numeric, 0), v_line->>'note');
  end loop;
  perform pg_temp.act('sales');
  perform tci.submit_declaration(v_id);
  if p_accept then
    perform pg_temp.act('commercial');
    perform tci.accept_declaration(v_id);
  end if;
  perform pg_temp.owner();
  update tci.declarations
     set submitted_at = (v_start + 40)::timestamptz,
         accepted_at  = case when p_accept then (v_start + 44)::timestamptz end
   where id = v_id;
  return v_id;
end $$;

-- PL1 Samarkand Textile: six months declared, the last one awaiting acceptance;
-- in month 3 the policyholder sold 80 000 to a buyer with no limit (DL 50 000)
select pg_temp.declaration('PL1', 6, '[{"buyer":"B1","turnover":410000},{"buyer":"B3","turnover":185000},{"buyer":"B5","turnover":120000},{"buyer":"B6","turnover":330000}]', true);
select pg_temp.declaration('PL1', 5, '[{"buyer":"B1","turnover":395000},{"buyer":"B3","turnover":210000},{"buyer":"B5","turnover":135000},{"buyer":"B6","turnover":350000}]', true);
select pg_temp.declaration('PL1', 4, '[{"buyer":"B1","turnover":450000},{"buyer":"B3","turnover":160000},{"buyer":"B5","turnover":98000},{"buyer":"B6","turnover":372000}]', true);
select pg_temp.declaration('PL1', 3, '[{"buyer":"B1","turnover":470000},{"buyer":"B3","turnover":150000},{"buyer":"B6","turnover":365000},{"buyer":"B14","turnover":80000,"note":"New domestic customer, limit not yet requested"}]', true);
select pg_temp.declaration('PL1', 2, '[{"buyer":"B1","turnover":430000},{"buyer":"B3","turnover":90000,"overdue":42000},{"buyer":"B6","turnover":390000}]', true);
select pg_temp.declaration('PL1', 1, '[{"buyer":"B1","turnover":445000},{"buyer":"B6","turnover":402000}]', false);
-- PL2 Fergana Cotton: quarterly, one accepted
select pg_temp.declaration('PL2', 1, '[{"buyer":"B2","turnover":820000},{"buyer":"B4","turnover":410000},{"buyer":"B10","turnover":260000}]', true);
-- PL4 Tashkent Pharma (UZS): three months
select pg_temp.declaration('PL4', 3, '[{"buyer":"B13","turnover":9800000000}]', true);
select pg_temp.declaration('PL4', 2, '[{"buyer":"B13","turnover":10400000000}]', true);
select pg_temp.declaration('PL4', 1, '[{"buyer":"B13","turnover":11200000000}]', true);
-- PL3 Navoi Copper (EUR) has declared nothing yet: the Agenda will chase it.

-- Premium instalments paid on time, except Fergana Cotton's latest, now overdue
update tci.premium_instalments i
   set status = 'paid', paid_at = (i.due_date + 3)::timestamptz
 where i.due_date < current_date - 20
   and i.policy_id in (select id from demo_keys where key in ('pol:PL1', 'pol:PL3', 'pol:PL4', 'pol:PL5', 'pol:PL6'));
update tci.premium_instalments i
   set status = 'paid', paid_at = (i.due_date + 5)::timestamptz
 where i.due_date < current_date - 100
   and i.policy_id = pg_temp.k('pol:PL2');

-- 6i. Overdue notifications (NOA) — filing suspends the buyer's limit ---------
create function pg_temp.noa(p_policy text, p_buyer text, p_first_due int, p_amount numeric, p_reported_after int)
returns uuid language plpgsql as $$
declare v jsonb; v_id uuid; v_ccy text;
begin
  perform pg_temp.owner();
  select currency_code into v_ccy from tci.policies where id = pg_temp.k('pol:' || p_policy);
  perform pg_temp.act('sales');
  v := tci.file_overdue_notification(pg_temp.k('pol:' || p_policy), pg_temp.k('ent:' || p_buyer),
         current_date + p_first_due, p_amount, v_ccy);
  perform pg_temp.owner();
  select id into v_id from tci.overdue_notifications
   where policy_id = pg_temp.k('pol:' || p_policy) and entity_id = pg_temp.k('ent:' || p_buyer) and status = 'open';
  update tci.overdue_notifications
     set reported_at = (current_date + p_first_due + p_reported_after)::timestamptz,
         created_at  = (current_date + p_first_due + p_reported_after)::timestamptz
   where id = v_id;
  insert into demo_keys values ('noa:' || p_policy || ':' || p_buyer, v_id);
  return v_id;
end $$;

select pg_temp.noa('PL1', 'B3', -75, 42000, 50);
select pg_temp.noa('PL5', 'B12', -40, 65000, 25);
select pg_temp.noa('PL1', 'B5', -155, 98000, 60);
select pg_temp.noa('PL2', 'B4', -50, 30000, 20);
select pg_temp.act('commercial');
select tci.resolve_overdue_notification(pg_temp.k('noa:PL2:B4'), 'resolved_paid', 'Buyer paid in full on day 52; no claim.');
select pg_temp.owner();

-- 6j. Claims, opened by the claims department with their invoices. Their
--     documents are uploaded through Storage by docs/demo/after-seed.mjs,
--     which then files and processes them (Storage bytes cannot come from SQL).
create function pg_temp.claim(p_key text, p_policy text, p_buyer text, p_cause tci.claim_cause_of_loss,
  p_noa text, p_reference text, p_invoices jsonb)
returns uuid language plpgsql as $$
declare v_claim tci.claims%rowtype; v_inv jsonb; v_ccy text;
begin
  perform pg_temp.owner();
  select currency_code into v_ccy from tci.policies where id = pg_temp.k('pol:' || p_policy);
  perform pg_temp.act('claims');
  v_claim := tci.open_claim(pg_temp.k('pol:' || p_policy), pg_temp.k('ent:' || p_buyer), p_cause,
               case when p_noa is null then null else pg_temp.k(p_noa) end, p_reference);
  for v_inv in select * from jsonb_array_elements(p_invoices) loop
    perform tci.save_claim_invoice(v_claim.id, v_inv->>'number', current_date + (v_inv->>'invoiced')::int,
      current_date + (v_inv->>'shipped')::int, current_date + (v_inv->>'due')::int, (v_inv->>'amount')::numeric,
      coalesce((v_inv->>'paid')::numeric, 0), 0, null, null);
  end loop;
  perform pg_temp.owner();
  insert into demo_keys values ('claim:' || p_key, v_claim.id);
  return v_claim.id;
end $$;

-- C1 Istanbul Tekstil: protracted default after the NOA (to be paid)
select pg_temp.claim('C1', 'PL1', 'B5', 'protracted_default', 'noa:PL1:B5', null,
  '[{"number":"ST-2026-0418","invoiced":-216,"shipped":-215,"due":-155,"amount":42000},
    {"number":"ST-2026-0457","invoiced":-201,"shipped":-200,"due":-140,"amount":31000},
    {"number":"ST-2026-0502","invoiced":-186,"shipped":-185,"due":-125,"amount":25000}]');
-- C2 Tashkent Supermarket Chain: insolvency (approved, paid, partly recovered)
select pg_temp.claim('C2', 'PL4', 'B13', 'insolvency', null, 'Toshkent iqtisodiy sudi, ish № 4-1001-2603/118',
  '[{"number":"TPD-26-1187","invoiced":-120,"shipped":-120,"due":-60,"amount":1850000000},
    {"number":"TPD-26-1302","invoiced":-95,"shipped":-95,"due":-35,"amount":1240000000,"paid":240000000}]');
-- C3 Seoul Auto Parts: protracted default, information requested from the policyholder
select pg_temp.claim('C3', 'PL5', 'B12', 'protracted_default', 'noa:PL5:B12', null,
  '[{"number":"AAC-26-077","invoiced":-131,"shipped":-130,"due":-40,"amount":65000}]');

-- 6k. A buyer the client named that is not in the registry yet ---------------
select pg_temp.act('client');
select tci.client_request_limit(pg_temp.k('pol:PL1'), null, 'OsOO Bishkek Market Group', '1205-3300-OOO', 'KG',
  70000, 'USD', 60, 'New distributor in Kyrgyzstan, first order planned next month.');
select pg_temp.owner();

-- ---------------------------------------------------------------------------
-- 7. Give the histories an age
-- ---------------------------------------------------------------------------
update tci.policy_status_history h
   set changed_at = (p.inception_date - 3)::timestamptz
  from tci.policies p
 where p.id = h.policy_id and p.inception_date < current_date;

-- submission steps spread over the days since the submission was opened
update tci.insurance_request_history h
   set changed_at = least(r.created_at + make_interval(days => (s.n * greatest(extract(day from now() - r.created_at)::int / 8, 1))::int), now() - interval '1 hour')
  from (select id, request_id, row_number() over (partition by request_id order by changed_at, id) as n
          from tci.insurance_request_history) s
  join tci.insurance_requests r on r.id = s.request_id
 where h.id = s.id;
update tci.insurance_requests r
   set submitted_at = (select min(h.changed_at) from tci.insurance_request_history h where h.request_id = r.id and h.to_status = 'submitted'),
       decided_at   = (select max(h.changed_at) from tci.insurance_request_history h where h.request_id = r.id and h.to_status in ('accepted', 'declined'))
 where r.id in (select id from demo_keys where key like 'sub:%');

-- ---------------------------------------------------------------------------
-- 8. The Agenda's time-based tasks (reviews due, stale ratings, declarations
--    and instalments due or overdue, group limits) — generated on read, as
--    the screen does
-- ---------------------------------------------------------------------------
select pg_temp.act('credit');
select tci.refresh_agenda();
select pg_temp.owner();
