-- Tests for migration 0080: the portal does not list a limit request still in
-- draft (staff work never submitted); every other status still reaches it.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/client_no_staff_drafts.sql
--
-- One transaction, rolled back. The client impersonated.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000080a1', 'nd-sales@t'),
  ('99999999-0000-4000-8000-0000000080a2', 'nd-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000080a1', 'sales'),
  ('99999999-0000-4000-8000-0000000080a2', 'client');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000080a1', 'ND Sales', false),
  ('99999999-0000-4000-8000-0000000080a2', 'ND Client', false)
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000080a1"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000080e1', 'ND Holder', 'UZ', '99999999-0000-4000-8000-0000000080a1'),
  ('99999999-0000-4000-8000-0000000080e2', 'ND Buyer Draft', 'KZ', '99999999-0000-4000-8000-0000000080a1'),
  ('99999999-0000-4000-8000-0000000080e3', 'ND Buyer Sent', 'KZ', '99999999-0000-4000-8000-0000000080a1');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000080f1', '99999999-0000-4000-8000-0000000080e1', 'ND-P1', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 10000, 50000, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000080a1', 10000000);
update tci.policies set status = 'active' where id = '99999999-0000-4000-8000-0000000080f1';
insert into tci.policyholder_users (entity_id, user_id, created_by) values
  ('99999999-0000-4000-8000-0000000080e1', '99999999-0000-4000-8000-0000000080a2', '99999999-0000-4000-8000-0000000080a1');
insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by, submitted_at)
values
  ('99999999-0000-4000-8000-0000000080c1', '99999999-0000-4000-8000-0000000080f1', '99999999-0000-4000-8000-0000000080e2',
   100000, 'UZS', 'draft', '99999999-0000-4000-8000-0000000080a1', null),
  ('99999999-0000-4000-8000-0000000080c2', '99999999-0000-4000-8000-0000000080f1', '99999999-0000-4000-8000-0000000080e3',
   100000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000080a1', now());
select set_config('tci.internal_call', '', true);

do $$
declare v_ids uuid[];
begin
  perform set_config('request.jwt.claims',
    '{"sub": "99999999-0000-4000-8000-0000000080a2", "role": "authenticated", "aal": "aal2"}', true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
  select array_agg(id order by id) into v_ids from tci.v_client_limit_requests;
  perform set_config('role', 'postgres', true);
  if v_ids is null or '99999999-0000-4000-8000-0000000080c2'::uuid <> all (v_ids) then
    raise exception 'client_no_staff_drafts: the submitted request is not listed';
  end if;
  if '99999999-0000-4000-8000-0000000080c1'::uuid = any (v_ids) then
    raise exception 'client_no_staff_drafts: the staff draft reaches the portal';
  end if;
  raise notice 'client_no_staff_drafts: OK — a staff draft on the policyholder''s policy is not listed in the portal, a submitted request still is';
end $$;

rollback;
