-- 0014_policy_annulled_status.sql
-- What: add reserve policy status 'annulled' and the transitions
--       active -> annulled and suspended -> annulled (terminal).
-- Why:  owner semantics: annulment voids the policy as if never concluded
--       (e.g. full premium return), distinct from 'cancelled' (расторжение:
--       terminated from a point in time; performance before it stands).
--       A comment is REQUIRED for annulment - enforced here in the status
--       machine function, not just hidden in the UI. 'draft' needs no
--       annulment path (a draft can simply stay draft or be deleted).
--
-- Note: the new enum value is only referenced inside the function body
-- (parsed at call time), so adding it and replacing the function in one
-- transaction is safe.

alter type tci.policy_status add value if not exists 'annulled';

create or replace function tci.change_policy_status(
  p_policy_id uuid,
  p_to_status tci.policy_status,
  p_comment   text default null
)
returns tci.policies
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_policy tci.policies%rowtype;
  v_from   tci.policy_status;
begin
  select * into v_policy from tci.policies where id = p_policy_id for update;
  if not found then
    raise exception 'policy % not found or not accessible', p_policy_id
      using errcode = 'P0002';
  end if;

  if not (
    (v_policy.status = 'draft'     and p_to_status = 'active')
    or (v_policy.status = 'active'    and p_to_status in ('suspended', 'cancelled', 'expired', 'annulled'))
    or (v_policy.status = 'suspended' and p_to_status in ('active', 'cancelled', 'annulled'))
  ) then
    raise exception 'invalid policy status transition: % -> %', v_policy.status, p_to_status
      using errcode = 'P0001';
  end if;

  if p_to_status = 'annulled' and (p_comment is null or btrim(p_comment) = '') then
    raise exception 'annulment requires a comment (reason for voiding the policy)'
      using errcode = 'P0001';
  end if;

  v_from := v_policy.status;

  update tci.policies
     set status = p_to_status
   where id = p_policy_id
   returning * into v_policy;

  insert into tci.policy_status_history (policy_id, from_status, to_status, comment)
  values (p_policy_id, v_from, p_to_status, p_comment);

  return v_policy;
end;
$$;
