-- What: tci.unlock_account refuses (P0002) unless a lockout is ACTIVE.
-- Why:  0044 looked the lockout row up by user only. A row stays behind as
--       history once it is cleared or has expired, so unlocking the same
--       account twice "succeeded" twice: a second lockout.cleared event, a
--       second forgiveness of the failures, and no signal to the admin that
--       there was nothing to clear. Caught by the canonical smoke; the local
--       test only tried a user that had never been locked.
create or replace function tci.unlock_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_lock tci.auth_lockouts%rowtype;
begin
  perform tci.require_role('admin');
  select * into v_lock from tci.auth_lockouts
   where user_id = p_user_id
     and cleared_at is null
     and locked_until > now()
   for update;
  if not found then
    raise exception 'this account is not locked' using errcode = 'P0002';
  end if;
  update tci.auth_lockouts
     set cleared_at = now(), cleared_by = (select auth.uid())
   where user_id = p_user_id;
  delete from tci.auth_attempts
   where subject_hash = v_lock.subject_hash and outcome in ('failure', 'mfa_failure');
  perform tci.log_auth_event('lockout.cleared', p_user_id, (select auth.uid()));
  return jsonb_build_object('result', 'unlocked', 'user_id', p_user_id);
end;
$$;

do $$
begin
  if (select prosrc from pg_proc where pronamespace = 'tci'::regnamespace and proname = 'unlock_account')
       not like '%cleared_at is null%' then
    raise exception '0045: unlock_account does not require an active lockout';
  end if;
end;
$$;
