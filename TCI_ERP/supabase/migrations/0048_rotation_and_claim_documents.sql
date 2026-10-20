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
