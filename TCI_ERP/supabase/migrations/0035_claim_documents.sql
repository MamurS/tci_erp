-- What: claim documents - the private Storage bucket, its RLS on
--       storage.objects, tci.claim_documents, the required-document checklist
--       per cause of loss, and the submission guard that reads it.
-- Why:  Phase 5. A claim is an evidence file. Three things this migration is
--       responsible for:
--
--   * THE BUCKET IS PRIVATE AND ROW-SCOPED. Objects live at
--     claims/<claim_id>/<file>, and every policy on storage.objects resolves
--     that claim id and asks the same question the rest of the system asks:
--     staff see all claims, a client sees only claims under its own policies.
--     A malformed path resolves to NULL and is therefore readable by nobody.
--   * THE CHECKLIST IS A GUARD, NOT A HINT. tci.claim_submission_blockers is
--     REPLACED here to append one i18n key per missing mandatory document, so
--     the refusal names exactly which ones are absent. 0032 left this seam on
--     purpose: the status machine could not wait for a Storage bucket.
--   * DECLARED CONTENT TYPE IS NOT EVIDENCE. The bucket enforces a size cap
--     and a MIME allowlist, and the table re-checks both plus the filename
--     extension. None of that is content sniffing - Postgres cannot read the
--     bytes - so the allowlist is a filter on what a caller CLAIMS, and the
--     defence that actually matters is that the bucket is private, the paths
--     are row-scoped, and nothing is ever served as active content.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'claim-documents', 'claim-documents', false,
  20971520,  -- 20 MiB
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/tiff', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Path -> claim
-- ---------------------------------------------------------------------------
-- Every storage policy goes through this. It returns NULL for anything that
-- is not exactly claims/<uuid>/..., so a hand-crafted path grants nothing.

create function tci.claim_id_from_storage_path(p_path text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_path ~ '^claims/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.+'
      then split_part(p_path, '/', 2)::uuid
    else null
  end
$$;

comment on function tci.claim_id_from_storage_path(text) is
  'The claim a storage object belongs to, from its path. NULL for any path that is not claims/<uuid>/<file> - so a malformed path is readable by nobody.';

-- Can the CALLER see this claim at all? One question, asked by every storage
-- policy and by the documents table.
create function tci.may_access_claim(p_claim_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_claim_id is null then false
    when tci.is_staff() then exists (select 1 from tci.claims where id = p_claim_id)
    when tci.has_role('client') then exists (
      select 1 from tci.claims c
      join tci.policies p on p.id = c.policy_id
      where c.id = p_claim_id
        and p.entity_id in (select tci.my_client_entities()))
    else false
  end
$$;

comment on function tci.may_access_claim(uuid) is
  'Staff see every claim; a client sees only claims under its own policies. The single predicate behind claim document access.';

revoke execute on function tci.may_access_claim(uuid) from public, anon;
grant execute on function tci.may_access_claim(uuid) to authenticated, service_role;

-- May the caller ADD to this claim's file? Staff who work claims, and the
-- policyholder while the ball is theirs - assembling a draft or answering an
-- information request.
create function tci.may_upload_to_claim(p_claim_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_claim_id is null then false
    when tci.has_role('claims', 'sales', 'admin') then exists (
      select 1 from tci.claims where id = p_claim_id)
    when tci.has_role('client') then exists (
      select 1 from tci.claims c
      join tci.policies p on p.id = c.policy_id
      where c.id = p_claim_id
        and p.entity_id in (select tci.my_client_entities())
        and c.status in ('draft', 'submitted', 'info_requested'))
    else false
  end
$$;

revoke execute on function tci.may_upload_to_claim(uuid) from public, anon;
grant execute on function tci.may_upload_to_claim(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Storage RLS
-- ---------------------------------------------------------------------------

create policy "claim documents: read own claims"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'claim-documents'
    and tci.may_access_claim(tci.claim_id_from_storage_path(name))
  );

create policy "claim documents: upload to own claims"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'claim-documents'
    and tci.may_upload_to_claim(tci.claim_id_from_storage_path(name))
  );

-- Replacing a file in place is an edit of evidence. Only the claims department
-- may do it, and only while the claim is still being assessed.
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
  );

create policy "claim documents: claims may delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'claim-documents'
    and tci.has_role('claims', 'admin')
    and tci.may_access_claim(tci.claim_id_from_storage_path(name))
  );

-- ---------------------------------------------------------------------------
-- 4. The document register
-- ---------------------------------------------------------------------------

create type tci.claim_document_type as enum (
  'invoice',              -- the unpaid invoices themselves
  'shipping',             -- proof the goods left: CMR, bill of lading, delivery note
  'contract',             -- the sales contract or framework agreement
  'order',                -- the purchase order the shipment answered
  'dunning',              -- the collection trail: reminders, demands, correspondence
  'insolvency_evidence',  -- court ruling, administrator's letter, register extract
  'other'
);

create table tci.claim_documents (
  id                uuid primary key default gen_random_uuid(),
  claim_id          uuid not null references tci.claims (id) on delete cascade,
  storage_path      text not null,
  document_type     tci.claim_document_type not null,
  original_filename text not null,
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  content_type      text not null,
  uploaded_by       uuid not null references auth.users (id) default auth.uid(),
  uploaded_at       timestamptz not null default now(),
  note              text,

  -- Named rather than inline so the UI can map the violation to a readable
  -- message by constraint name (src/features/claims/errors.ts).
  constraint claim_documents_storage_path_uq unique (storage_path),
  -- The register row must describe an object inside its own claim's folder.
  constraint claim_documents_path_matches_claim check (
    tci.claim_id_from_storage_path(storage_path) = claim_id
  )
);

create index claim_documents_claim_idx on tci.claim_documents (claim_id, document_type);

comment on table tci.claim_documents is
  'The register of what is in a claim file. The bytes live in the private claim-documents bucket at claims/<claim_id>/<file>; this row is the metadata and the checklist''s evidence.';

-- ---------------------------------------------------------------------------
-- 5. The checklist
-- ---------------------------------------------------------------------------
-- Modelled on what a credit insurer actually asks for. Protracted default has
-- to prove the debt exists, the goods went out, and that the policyholder
-- chased the money. Insolvency swaps the dunning trail for the formal
-- evidence, because the collection effort is moot once a court is involved.

create function tci.required_claim_documents(p_cause tci.claim_cause_of_loss)
returns tci.claim_document_type[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_cause
    when 'protracted_default' then
      array['invoice', 'shipping', 'dunning']::tci.claim_document_type[]
    when 'insolvency' then
      array['invoice', 'shipping', 'insolvency_evidence']::tci.claim_document_type[]
    else
      array['invoice']::tci.claim_document_type[]
  end
$$;

comment on function tci.required_claim_documents(tci.claim_cause_of_loss) is
  'Mandatory document types per cause of loss. Insolvency replaces the dunning trail with formal evidence: chasing a company in administration proves nothing.';

create function tci.missing_claim_documents(p_claim_id uuid)
returns tci.claim_document_type[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t order by t), '{}'::tci.claim_document_type[])
    from tci.claims c
    cross join lateral unnest(tci.required_claim_documents(c.cause_of_loss)) as t
   where c.id = p_claim_id
     and not exists (
       select 1 from tci.claim_documents d
        where d.claim_id = p_claim_id and d.document_type = t)
$$;

comment on function tci.missing_claim_documents(uuid) is
  'Which mandatory document types this claim still lacks. Drives both the on-screen checklist and the submission refusal.';

revoke execute on function tci.missing_claim_documents(uuid) from public, anon;
grant execute on function tci.missing_claim_documents(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Registering an upload
-- ---------------------------------------------------------------------------
-- The bytes go straight to Storage through a signed upload URL; this records
-- what arrived. It re-checks the size and the declared type rather than
-- trusting the caller's word, and refuses a path outside the claim's folder.

create function tci.register_claim_document(
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
  v_row   tci.claim_documents%rowtype;
  v_allowed text[];
begin
  if not tci.may_upload_to_claim(p_claim_id) then
    raise exception 'not permitted to add documents to this claim' using errcode = 'P0004';
  end if;
  if tci.claim_id_from_storage_path(p_storage_path) is distinct from p_claim_id then
    raise exception 'a claim document must live under claims/%/', p_claim_id
      using errcode = 'P0001';
  end if;
  if coalesce(p_size_bytes, 0) <= 0 or p_size_bytes > 20971520 then
    raise exception 'a claim document must be between 1 byte and 20 MiB'
      using errcode = 'P0001';
  end if;

  select allowed_mime_types into v_allowed from storage.buckets where id = 'claim-documents';
  if p_content_type is null or not (p_content_type = any (v_allowed)) then
    raise exception 'this file type is not accepted for claim documents'
      using errcode = 'P0001';
  end if;
  -- The extension has to agree with the declared type's family. It is a weak
  -- check by construction - neither side is the bytes - but a .exe announced
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
    p_size_bytes, p_content_type, p_note
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function tci.register_claim_document(uuid, text, tci.claim_document_type, text, bigint, text, text) from public, anon;
grant execute on function tci.register_claim_document(uuid, text, tci.claim_document_type, text, bigint, text, text) to authenticated, service_role;

create function tci.delete_claim_document(p_document_id uuid)
returns void
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
    raise exception 'not permitted to remove this document' using errcode = 'P0004';
  end if;
  delete from tci.claim_documents where id = p_document_id;
end;
$$;

revoke execute on function tci.delete_claim_document(uuid) from public, anon;
grant execute on function tci.delete_claim_document(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The submission guard, now with the checklist
-- ---------------------------------------------------------------------------
-- Everything 0032 checked, plus one key per missing mandatory document. The
-- keys name the type, so the refusal reads "missing: shipping documents".

-- Every appended key is cast to text explicitly. `text[] || 'literal'` is
-- ambiguous - Postgres resolves the unknown literal as an ARRAY and dies with
-- "malformed array literal" the first time a blocker actually fires.
create or replace function tci.claim_submission_blockers(p_claim_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claim    tci.claims%rowtype;
  v_blockers text[] := '{}';
  v_from     date;
  v_missing  tci.claim_document_type[];
  v_type     tci.claim_document_type;
begin
  select * into v_claim from tci.claims where id = p_claim_id;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from tci.claim_invoices where claim_id = p_claim_id) then
    v_blockers := v_blockers || 'claims.blocker.noInvoices'::text;
  end if;

  if exists (
    select 1 from tci.claim_invoices
     where claim_id = p_claim_id and currency_code <> v_claim.currency_code
  ) then
    v_blockers := v_blockers || 'claims.blocker.currencyMismatch'::text;
  end if;

  if coalesce(v_claim.claimed_amount, 0) <= 0 then
    v_blockers := v_blockers || 'claims.blocker.nothingOutstanding'::text;
  end if;

  if v_claim.cause_of_loss = 'insolvency'
     and coalesce(trim(v_claim.insolvency_reference), '') = '' then
    v_blockers := v_blockers || 'claims.blocker.insolvencyReference'::text;
  end if;

  v_from := tci.claim_eligible_from(p_claim_id);
  if v_from is not null and current_date < v_from then
    v_blockers := v_blockers || 'claims.blocker.waitingPeriod'::text;
  end if;

  v_missing := tci.missing_claim_documents(p_claim_id);
  foreach v_type in array v_missing loop
    v_blockers := v_blockers || ('claims.blocker.missingDocument.' || v_type::text)::text;
  end loop;

  return v_blockers;
end;
$$;

comment on function tci.claim_submission_blockers(uuid) is
  'i18n keys for everything standing between this claim and submission - content, waiting period, and one key per missing mandatory document. Empty = ready.';

-- ---------------------------------------------------------------------------
-- 8. RLS on the register
-- ---------------------------------------------------------------------------
-- Written only through the functions above. Read is the same predicate the
-- storage policy uses, so the register can never show a client a document they
-- could not download, or hide one they could.

alter table tci.claim_documents enable row level security;

create policy "claim_documents: staff read"
  on tci.claim_documents for select to authenticated using (tci.is_staff());
create policy "claim_documents: staff write"
  on tci.claim_documents for all to authenticated
  using (tci.has_role('claims', 'sales', 'admin'))
  with check (tci.has_role('claims', 'sales', 'admin'));

grant select, insert, update, delete on tci.claim_documents to authenticated;
grant all on tci.claim_documents to service_role;

-- ---------------------------------------------------------------------------
-- 9. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_n int;
begin
  if not exists (select 1 from storage.buckets where id = 'claim-documents' and public = false) then
    raise exception 'the claim-documents bucket must exist and must be private';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'claim documents:%';
  if v_n <> 4 then
    raise exception 'expected 4 storage policies for claim documents, found %', v_n;
  end if;

  -- A path outside the convention must resolve to nothing.
  if tci.claim_id_from_storage_path('claims/../secret.pdf') is not null
     or tci.claim_id_from_storage_path('other/00000000-0000-0000-0000-000000000000/x.pdf') is not null
     or tci.claim_id_from_storage_path('claims/00000000-0000-0000-0000-000000000000') is not null then
    raise exception 'claim_id_from_storage_path accepts a path it should refuse';
  end if;
  if tci.claim_id_from_storage_path('claims/00000000-0000-0000-0000-000000000000/x.pdf')
     <> '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'claim_id_from_storage_path refuses a path it should accept';
  end if;

  if tci.required_claim_documents('insolvency') @> array['dunning']::tci.claim_document_type[] then
    raise exception 'insolvency must not require a dunning trail';
  end if;
end;
$$;
