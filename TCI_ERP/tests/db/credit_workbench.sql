-- Tests for migration 0053: the credit underwriter's workbench views.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/credit_workbench.sql
--
-- One transaction, rolled back. API roles are impersonated; the
-- internal-call token is cleared at every actor switch. Every UPDATE carries
-- a WHERE clause (the canonical tooling holds one without).

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000001c1', 'w-credit-a@t'),
  ('99999999-0000-4000-8000-0000000001c2', 'w-credit-b@t'),
  ('99999999-0000-4000-8000-0000000001c3', 'w-commercial@t'),
  ('99999999-0000-4000-8000-0000000001c9', 'w-admin@t'),
  ('99999999-0000-4000-8000-0000000001c5', 'w-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000001c1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000001c2', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000001c3', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000001c9', 'admin'),
  ('99999999-0000-4000-8000-0000000001c5', 'client');
-- underwriter A may decide 100 000 UZS on unrated buyers; B holds no grant
insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, created_by)
values ('99999999-0000-4000-8000-0000000001c1', 'credit', 'unrated', 100000, 'UZS',
        '99999999-0000-4000-8000-0000000001c9');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000001c3"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000001e1', 'W Holder LLC',    'UZ', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-0000000001e2', 'W No Statements', 'DE', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-0000000001e3', 'W Unrated',       'KZ', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-0000000001e4', 'W Stale',         'UZ', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-0000000001e5', 'W New Period',    'UZ', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-0000000001e6', 'W Fresh',         'UZ', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-0000000001e7', 'W Group Parent',  'UZ', '99999999-0000-4000-8000-0000000001c3');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000001f1', '99999999-0000-4000-8000-0000000001e1', 'W-1', 'whole_turnover',
  'draft', current_date - 30, current_date + 300, 'UZS', 90, 0, 0.15, 10000, 25000, 30, 60, 90, 'monthly',
  '99999999-0000-4000-8000-0000000001c3', 1000000);

-- statements and ratings
insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
values
  ('99999999-0000-4000-8000-000000000131', '99999999-0000-4000-8000-0000000001e3', 'annual', 2025, '2025-12-31', 'UZS', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-000000000141', '99999999-0000-4000-8000-0000000001e4', 'annual', 2025, '2025-12-31', 'UZS', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-000000000151', '99999999-0000-4000-8000-0000000001e5', 'annual', 2024, '2024-12-31', 'UZS', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-000000000152', '99999999-0000-4000-8000-0000000001e5', 'annual', 2025, '2025-12-31', 'UZS', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-000000000161', '99999999-0000-4000-8000-0000000001e6', 'annual', 2025, '2025-12-31', 'UZS', '99999999-0000-4000-8000-0000000001c3');
insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
  inputs_snapshot, calculation_trace, engine_version, created_by, created_at)
values
  ('99999999-0000-4000-8000-0000000001e4', '99999999-0000-4000-8000-000000000141', 40, 'B2', 1, 'UZS', '{}', '{}', 't',
   '99999999-0000-4000-8000-0000000001c1', now() - interval '13 months'),
  ('99999999-0000-4000-8000-0000000001e5', '99999999-0000-4000-8000-000000000151', 30, 'A2', 1, 'UZS', '{}', '{}', 't',
   '99999999-0000-4000-8000-0000000001c1', now() - interval '2 months'),
  ('99999999-0000-4000-8000-0000000001e6', '99999999-0000-4000-8000-000000000161', 30, 'A1', 1, 'UZS', '{}', '{}', 't',
   '99999999-0000-4000-8000-0000000001c1', now() - interval '1 month');

-- open requests: e2 within A's authority, e3 beyond it
insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by, submitted_at)
values
  ('99999999-0000-4000-8000-0000000001a2', '99999999-0000-4000-8000-0000000001f1', '99999999-0000-4000-8000-0000000001e2',
   50000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000001c3', now()),
  ('99999999-0000-4000-8000-0000000001a3', '99999999-0000-4000-8000-0000000001f1', '99999999-0000-4000-8000-0000000001e3',
   200000, 'UZS', 'escalated', '99999999-0000-4000-8000-0000000001c3', now());
-- in-force limits: e4 (stale), e5 (new period), e6 (fresh), plus the group
insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
values
  ('99999999-0000-4000-8000-0000000001a4', '99999999-0000-4000-8000-0000000001f1', '99999999-0000-4000-8000-0000000001e4', 30000, 'UZS', 'decided', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-0000000001a5', '99999999-0000-4000-8000-0000000001f1', '99999999-0000-4000-8000-0000000001e5', 30000, 'UZS', 'decided', '99999999-0000-4000-8000-0000000001c3'),
  ('99999999-0000-4000-8000-0000000001a6', '99999999-0000-4000-8000-0000000001f1', '99999999-0000-4000-8000-0000000001e6', 30000, 'UZS', 'decided', '99999999-0000-4000-8000-0000000001c3');
insert into tci.credit_limit_decisions (request_id, outcome, approved_amount, currency_code, lifecycle, decided_by)
values
  ('99999999-0000-4000-8000-0000000001a4', 'approved', 30000, 'UZS', 'effective', '99999999-0000-4000-8000-0000000001c1'),
  ('99999999-0000-4000-8000-0000000001a5', 'approved', 20000, 'UZS', 'effective', '99999999-0000-4000-8000-0000000001c1'),
  ('99999999-0000-4000-8000-0000000001a6', 'approved', 25000, 'UZS', 'effective', '99999999-0000-4000-8000-0000000001c1');

-- a group: e7 owns e5 and e6; capped at 40 000 UZS against 45 000 in force
insert into tci.entity_relationships (parent_entity_id, child_entity_id, relationship_type, ownership_pct, created_by)
values
  ('99999999-0000-4000-8000-0000000001e7', '99999999-0000-4000-8000-0000000001e5', 'ownership', 100, '99999999-0000-4000-8000-0000000001c1'),
  ('99999999-0000-4000-8000-0000000001e7', '99999999-0000-4000-8000-0000000001e6', 'ownership', 100, '99999999-0000-4000-8000-0000000001c1');
insert into tci.group_limits (ultimate_parent_entity_id, max_amount, currency_code, set_by)
values ('99999999-0000-4000-8000-0000000001e7', 40000, 'UZS', '99999999-0000-4000-8000-0000000001c1');

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;

do $$
declare
  v_q  tci.v_limit_request_queue%rowtype;
  v_r  record;
  v_g  tci.v_group_limit_status%rowtype;
  v_n  int;
begin
  -- 1. the queue: band, UZS amount, and who may decide alone
  perform pg_temp.act('99999999-0000-4000-8000-0000000001c1');
  select * into v_q from tci.v_limit_request_queue where request_id = '99999999-0000-4000-8000-0000000001a2';
  if not found then raise exception 'workbench: the open request is missing from the queue'; end if;
  if v_q.band <> 'unrated' or v_q.amount_uzs <> 50000 or v_q.my_authority_uzs <> 100000 or not v_q.decide_alone then
    raise exception 'workbench: underwriter A, within authority: %', row_to_json(v_q);
  end if;
  select * into v_q from tci.v_limit_request_queue where request_id = '99999999-0000-4000-8000-0000000001a3';
  if v_q.decide_alone or v_q.status <> 'escalated' then
    raise exception 'workbench: 200 000 is beyond A''s 100 000 yet decide_alone = %', v_q.decide_alone;
  end if;
  -- decided requests are not in the queue
  select count(*) into v_n from tci.v_limit_request_queue where request_id = '99999999-0000-4000-8000-0000000001a4';
  if v_n <> 0 then raise exception 'workbench: a decided request is in the queue'; end if;

  perform pg_temp.act('99999999-0000-4000-8000-0000000001c2');
  select * into v_q from tci.v_limit_request_queue where request_id = '99999999-0000-4000-8000-0000000001a2';
  if v_q.decide_alone or v_q.my_authority_uzs <> 0 then
    raise exception 'workbench: underwriter B holds no grant yet decide_alone = %', v_q.decide_alone;
  end if;

  perform pg_temp.act('99999999-0000-4000-8000-0000000001c9');
  select * into v_q from tci.v_limit_request_queue where request_id = '99999999-0000-4000-8000-0000000001a3';
  -- 0063: admin holds no business decision rights, so no authority either
  if v_q.decide_alone then raise exception 'workbench: admin must not decide alone (0063)'; end if;

  -- 2. the rating worklist: one reason each, the fresh buyer absent
  perform pg_temp.act('99999999-0000-4000-8000-0000000001c1');
  for v_r in
    select * from (values
      ('99999999-0000-4000-8000-0000000001e2'::uuid, 'no_statements'),
      ('99999999-0000-4000-8000-0000000001e3'::uuid, 'no_rating'),
      ('99999999-0000-4000-8000-0000000001e4'::uuid, 'stale'),
      ('99999999-0000-4000-8000-0000000001e5'::uuid, 'new_statement')) as t(entity_id, reason)
  loop
    if (select w.reason from tci.v_rating_worklist w where w.entity_id = v_r.entity_id) is distinct from v_r.reason then
      raise exception 'workbench: % expected reason %, got %', v_r.entity_id, v_r.reason,
        (select w.reason from tci.v_rating_worklist w where w.entity_id = v_r.entity_id);
    end if;
  end loop;
  if exists (select 1 from tci.v_rating_worklist where entity_id = '99999999-0000-4000-8000-0000000001e6') then
    raise exception 'workbench: a freshly rated buyer is on the rating worklist';
  end if;
  -- the policyholder has no credit business of its own
  if exists (select 1 from tci.v_rating_worklist where entity_id = '99999999-0000-4000-8000-0000000001e1') then
    raise exception 'workbench: a policyholder with no limit is on the rating worklist';
  end if;
  -- the stale buyer is reported with its band and in-force count
  select * into v_r from tci.v_rating_worklist where entity_id = '99999999-0000-4000-8000-0000000001e4';
  if v_r.band <> 'B' or v_r.limits_in_force <> 1 or v_r.grade <> 'B2' then
    raise exception 'workbench: stale row %', row_to_json(v_r);
  end if;

  -- 3. groups against their limits: 45 000 in force over a 40 000 cap
  select * into v_g from tci.v_group_limit_status where ultimate_parent_id = '99999999-0000-4000-8000-0000000001e7';
  if not found then raise exception 'workbench: the group is missing'; end if;
  if v_g.members_count <> 3 or v_g.exposure_uzs <> 45000 or v_g.limit_uzs <> 40000
     or v_g.utilisation_pct <> 112.5 or not v_g.over_limit or v_g.members_with_limits <> 2 then
    raise exception 'workbench: group row %', row_to_json(v_g);
  end if;
  -- a standalone buyer is not a group
  if exists (select 1 from tci.v_group_limit_status where ultimate_parent_id = '99999999-0000-4000-8000-0000000001e4') then
    raise exception 'workbench: a standalone buyer is listed as a group';
  end if;

  -- 4. a client sees nothing in any of them
  perform pg_temp.act('99999999-0000-4000-8000-0000000001c5');
  if exists (select 1 from tci.v_limit_request_queue)
     or exists (select 1 from tci.v_rating_worklist)
     or exists (select 1 from tci.v_group_limit_status) then
    raise exception 'workbench: a client can read a workbench view';
  end if;
  perform set_config('role', 'postgres', true);
end $$;

do $$ begin raise notice 'credit_workbench: OK — queue authority, rating reasons, group utilisation, staff-only'; end $$;
rollback;
