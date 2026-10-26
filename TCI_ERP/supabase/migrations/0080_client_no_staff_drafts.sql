-- What: the portal's limit request list (tci.v_client_limit_requests) no
--       longer shows a request still in DRAFT.
-- Why:  a draft is staff work in progress — raised on the policyholder's
--       policy but never submitted — and nothing in it is the policyholder's
--       to answer: they may neither amend nor withdraw a draft (0075), so it
--       sat under «Waiting on us» with no action and no explanation (owner,
--       2026-10-26: Khorezm Agro Export MChJ). It reaches the portal once it
--       is submitted, as before. Same columns, so `create or replace`.

create or replace view tci.v_client_limit_requests as
 select r.id,
    'request'::text as kind,
    r.policy_id,
    p.policy_number,
    r.entity_id as buyer_id,
    b.name as buyer_name,
    null::text as proposed_name,
    r.requested_amount,
    r.currency_code,
    r.requested_payment_terms_days,
    r.justification,
    r.status::text as status,
    r.created_at,
    r.decided_at,
    tci.client_request_amendable(r.status::text) as may_amend,
    tci.client_request_open(r.status::text) as may_withdraw,
    (select max(a.amended_at) from tci.limit_request_amendments a where a.request_id = r.id) as amended_at,
    r.replaces_request_id
   from tci.credit_limit_requests r
     join tci.policies p on p.id = r.policy_id
     join tci.legal_entities b on b.id = r.entity_id
  where p.entity_id in (select tci.my_client_entities())
    and r.status <> 'draft'
union all
 select pr.id,
    'proposal'::text as kind,
    pr.policy_id,
    p.policy_number,
    pr.resolved_entity_id as buyer_id,
    null::text as buyer_name,
    pr.proposed_name,
    pr.requested_amount,
    pr.currency_code,
    pr.requested_payment_terms_days,
    pr.justification,
    pr.status,
    pr.created_at,
    pr.resolved_at as decided_at,
    tci.client_request_amendable(pr.status) as may_amend,
    tci.client_request_open(pr.status) as may_withdraw,
    (select max(a.amended_at) from tci.limit_request_amendments a where a.proposal_id = pr.id) as amended_at,
    null::uuid as replaces_request_id
   from tci.client_buyer_proposals pr
     join tci.policies p on p.id = pr.policy_id
  where p.entity_id in (select tci.my_client_entities());

do $$
begin
  if pg_get_viewdef('tci.v_client_limit_requests'::regclass) !~ $re$status <> 'draft'$re$ then
    raise exception '0080: v_client_limit_requests still shows drafts';
  end if;
end $$;
