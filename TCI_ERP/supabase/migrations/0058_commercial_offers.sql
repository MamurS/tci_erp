-- What: commercial offers (КП) generated from a submission and published to
--       the client portal, a versioned TCI product brochure, and a small media
--       library for the brochure's images.
--         * tci.commercial_offers          one offer per submission at a time
--                                          (KP-YYYY-NNNN): language, validity,
--                                          status, what is PUBLISHED, when the
--                                          client first viewed it and answered
--         * tci.commercial_offer_versions  APPEND-ONLY: every save is a new
--                                          row — the texts staff wrote (from
--                                          the browser) and the DATA the
--                                          database built (client, proposed
--                                          terms, premium, buyer limits,
--                                          insurer particulars, contact), plus
--                                          the brochure version current at
--                                          generation time
--         * tci.brochure_versions          the product brochure, versioned;
--                                          the current one is the latest
--                                          PUBLISHED; nothing unreviewed ever
--                                          reaches a client
--         * tci.media_assets               images uploaded by staff with alt
--                                          text per language, source and
--                                          licence (storage bucket
--                                          'media-assets', private)
--         * the offer machine              draft -> published -> viewed ->
--                                          accepted | changes_requested |
--                                          declined, withdrawn from any live
--                                          state; EXPIRED is derived from
--                                          valid_until, never stored
--         * create_commercial_offer / save_offer_version / publish_offer /
--           withdraw_offer                 staff writers, each gated
--         * v_client_offers, client_view_offer, client_accept_offer,
--           client_request_offer_changes   the portal reads only what was
--                                          PUBLISHED, records the first view,
--                                          and answers THROUGH the existing
--                                          submission step
--         * a SEVENTH trigger on tci.workflow_events keeps the offer in step
--           with its submission and opens offer_viewed for sales;
--           offer_expiring / offer_expired are generated lazily by
--           tci.refresh_offer_tasks(), which refresh_agenda now calls
-- Why:  Prompt 26. Sales sent commercial offers by hand. An offer is now a
--       document the database composes from the submission it belongs to, so
--       the terms and limits a client reads are the ones underwriting agreed —
--       and a client never sees a grade, an engine limit, an authority or an
--       underwriter's comment, because none of them is ever put into it.
--
-- ONE SOURCE OF TRUTH FOR ACCEPTANCE. Accepting an offer in the portal IS the
-- 3c client_review -> accepted step: client_accept_offer calls
-- client_respond_to_submission, and the offer follows the submission (the
-- trigger below), never the other way round. "Request changes" is the
-- existing client_review -> sales_confirmation step, which already reopens
-- sales' Agenda task with the client's comment, so no second sales task is
-- opened for it. client_respond_to_submission itself now refuses to accept a
-- submission whose published offer has expired, so the older «Мои заявки»
-- page cannot become a way around the offer's validity.
--
-- PUBLISHING IS THE HAND-OVER. Publishing moves the submission from
-- sales_confirmation to client_review (the step sales already owns);
-- withdrawing a published offer hands it back (client_review ->
-- sales_confirmation, with the reason). A republish after changes publishes
-- the latest version and supersedes the old one in the portal.
--
-- A FIX rides along: since 0043 a client's own answer to a submission
-- (client_respond_to_submission -> advance_insurance_request ->
-- begin_internal_call) was refused with 42501 for every non-staff caller, so
-- the portal could not accept, decline or ask for changes. The answer step now
-- marks itself trusted, and begin_internal_call accepts a transaction that
-- already carries the token (which only owner-run code can mint).
--
-- A prospect (an organisation with a submission and no policy) is treated
-- exactly like a policyholder: publishing works whether or not anyone is
-- mapped to it yet, and the offer waits in the portal. Until the provisioning
-- service is hosted, portal users are created with docs/create-user.sql.
--
-- Agenda catalogue rows (read by catalogue.test.ts):
--
--   offer_viewed    sales  normal  AUTO offer answered, republished or withdrawn
--   offer_expiring  sales  high    AUTO lazily, once answered, republished, withdrawn or expired
--   offer_expired   sales  high    AUTO lazily, once republished with a new date, withdrawn or answered

-- ---------------------------------------------------------------------------
-- 1. Task types
-- ---------------------------------------------------------------------------
-- Their own statements: a new enum value cannot be used in the transaction
-- that adds it, and these are only referenced inside plpgsql bodies below.

alter type tci.task_type add value 'offer_viewed';
alter type tci.task_type add value 'offer_expiring';
alter type tci.task_type add value 'offer_expired';

-- ---------------------------------------------------------------------------
-- 2. Types and the pure rules (mirrored by src/features/offers/machine.ts)
-- ---------------------------------------------------------------------------

create type tci.offer_status as enum
  ('draft', 'published', 'viewed', 'accepted', 'changes_requested', 'declined', 'withdrawn');

create type tci.brochure_status as enum ('draft', 'published', 'retired');

-- Today in Tashkent: an offer valid until the 30th is valid all of the 30th
-- where the client is, not until 05:00 local time.
create function tci.offer_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Tashkent')::date $$;

-- What the screens show. Expiry is DERIVED: an offer that is out with the
-- client (published or viewed) and whose last valid day has passed reads
-- 'expired'; nothing is rewritten when the date passes.
create function tci.offer_effective_status(p_status tci.offer_status, p_valid_until date)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status in ('published', 'viewed') and p_valid_until < tci.offer_today() then 'expired'
    else p_status::text
  end
$$;

-- A live offer can still change: be edited, (re)published or withdrawn.
create function tci.offer_is_live(p_status tci.offer_status)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_status in ('draft', 'published', 'viewed', 'changes_requested') $$;

-- The submission statuses an offer may be generated in, and published from.
create function tci.offer_request_status_ok(p_status tci.insurance_request_status)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_status in ('commercial_review', 'sales_confirmation', 'client_review') $$;

-- Texts staff write: a JSON object of named blocks, each an editor document
-- or a plain string. Bounded so a paste cannot bloat the table.
create function tci.offer_texts_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p is not null and jsonb_typeof(p) = 'object' and octet_length(p::text) <= 262144 $$;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

create table tci.media_assets (
  id            uuid primary key default gen_random_uuid(),
  storage_path  text not null unique check (storage_path ~* '^[0-9a-f-]{36}\.(png|jpe?g|webp)$'),
  mime_type     text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size     int check (byte_size is null or byte_size > 0),
  width         int check (width is null or width > 0),
  height        int check (height is null or height > 0),
  -- Alt text in every language the brochure is printed in.
  alt           jsonb not null check (
                  jsonb_typeof(alt) = 'object'
                  and coalesce(btrim(alt ->> 'en'), '') <> ''
                  and coalesce(btrim(alt ->> 'ru'), '') <> ''
                  and coalesce(btrim(alt ->> 'uz'), '') <> ''),
  -- Where it came from and on what terms. Both required: an image with no
  -- recorded licence does not enter the library.
  source        text not null check (char_length(btrim(source)) > 0),
  licence       text not null check (char_length(btrim(licence)) > 0),
  author        text,
  source_url    text,
  uploaded_by   uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  retired_at    timestamptz
);
comment on table tci.media_assets is
  'Images for the TCI brochure (0058): uploaded by staff into the private media-assets bucket, each with alt text per language, a source and a licence. No hotlinking: only what is stored here is shown.';

create table tci.brochure_versions (
  id            uuid primary key default gen_random_uuid(),
  version_no    int not null unique check (version_no > 0),
  status        tci.brochure_status not null default 'draft',
  -- { sections: [ { key, title: {en,ru,uz}, body: {en,ru,uz}, image_asset_id? } ] }
  content       jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 524288),
  note          text,
  author_id     uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  published_at  timestamptz,
  published_by  uuid references auth.users (id)
);
comment on table tci.brochure_versions is
  'The TCI product brochure (0058), versioned. Content is never changed in place; publishing marks a version current. The current brochure is the latest PUBLISHED version.';

create sequence tci.commercial_offer_seq;

create table tci.commercial_offers (
  id                    uuid primary key default gen_random_uuid(),
  offer_number          text not null unique,
  insurance_request_id  uuid not null references tci.insurance_requests (id),
  entity_id             uuid not null references tci.legal_entities (id),
  language              text not null check (language in ('en', 'ru', 'uz')),
  status                tci.offer_status not null default 'draft',
  -- The latest version, and the one the client sees.
  current_version_id    uuid,
  published_version_id  uuid,
  valid_until           date not null,
  published_at          timestamptz,
  published_by          uuid references auth.users (id),
  -- The first time the client ever opened it, and the first view of what is
  -- published NOW (reset by a republish).
  first_viewed_at       timestamptz,
  published_viewed_at   timestamptz,
  answered_at           timestamptz,
  client_comment        text,
  withdrawn_at          timestamptz,
  withdrawn_by          uuid references auth.users (id),
  withdraw_reason       text,
  created_by            uuid not null references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table tci.commercial_offers is
  'Commercial offers (КП, 0058). Status moves only through the offer functions and, for the client''s answer, through the submission it belongs to. EXPIRED is derived (tci.offer_effective_status), never stored.';

-- One live offer per submission: a second would be a second source of truth.
create unique index commercial_offers_one_live_uq
  on tci.commercial_offers (insurance_request_id)
  where status in ('draft', 'published', 'viewed', 'changes_requested');
create index commercial_offers_entity_idx on tci.commercial_offers (entity_id);

create table tci.commercial_offer_versions (
  id                  uuid primary key default gen_random_uuid(),
  offer_id            uuid not null references tci.commercial_offers (id),
  version_no          int not null check (version_no > 0),
  texts               jsonb not null check (tci.offer_texts_ok(texts)),
  data                jsonb not null check (jsonb_typeof(data) = 'object'),
  valid_until         date not null,
  include_brochure    boolean not null default true,
  brochure_version_id uuid references tci.brochure_versions (id),
  note                text,
  author_id           uuid not null references auth.users (id),
  created_at          timestamptz not null default now(),
  unique (offer_id, version_no)
);
comment on table tci.commercial_offer_versions is
  'Versions of a commercial offer (0058), append-only. texts come from the editor; data is what the DATABASE composed at that moment and is the only source of terms, premium and limits a client reads.';
comment on column tci.commercial_offer_versions.data is
  'Built by tci.offer_merge_data: client, proposed terms, premium estimate, buyer limits marked approved / indicative / declined, insurer particulars, contact. Never grades, engine limits, authorities or internal comments.';

alter table tci.commercial_offers
  add constraint commercial_offers_current_version_fk
    foreign key (current_version_id) references tci.commercial_offer_versions (id),
  add constraint commercial_offers_published_version_fk
    foreign key (published_version_id) references tci.commercial_offer_versions (id);

create function tci.set_commercial_offer_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.offer_number is null or new.offer_number = '' then
    new.offer_number := 'KP-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('tci.commercial_offer_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger commercial_offers_number
  before insert on tci.commercial_offers
  for each row execute function tci.set_commercial_offer_number();
create trigger commercial_offers_set_updated_at
  before update on tci.commercial_offers
  for each row execute function tci.set_updated_at();
create trigger media_assets_set_updated_at
  before update on tci.media_assets
  for each row execute function tci.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS and grants: staff read, nobody writes directly
-- ---------------------------------------------------------------------------

alter table tci.commercial_offers enable row level security;
alter table tci.commercial_offer_versions enable row level security;
alter table tci.brochure_versions enable row level security;
alter table tci.media_assets enable row level security;

create policy "commercial_offers: staff read" on tci.commercial_offers
  for select to authenticated using (tci.is_staff());
create policy "commercial_offer_versions: staff read" on tci.commercial_offer_versions
  for select to authenticated using (tci.is_staff());
create policy "brochure_versions: staff read" on tci.brochure_versions
  for select to authenticated using (tci.is_staff());
create policy "media_assets: staff read" on tci.media_assets
  for select to authenticated using (tci.is_staff());

revoke all on tci.commercial_offers, tci.commercial_offer_versions,
              tci.brochure_versions, tci.media_assets
  from public, anon, authenticated;
grant select on tci.commercial_offers, tci.commercial_offer_versions,
                tci.brochure_versions, tci.media_assets
  to authenticated;
grant select, insert, update on tci.commercial_offers, tci.brochure_versions, tci.media_assets to service_role;
grant select, insert on tci.commercial_offer_versions to service_role;
grant usage on sequence tci.commercial_offer_seq to service_role;

-- Versions are never changed in place, by anyone, the owner included.
create function tci.refuse_offer_version_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'offer_version_immutable: an offer version is never changed in place'
    using errcode = '42501';
end;
$$;

create trigger commercial_offer_versions_immutable
  before update on tci.commercial_offer_versions
  for each row execute function tci.refuse_offer_version_change();

-- A brochure version's words never change; only its status moves.
create function tci.guard_brochure_version_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is distinct from old.content
     or new.version_no is distinct from old.version_no
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'brochure_version_immutable: a brochure version''s content is never changed in place'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger brochure_versions_content_immutable
  before update on tci.brochure_versions
  for each row execute function tci.guard_brochure_version_change();

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------

-- The current brochure: the latest PUBLISHED version, or none.
create function tci.current_brochure_version()
returns uuid
language sql
stable
set search_path = ''
as $$
  select b.id from tci.brochure_versions b
   where b.status = 'published'
   order by b.published_at desc nulls last, b.version_no desc
   limit 1
$$;

-- What an offer says, composed by the database from the submission. INVOKER
-- and granted to no API role: it is called only by the SECURITY DEFINER
-- writers below, as the owner. What is NOT here is the point: no grade, no
-- engine limit, no authority, no comment, no decided_by.
create function tci.offer_merge_data(p_request_id uuid, p_author uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'client', jsonb_build_object(
      'name', e.name,
      'legal_form', e.legal_form,
      'registration_number', e.registration_number,
      'country_code', e.country_code,
      'address', e.address),
    'request', jsonb_build_object('number', ir.request_number),
    'terms', jsonb_build_object(
      'product_structure', ir.product_structure,
      'currency_code', ir.currency_code,
      'insured_percentage', ir.insured_percentage,
      'max_liability_amount', ir.max_liability_amount,
      'max_liability_premium_multiple', ir.max_liability_premium_multiple,
      'discretionary_limit', ir.discretionary_limit,
      'nql_amount', ir.nql_amount,
      'deductible_each_loss', ir.deductible_each_loss,
      'aggregate_first_loss', ir.aggregate_first_loss,
      'waiting_period_days', ir.waiting_period_days,
      'max_extension_period_days', ir.max_extension_period_days,
      'max_payment_terms_days', ir.max_payment_terms_days,
      'declaration_frequency', ir.declaration_frequency,
      'estimated_annual_turnover', ir.estimated_annual_turnover),
    'premium', jsonb_build_object(
      'rate_pct', ir.premium_rate_pct,
      'minimum_premium', ir.minimum_premium,
      'estimated_premium',
        case when ir.estimated_annual_turnover is not null and ir.premium_rate_pct is not null
             then round(ir.estimated_annual_turnover * ir.premium_rate_pct / 100.0, 2) end,
      -- What the policyholder would owe for the year: the minimum stands if
      -- the estimate earns less (no refund below the minimum, 0027).
      'estimated_premium_due',
        case when ir.estimated_annual_turnover is not null and ir.premium_rate_pct is not null
             then greatest(round(ir.estimated_annual_turnover * ir.premium_rate_pct / 100.0, 2),
                           coalesce(ir.minimum_premium, 0))
             else ir.minimum_premium end,
      'instalments', case ir.declaration_frequency when 'monthly' then 12 when 'quarterly' then 4 end,
      'instalment_amount',
        case when ir.minimum_premium is not null and ir.declaration_frequency is not null
             then round(ir.minimum_premium / (case ir.declaration_frequency when 'monthly' then 12 else 4 end), 2) end),
    'buyers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', coalesce(be.name, b.proposed_name),
               'country_code', be.country_code,
               'requested_amount', b.requested_amount,
               'requested_payment_terms_days', b.requested_payment_terms_days,
               'basis', case
                          when l.outcome in ('approved', 'partial') and not coalesce(l.held, false) then 'approved'
                          when l.outcome in ('declined', 'revoked') and not coalesce(l.held, false) then 'declined'
                          else 'indicative' end,
               'offered_amount', case
                          when l.outcome in ('approved', 'partial') and not coalesce(l.held, false) then l.approved_amount
                          when l.outcome in ('declined', 'revoked') and not coalesce(l.held, false) then 0
                          else b.requested_amount end,
               'offered_payment_terms_days', case
                          when l.outcome in ('approved', 'partial') and not coalesce(l.held, false)
                            then coalesce(l.payment_terms_days, b.requested_payment_terms_days)
                          else b.requested_payment_terms_days end,
               'currency_code', coalesce(l.currency_code, ir.currency_code))
             order by coalesce(be.name, b.proposed_name))
        from tci.insurance_request_buyers b
        left join tci.legal_entities be on be.id = b.entity_id
        left join tci.v_effective_limits l
               on l.scope_id = tci.limit_scope(null, ir.id) and l.entity_id = b.entity_id
       where b.request_id = ir.id), '[]'::jsonb),
    'insurer', (select jsonb_build_object(
        'legal_name', i.legal_name, 'legal_form', i.legal_form,
        'registration_number', i.registration_number, 'tax_id', i.tax_id,
        'license_number', i.license_number, 'license_date', i.license_date,
        'address', i.address, 'phone', i.phone, 'email', i.email, 'website', i.website,
        'bank_name', i.bank_name, 'bank_account', i.bank_account, 'bank_code', i.bank_code)
      from tci.insurer_profile i limit 1),
    'contact', jsonb_build_object(
      'name', (select p.full_name from tci.user_profiles p where p.user_id = p_author),
      'phone', (select p.phone from tci.user_profiles p where p.user_id = p_author),
      'email', (select u.email from auth.users u where u.id = p_author)),
    'composed_at', now())
  from tci.insurance_requests ir
  join tci.legal_entities e on e.id = ir.entity_id
  where ir.id = p_request_id
$$;

-- Appends a version and points the offer at it. Internal: no API role.
create function tci.append_offer_version(
  p_offer tci.commercial_offers,
  p_texts jsonb,
  p_valid_until date,
  p_include_brochure boolean,
  p_note text
)
returns tci.commercial_offer_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_no  int;
  v_row tci.commercial_offer_versions%rowtype;
begin
  perform tci.require_internal_call();
  select coalesce(max(version_no), 0) + 1 into v_no
    from tci.commercial_offer_versions where offer_id = p_offer.id;
  insert into tci.commercial_offer_versions (
    offer_id, version_no, texts, data, valid_until, include_brochure,
    brochure_version_id, note, author_id)
  values (
    p_offer.id, v_no, p_texts,
    tci.offer_merge_data(p_offer.insurance_request_id, (select auth.uid())),
    p_valid_until, p_include_brochure,
    case when p_include_brochure then tci.current_brochure_version() end,
    nullif(btrim(p_note), ''), (select auth.uid()))
  returning * into v_row;
  update tci.commercial_offers set current_version_id = v_row.id where id = p_offer.id;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Staff writers (SECURITY DEFINER: authenticated holds no write grant)
-- ---------------------------------------------------------------------------

create function tci.create_commercial_offer(
  p_request_id       uuid,
  p_language         text,
  p_texts            jsonb,
  p_valid_until      date default null,
  p_include_brochure boolean default true
)
returns tci.commercial_offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request tci.insurance_requests%rowtype;
  v_offer   tci.commercial_offers%rowtype;
  v_until   date := coalesce(p_valid_until, tci.offer_today() + 30);
begin
  perform tci.require_role('admin', 'sales', 'commercial_underwriter');
  perform tci.begin_trusted_call();

  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found then
    raise exception 'insurance request not found' using errcode = 'P0002';
  end if;
  if not tci.offer_request_status_ok(v_request.status) then
    raise exception 'offer_request_status: an offer is prepared during the commercial review, sales confirmation or client review (the submission is %)', v_request.status
      using errcode = 'P0001';
  end if;
  if v_request.currency_code is null or v_request.premium_rate_pct is null
     or v_request.minimum_premium is null or v_request.product_structure is null then
    raise exception 'offer_terms_missing: the proposed terms (structure, currency, rate, minimum premium) are not filled in yet'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.commercial_offers o
              where o.insurance_request_id = p_request_id and tci.offer_is_live(o.status)) then
    raise exception 'offer_exists: this submission already has a live offer; edit it or withdraw it first'
      using errcode = 'P0001';
  end if;
  if p_language not in ('en', 'ru', 'uz') then
    raise exception 'offer_language: % is not an offer language', p_language using errcode = 'P0001';
  end if;
  if v_until < tci.offer_today() then
    raise exception 'offer_valid_until_past: an offer cannot be valid until a day that has passed'
      using errcode = 'P0001';
  end if;
  if not tci.offer_texts_ok(p_texts) then
    raise exception 'offer_texts_invalid' using errcode = 'P0001';
  end if;

  insert into tci.commercial_offers (insurance_request_id, entity_id, language, valid_until, created_by)
  values (p_request_id, v_request.entity_id, p_language, v_until, (select auth.uid()))
  returning * into v_offer;

  perform tci.append_offer_version(v_offer, p_texts, v_until, p_include_brochure, null);

  perform tci.emit_workflow_event('offer.created', 'commercial_offer', v_offer.id,
    jsonb_build_object('offer_number', v_offer.offer_number, 'request_id', p_request_id,
                       'request_number', v_request.request_number, 'language', p_language),
    null);

  select * into v_offer from tci.commercial_offers where id = v_offer.id;
  return v_offer;
end;
$$;

-- Every save is a new version. p_base_version_no is the version the editor
-- started from: a save on top of a newer one is refused, not merged.
create function tci.save_offer_version(
  p_offer_id         uuid,
  p_base_version_no  int,
  p_texts            jsonb,
  p_valid_until      date,
  p_include_brochure boolean default true,
  p_note             text default null
)
returns tci.commercial_offer_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer   tci.commercial_offers%rowtype;
  v_request tci.insurance_requests%rowtype;
  v_latest  int;
begin
  perform tci.require_role('admin', 'sales', 'commercial_underwriter');
  perform tci.begin_trusted_call();

  select * into v_offer from tci.commercial_offers where id = p_offer_id for update;
  if not found then
    raise exception 'commercial offer not found' using errcode = 'P0002';
  end if;
  if not tci.offer_is_live(v_offer.status) then
    raise exception 'offer_closed: the offer is % and cannot be changed', v_offer.status
      using errcode = 'P0001';
  end if;
  select * into v_request from tci.insurance_requests where id = v_offer.insurance_request_id;
  if not tci.offer_request_status_ok(v_request.status) then
    raise exception 'offer_request_status: the submission is % — an offer is not edited at this step', v_request.status
      using errcode = 'P0001';
  end if;
  select max(version_no) into v_latest from tci.commercial_offer_versions where offer_id = p_offer_id;
  if p_base_version_no is distinct from v_latest then
    raise exception 'offer_version_conflict: version % was saved since you opened version %', v_latest, p_base_version_no
      using errcode = 'P0001';
  end if;
  if p_valid_until is null or p_valid_until < tci.offer_today() then
    raise exception 'offer_valid_until_past: an offer cannot be valid until a day that has passed'
      using errcode = 'P0001';
  end if;
  if not tci.offer_texts_ok(p_texts) then
    raise exception 'offer_texts_invalid' using errcode = 'P0001';
  end if;

  return tci.append_offer_version(v_offer, p_texts, p_valid_until, coalesce(p_include_brochure, true), p_note);
end;
$$;

-- Publishing puts the LATEST version in front of the client and hands the
-- submission to them (sales_confirmation -> client_review). Sales' step.
create function tci.publish_offer(p_offer_id uuid)
returns tci.commercial_offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer   tci.commercial_offers%rowtype;
  v_request tci.insurance_requests%rowtype;
  v_version tci.commercial_offer_versions%rowtype;
  v_republish boolean;
begin
  perform tci.require_role('admin', 'sales');
  perform tci.begin_trusted_call();

  select * into v_offer from tci.commercial_offers where id = p_offer_id for update;
  if not found then
    raise exception 'commercial offer not found' using errcode = 'P0002';
  end if;
  if not tci.offer_is_live(v_offer.status) then
    raise exception 'offer_closed: the offer is % and cannot be published', v_offer.status
      using errcode = 'P0001';
  end if;
  select * into v_version from tci.commercial_offer_versions where id = v_offer.current_version_id;
  if v_offer.status in ('published', 'viewed') and v_offer.published_version_id = v_version.id then
    raise exception 'offer_nothing_new: the latest version is already published'
      using errcode = 'P0001';
  end if;
  if v_version.valid_until < tci.offer_today() then
    raise exception 'offer_valid_until_past: the latest version expired on %; save a version with a new date', v_version.valid_until
      using errcode = 'P0001';
  end if;

  select * into v_request from tci.insurance_requests where id = v_offer.insurance_request_id for update;
  if v_request.status = 'sales_confirmation' then
    perform tci.advance_insurance_request(v_request.id, 'client_review', null);
  elsif v_request.status <> 'client_review' then
    raise exception 'offer_request_status: an offer is published from sales confirmation (the submission is %)', v_request.status
      using errcode = 'P0001';
  end if;

  v_republish := v_offer.published_version_id is not null;
  update tci.commercial_offers
     set status = 'published',
         published_version_id = v_version.id,
         valid_until = v_version.valid_until,
         published_at = now(),
         published_by = (select auth.uid()),
         published_viewed_at = null,
         answered_at = null
   where id = p_offer_id
   returning * into v_offer;

  perform tci.emit_workflow_event('offer.published', 'commercial_offer', p_offer_id,
    jsonb_build_object('offer_number', v_offer.offer_number, 'request_id', v_request.id,
                       'request_number', v_request.request_number,
                       'version_no', v_version.version_no, 'valid_until', v_version.valid_until,
                       'republished', v_republish),
    null);
  return v_offer;
end;
$$;

-- Withdrawing takes the offer out of the client's hands. A published offer
-- hands the submission back to sales (client_review -> sales_confirmation)
-- with the reason, so it can no longer be accepted.
create function tci.withdraw_offer(p_offer_id uuid, p_reason text)
returns tci.commercial_offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer   tci.commercial_offers%rowtype;
  v_request tci.insurance_requests%rowtype;
  v_was     tci.offer_status;
begin
  perform tci.require_role('admin', 'sales');
  perform tci.begin_trusted_call();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'offer_withdraw_reason: say why the offer is withdrawn' using errcode = 'P0001';
  end if;
  select * into v_offer from tci.commercial_offers where id = p_offer_id for update;
  if not found then
    raise exception 'commercial offer not found' using errcode = 'P0002';
  end if;
  if not tci.offer_is_live(v_offer.status) then
    raise exception 'offer_closed: the offer is % and cannot be withdrawn', v_offer.status
      using errcode = 'P0001';
  end if;
  v_was := v_offer.status;

  update tci.commercial_offers
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = (select auth.uid()),
         withdraw_reason = btrim(p_reason)
   where id = p_offer_id
   returning * into v_offer;

  select * into v_request from tci.insurance_requests where id = v_offer.insurance_request_id for update;
  if v_was in ('published', 'viewed') and v_request.status = 'client_review' then
    perform tci.advance_insurance_request(v_request.id, 'sales_confirmation', btrim(p_reason));
  end if;

  perform tci.emit_workflow_event('offer.withdrawn', 'commercial_offer', p_offer_id,
    jsonb_build_object('offer_number', v_offer.offer_number, 'request_id', v_request.id,
                       'request_number', v_request.request_number, 'from', v_was),
    null);
  return v_offer;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Brochure and media library writers (admin, sales)
-- ---------------------------------------------------------------------------

create function tci.save_brochure_version(p_content jsonb, p_note text default null)
returns tci.brochure_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     tci.brochure_versions%rowtype;
  v_content jsonb;
begin
  perform tci.require_role('admin', 'sales');
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or jsonb_typeof(p_content -> 'sections') <> 'array'
     or octet_length(p_content::text) > 524288 then
    raise exception 'brochure_content_invalid' using errcode = 'P0001';
  end if;
  -- Every image a section names must be in the library and not retired.
  if exists (
    select 1 from jsonb_array_elements(p_content -> 'sections') s
     where s ->> 'image_asset_id' is not null
       and not exists (select 1 from tci.media_assets a
                        where a.id::text = s ->> 'image_asset_id' and a.retired_at is null)) then
    raise exception 'brochure_image_unknown: a section names an image that is not in the library'
      using errcode = 'P0001';
  end if;
  -- The version records WHAT it printed: each image's storage path and alt
  -- text are stamped from the library now (a portal client cannot read the
  -- library, and a later alt edit must not rewrite a published brochure).
  v_content := p_content || jsonb_build_object('sections', (
    select coalesce(jsonb_agg(
             case when s ->> 'image_asset_id' is null then s - 'image_path' - 'image_alt'
                  else s || jsonb_build_object('image_path', a.storage_path, 'image_alt', a.alt) end
             order by s_ord), '[]'::jsonb)
      from jsonb_array_elements(p_content -> 'sections') with ordinality as e(s, s_ord)
      left join tci.media_assets a on a.id::text = s ->> 'image_asset_id'));
  insert into tci.brochure_versions (version_no, content, note, author_id)
  values ((select coalesce(max(version_no), 0) + 1 from tci.brochure_versions),
          v_content, nullif(btrim(p_note), ''), (select auth.uid()))
  returning * into v_row;
  return v_row;
end;
$$;

create function tci.publish_brochure_version(p_version_id uuid)
returns tci.brochure_versions
language plpgsql
security definer
set search_path = ''
as $$
declare v_row tci.brochure_versions%rowtype;
begin
  perform tci.require_role('admin', 'sales');
  select * into v_row from tci.brochure_versions where id = p_version_id for update;
  if not found then
    raise exception 'brochure version not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'brochure_not_draft: version % is %', v_row.version_no, v_row.status
      using errcode = 'P0001';
  end if;
  -- The previous current version retires; offers that embedded it keep it.
  update tci.brochure_versions set status = 'retired'
   where status = 'published' and id <> p_version_id;
  update tci.brochure_versions
     set status = 'published', published_at = now(), published_by = (select auth.uid())
   where id = p_version_id
   returning * into v_row;
  return v_row;
end;
$$;

create function tci.register_media_asset(
  p_storage_path text,
  p_mime_type    text,
  p_alt          jsonb,
  p_source       text,
  p_licence      text,
  p_author       text default null,
  p_source_url   text default null,
  p_byte_size    int default null,
  p_width        int default null,
  p_height       int default null
)
returns tci.media_assets
language plpgsql
security definer
set search_path = ''
as $$
declare v_row tci.media_assets%rowtype;
begin
  perform tci.require_role('admin', 'sales');
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'media-assets' and o.name = p_storage_path) then
    raise exception 'media_not_uploaded: the file is not in the media library bucket'
      using errcode = 'P0002';
  end if;
  insert into tci.media_assets (storage_path, mime_type, byte_size, width, height, alt,
                                source, licence, author, source_url, uploaded_by)
  values (p_storage_path, p_mime_type, p_byte_size, p_width, p_height, p_alt,
          btrim(p_source), btrim(p_licence), nullif(btrim(p_author), ''),
          nullif(btrim(p_source_url), ''), (select auth.uid()))
  returning * into v_row;
  return v_row;
end;
$$;

create function tci.update_media_asset(
  p_id         uuid,
  p_alt        jsonb,
  p_source     text,
  p_licence    text,
  p_author     text default null,
  p_source_url text default null
)
returns tci.media_assets
language plpgsql
security definer
set search_path = ''
as $$
declare v_row tci.media_assets%rowtype;
begin
  perform tci.require_role('admin', 'sales');
  update tci.media_assets
     set alt = p_alt, source = btrim(p_source), licence = btrim(p_licence),
         author = nullif(btrim(p_author), ''), source_url = nullif(btrim(p_source_url), '')
   where id = p_id and retired_at is null
   returning * into v_row;
  if not found then
    raise exception 'media asset not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- Retired, never removed: a brochure version that printed it keeps showing it.
create function tci.retire_media_asset(p_id uuid)
returns tci.media_assets
language plpgsql
security definer
set search_path = ''
as $$
declare v_row tci.media_assets%rowtype;
begin
  perform tci.require_role('admin', 'sales');
  update tci.media_assets set retired_at = now()
   where id = p_id and retired_at is null
   returning * into v_row;
  if not found then
    raise exception 'media asset not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Staff read model
-- ---------------------------------------------------------------------------

create view tci.v_commercial_offers
with (security_invoker = true) as
select
  o.id,
  o.offer_number,
  o.insurance_request_id,
  ir.request_number,
  ir.status as request_status,
  o.entity_id,
  e.name as entity_name,
  o.language,
  o.status,
  tci.offer_effective_status(o.status, o.valid_until) as effective_status,
  o.valid_until,
  o.published_at,
  o.first_viewed_at,
  o.published_viewed_at,
  o.answered_at,
  o.client_comment,
  o.withdrawn_at,
  o.withdraw_reason,
  cv.version_no as current_version_no,
  pv.version_no as published_version_no,
  (select count(*) from tci.commercial_offer_versions v where v.offer_id = o.id)::int as versions_count,
  -- A prospect with nobody mapped to it cannot open the portal yet.
  exists (select 1 from tci.policyholder_users pu where pu.entity_id = o.entity_id) as has_portal_users,
  not exists (select 1 from tci.policies p where p.entity_id = o.entity_id) as is_prospect,
  o.created_by,
  o.created_at,
  o.updated_at
from tci.commercial_offers o
join tci.insurance_requests ir on ir.id = o.insurance_request_id
join tci.legal_entities e on e.id = o.entity_id
left join tci.commercial_offer_versions cv on cv.id = o.current_version_id
left join tci.commercial_offer_versions pv on pv.id = o.published_version_id;

comment on view tci.v_commercial_offers is
  'Commercial offers for staff (0058): effective_status derives EXPIRED from valid_until; has_portal_users / is_prospect drive the «create a portal user» hint.';

revoke all on tci.v_commercial_offers from public, anon;
grant select on tci.v_commercial_offers to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The client portal
-- ---------------------------------------------------------------------------
-- A SECURITY DEFINER view over BASE tables only (0030), carrying its own
-- client gate. Only what was PUBLISHED: never a draft, never an unpublished
-- later version, never author, notes or the staff reason for a withdrawal.

create view tci.v_client_offers as
select
  o.id,
  o.offer_number,
  o.insurance_request_id,
  ir.request_number,
  o.entity_id,
  e.name as entity_name,
  o.language,
  o.status,
  tci.offer_effective_status(o.status, o.valid_until) as effective_status,
  o.valid_until,
  o.published_at,
  o.answered_at,
  o.client_comment,
  case when o.status <> 'withdrawn' then v.version_no end as version_no,
  case when o.status <> 'withdrawn' then v.texts end as texts,
  case when o.status <> 'withdrawn' then v.data end as data,
  case when o.status <> 'withdrawn' then v.include_brochure end as include_brochure,
  case when o.status <> 'withdrawn' and v.include_brochure then b.version_no end as brochure_version_no,
  case when o.status <> 'withdrawn' and v.include_brochure then b.content end as brochure_content
from tci.commercial_offers o
join tci.commercial_offer_versions v on v.id = o.published_version_id
join tci.insurance_requests ir on ir.id = o.insurance_request_id
join tci.legal_entities e on e.id = o.entity_id
left join tci.brochure_versions b on b.id = v.brochure_version_id
where tci.has_role('client')
  and o.status <> 'draft'
  and o.entity_id in (select tci.my_client_entities());

comment on view tci.v_client_offers is
  'A policyholder''s or prospect''s published commercial offers (0058): the PUBLISHED version only, its server-composed data (no grades, engine limits, authorities or internal comments) and the brochure version embedded at generation.';

revoke all on tci.v_client_offers from public, anon;
grant select on tci.v_client_offers to authenticated, service_role;

-- The client opened it. The first view of a publication is recorded once and
-- tells sales.
create function tci.client_view_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_offer tci.commercial_offers%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'only a portal user may open an offer this way' using errcode = '42501';
  end if;
  select * into v_offer from tci.commercial_offers where id = p_offer_id for update;
  if not found or v_offer.status = 'draft' or v_offer.published_version_id is null
     or v_offer.entity_id not in (select tci.my_client_entities()) then
    raise exception 'offer not found' using errcode = 'P0002';
  end if;
  if v_offer.status = 'published' then
    update tci.commercial_offers
       set status = 'viewed',
           published_viewed_at = now(),
           first_viewed_at = coalesce(first_viewed_at, now())
     where id = p_offer_id
     returning * into v_offer;
    perform tci.begin_trusted_call();
    perform tci.emit_workflow_event('offer.viewed', 'commercial_offer', p_offer_id,
      jsonb_build_object('offer_number', v_offer.offer_number,
                         'request_id', v_offer.insurance_request_id,
                         'request_number', (select r.request_number from tci.insurance_requests r
                                             where r.id = v_offer.insurance_request_id),
                         'entity_name', (select e.name from tci.legal_entities e where e.id = v_offer.entity_id),
                         'viewed_at', v_offer.published_viewed_at),
      'sales'::tci.user_role);
  end if;
  return jsonb_build_object('status', v_offer.status,
                            'effective_status', tci.offer_effective_status(v_offer.status, v_offer.valid_until));
end;
$$;

-- The checks both client answers share: the offer is out with this client,
-- it is the one published now, and it is still open.
create function tci.client_open_offer(p_offer_id uuid, p_allow_expired boolean)
returns tci.commercial_offers
language plpgsql
security definer
set search_path = ''
as $$
declare v_offer tci.commercial_offers%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'only a portal user may answer an offer this way' using errcode = '42501';
  end if;
  select * into v_offer from tci.commercial_offers where id = p_offer_id for update;
  if not found or v_offer.status = 'draft' or v_offer.published_version_id is null
     or v_offer.entity_id not in (select tci.my_client_entities()) then
    raise exception 'offer not found' using errcode = 'P0002';
  end if;
  if v_offer.status not in ('published', 'viewed') then
    raise exception 'offer_not_open: the offer is %', v_offer.status using errcode = 'P0001';
  end if;
  if not p_allow_expired and tci.offer_effective_status(v_offer.status, v_offer.valid_until) = 'expired' then
    raise exception 'offer_expired: the offer was valid until %', v_offer.valid_until using errcode = 'P0001';
  end if;
  return v_offer;
end;
$$;

-- Accepting the offer IS accepting the submission: one action, one source of
-- truth. The offer follows through the trigger below.
create function tci.client_accept_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_offer tci.commercial_offers%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'only a portal user may accept an offer' using errcode = '42501';
  end if;
  v_offer := tci.client_open_offer(p_offer_id, false);
  perform tci.client_respond_to_submission(v_offer.insurance_request_id, 'accept', null);
  select * into v_offer from tci.commercial_offers where id = p_offer_id;
  return jsonb_build_object('status', v_offer.status);
end;
$$;

-- Asking for changes is the existing client_review -> sales_confirmation
-- step, which reopens sales' task with the comment. Allowed on an expired
-- offer too: "the dates ran out, please renew" is a change request.
create function tci.client_request_offer_changes(p_offer_id uuid, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_offer tci.commercial_offers%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'only a portal user may answer an offer' using errcode = '42501';
  end if;
  if coalesce(btrim(p_comment), '') = '' then
    raise exception 'say what should change' using errcode = 'P0001';
  end if;
  if char_length(btrim(p_comment)) > 2000 then
    raise exception 'offer_comment_too_long' using errcode = 'P0001';
  end if;
  v_offer := tci.client_open_offer(p_offer_id, true);
  perform tci.client_respond_to_submission(v_offer.insurance_request_id, 'request_changes', btrim(p_comment));
  select * into v_offer from tci.commercial_offers where id = p_offer_id;
  return jsonb_build_object('status', v_offer.status);
end;
$$;

-- The existing answer step, with one new guard: a submission whose published
-- offer has expired cannot be accepted from anywhere.
create or replace function tci.client_respond_to_submission(p_request_id uuid, p_action text, p_comment text DEFAULT NULL::text)
 RETURNS tci.insurance_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request tci.insurance_requests%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'only a portal user may answer a submission this way'
      using errcode = '42501';
  end if;

  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found or v_request.entity_id not in (select tci.my_client_entities()) then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'client_review' then
    raise exception 'this submission is not with you (it is %)', v_request.status
      using errcode = 'P0001';
  end if;
  -- FIX in 0058: mark the transaction trusted before handing over to the
  -- invoker workflow function. Since 0043 advance_insurance_request opens
  -- with begin_internal_call(), which refused every non-staff caller, so a
  -- client's accept / decline / request-changes failed with 42501.
  perform tci.begin_trusted_call();

  if p_action = 'accept' then
    -- NEW in 0058: the published offer's validity binds every way of accepting.
    if exists (select 1 from tci.commercial_offers o
                where o.insurance_request_id = p_request_id
                  and tci.offer_effective_status(o.status, o.valid_until) = 'expired') then
      raise exception 'offer_expired: the commercial offer for this submission has expired'
        using errcode = 'P0001';
    end if;
    return tci.advance_insurance_request(p_request_id, 'accepted', null);

  elsif p_action = 'decline' then
    if coalesce(btrim(p_comment), '') = '' then
      raise exception 'a decline needs a reason' using errcode = 'P0001';
    end if;
    return tci.advance_insurance_request(p_request_id, 'declined', btrim(p_comment));

  elsif p_action = 'request_changes' then
    if coalesce(btrim(p_comment), '') = '' then
      raise exception 'say what should change' using errcode = 'P0001';
    end if;
    -- Back to sales, not a decline: the client still wants the cover, on
    -- different terms. The status machine gained this transition below.
    return tci.advance_insurance_request(p_request_id, 'sales_confirmation', btrim(p_comment));
  end if;

  raise exception 'unknown action %', p_action using errcode = 'P0001';
end;
$function$;

-- FIX in 0058: begin_internal_call() also accepts a transaction that already
-- carries the internal-call token. The token can only be minted by
-- begin_trusted_call(), which no API role may execute — so its presence
-- proves owner-run definer code is on the stack, and a client reaching an
-- invoker workflow function THROUGH such code (client_respond_to_submission
-- -> advance_insurance_request) is let through. A client calling it directly
-- still has no token and is still refused.
create or replace function tci.begin_internal_call()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not tci.is_staff() and not tci.internal_call_ok() then
    raise exception 'not permitted to enter internal workflow code' using errcode = '42501';
  end if;
  perform set_config('tci.internal_call', tci.internal_call_token(), true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. The Agenda mapping - a SEVENTH trigger on tci.workflow_events
-- ---------------------------------------------------------------------------
-- The offer FOLLOWS its submission: the client's answer, a decline or a
-- withdrawal of the submission settle the live offer here, whichever screen
-- the answer came from.

create function tci.handle_offer_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer tci.commercial_offers%rowtype;
  v_to    text;
  v_sales uuid;
begin
  if not (new.object_type = 'commercial_offer'
          or (new.event_type = 'request.status_changed' and new.object_type = 'insurance_request')) then
    return null;
  end if;
  perform tci.begin_trusted_call();

  if new.event_type = 'request.status_changed' then
    v_to := new.payload ->> 'to';
    if v_to not in ('accepted', 'declined', 'sales_confirmation', 'withdrawn') then
      return null;
    end if;
    for v_offer in
      select * from tci.commercial_offers o
       where o.insurance_request_id = new.object_id
         and o.status in ('published', 'viewed', 'draft', 'changes_requested')
       for update
    loop
      if v_to = 'withdrawn' then
        -- The submission itself is gone: so is any live offer.
        update tci.commercial_offers
           set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = new.actor,
               withdraw_reason = coalesce(new.payload ->> 'comment', 'submission withdrawn')
         where id = v_offer.id;
      elsif v_offer.status in ('published', 'viewed') and (new.payload ->> 'from') = 'client_review' then
        update tci.commercial_offers
           set status = case v_to when 'accepted' then 'accepted'
                                  when 'declined' then 'declined'
                                  else 'changes_requested' end::tci.offer_status,
               answered_at = now(),
               client_comment = case when v_to in ('sales_confirmation', 'declined')
                                     then new.payload ->> 'comment' end
         where id = v_offer.id;
      end if;
      perform tci.close_tasks(array['offer_viewed', 'offer_expiring', 'offer_expired']::tci.task_type[],
                              v_offer.id,
                              case when v_to = 'accepted' then 'done' else 'cancelled' end::tci.task_status);
    end loop;
    return null;
  end if;

  if new.event_type = 'offer.viewed' then
    select ir.assigned_sales into v_sales
      from tci.insurance_requests ir where ir.id = (new.payload ->> 'request_id')::uuid;
    perform tci.open_task(
      'offer_viewed', 'commercial_offer', new.object_id,
      'agenda.tasks.offer_viewed',
      jsonb_build_object('offer_number', new.payload ->> 'offer_number',
                         'request_id', new.payload ->> 'request_id',
                         'request_number', new.payload ->> 'request_number',
                         'entity_name', new.payload ->> 'entity_name',
                         'viewed_at', new.payload ->> 'viewed_at'),
      case when v_sales is null then 'sales'::tci.user_role end, v_sales,
      now() + interval '2 days', 'normal', new.id);

  elsif new.event_type in ('offer.published', 'offer.withdrawn') then
    -- A new publication starts the viewing and the validity clock afresh.
    perform tci.close_tasks(array['offer_viewed', 'offer_expiring', 'offer_expired']::tci.task_type[],
                            new.object_id, 'cancelled');
  end if;
  return null;
end;
$$;

create trigger workflow_events_to_offer_tasks
  after insert on tci.workflow_events
  for each row execute function tci.handle_offer_event();

comment on function tci.handle_offer_event() is
  'Commercial offers (0058): the offer follows its submission (accepted / declined / changes requested / withdrawn), the first view opens offer_viewed for sales, a (re)publication or withdrawal retires the offer tasks.';

-- The time-based offer tasks, generated on read like every other lazy kind.
-- Called by refresh_agenda (owner, inside its trusted call); no API grant.
create function tci.refresh_offer_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened int := 0;
  v_row    record;
  v_today  date := tci.offer_today();
begin
  perform tci.require_internal_call();

  for v_row in
    select o.id, o.offer_number, o.valid_until, o.insurance_request_id, ir.request_number,
           ir.assigned_sales, e.name as entity_name,
           tci.offer_effective_status(o.status, o.valid_until) as eff
      from tci.commercial_offers o
      join tci.insurance_requests ir on ir.id = o.insurance_request_id
      join tci.legal_entities e on e.id = o.entity_id
     where o.status in ('published', 'viewed')
       and o.valid_until <= v_today + 3
  loop
    perform tci.open_task(
      case when v_row.eff = 'expired' then 'offer_expired' else 'offer_expiring' end::tci.task_type,
      'commercial_offer', v_row.id,
      case when v_row.eff = 'expired' then 'agenda.tasks.offer_expired' else 'agenda.tasks.offer_expiring' end,
      jsonb_build_object('offer_number', v_row.offer_number, 'valid_until', v_row.valid_until,
                         'request_id', v_row.insurance_request_id,
                         'request_number', v_row.request_number, 'entity_name', v_row.entity_name),
      case when v_row.assigned_sales is null then 'sales'::tci.user_role end, v_row.assigned_sales,
      ((v_row.valid_until + 1)::timestamp at time zone 'Asia/Tashkent'),
      'high', null);
    v_opened := v_opened + 1;
  end loop;

  -- Expiring that has since expired, or is no longer near (republished with a
  -- later date): retire. Answered or withdrawn offers were settled by the
  -- trigger already.
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'offer_expiring' and t.status = 'open'
     and not exists (select 1 from tci.commercial_offers o
                      where o.id = t.object_id and o.status in ('published', 'viewed')
                        and o.valid_until between v_today and v_today + 3);
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'offer_expired' and t.status = 'open'
     and not exists (select 1 from tci.commercial_offers o
                      where o.id = t.object_id and o.status in ('published', 'viewed')
                        and o.valid_until < v_today);
  return v_opened;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Storage: the brochure's images - private, raster only, never replaced
-- ---------------------------------------------------------------------------
-- Readable by every signed-in user (a portal client reads the brochure that
-- came with their offer); written by admin and sales only, one file per new
-- uuid name, no UPDATE or removal policy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-assets', 'media-assets', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "media assets: signed-in read" on storage.objects
  for select to authenticated
  using (bucket_id = 'media-assets');

create policy "media assets: admin and sales upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media-assets'
    and tci.has_role('admin', 'sales')
    and name ~* '^[0-9a-f-]{36}\.(png|jpe?g|webp)$');

-- ---------------------------------------------------------------------------
-- 12. Grants: every new function revokes PUBLIC and anon explicitly
-- ---------------------------------------------------------------------------

revoke all on function tci.offer_today() from public, anon;
revoke all on function tci.offer_effective_status(tci.offer_status, date) from public, anon;
revoke all on function tci.offer_is_live(tci.offer_status) from public, anon;
revoke all on function tci.offer_request_status_ok(tci.insurance_request_status) from public, anon;
revoke all on function tci.offer_texts_ok(jsonb) from public, anon;
revoke all on function tci.current_brochure_version() from public, anon;
revoke all on function tci.create_commercial_offer(uuid, text, jsonb, date, boolean) from public, anon;
revoke all on function tci.save_offer_version(uuid, int, jsonb, date, boolean, text) from public, anon;
revoke all on function tci.publish_offer(uuid) from public, anon;
revoke all on function tci.withdraw_offer(uuid, text) from public, anon;
revoke all on function tci.save_brochure_version(jsonb, text) from public, anon;
revoke all on function tci.publish_brochure_version(uuid) from public, anon;
revoke all on function tci.register_media_asset(text, text, jsonb, text, text, text, text, int, int, int) from public, anon;
revoke all on function tci.update_media_asset(uuid, jsonb, text, text, text, text) from public, anon;
revoke all on function tci.retire_media_asset(uuid) from public, anon;
revoke all on function tci.client_view_offer(uuid) from public, anon;
revoke all on function tci.client_accept_offer(uuid) from public, anon;
revoke all on function tci.client_request_offer_changes(uuid, text) from public, anon;
-- internal and trigger functions: no API role at all
revoke all on function tci.offer_merge_data(uuid, uuid) from public, anon, authenticated;
revoke all on function tci.append_offer_version(tci.commercial_offers, jsonb, date, boolean, text)
  from public, anon, authenticated;
revoke all on function tci.client_open_offer(uuid, boolean) from public, anon, authenticated;
revoke all on function tci.refresh_offer_tasks() from public, anon, authenticated;
revoke all on function tci.set_commercial_offer_number() from public, anon, authenticated;
revoke all on function tci.refuse_offer_version_change() from public, anon, authenticated;
revoke all on function tci.guard_brochure_version_change() from public, anon, authenticated;
revoke all on function tci.handle_offer_event() from public, anon, authenticated;

grant execute on function tci.offer_today() to authenticated, service_role;
grant execute on function tci.offer_effective_status(tci.offer_status, date) to authenticated, service_role;
grant execute on function tci.offer_is_live(tci.offer_status) to authenticated, service_role;
grant execute on function tci.offer_request_status_ok(tci.insurance_request_status) to authenticated, service_role;
grant execute on function tci.offer_texts_ok(jsonb) to authenticated, service_role;
grant execute on function tci.current_brochure_version() to authenticated, service_role;
grant execute on function tci.create_commercial_offer(uuid, text, jsonb, date, boolean) to authenticated, service_role;
grant execute on function tci.save_offer_version(uuid, int, jsonb, date, boolean, text) to authenticated, service_role;
grant execute on function tci.publish_offer(uuid) to authenticated, service_role;
grant execute on function tci.withdraw_offer(uuid, text) to authenticated, service_role;
grant execute on function tci.save_brochure_version(jsonb, text) to authenticated, service_role;
grant execute on function tci.publish_brochure_version(uuid) to authenticated, service_role;
grant execute on function tci.register_media_asset(text, text, jsonb, text, text, text, text, int, int, int) to authenticated, service_role;
grant execute on function tci.update_media_asset(uuid, jsonb, text, text, text, text) to authenticated, service_role;
grant execute on function tci.retire_media_asset(uuid) to authenticated, service_role;
grant execute on function tci.client_view_offer(uuid) to authenticated, service_role;
grant execute on function tci.client_accept_offer(uuid) to authenticated, service_role;
grant execute on function tci.client_request_offer_changes(uuid, text) to authenticated, service_role;
grant execute on function tci.offer_merge_data(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 13. refresh_agenda: the 0056 body verbatim, plus the offer tasks
-- ---------------------------------------------------------------------------

create or replace function tci.refresh_agenda()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_opened int := 0;
  v_row record;
  v_client uuid;
begin
  perform tci.begin_trusted_call();
  if not tci.is_staff() then
    raise exception 'only staff have an agenda' using errcode = '42501';
  end if;

  -- (1) Effective limits expiring within 30 days need a review decision.
  for v_row in
    select v.entity_id, v.policy_id, v.valid_until, v.approved_amount, v.currency_code
    from tci.v_effective_limits v
    where v.valid_until is not null
      and v.valid_until <= current_date + 30
      and v.outcome in ('approved', 'partial')
  loop
    perform tci.open_task(
      'limit_review_due', 'legal_entity', v_row.entity_id,
      'agenda.tasks.limit_review_due',
      jsonb_build_object(
        'entity_id', v_row.entity_id,
        'policy_id', v_row.policy_id,
        'valid_until', v_row.valid_until,
        'amount', v_row.approved_amount,
        'currency', v_row.currency_code),
      'credit_underwriter'::tci.user_role, null,
      v_row.valid_until::timestamptz,
      case when v_row.valid_until <= current_date + 7 then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'limit_review_due'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_effective_limits v
        where v.entity_id = t.object_id
          and v.valid_until is not null
          and v.valid_until <= current_date + 30
          and v.outcome in ('approved', 'partial')
     );

  -- (2) A company carrying an effective limit on a rating older than a year.
  for v_row in
    select distinct v.entity_id
    from tci.v_effective_limits v
    where v.outcome in ('approved', 'partial')
      and not exists (
        select 1 from tci.credit_assessments a
         where a.entity_id = v.entity_id
           and a.created_at > now() - interval '12 months'
      )
  loop
    perform tci.open_task(
      'rating_stale', 'legal_entity', v_row.entity_id,
      'agenda.tasks.rating_stale',
      jsonb_build_object('entity_id', v_row.entity_id),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'rating_stale'
     and t.status = 'open'
     and exists (
       select 1 from tci.credit_assessments a
        where a.entity_id = t.object_id
          and a.created_at > now() - interval '12 months'
     );

  -- (3) NEW: the declaration period that has CLOSED and has not been declared.
  -- Keyed on the policy, not on a declaration row, because the whole point is
  -- that the declaration does not exist yet.
  for v_row in
    select p.id as policy_id,
           p.policy_number,
           p.declaration_frequency,
           tci.declaration_period_start(
             (tci.declaration_period_start(current_date, p.declaration_frequency)
              - interval '1 day')::date,
             p.declaration_frequency) as period_start
    from tci.policies p
    where p.status = 'active'
      -- Only chase a period the policy was actually live for: a policy
      -- incepted this month owes nothing for last month.
      and tci.declaration_period_start(
            (tci.declaration_period_start(current_date, p.declaration_frequency)
             - interval '1 day')::date,
            p.declaration_frequency)
          >= tci.declaration_period_start(p.inception_date, p.declaration_frequency)
  loop
    if not exists (
      select 1 from tci.declarations d
       where d.policy_id = v_row.policy_id
         and d.period_start = v_row.period_start
         and d.status <> 'corrected'
    ) then
      perform tci.open_task(
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'declaration_overdue' else 'declaration_due' end::tci.task_type,
        'policy', v_row.policy_id,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'agenda.tasks.declaration_overdue' else 'agenda.tasks.declaration_due' end,
        jsonb_build_object(
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'period_start', v_row.period_start,
          'period_end', tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency)),
        'sales'::tci.user_role, null,
        (tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30)::timestamptz,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'high' else 'normal' end::tci.task_priority,
        null);
      v_opened := v_opened + 1;
    end if;
  end loop;

  -- Retire chasing tasks once the period HAS been declared, or the policy
  -- stopped being active.
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('declaration_due', 'declaration_overdue')
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.declarations d
          where d.policy_id = t.object_id
            and d.period_start = (t.params->>'period_start')::date
            and d.status <> 'corrected'
       )
       or not exists (
         select 1 from tci.policies p where p.id = t.object_id and p.status = 'active'
       )
     );

  -- (4) instalments falling due, and instalments already past due. Since
  -- 0056 an instalment is owed while it has an OUTSTANDING amount, whatever
  -- its billing status, and the task carries what is still owed.
  for v_row in
    select vi.id, vi.policy_id, vi.sequence, vi.due_date, vi.outstanding, vi.amount,
           vi.invoice_number, p.policy_number, p.currency_code
    from tci.v_premium_instalments vi
    join tci.policies p on p.id = vi.policy_id
    where vi.derived_status <> 'cancelled'
      and vi.outstanding > 0
      and vi.due_date <= current_date + 14
  loop
    perform tci.open_task(
      case when v_row.due_date < current_date
           then 'instalment_overdue' else 'instalment_due' end::tci.task_type,
      'premium_instalment', v_row.id,
      case when v_row.due_date < current_date
           then 'agenda.tasks.instalment_overdue' else 'agenda.tasks.instalment_due' end,
      jsonb_build_object(
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'sequence', v_row.sequence,
        'due_date', v_row.due_date,
        'amount', v_row.outstanding,
        'scheduled', v_row.amount,
        'invoice_number', v_row.invoice_number,
        'currency', v_row.currency_code),
      'commercial_underwriter'::tci.user_role, null,
      v_row.due_date::timestamptz,
      case when v_row.due_date < current_date then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  -- An open task follows what is still owed (a part payment lowers it).
  -- (The owed set is materialised once: the view's allocation is a window
  -- over each policy, which a per-task lookup would recompute.)
  with owed as materialized (
    select vi.id, vi.outstanding from tci.v_premium_instalments vi where vi.outstanding > 0
  )
  update tci.tasks t
     set params = t.params || jsonb_build_object('amount', owed.outstanding)
    from owed
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and owed.id = t.object_id
     and (t.params->>'amount')::numeric is distinct from owed.outstanding;

  with chased as materialized (
    select vi.id from tci.v_premium_instalments vi
     where vi.derived_status <> 'cancelled'
       and vi.outstanding > 0
       and vi.due_date <= current_date + 14
  )
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and not exists (select 1 from chased c where c.id = t.object_id);

  -- (5) NEW: an open overdue notification whose waiting period has run. The
  -- debt is now claimable, so the policyholder is told they may file and
  -- claims is told to expect it. Neither is a claim: only the policyholder
  -- decides that a debt is a loss.
  for v_row in
    select n.id, n.policy_id, n.entity_id, n.first_due_date, n.overdue_amount,
           n.currency_code, p.policy_number, p.waiting_period_days,
           (n.first_due_date + p.waiting_period_days) as claimable_from
    from tci.overdue_notifications n
    join tci.policies p on p.id = n.policy_id
    where n.status = 'open'
      and current_date >= n.first_due_date + p.waiting_period_days
      and not exists (
        select 1 from tci.claims c
         where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
  loop
    perform tci.open_task(
      'noa_matured_to_claim', 'overdue_notification', v_row.id,
      'agenda.tasks.noa_matured_to_claim',
      jsonb_build_object(
        'noa_id', v_row.id,
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'entity_id', v_row.entity_id,
        'amount', v_row.overdue_amount,
        'currency', v_row.currency_code,
        'claimable_from', v_row.claimable_from),
      'claims'::tci.user_role, null, v_row.claimable_from::timestamptz, 'normal', null);
    v_opened := v_opened + 1;

    -- Addressed to the individual portal users, never to the client role:
    -- every policyholder holds that role, so a role-targeted task would show
    -- them each other's files.
    for v_client in select tci.policyholder_user_ids(v_row.policy_id) loop
      perform tci.open_task(
        'claim_ready_to_file', 'overdue_notification', v_row.id,
        'agenda.tasks.claim_ready_to_file',
        jsonb_build_object(
          'noa_id', v_row.id,
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'entity_id', v_row.entity_id,
          'amount', v_row.overdue_amount,
          'currency', v_row.currency_code,
          'claimable_from', v_row.claimable_from),
        null, v_client, v_row.claimable_from::timestamptz, 'normal', null);
      v_opened := v_opened + 1;
    end loop;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('noa_matured_to_claim', 'claim_ready_to_file')
     and t.status = 'open'
     and not exists (
       select 1 from tci.overdue_notifications n
        where n.id = t.object_id
          and n.status = 'open'
          and not exists (
            select 1 from tci.claims c
             where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
     );

  -- (6) NEW: retire the reinstatement review once the buyer holds a live limit
  -- again, or the claim file is closed. The credit underwriter's decision IS
  -- the completion signal, so this type needs no button either.
  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        join tci.v_effective_limits v
          on v.policy_id = c.policy_id and v.entity_id = c.entity_id
       where c.id = t.object_id
         and v.outcome in ('approved', 'partial')
     );
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        where c.id = t.object_id and c.status in ('closed', 'withdrawn')
     );

  -- (7) NEW (Phase 6): a group whose exposure has crossed the warning share of
  -- its group limit. Keyed on the ULTIMATE PARENT, which is the group's
  -- identity - there is no group record to key on.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           gl.max_amount, gl.currency_code,
           tci.to_uzs(gl.max_amount, gl.currency_code) as limit_uzs
      from tci.v_group_exposure ge
      join tci.group_limits gl
        on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
       and gl.valid_from <= current_date
       and (gl.valid_to is null or gl.valid_to >= current_date)
     where tci.to_uzs(gl.max_amount, gl.currency_code) > 0
       and ge.exposure_uzs
           >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
  loop
    perform tci.open_task(
      'group_exposure_near_limit', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_exposure_near_limit',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'exposure_uzs', v_row.exposure_uzs,
        'limit_uzs', v_row.limit_uzs,
        'utilisation_pct', round(v_row.exposure_uzs * 100 / v_row.limit_uzs, 1)),
      'credit_underwriter'::tci.user_role, null, null, 'high', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_exposure_near_limit'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_group_exposure ge
        join tci.group_limits gl
          on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
         and gl.valid_from <= current_date
         and (gl.valid_to is null or gl.valid_to >= current_date)
       where ge.ultimate_parent_id = t.object_id
         and tci.to_uzs(gl.max_amount, gl.currency_code) > 0
         and ge.exposure_uzs
             >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
     );

  -- (8) NEW (Phase 6): a group carrying limits with NO group limit set. Not an
  -- error - most single-company "groups" never need one - so it is only raised
  -- where the group actually has more than one member.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           ge.members_with_limits
      from tci.v_group_exposure ge
     where ge.members_with_limits > 1
       and not exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = ge.ultimate_parent_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
  loop
    perform tci.open_task(
      'group_limit_missing', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_limit_missing',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'members_with_limits', v_row.members_with_limits,
        'exposure_uzs', v_row.exposure_uzs),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_limit_missing'
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = t.object_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
       or not exists (
         select 1 from tci.v_group_exposure ge
          where ge.ultimate_parent_id = t.object_id and ge.members_with_limits > 1)
     );

  -- (9) 0055: new statements since the rating. A buyer with live credit
  -- business whose latest statements cover a LATER period than the ones its
  -- current rating was calculated on: the rating is a period behind. The
  -- params carry what the system note says — which statements, who added
  -- them and when, and what the current rating rests on.
  for v_row in
    select w.entity_id, w.assessment_id, w.grade, w.rated_at, w.rated_period_end,
           w.limits_in_force, ca.rating_score,
           fs.id as statement_id, fs.statement_kind, fs.fiscal_year, fs.fiscal_quarter,
           fs.period_end_date, fs.report_type, fs.created_by, fs.created_at
      from tci.v_rating_worklist w
      left join tci.credit_assessments ca on ca.id = w.assessment_id
      join lateral (
        select s.* from tci.financial_statements s
         where s.entity_id = w.entity_id
         order by s.period_end_date desc, s.created_at desc
         limit 1
      ) fs on true
     where w.reason = 'new_statement'
  loop
    perform tci.open_task(
      'rating_new_statements', 'legal_entity', v_row.entity_id,
      'agenda.tasks.rating_new_statements',
      jsonb_build_object(
        'entity_id', v_row.entity_id,
        'statement_id', v_row.statement_id,
        'statement_kind', v_row.statement_kind,
        'fiscal_year', v_row.fiscal_year,
        'fiscal_quarter', v_row.fiscal_quarter,
        'period_end', v_row.period_end_date,
        'report_type', v_row.report_type,
        'added_by', v_row.created_by,
        'added_at', v_row.created_at,
        'assessment_id', v_row.assessment_id,
        'grade', v_row.grade,
        'score', v_row.rating_score,
        'rated_at', v_row.rated_at,
        'rated_period_end', v_row.rated_period_end,
        'limits_in_force', v_row.limits_in_force),
      'credit_underwriter'::tci.user_role, null,
      -- The clock starts when the Agenda first sees the work, not when the
      -- statements were typed in: a backlog must not arrive months overdue.
      greatest(v_row.created_at, now()) + interval '7 days',
      case when v_row.limits_in_force > 0 then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  -- Rated since (done), or no longer live business / statements removed
  -- (cancelled).
  update tci.tasks t
     set status = case when exists (
                          select 1 from tci.credit_assessments a
                           where a.entity_id = t.object_id and a.created_at >= t.created_at)
                       then 'done' else 'cancelled' end::tci.task_status,
         completed_at = now()
   where t.task_type = 'rating_new_statements'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_rating_worklist w
        where w.entity_id = t.object_id and w.reason = 'new_statement');

  -- (0058) Commercial offers close to, or past, their last valid day.
  v_opened := v_opened + tci.refresh_offer_tasks();

  return v_opened;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 14. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  if (select public from storage.buckets where id = 'media-assets') is distinct from false then
    raise exception '0058: the media-assets bucket must exist and be private';
  end if;

  -- No direct write on the four tables for the API roles.
  select string_agg(t || ':' || p, ', ') into v_bad
    from unnest(array['commercial_offers', 'commercial_offer_versions', 'brochure_versions', 'media_assets']) t,
         unnest(array['insert', 'update', 'delete']) p
   where has_table_privilege('authenticated', 'tci.' || t, p)
      or has_table_privilege('anon', 'tci.' || t, p);
  if v_bad is not null then
    raise exception '0058: direct writes left open: %', v_bad;
  end if;

  -- Every new SECURITY DEFINER function executable by authenticated is gated.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosecdef
     and p.proname in ('create_commercial_offer', 'save_offer_version', 'publish_offer', 'withdraw_offer',
                       'save_brochure_version', 'publish_brochure_version', 'register_media_asset',
                       'update_media_asset', 'retire_media_asset', 'client_view_offer',
                       'client_accept_offer', 'client_request_offer_changes')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.prosrc !~* 'tci\.require_(role|staff)\(|tci\.has_role\(';
  if v_bad is not null then
    raise exception '0058: ungated: %', v_bad;
  end if;

  -- The internal pieces are reachable by no API role, and anon reaches nothing new.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci'
     and p.proname in ('offer_merge_data', 'append_offer_version', 'client_open_offer',
                       'refresh_offer_tasks', 'handle_offer_event')
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'));
  if v_bad is not null then
    raise exception '0058: internal functions reachable by an API role: %', v_bad;
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and has_function_privilege('anon', p.oid, 'execute')
     and (p.proname like '%offer%' or p.proname like '%brochure%' or p.proname like '%media_asset%');
  if v_bad is not null then
    raise exception '0058: anon can execute: %', v_bad;
  end if;

  -- One source of truth for acceptance, and the validity binds it.
  if (select prosrc from pg_proc where oid = 'tci.client_accept_offer(uuid)'::regprocedure)
       !~ 'tci\.client_respond_to_submission\(' then
    raise exception '0058: client_accept_offer must accept through client_respond_to_submission';
  end if;
  if (select prosrc from pg_proc
       where oid = 'tci.client_respond_to_submission(uuid, text, text)'::regprocedure) !~ 'offer_expired' then
    raise exception '0058: client_respond_to_submission lost the offer validity guard';
  end if;
  if (select prosrc from pg_proc
       where oid = 'tci.client_respond_to_submission(uuid, text, text)'::regprocedure) !~ 'begin_trusted_call'
     or (select prosrc from pg_proc where oid = 'tci.begin_internal_call()'::regprocedure) !~ 'internal_call_ok' then
    raise exception '0058: the client answer path must reach advance_insurance_request';
  end if;
  if (select prosrc from pg_proc where oid = 'tci.refresh_agenda()'::regprocedure) !~ 'refresh_offer_tasks'
     or (select prosrc from pg_proc where oid = 'tci.refresh_agenda()'::regprocedure) !~ 'v_premium_instalments' then
    raise exception '0058: refresh_agenda must keep the 0056 body and call refresh_offer_tasks';
  end if;

  -- The client view never carries an internal field.
  select string_agg(a.attname, ', ') into v_bad
    from pg_attribute a
   where a.attrelid = 'tci.v_client_offers'::regclass and a.attnum > 0
     and a.attname in ('created_by', 'published_by', 'withdrawn_by', 'withdraw_reason', 'note',
                       'author_id', 'current_version_id', 'grade', 'comment');
  if v_bad is not null then
    raise exception '0058: v_client_offers exposes internal columns: %', v_bad;
  end if;
end $$;
