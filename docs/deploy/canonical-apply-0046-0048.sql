-- TCI ERP: the remaining parts of migrations 0046-0048 for the canonical
-- project (reunqrpeumokqgarknge). Paste into Supabase -> SQL Editor -> Run.
-- It runs as ONE transaction: either all of it applies or none of it does.
-- What it deletes: nothing. DELETE/DROP appear only inside function bodies,
-- trigger definitions, a REVOKE of write privileges and DROP ... IF EXISTS
-- of a trigger, a function and two storage policies that are recreated
-- immediately below. Source of truth: TCI_ERP/supabase/migrations/.
--
-- Sections 1-4, 6 and part of 5 of 0046 were applied on 2026-10-19 through
-- the MCP tooling, which cannot send a statement containing DELETE/DROP
-- without an approval prompt this environment never shows. This script is
-- the rest, followed by each migration's closing assertions and its ledger
-- entry. Run it once; a second run fails harmlessly ("already exists") and
-- rolls back. Delete this file once it has been applied.
begin;

-- ===== 0046_login_gate: section 5 (rest) =====
-- An unlock also forgives the counted attempts; a bypass unlock forces the
-- password to be changed at the next sign-in (the administrator resets it
-- first - see docs/create-user.sql).
create or replace function tci.unlock_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_lock tci.auth_lockouts%rowtype; v_email text;
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
  select email into v_email from auth.users where id = p_user_id;
  if v_email is not null then
    update tci.login_attempts set status = 'forgiven', resolved_at = now()
     where email_hash = tci.login_email_hash(v_email) and status = 'pending';
  end if;
  if v_lock.reason = 'bypass' then
    update tci.user_profiles set must_change_password = true where user_id = p_user_id;
  end if;
  perform tci.log_auth_event('lockout.cleared', p_user_id, (select auth.uid()),
    jsonb_build_object('reason', v_lock.reason));
  return jsonb_build_object('result', 'unlocked', 'user_id', p_user_id, 'reason', v_lock.reason);
end;
$$;

-- Retention: login attempts are kept 30 days like auth_attempts.
create or replace function tci.prune_auth_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_events integer; v_attempts integer; v_logins integer; v_days integer;
begin
  perform tci.require_role('admin');
  v_days := (tci.auth_policy() ->> 'auth_events_retention_days')::int;
  delete from tci.auth_events where at < now() - make_interval(days => v_days);
  get diagnostics v_events = row_count;
  -- Attempts only matter inside the lockout window; 30 days keeps enough
  -- for the spike views without keeping a per-user sign-in history forever.
  delete from tci.auth_attempts where at < now() - interval '30 days';
  get diagnostics v_attempts = row_count;
  delete from tci.login_attempts where at < now() - interval '30 days';
  get diagnostics v_logins = row_count;
  delete from tci.auth_lockouts where coalesce(cleared_at, locked_until) < now() - interval '30 days';
  return jsonb_build_object('events_pruned', v_events, 'attempts_pruned', v_attempts + v_logins);
end;
$$;


-- ===== 0047_close_direct_writes: part 0 =====
-- What: close the direct REST writes that walked around the workflow
--       functions. (1) Tables whose every writer is a SECURITY DEFINER
--       function lose INSERT/UPDATE/DELETE for `authenticated`: claims and
--       their money (payments, recoveries, verdicts, invoices, documents,
--       status history), group limits, relationships and suggestions,
--       overdue notifications, workflow events and settings. (2) Tables
--       written by SECURITY INVOKER workflow functions - limit decisions,
--       decision conditions, policy and submission history - get a guard
--       trigger: an API role may write them only inside a transaction marked
--       by tci.begin_internal_call(), i.e. from inside those functions.
--       (3) A policy's status changes only through change_policy_status, and
--       a policy is created as a draft.
-- Why:  the 2026-10 review found that the authority, escalation, group-cap,
--       NQL, payment-cap and immutability rules enforced by the functions
--       could be skipped with a raw PATCH/POST: a credit underwriter could
--       insert a released decision of any amount, sales could reinstate a
--       revoked limit or backdate released_at, claims staff could set
--       approved_indemnity or insert payments past the cap. The functions
--       were the rule; the grants were the hole.
--
-- How the guard tells trusted code from a REST call: inside a SECURITY
-- DEFINER function current_user is the owner, so the guard only checks API
-- roles (authenticated, anon); for those it requires the per-transaction
-- internal-call token of 0043 (tci.internal_call_ok()), which a REST caller
-- cannot forge and which only begin_internal_call() / begin_trusted_call()
-- set. Every SECURITY INVOKER writer of a guarded table calls
-- begin_internal_call() before writing - two did not and are restated here.


-- ===== 0047_close_direct_writes: part 1 =====
-- ---------------------------------------------------------------------------
-- 1. The gate the guard calls
-- ---------------------------------------------------------------------------
create function tci.require_trusted_write()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not tci.internal_call_ok() then
    raise exception 'this table is written only through its workflow functions'
      using errcode = '42501';
  end if;
end;
$$;
comment on function tci.require_trusted_write() is
  'Raises 42501 unless the transaction carries the internal-call token. A gate: only raises.';
revoke execute on function tci.require_trusted_write() from public, anon;
grant execute on function tci.require_trusted_write() to authenticated, service_role;

create function tci.guard_workflow_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Owner code (SECURITY DEFINER writers, migrations, service_role) passes;
  -- an API role passes only from inside a trusted workflow function.
  if current_user in ('authenticated', 'anon') then
    perform tci.require_trusted_write();
  end if;
  return coalesce(new, old);
end;
$$;

-- Trigger functions are not called through the API; no role needs EXECUTE.
revoke execute on function tci.guard_workflow_write() from public, anon, authenticated;

create trigger guard_workflow_write before insert or update or delete on tci.credit_limit_decisions
  for each row execute function tci.guard_workflow_write();
create trigger guard_workflow_write before insert or update or delete on tci.decision_conditions
  for each row execute function tci.guard_workflow_write();
create trigger guard_workflow_write before insert or update or delete on tci.policy_status_history
  for each row execute function tci.guard_workflow_write();
create trigger guard_workflow_write before insert or update or delete on tci.insurance_request_history
  for each row execute function tci.guard_workflow_write();

-- A policy's status is the status machine's: terms are edited directly,
-- the status never is, and a new policy starts as a draft.
create function tci.guard_policy_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.status <> 'draft' then
      perform tci.require_trusted_write();
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      perform tci.require_trusted_write();
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function tci.guard_policy_status() from public, anon, authenticated;
create trigger guard_policy_status before insert or update on tci.policies
  for each row execute function tci.guard_policy_status();


-- ===== 0047_close_direct_writes: part 2 =====
-- ---------------------------------------------------------------------------
-- 2. The two INVOKER writers that did not mark the transaction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tci.change_policy_status(p_policy_id uuid, p_to_status tci.policy_status, p_comment text DEFAULT NULL::text)
 RETURNS tci.policies
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_policy tci.policies%rowtype;
  v_from   tci.policy_status;
begin
  -- 0047: the status machine is the only path to a status change; it marks
  -- the transaction so the guard triggers let its writes through.
  perform tci.begin_internal_call();
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
$function$
;


CREATE OR REPLACE FUNCTION tci.revoke_effective_limit(p_policy_id uuid, p_entity_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_effective tci.credit_limit_decisions%rowtype;
  v_new tci.credit_limit_decisions%rowtype;
  v_band tci.grade_band;
begin
  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may revoke' using errcode = '42501';
  end if;
  -- 0047: mark the transaction trusted for the guard on credit_limit_decisions.
  perform tci.begin_internal_call();

  select d.* into v_effective
  from tci.credit_limit_decisions d
  join tci.credit_limit_requests r on r.id = d.request_id
  where r.policy_id = p_policy_id and r.entity_id = p_entity_id
    and d.lifecycle = 'effective'
    and d.outcome in ('approved', 'partial')
  order by d.decided_at desc
  limit 1
  for update of d;
  if not found then
    raise exception 'no effective approved limit for this (policy, entity)'
      using errcode = 'P0002';
  end if;

  -- The band of the limit being revoked decides which authority applies.
  v_band := tci.grade_band_for_assessment(v_effective.based_on_assessment_id);

  if not tci.has_role('admin')
     and tci.to_uzs(v_effective.approved_amount, v_effective.currency_code)
         > tci.my_authority_uzs(v_band) then
    raise exception 'revoking this limit exceeds your authority for grade band %', v_band
      using errcode = '42501';
  end if;

  update tci.credit_limit_decisions set lifecycle = 'revoked_lc' where id = v_effective.id;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, comment
  ) values (
    v_effective.request_id, 'revoked', 0, v_effective.currency_code, current_date, p_comment
  ) returning * into v_new;

  return jsonb_build_object('result', 'revoked', 'decision_id', v_new.id, 'grade_band', v_band);
end;
$function$
;



-- ===== 0047_close_direct_writes: part 3 =====
-- ---------------------------------------------------------------------------
-- 3. No direct writes where every writer is a SECURITY DEFINER function
-- ---------------------------------------------------------------------------
-- The write POLICIES stay (they are inert without the grant and document the
-- original intent); the GRANT is what PostgREST checks first.
revoke insert, update, delete on
  tci.claims, tci.claim_payments, tci.recoveries, tci.claim_invoice_verdicts,
  tci.claim_invoices, tci.claim_documents, tci.claim_status_history,
  tci.group_limits, tci.entity_relationships, tci.entity_relationship_suggestions,
  tci.overdue_notifications, tci.workflow_events, tci.workflow_settings
from authenticated, anon;


-- ===== 0047_close_direct_writes: part 4 =====
-- ---------------------------------------------------------------------------
-- 4. The allow-list gains the new gate
-- ---------------------------------------------------------------------------
create or replace function tci.definer_gate_allowlist()
returns table (proname text, justification text)
language sql
immutable
parallel safe
set search_path = ''
as $$
  values
    ('has_role',                 'reads only the caller''s own tci.user_roles rows; it IS the gate'),
    ('is_staff',                 'reads only the caller''s own tci.user_roles rows; it IS the gate'),
    ('current_user_roles',       'returns only the caller''s own roles'),
    ('password_rotation_pending','reads only the caller''s own profile flag; part of the gate'),
    ('complete_password_change', 'writes only the caller''s own profile row, keyed by auth.uid()'),
    ('sales_window_hours',       'one non-sensitive workflow_settings number, needed by views a client reads'),
    ('group_depth_cap',          'one non-sensitive workflow_settings number'),
    ('group_exposure_warn_pct',  'one non-sensitive workflow_settings number'),
    ('decision_is_released',     'pure computation over its arguments and the sales window; no table read'),
    ('begin_internal_call',      'is itself gated on is_staff(); the token it sets dies with the transaction'),
    ('require_staff',            'a gate: only raises'),
    ('require_role',             'a gate: only raises'),
    ('require_claim_access',     'a gate: only raises'),
    ('auth_policy',              'non-sensitive policy numbers the UI mirrors to explain a refusal'),
    ('mfa_satisfied',            'reads only the caller''s own factors, roles and JWT claims; part of the gate'),
    ('my_auth_status',           'reads only the caller''s own rotation, MFA and lockout state'),
    ('login_begin',              'pre-sign-in entry point: salted hashes only, names no account (see pre_auth_entry_points)'),
    ('my_sign_in_notice',        'reads only the caller''s own sign-in attempts, keyed by auth.uid()'),
    ('require_trusted_write',    'a gate: only raises (the guard on workflow-written tables)')
$$;


-- ===== 0048_rotation_and_claim_documents: part 0 =====
-- What: three gaps the 2026-10 security review left for last.
--       (1) Rotating a temporary password must actually change it.
--           user_profiles.temp_password_hash records a salted hash of the
--           auth.users password hash whenever must_change_password is
--           (re)set, and complete_password_change refuses while the
--           current password still matches it.
--       (2) A claim document is registered from what Storage holds, not
--           from what the browser says: the object must exist under the
--           claim's folder, belong to the caller, and its size and type
--           are read from storage.objects.metadata.
--       (3) Storage cleanup: the uploader may remove their own object
--           once it is not (or no longer) registered, and the "claims may
--           replace" policy re-checks the claim on the NEW path.
-- Why:  (1) complete_password_change cleared the flag on request, so a
--           POST to /rpc/complete_password_change walked past the forced
--           rotation keeping the temporary password the administrator
--           had seen. (2) register_claim_document trusted p_size_bytes
--           and p_content_type and never looked for the object, so a
--           register row could describe a file that does not exist, or
--           a 1 GB executable as a 10 KB PDF. (3) A non-claims uploader
--           could not delete their own refused upload (the client's
--           clean-up silently failed, leaving orphans readable to
--           everyone with access to the claim), and an UPDATE could move
--           an object to a path under another claim.
--
-- Supabase refuses DELETE on storage.objects from SQL
-- (storage.protect_delete), and a row removed there would leave the bytes
-- in the object store anyway. The file is therefore removed through the
-- Storage API by the client, and this migration only makes sure the
-- policies let the right person do it.


-- ===== 0048_rotation_and_claim_documents: part 1 =====
-- ---------------------------------------------------------------------------
-- 1. Rotation must change the password
-- ---------------------------------------------------------------------------
alter table tci.user_profiles add column if not exists temp_password_hash text;

comment on column tci.user_profiles.temp_password_hash is
  'tci.security_hash of auth.users.encrypted_password at the moment must_change_password was set. complete_password_change refuses while the password still hashes to it. Never readable through the API.';

-- The column is not for anyone to read, not even its owner.
revoke select (temp_password_hash) on tci.user_profiles from authenticated, anon;
do $$
begin
  -- a table-level SELECT would make the column revoke meaningless: replace it
  -- with column grants for everything but the hash
  if has_table_privilege('authenticated', 'tci.user_profiles', 'select') then
    revoke select on tci.user_profiles from authenticated, anon;
    execute (
      select format('grant select (%s) on tci.user_profiles to authenticated',
                    string_agg(quote_ident(attname), ', ' order by attnum))
        from pg_attribute
       where attrelid = 'tci.user_profiles'::regclass and attnum > 0 and not attisdropped
         and attname <> 'temp_password_hash');
  end if;
end;
$$;

-- SECURITY DEFINER: it reads auth.users, which no API role may. A trigger
-- function, closed to every API role (it is never called through SQL).
create or replace function tci.capture_temp_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.must_change_password then
    new.temp_password_hash := (
      select tci.security_hash(u.encrypted_password)
        from auth.users u
       where u.id = new.user_id and u.encrypted_password is not null and u.encrypted_password <> '');
  else
    new.temp_password_hash := null;
  end if;
  return new;
end;
$$;
revoke all on function tci.capture_temp_password() from public, anon, authenticated;

-- UPDATE OF fires whenever the column is in the SET list, even unchanged:
-- both reset paths (users.py and create-user.sql) re-write the flag after
-- setting the new temporary password, so the hash is always the latest.
drop trigger if exists capture_temp_password on tci.user_profiles;
create trigger capture_temp_password
  before insert or update of must_change_password on tci.user_profiles
  for each row execute function tci.capture_temp_password();

-- Accounts already waiting to rotate get their hash now.
update tci.user_profiles set must_change_password = true where must_change_password;

create or replace function tci.complete_password_change()
returns tci.user_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.user_profiles%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if exists (
    select 1
      from tci.user_profiles p
      join auth.users u on u.id = p.user_id
     where p.user_id = (select auth.uid())
       and p.must_change_password
       and p.temp_password_hash is not null
       and p.temp_password_hash = tci.security_hash(u.encrypted_password)
  ) then
    raise exception 'password_unchanged: the temporary password has not been changed'
      using errcode = 'P0001';
  end if;

  insert into tci.user_profiles (user_id, must_change_password, password_changed_at)
  values ((select auth.uid()), false, now())
  on conflict (user_id) do update
    set must_change_password = false,
        password_changed_at = now()
  returning * into v_row;

  perform tci.log_auth_event('password.changed', (select auth.uid()), (select auth.uid()));
  return v_row;
end;
$$;


-- ===== 0048_rotation_and_claim_documents: part 2 =====
-- ---------------------------------------------------------------------------
-- 2. Register a claim document from what Storage actually holds
-- ---------------------------------------------------------------------------
-- The signature is kept (the client still sends size and type, and older
-- clients keep working); the two values are now ignored in favour of the
-- object's own metadata, which Storage measured and checked against the
-- bucket's allowed types and size limit on upload.
create or replace function tci.register_claim_document(
  p_claim_id      uuid,
  p_storage_path  text,
  p_document_type tci.claim_document_type,
  p_filename      text,
  p_size_bytes    bigint,
  p_content_type  text,
  p_note          text default null
)
returns tci.claim_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     tci.claim_documents%rowtype;
  v_allowed text[];
  v_object  record;
  v_size    bigint;
  v_type    text;
begin
  if not tci.may_upload_to_claim(p_claim_id) then
    raise exception 'not permitted to add documents to this claim' using errcode = '42501';
  end if;
  if tci.claim_id_from_storage_path(p_storage_path) is distinct from p_claim_id then
    raise exception 'a claim document must live under claims/%/', p_claim_id
      using errcode = 'P0001';
  end if;

  -- The object must exist and be the caller's own upload: registering a
  -- path nobody uploaded, or someone else's file, is refused.
  select o.metadata, o.owner_id into v_object
    from storage.objects o
   where o.bucket_id = 'claim-documents' and o.name = p_storage_path;
  if not found then
    raise exception 'the uploaded file was not found in storage' using errcode = 'P0002';
  end if;
  if v_object.owner_id is distinct from (select auth.uid())::text then
    raise exception 'only the uploader may register a file' using errcode = '42501';
  end if;
  if exists (select 1 from tci.claim_documents d where d.storage_path = p_storage_path) then
    raise exception 'this file is already registered' using errcode = 'P0001';
  end if;

  v_size := nullif(v_object.metadata ->> 'size', '')::bigint;
  v_type := v_object.metadata ->> 'mimetype';

  if coalesce(v_size, 0) <= 0 or v_size > 20971520 then
    raise exception 'a claim document must be between 1 byte and 20 MiB'
      using errcode = 'P0001';
  end if;

  select allowed_mime_types into v_allowed from storage.buckets where id = 'claim-documents';
  if v_type is null or not (v_type = any (v_allowed)) then
    raise exception 'this file type is not accepted for claim documents'
      using errcode = 'P0001';
  end if;
  -- The extension has to agree with the stored type's family. It is a weak
  -- check by construction - neither side is the bytes - but a .exe stored
  -- as application/pdf is worth refusing anyway.
  if p_filename !~* '\.(pdf|jpe?g|png|tiff?|webp|docx?|xlsx?|csv|txt)$' then
    raise exception 'this file extension is not accepted for claim documents'
      using errcode = 'P0001';
  end if;

  insert into tci.claim_documents (
    claim_id, storage_path, document_type, original_filename,
    size_bytes, content_type, note
  ) values (
    p_claim_id, p_storage_path, p_document_type, p_filename,
    v_size, v_type, p_note
  ) returning * into v_row;

  return v_row;
end;
$$;

-- delete_claim_document now returns the storage path, so the client can
-- remove the bytes through the Storage API (SQL may not, see the header).
drop function if exists tci.delete_claim_document(uuid);
create function tci.delete_claim_document(p_document_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_doc tci.claim_documents%rowtype;
begin
  select * into v_doc from tci.claim_documents where id = p_document_id;
  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  -- The uploader may take back their own file while the claim is still theirs
  -- to assemble; claims may remove anything.
  if not (tci.has_role('claims', 'admin')
          or (v_doc.uploaded_by = (select auth.uid())
              and tci.may_upload_to_claim(v_doc.claim_id))) then
    raise exception 'not permitted to remove this document' using errcode = '42501';
  end if;
  delete from tci.claim_documents where id = p_document_id;
  return v_doc.storage_path;
end;
$$;
revoke all on function tci.delete_claim_document(uuid) from public, anon;
grant execute on function tci.delete_claim_document(uuid) to authenticated, service_role;


-- ===== 0048_rotation_and_claim_documents: part 3 =====
-- ---------------------------------------------------------------------------
-- 3. Storage policies
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because the uploader may not be able to read
-- tci.claim_documents (clients never read base tables). Allow-listed: it
-- returns one boolean about the caller's own upload and nothing else.
create or replace function tci.may_remove_claim_object(p_name text, p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner_id is not distinct from (select auth.uid())::text
     and tci.may_upload_to_claim(tci.claim_id_from_storage_path(p_name))
     and not exists (select 1 from tci.claim_documents d where d.storage_path = p_name)
$$;
revoke all on function tci.may_remove_claim_object(text, text) from public, anon;
grant execute on function tci.may_remove_claim_object(text, text) to authenticated, service_role;

drop policy if exists "claim documents: uploader may remove own unregistered" on storage.objects;
create policy "claim documents: uploader may remove own unregistered"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'claim-documents'
    and tci.may_remove_claim_object(name, owner_id)
  );

drop policy if exists "claim documents: claims may replace" on storage.objects;
create policy "claim documents: claims may replace"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'claim-documents'
    and tci.has_role('claims', 'admin')
    and tci.may_access_claim(tci.claim_id_from_storage_path(name))
  )
  with check (
    bucket_id = 'claim-documents'
    and tci.has_role('claims', 'admin')
    and tci.may_access_claim(tci.claim_id_from_storage_path(name))
  );


-- ===== 0048_rotation_and_claim_documents: part 4 =====
-- ---------------------------------------------------------------------------
-- 4. The allow-list gains the storage predicate
-- ---------------------------------------------------------------------------
create or replace function tci.definer_gate_allowlist()
returns table (proname text, justification text)
language sql
immutable
parallel safe
set search_path = ''
as $$
  values
    ('has_role',                 'reads only the caller''s own tci.user_roles rows; it IS the gate'),
    ('is_staff',                 'reads only the caller''s own tci.user_roles rows; it IS the gate'),
    ('current_user_roles',       'returns only the caller''s own roles'),
    ('password_rotation_pending','reads only the caller''s own profile flag; part of the gate'),
    ('complete_password_change', 'writes only the caller''s own profile row, keyed by auth.uid()'),
    ('sales_window_hours',       'one non-sensitive workflow_settings number, needed by views a client reads'),
    ('group_depth_cap',          'one non-sensitive workflow_settings number'),
    ('group_exposure_warn_pct',  'one non-sensitive workflow_settings number'),
    ('decision_is_released',     'pure computation over its arguments and the sales window; no table read'),
    ('begin_internal_call',      'is itself gated on is_staff(); the token it sets dies with the transaction'),
    ('require_staff',            'a gate: only raises'),
    ('require_role',             'a gate: only raises'),
    ('require_claim_access',     'a gate: only raises'),
    ('auth_policy',              'non-sensitive policy numbers the UI mirrors to explain a refusal'),
    ('mfa_satisfied',            'reads only the caller''s own factors, roles and JWT claims; part of the gate'),
    ('my_auth_status',           'reads only the caller''s own rotation, MFA and lockout state'),
    ('login_begin',              'pre-sign-in entry point: salted hashes only, names no account (see pre_auth_entry_points)'),
    ('my_sign_in_notice',        'reads only the caller''s own sign-in attempts, keyed by auth.uid()'),
    ('require_trusted_write',    'a gate: only raises (the guard on workflow-written tables)'),
    ('may_remove_claim_object',  'a storage-policy predicate: true only for the caller''s own unregistered upload to a claim they may upload to')
$$;


-- ===== 0046_login_gate: closing assertions =====
-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  -- the schedule
  if tci.login_lock_seconds(2, 3, 30, 3600) <> 0 or tci.login_lock_seconds(3, 3, 30, 3600) <> 30
     or tci.login_lock_seconds(4, 3, 30, 3600) <> 60 or tci.login_lock_seconds(9, 3, 30, 3600) <> 1920
     or tci.login_lock_seconds(10, 3, 30, 3600) <> 3600 or tci.login_lock_seconds(99, 3, 30, 3600) <> 3600 then
    raise exception '0046: login_lock_seconds does not follow the schedule';
  end if;

  -- anon executes exactly the pre-auth entry points, and nothing in tci else
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select proname from tci.pre_auth_entry_points());
  if v_bad is not null then
    raise exception '0046: anon can execute tci functions beyond the pre-auth entry points: %', v_bad;
  end if;
  if not has_function_privilege('anon', 'tci.login_begin(text)', 'execute') then
    raise exception '0046: anon cannot start a sign-in';
  end if;

  -- anon still reads no table or view
  if exists (select 1 from information_schema.role_table_grants
              where grantee = 'anon' and table_schema = 'tci') then
    raise exception '0046: anon holds a table grant in tci';
  end if;

  -- the hook is GoTrue's alone
  if has_function_privilege('authenticated', 'tci.custom_access_token_hook(jsonb)', 'execute')
     or has_function_privilege('anon', 'tci.custom_access_token_hook(jsonb)', 'execute')
     or not has_function_privilege('supabase_auth_admin', 'tci.custom_access_token_hook(jsonb)', 'execute') then
    raise exception '0046: custom_access_token_hook grants are wrong';
  end if;
  if (select prosrc from pg_proc where pronamespace = 'tci'::regnamespace and proname = 'custom_access_token_hook')
       not like '%perform tci.require_auth_admin()%' then
    raise exception '0046: custom_access_token_hook is not gated';
  end if;

  -- the attempts table is closed
  if has_table_privilege('authenticated', 'tci.login_attempts', 'select')
     or has_table_privilege('anon', 'tci.login_attempts', 'select') then
    raise exception '0046: login_attempts is readable by an API role';
  end if;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261019120000', '0046_login_gate', array['-- applied from TCI_ERP/supabase/migrations/0046_login_gate.sql (see the header of docs/deploy/canonical-apply-0046-0048.sql)']);

-- ===== 0047_close_direct_writes: closing assertions =====
-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  -- authenticated writes directly only the tables the application edits
  -- (forms, spreading, admin reference data) and the guarded ones.
  select string_agg(distinct g.table_name, ', ') into v_bad
    from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name and c.relnamespace = 'tci'::regnamespace and c.relkind = 'r'
   where g.grantee in ('authenticated', 'anon') and g.table_schema = 'tci'
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
     and g.table_name not in (
       -- edited by the application directly (RLS decides the rows)
       'authority_grants', 'balance_sheets', 'credit_assessments', 'credit_limit_requests',
       'declaration_lines', 'declarations', 'financial_statements', 'fx_rates', 'income_statements',
       'insurance_request_buyers', 'insurance_requests', 'legal_entities', 'local_statement_values',
       'policies', 'premium_instalments', 'user_roles',
       -- admin reference data and mappings
       'countries', 'currencies', 'industries', 'ifrs_mappings', 'statement_templates',
       'statement_template_lines', 'policyholder_users', 'client_buyer_proposals',
       -- written by INVOKER workflow functions, behind guard_workflow_write
       'credit_limit_decisions', 'decision_conditions', 'policy_status_history', 'insurance_request_history');
  if v_bad is not null then
    raise exception '0047: authenticated can write workflow tables directly: %', v_bad;
  end if;

  -- anon still executes nothing in tci but the pre-auth entry points
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select proname from tci.pre_auth_entry_points());
  if v_bad is not null then
    raise exception '0047: anon can execute: %', v_bad;
  end if;

  -- every guarded table carries the guard
  select string_agg(t, ', ') into v_bad
    from unnest(array['credit_limit_decisions', 'decision_conditions', 'policy_status_history',
                      'insurance_request_history']) t
   where not exists (select 1 from pg_trigger tg
                      where tg.tgrelid = ('tci.' || t)::regclass and tg.tgname = 'guard_workflow_write');
  if v_bad is not null then
    raise exception '0047: guard missing on: %', v_bad;
  end if;

  -- every INVOKER function that writes a guarded table marks the transaction
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and not p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+tci\.(credit_limit_decisions|decision_conditions|policy_status_history|insurance_request_history)\M'
     and p.prosrc !~ 'begin_internal_call\(\)';
  if v_bad is not null then
    raise exception '0047: invoker writers of guarded tables that do not mark the transaction: %', v_bad;
  end if;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261019120100', '0047_close_direct_writes', array['-- applied from TCI_ERP/supabase/migrations/0047_close_direct_writes.sql (see the header of docs/deploy/canonical-apply-0046-0048.sql)']);

-- ===== 0048_rotation_and_claim_documents: closing assertions =====
-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  if has_column_privilege('authenticated', 'tci.user_profiles', 'temp_password_hash', 'select') then
    raise exception '0048: authenticated can read temp_password_hash';
  end if;
  if has_function_privilege('authenticated', 'tci.capture_temp_password()', 'execute') then
    raise exception '0048: the capture trigger function is executable through the API';
  end if;
  if position('password_unchanged' in pg_get_functiondef('tci.complete_password_change()'::regprocedure)) = 0 then
    raise exception '0048: complete_password_change does not check the password changed';
  end if;
  if position('p_size_bytes, p_content_type' in pg_get_functiondef(
       'tci.register_claim_document(uuid, text, tci.claim_document_type, text, bigint, text, text)'::regprocedure)) > 0 then
    raise exception '0048: register_claim_document still stores the client-declared size and type';
  end if;

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select proname from tci.pre_auth_entry_points());
  if v_bad is not null then
    raise exception '0048: anon can execute: %', v_bad;
  end if;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261019120200', '0048_rotation_and_claim_documents', array['-- applied from TCI_ERP/supabase/migrations/0048_rotation_and_claim_documents.sql (see the header of docs/deploy/canonical-apply-0046-0048.sql)']);

commit;
