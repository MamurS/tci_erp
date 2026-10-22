-- Tests for migration 0059: the buyer package of a submission advances on
-- its own — rated => rating_done, an approved credit decision in that
-- submission => limit_done — forward only, live submissions only.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/buyer_progress.sql
--
-- One transaction, rolled back. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000007a1', 'bp-sales@t'),
  ('99999999-0000-4000-8000-0000000007a2', 'bp-credit@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000007a1', 'sales'),
  ('99999999-0000-4000-8000-0000000007a2', 'credit_underwriter');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000007a1', 'BP Sales', false),
  ('99999999-0000-4000-8000-0000000007a2', 'BP Credit', false)
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000007a1"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000007e1', 'BP Applicant', 'UZ', '99999999-0000-4000-8000-0000000007a1'),
  ('99999999-0000-4000-8000-0000000007e2', 'BP Buyer Approved', 'KZ', '99999999-0000-4000-8000-0000000007a1'),
  ('99999999-0000-4000-8000-0000000007e3', 'BP Buyer Declined', 'TR', '99999999-0000-4000-8000-0000000007a1');
insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
values
  ('99999999-0000-4000-8000-000000000721', '99999999-0000-4000-8000-0000000007e2', 'annual', 2025, '2025-12-31', 'USD', '99999999-0000-4000-8000-0000000007a1'),
  ('99999999-0000-4000-8000-000000000722', '99999999-0000-4000-8000-0000000007e3', 'annual', 2025, '2025-12-31', 'USD', '99999999-0000-4000-8000-0000000007a1');

-- A live submission (underwriting) and a closed one (declined), both with e2.
insert into tci.insurance_requests (id, entity_id, request_number, status, created_by) values
  ('99999999-0000-4000-8000-0000000007b1', '99999999-0000-4000-8000-0000000007e1', 'BP-IR-1', 'underwriting',
   '99999999-0000-4000-8000-0000000007a1'),
  ('99999999-0000-4000-8000-0000000007b2', '99999999-0000-4000-8000-0000000007e1', 'BP-IR-2', 'declined',
   '99999999-0000-4000-8000-0000000007a1');
insert into tci.insurance_request_buyers (id, request_id, entity_id, requested_amount, resolution_status, created_by) values
  ('99999999-0000-4000-8000-0000000007d1', '99999999-0000-4000-8000-0000000007b1', '99999999-0000-4000-8000-0000000007e2', 100000, 'ready', '99999999-0000-4000-8000-0000000007a1'),
  ('99999999-0000-4000-8000-0000000007d2', '99999999-0000-4000-8000-0000000007b1', '99999999-0000-4000-8000-0000000007e3', 50000, 'ready', '99999999-0000-4000-8000-0000000007a1'),
  ('99999999-0000-4000-8000-0000000007d3', '99999999-0000-4000-8000-0000000007b2', '99999999-0000-4000-8000-0000000007e2', 70000, 'ready', '99999999-0000-4000-8000-0000000007a1');
select set_config('tci.internal_call', '', true);

create function pg_temp.status_of(p_id uuid) returns text language sql as
  $$ select resolution_status::text from tci.insurance_request_buyers where id = p_id $$;

do $$
declare
  c_live_approved  constant uuid := '99999999-0000-4000-8000-0000000007d1';
  c_live_declined  constant uuid := '99999999-0000-4000-8000-0000000007d2';
  c_closed         constant uuid := '99999999-0000-4000-8000-0000000007d3';
  v_state text;
begin
  -- Nothing rated yet: the rows stay where they were put.
  if pg_temp.status_of(c_live_approved) <> 'ready' then
    raise exception 'buyer_progress: a buyer moved before any fact';
  end if;

  -- 1. A rating moves every live row of that buyer to rating_done.
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_by)
  values ('99999999-0000-4000-8000-0000000007e2', '99999999-0000-4000-8000-000000000721', 35, 'A2', 1, 'USD', '{}', '{}', 't',
          '99999999-0000-4000-8000-0000000007a2'),
         ('99999999-0000-4000-8000-0000000007e3', '99999999-0000-4000-8000-000000000722', 70, 'C1', 1, 'USD', '{}', '{}', 't',
          '99999999-0000-4000-8000-0000000007a2');
  perform set_config('tci.internal_call', '', true);
  if pg_temp.status_of(c_live_approved) <> 'rating_done' or pg_temp.status_of(c_live_declined) <> 'rating_done' then
    raise exception 'buyer_progress: a rating did not move the live rows (% / %)',
      pg_temp.status_of(c_live_approved), pg_temp.status_of(c_live_declined);
  end if;
  -- ... but never the row of a declined submission.
  if pg_temp.status_of(c_closed) <> 'ready' then
    raise exception 'buyer_progress: a closed submission moved';
  end if;

  -- 2. An approved credit decision inside the submission => limit_done;
  --    a declined one leaves the buyer at rating_done.
  perform tci.begin_trusted_call();
  insert into tci.credit_limit_requests (id, entity_id, insurance_request_id, requested_amount, currency_code, status, requested_by)
  values ('99999999-0000-4000-8000-0000000007c1', '99999999-0000-4000-8000-0000000007e2', '99999999-0000-4000-8000-0000000007b1',
          100000, 'USD', 'decided', '99999999-0000-4000-8000-0000000007a1'),
         ('99999999-0000-4000-8000-0000000007c2', '99999999-0000-4000-8000-0000000007e3', '99999999-0000-4000-8000-0000000007b1',
          50000, 'USD', 'decided', '99999999-0000-4000-8000-0000000007a1');
  insert into tci.credit_limit_decisions (request_id, outcome, approved_amount, currency_code, decided_by)
  values ('99999999-0000-4000-8000-0000000007c1', 'approved', 80000, 'USD', '99999999-0000-4000-8000-0000000007a2'),
         ('99999999-0000-4000-8000-0000000007c2', 'declined', null, 'USD', '99999999-0000-4000-8000-0000000007a2');
  perform set_config('tci.internal_call', '', true);
  if pg_temp.status_of(c_live_approved) <> 'limit_done' then
    raise exception 'buyer_progress: an approved decision did not give limit_done (%)', pg_temp.status_of(c_live_approved);
  end if;
  if pg_temp.status_of(c_live_declined) <> 'rating_done' then
    raise exception 'buyer_progress: a declined decision moved the buyer to %', pg_temp.status_of(c_live_declined);
  end if;

  -- 3. Forward only: a fresh rating never takes limit_done back.
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_by)
  values ('99999999-0000-4000-8000-0000000007e2', '99999999-0000-4000-8000-000000000721', 80, 'D1', 1, 'USD', '{}', '{}', 't',
          '99999999-0000-4000-8000-0000000007a2');
  perform set_config('tci.internal_call', '', true);
  if pg_temp.status_of(c_live_approved) <> 'limit_done' then
    raise exception 'buyer_progress: the status moved backwards';
  end if;

  -- 4. A buyer added already resolved picks up the facts at once.
  insert into tci.insurance_request_buyers (id, request_id, entity_id, requested_amount, resolution_status, created_by)
  values ('99999999-0000-4000-8000-0000000007d4', '99999999-0000-4000-8000-0000000007b1',
          '99999999-0000-4000-8000-0000000007e3', 10000, 'ready', '99999999-0000-4000-8000-0000000007a1');
  perform set_config('tci.internal_call', '', true);
  if pg_temp.status_of('99999999-0000-4000-8000-0000000007d4') <> 'rating_done' then
    raise exception 'buyer_progress: a resolved buyer added to the package did not pick up its rating';
  end if;

  -- 5. Not an API surface.
  perform set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000007a2", "role": "authenticated", "aal": "aal2"}', true);
  perform set_config('role', 'authenticated', true);
  begin
    perform tci.refresh_buyer_progress(null, '99999999-0000-4000-8000-0000000007e2');
    raise exception 'buyer_progress: refresh_buyer_progress is callable by an API role';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  raise notice 'buyer_progress: OK — rating => rating_done, approved credit decision => limit_done, declined stays, forward only, closed submissions untouched, resolved buyers pick up the facts, internal only';
end;
$$;

rollback;
