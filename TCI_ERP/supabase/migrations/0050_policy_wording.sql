-- What: policy wording - generate a draft contract («проект договора») from
--       an uploaded template. The insurer uploads its own .docx wording
--       templates (per jurisdiction, language and product structure) with
--       {{placeholders}}; generating fills one from a policy or a submission
--       and stores the result as an immutable document.
--         * tci.insurer_profile          the insurer's own particulars (one row)
--         * tci.wording_templates        uploaded templates, versioned; one
--                                        ACTIVE per (country, language, product)
--         * tci.policy_documents         generated documents, each with the
--                                        merge data it was generated from
--         * storage bucket 'wording'     private; templates/<id>/..., documents/<target>/...
--         * tci.wording_merge_data()     THE source of the data a document says
--         * tci.register_wording_template / set_wording_template_status /
--           register_policy_document     the only writers
-- Why:  every insurer words its contract differently and by its own law: a
--       Russian insurer uploads its Russian policy, a Nepali one its own. The
--       data comes from the database (one function), the words from the
--       insurer's template, and the browser only renders the two together
--       (docxtemplater) - there is no server to run it on, and the rendering
--       holds no business logic. What a generated document SAID is recorded
--       server-side at registration (merge_data), not taken from the browser.
--
-- Immutability: a template file is never replaced - a new upload is a new
-- version - and neither templates nor documents can be removed through the
-- API (no storage UPDATE/remove policy, no table write grant). Retire a
-- template instead.

-- ---------------------------------------------------------------------------
-- 1. The insurer's particulars
-- ---------------------------------------------------------------------------
create table tci.insurer_profile (
  id                  boolean primary key default true check (id),
  legal_name          text,
  legal_form          text,
  registration_number text,
  tax_id              text,
  license_number      text,
  license_date        date,
  country_code        char(2) references tci.countries (code),
  address             text,
  phone               text,
  email               text,
  website             text,
  bank_name           text,
  bank_account        text,
  bank_code           text,
  signatory_name      text,
  signatory_title     text,
  signatory_basis     text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id)
);
comment on table tci.insurer_profile is
  'The insurer''s own particulars, filled into wording templates as {{insurer.*}}. One row; admin edits.';
insert into tci.insurer_profile (id) values (true);

alter table tci.insurer_profile enable row level security;
create policy "insurer_profile: staff read" on tci.insurer_profile
  for select to authenticated using (tci.is_staff());
create policy "insurer_profile: admin edit" on tci.insurer_profile
  for update to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));
grant select on tci.insurer_profile to authenticated;
grant update (legal_name, legal_form, registration_number, tax_id, license_number, license_date,
              country_code, address, phone, email, website, bank_name, bank_account, bank_code,
              signatory_name, signatory_title, signatory_basis, updated_at, updated_by)
  on tci.insurer_profile to authenticated;
grant all on tci.insurer_profile to service_role;

-- ---------------------------------------------------------------------------
-- 2. Templates
-- ---------------------------------------------------------------------------
create table tci.wording_templates (
  id                uuid primary key,
  name              text not null check (length(btrim(name)) between 1 and 200),
  description       text,
  -- NULL = any jurisdiction / any product structure
  country_code      char(2) references tci.countries (code),
  language          text not null check (language ~ '^[a-z]{2}$'),
  product_structure tci.product_structure,
  version           int not null check (version >= 1),
  status            text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  storage_path      text not null unique,
  file_name         text not null,
  size_bytes        bigint not null check (size_bytes > 0),
  -- placeholders found in the file at upload ({{policy.number}}, limits.amount, ...)
  placeholders      text[] not null default '{}',
  uploaded_by       uuid not null references auth.users (id),
  uploaded_at       timestamptz not null default now(),
  activated_at      timestamptz,
  activated_by      uuid references auth.users (id),
  retired_at        timestamptz,
  retired_by        uuid references auth.users (id)
);
comment on table tci.wording_templates is
  'Uploaded .docx wording templates. Versioned per (country, language, product); at most one ACTIVE per key. A file is never replaced: a new upload is a new version.';

create unique index wording_templates_one_active
  on tci.wording_templates (country_code, language, product_structure) nulls not distinct
  where status = 'active';
create unique index wording_templates_version_uq
  on tci.wording_templates (country_code, language, product_structure, version) nulls not distinct;

alter table tci.wording_templates enable row level security;
create policy "wording_templates: staff read" on tci.wording_templates
  for select to authenticated using (tci.is_staff());
grant select on tci.wording_templates to authenticated;
grant all on tci.wording_templates to service_role;

-- ---------------------------------------------------------------------------
-- 3. Generated documents
-- ---------------------------------------------------------------------------
create table tci.policy_documents (
  id                   uuid primary key,
  policy_id            uuid references tci.policies (id),
  insurance_request_id uuid references tci.insurance_requests (id),
  template_id          uuid not null references tci.wording_templates (id),
  template_version     int not null,
  language             text not null,
  storage_path         text not null unique,
  file_name            text not null,
  -- what the document said: the merge data as the DATABASE produced it at
  -- registration, not as the browser reported it
  merge_data           jsonb not null,
  generated_by         uuid not null references auth.users (id),
  generated_at         timestamptz not null default now(),
  constraint policy_documents_one_target check ((policy_id is null) <> (insurance_request_id is null))
);
comment on table tci.policy_documents is
  'Draft contracts generated from a wording template. Immutable; merge_data records what the document said.';
create index policy_documents_policy_idx on tci.policy_documents (policy_id, generated_at desc);
create index policy_documents_request_idx on tci.policy_documents (insurance_request_id, generated_at desc);

alter table tci.policy_documents enable row level security;
create policy "policy_documents: staff read" on tci.policy_documents
  for select to authenticated using (tci.is_staff());
grant select on tci.policy_documents to authenticated;
grant all on tci.policy_documents to service_role;

-- ---------------------------------------------------------------------------
-- 4. Storage: private, .docx only, no replace and no remove through the API
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wording', 'wording', false, 10485760,
        array['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "wording: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'wording' and tci.is_staff());
create policy "wording: upload templates" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wording' and name like 'templates/%'
              and tci.has_role('admin', 'commercial_underwriter'));
create policy "wording: upload documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wording' and name like 'documents/%'
              and tci.has_role('admin', 'commercial_underwriter', 'sales'));

-- ---------------------------------------------------------------------------
-- 5. The placeholder catalogue (mirrored by src/features/wording/catalogue.ts)
-- ---------------------------------------------------------------------------
create function tci.wording_placeholder_catalogue()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'insurer.name', 'insurer.legal_form', 'insurer.registration_number', 'insurer.tax_id',
    'insurer.license_number', 'insurer.license_date', 'insurer.country', 'insurer.address',
    'insurer.phone', 'insurer.email', 'insurer.website', 'insurer.bank_name', 'insurer.bank_account',
    'insurer.bank_code', 'insurer.signatory_name', 'insurer.signatory_title', 'insurer.signatory_basis',
    'policyholder.name', 'policyholder.legal_form', 'policyholder.registration_number',
    'policyholder.country', 'policyholder.address', 'policyholder.contact_person',
    'policyholder.email', 'policyholder.phone',
    'policy.number', 'policy.status', 'policy.product', 'policy.inception_date', 'policy.expiry_date',
    'policy.currency', 'policy.insured_percentage', 'policy.max_liability_amount',
    'policy.max_liability_multiple', 'policy.nql_amount', 'policy.deductible',
    'policy.aggregate_first_loss', 'policy.premium_rate', 'policy.minimum_premium',
    'policy.premium_basis', 'policy.estimated_turnover', 'policy.discretionary_limit',
    'policy.waiting_period_days', 'policy.max_extension_days', 'policy.max_payment_terms_days',
    'policy.declaration_frequency', 'policy.noa_window_days',
    'limits', 'limits.buyer_name', 'limits.buyer_country', 'limits.buyer_registration_number',
    'limits.amount', 'limits.currency', 'limits.payment_terms_days', 'limits.valid_from',
    'limits.valid_until',
    'document.date', 'document.language'
  ]::text[]
$$;
revoke all on function tci.wording_placeholder_catalogue() from public, anon;
grant execute on function tci.wording_placeholder_catalogue() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The merge data: what a document generated now would say
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: it reads as the caller, so it can never show a caller
-- what their row policies would not. Raw values only - numbers, ISO dates,
-- enum codes; the browser formats them in the TEMPLATE's language with
-- src/lib/format.ts, the one formatter.
create function tci.wording_merge_data(p_policy_id uuid default null, p_request_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entity uuid;
  v_terms  jsonb;
  v_limits jsonb;
begin
  perform tci.require_staff();
  if (p_policy_id is null) = (p_request_id is null) then
    raise exception 'name exactly one of a policy or a submission' using errcode = 'P0001';
  end if;

  if p_policy_id is not null then
    select p.entity_id,
           jsonb_build_object(
             'number', p.policy_number, 'status', p.status, 'product', p.product_structure,
             'inception_date', p.inception_date, 'expiry_date', p.expiry_date,
             'currency', p.currency_code, 'insured_percentage', p.insured_percentage,
             'max_liability_amount', p.max_liability_amount,
             'max_liability_multiple', p.max_liability_premium_multiple,
             'nql_amount', p.nql_amount, 'deductible', p.deductible_each_loss,
             'aggregate_first_loss', p.aggregate_first_loss, 'premium_rate', p.premium_rate_pct,
             'minimum_premium', p.minimum_premium, 'premium_basis', p.premium_basis,
             'estimated_turnover', p.estimated_annual_turnover,
             'discretionary_limit', p.discretionary_limit,
             'waiting_period_days', p.waiting_period_days,
             'max_extension_days', p.max_extension_period_days,
             'max_payment_terms_days', p.max_payment_terms_days,
             'declaration_frequency', p.declaration_frequency,
             'noa_window_days', p.noa_window_days)
      into v_entity, v_terms
      from tci.policies p where p.id = p_policy_id;
    if not found then
      raise exception 'policy not found' using errcode = 'P0002';
    end if;
  else
    select r.entity_id,
           jsonb_build_object(
             'number', r.request_number, 'status', r.status, 'product', r.product_structure,
             'inception_date', null, 'expiry_date', null,
             'currency', r.currency_code, 'insured_percentage', r.insured_percentage,
             'max_liability_amount', r.max_liability_amount,
             'max_liability_multiple', r.max_liability_premium_multiple,
             'nql_amount', r.nql_amount, 'deductible', r.deductible_each_loss,
             'aggregate_first_loss', r.aggregate_first_loss, 'premium_rate', r.premium_rate_pct,
             'minimum_premium', r.minimum_premium, 'premium_basis', null,
             'estimated_turnover', r.estimated_annual_turnover,
             'discretionary_limit', r.discretionary_limit,
             'waiting_period_days', r.waiting_period_days,
             'max_extension_days', r.max_extension_period_days,
             'max_payment_terms_days', r.max_payment_terms_days,
             'declaration_frequency', r.declaration_frequency,
             'noa_window_days', null)
      into v_entity, v_terms
      from tci.insurance_requests r where r.id = p_request_id;
    if not found then
      raise exception 'submission not found' using errcode = 'P0002';
    end if;
  end if;

  -- The limits in force for the scope: approved or partial, by buyer name.
  select coalesce(jsonb_agg(jsonb_build_object(
           'buyer_name', e.name, 'buyer_country', e.country_code,
           'buyer_registration_number', e.registration_number,
           'amount', l.approved_amount, 'currency', l.currency_code,
           'payment_terms_days', l.payment_terms_days,
           'valid_from', l.valid_from, 'valid_until', l.valid_until)
           order by e.name), '[]'::jsonb)
    into v_limits
    from tci.v_effective_limits l
    join tci.legal_entities e on e.id = l.entity_id
   where l.scope_id = coalesce(p_policy_id, p_request_id)
     and l.outcome in ('approved', 'partial');

  return jsonb_build_object(
    'source', jsonb_build_object('kind', case when p_policy_id is not null then 'policy' else 'submission' end,
                                 'id', coalesce(p_policy_id, p_request_id)),
    'insurer', (select jsonb_build_object(
                  'name', i.legal_name, 'legal_form', i.legal_form,
                  'registration_number', i.registration_number, 'tax_id', i.tax_id,
                  'license_number', i.license_number, 'license_date', i.license_date,
                  'country', i.country_code, 'address', i.address, 'phone', i.phone,
                  'email', i.email, 'website', i.website, 'bank_name', i.bank_name,
                  'bank_account', i.bank_account, 'bank_code', i.bank_code,
                  'signatory_name', i.signatory_name, 'signatory_title', i.signatory_title,
                  'signatory_basis', i.signatory_basis)
                from tci.insurer_profile i where i.id),
    'policyholder', (select jsonb_build_object(
                       'name', e.name, 'legal_form', e.legal_form,
                       'registration_number', e.registration_number, 'country', e.country_code,
                       'address', e.address, 'contact_person', e.contact_person,
                       'email', e.contact_email, 'phone', e.contact_phone)
                     from tci.legal_entities e where e.id = v_entity),
    'policy', v_terms,
    'limits', v_limits);
end;
$$;
revoke all on function tci.wording_merge_data(uuid, uuid) from public, anon;
grant execute on function tci.wording_merge_data(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Writers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: they read storage.objects (owner, metadata) and write
-- tables the API cannot write. Each opens with its gate.
create function tci.register_wording_template(
  p_id           uuid,
  p_name         text,
  p_description  text,
  p_country      char(2),
  p_language     text,
  p_product      tci.product_structure,
  p_storage_path text,
  p_file_name    text,
  p_placeholders text[]
)
returns tci.wording_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object  record;
  v_row     tci.wording_templates%rowtype;
  v_version int;
begin
  perform tci.require_role('admin', 'commercial_underwriter');
  if p_storage_path is distinct from format('templates/%s/%s', p_id, p_file_name)
     or p_file_name !~* '^[^/]+\.docx$' then
    raise exception 'a wording template must be a .docx stored at templates/<id>/<file>'
      using errcode = 'P0001';
  end if;
  select o.metadata, o.owner_id into v_object
    from storage.objects o where o.bucket_id = 'wording' and o.name = p_storage_path;
  if not found then
    raise exception 'the uploaded template was not found in storage' using errcode = 'P0002';
  end if;
  if v_object.owner_id is distinct from (select auth.uid())::text then
    raise exception 'only the uploader may register a template' using errcode = '42501';
  end if;

  -- Serialise version numbering for this key.
  perform pg_advisory_xact_lock(hashtext(format('wording:%s:%s:%s', p_country, p_language, p_product)));
  select coalesce(max(version), 0) + 1 into v_version
    from tci.wording_templates
   where country_code is not distinct from p_country
     and language = p_language
     and product_structure is not distinct from p_product;

  insert into tci.wording_templates (
    id, name, description, country_code, language, product_structure, version, status,
    storage_path, file_name, size_bytes, placeholders, uploaded_by
  ) values (
    p_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_country, p_language,
    p_product, v_version, 'draft', p_storage_path, p_file_name,
    coalesce(nullif(v_object.metadata ->> 'size', '')::bigint, 0),
    coalesce(p_placeholders, '{}'), (select auth.uid())
  ) returning * into v_row;
  return v_row;
end;
$$;
revoke all on function tci.register_wording_template(uuid, text, text, char, text, tci.product_structure, text, text, text[]) from public, anon;
grant execute on function tci.register_wording_template(uuid, text, text, char, text, tci.product_structure, text, text, text[]) to authenticated, service_role;

create function tci.set_wording_template_status(p_id uuid, p_status text)
returns tci.wording_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     tci.wording_templates%rowtype;
  v_unknown text[];
begin
  perform tci.require_role('admin', 'commercial_underwriter');
  select * into v_row from tci.wording_templates where id = p_id for update;
  if not found then
    raise exception 'template not found' using errcode = 'P0002';
  end if;

  if p_status = 'active' then
    if v_row.status = 'retired' then
      raise exception 'wording_template_retired: a retired template cannot be activated again; upload it as a new version'
        using errcode = 'P0001';
    end if;
    select array_agg(p) into v_unknown
      from unnest(v_row.placeholders) as p
     where not (p = any (tci.wording_placeholder_catalogue()));
    if v_unknown is not null then
      raise exception 'wording_unknown_placeholders: %', array_to_string(v_unknown, ', ')
        using errcode = 'P0001';
    end if;
    -- The previous active version of the same key retires: one active per key.
    update tci.wording_templates
       set status = 'retired', retired_at = now(), retired_by = (select auth.uid())
     where status = 'active' and id <> p_id
       and country_code is not distinct from v_row.country_code
       and language = v_row.language
       and product_structure is not distinct from v_row.product_structure;
    update tci.wording_templates
       set status = 'active', activated_at = now(), activated_by = (select auth.uid())
     where id = p_id
    returning * into v_row;
  elsif p_status = 'retired' then
    update tci.wording_templates
       set status = 'retired', retired_at = now(), retired_by = (select auth.uid())
     where id = p_id
    returning * into v_row;
  else
    raise exception 'a template can be made active or retired' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;
revoke all on function tci.set_wording_template_status(uuid, text) from public, anon;
grant execute on function tci.set_wording_template_status(uuid, text) to authenticated, service_role;

create function tci.register_policy_document(
  p_id           uuid,
  p_policy_id    uuid,
  p_request_id   uuid,
  p_template_id  uuid,
  p_storage_path text,
  p_file_name    text
)
returns tci.policy_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template tci.wording_templates%rowtype;
  v_object   record;
  v_row      tci.policy_documents%rowtype;
begin
  perform tci.require_role('admin', 'commercial_underwriter', 'sales');
  if (p_policy_id is null) = (p_request_id is null) then
    raise exception 'name exactly one of a policy or a submission' using errcode = 'P0001';
  end if;
  select * into v_template from tci.wording_templates where id = p_template_id;
  if not found then
    raise exception 'template not found' using errcode = 'P0002';
  end if;
  if v_template.status <> 'active' then
    raise exception 'wording_template_not_active: only an active template generates a document'
      using errcode = 'P0001';
  end if;
  if p_storage_path is distinct from format('documents/%s/%s.docx', coalesce(p_policy_id, p_request_id), p_id) then
    raise exception 'a generated document must be stored at documents/<policy or submission>/<id>.docx'
      using errcode = 'P0001';
  end if;
  select o.owner_id into v_object
    from storage.objects o where o.bucket_id = 'wording' and o.name = p_storage_path;
  if not found then
    raise exception 'the generated document was not found in storage' using errcode = 'P0002';
  end if;
  if v_object.owner_id is distinct from (select auth.uid())::text then
    raise exception 'only the generator may register a document' using errcode = '42501';
  end if;

  insert into tci.policy_documents (
    id, policy_id, insurance_request_id, template_id, template_version, language,
    storage_path, file_name, merge_data, generated_by
  ) values (
    p_id, p_policy_id, p_request_id, p_template_id, v_template.version, v_template.language,
    p_storage_path, p_file_name,
    tci.wording_merge_data(p_policy_id, p_request_id), (select auth.uid())
  ) returning * into v_row;
  return v_row;
end;
$$;
revoke all on function tci.register_policy_document(uuid, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function tci.register_policy_document(uuid, uuid, uuid, uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  -- the API writes nothing here directly
  select string_agg(distinct table_name || ':' || privilege_type, ', ') into v_bad
    from information_schema.role_table_grants
   where table_schema = 'tci' and grantee in ('authenticated', 'anon')
     and table_name in ('wording_templates', 'policy_documents')
     and privilege_type <> 'SELECT';
  if v_bad is not null then
    raise exception '0050: the API can write wording tables directly: %', v_bad;
  end if;
  -- every new definer function opens with its gate
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and p.prosecdef
     and p.proname in ('register_wording_template', 'set_wording_template_status', 'register_policy_document')
     and p.prosrc !~ '^\s*declare[\s\S]*?begin\s+perform tci\.require_role\(';
  if v_bad is not null then
    raise exception '0050: ungated definer function(s): %', v_bad;
  end if;
  -- nothing new is reachable by anon
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select proname from tci.pre_auth_entry_points());
  if v_bad is not null then
    raise exception '0050: anon can execute: %', v_bad;
  end if;
  if exists (select 1 from storage.buckets where id = 'wording' and public) then
    raise exception '0050: the wording bucket must be private';
  end if;
end;
$$;
