-- What: expose tci.policies.noa_window_days through tci.v_client_policies.
-- Why:  the portal computes the notification deadline BEFORE the policyholder
--       files, so they are warned while they can still act rather than after.
--       That sum needs the window, and 0025 predates the column. Without it
--       the screen would have to hardcode the 30-day default, which is a
--       magic number that silently stops matching the policy the moment
--       anyone changes it.
--
-- Additive: one more column on a view the client already reads. Nothing about
-- what a client may see changes - the window is a term of their own policy.

create or replace view tci.v_client_policies as
select
  p.id,
  p.entity_id,
  e.name              as entity_name,
  p.policy_number,
  p.status,
  p.product_structure,
  p.inception_date,
  p.expiry_date,
  p.currency_code,
  p.insured_percentage,
  p.max_liability_amount,
  p.max_liability_premium_multiple,
  p.nql_amount,
  p.deductible_each_loss,
  p.aggregate_first_loss,
  p.premium_rate_pct,
  p.minimum_premium,
  p.estimated_annual_turnover,
  p.discretionary_limit,
  p.waiting_period_days,
  p.max_extension_period_days,
  p.max_payment_terms_days,
  p.declaration_frequency,
  -- New in Phase 4: the notification window, so the portal can show the
  -- deadline for reporting an overdue account.
  p.noa_window_days
from tci.policies p
join tci.legal_entities e on e.id = p.entity_id
where p.entity_id in (select tci.my_client_entities());

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'tci' and table_name = 'v_client_policies'
       and column_name = 'noa_window_days'
  ) then
    raise exception 'v_client_policies is missing noa_window_days';
  end if;
end
$$;
