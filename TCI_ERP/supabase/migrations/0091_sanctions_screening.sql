-- 0091_sanctions_screening.sql
--
-- What: sanctions screening as an ongoing process of the credit analysts
--       (owner request 2026-10-27).
--
--       1. The official lists — OFAC SDN, the UN Security Council
--          consolidated list, the EU consolidated financial sanctions list,
--          the UK Sanctions List, or another named list — are imported as
--          published (the browser reads the file, the database keeps one row
--          per listed party and every name it is known by). An import is
--          loaded in batches and takes effect at once when finished; a party
--          missing from the newer file is DELISTED, never deleted. Names are
--          normalised (case, Cyrillic and Uzbek Latin, diacritics, legal
--          forms) into a trigram-indexed column.
--       2. Beneficial owners (people) per company: tci.entity_beneficial_owners,
--          entered by the information desk and credit analysts, ended with a
--          reason, never deleted.
--       3. Screening (tci.screen_entity_internal) compares the company, the
--          companies above it in the registry (ownership and control,
--          cycle-safe, live today) and the beneficial owners of all of them
--          against the lists in use (the nearest names by trigram
--          distance, scored by similarity or by every word of one name
--          being in the other — tci.sanctions_name_score — at or above
--          workflow_settings.sanctions_match_threshold; people against
--          people, companies against companies). It runs by itself when a
--          rating is created and when a limit request is submitted (before
--          the auto decision), when an owner, an ownership link or the name
--          changes, and after a list is imported (in batches, the screen
--          driving them, and lazily from refresh_agenda).
--       4. A possible match is a row of tci.sanctions_matches, remembered per
--          (company, subject, list entry): a match cleared as a false
--          positive is never raised again for the same name. Pending matches
--          open ONE sanctions_match_review task per company for the
--          LEAST-LOADED active credit analyst (as 0054 distributes data
--          requests); the analyst CONFIRMS (a sanctions flag is set on the
--          company through set_sanction_flag, with its limit reviews) or
--          CLEARS it, with a note. The task closes when nothing is pending.
--       5. While a match is pending: no auto decision (stop factor
--          `sanctions_match`, which also suspends a live ADT) and no
--          approving credit decision (`sanctions_screening_pending`, a
--          BEFORE INSERT trigger on the decisions, for every writer).
--       6. Sanctions flags are maintained by credit analysts
--          (tci.may_manage_sanctions); admin keeps reading them.
--       7. sanctions_list_due: a lazy reminder for the least-loaded credit
--          analyst while a required list (workflow_settings.sanctions_required_lists)
--          is missing or older than sanctions_list_stale_days.
--       8. tci.sanctions_search (any staff) — a name against the lists in
--          use, for the tools page; tci.sanctions_subjects (any staff) — the
--          names screened for a company, to check by hand in the official
--          search tools; tci.screen_entity_now (any staff).
--       9. tci.v_entity_sanctions_status (the registry and limit tables'
--          column) and tci.v_sanctions_lists.
--
-- Agenda (0090 types):
--   sanctions_match_review   credit_analyst (the least-loaded one, by name)
--                                                 high    AUTO: nothing on the
--                                                         company is pending
--   sanctions_list_due       credit_analyst (the least-loaded one, by name)
--                                                 normal  AUTO: every required
--                                                         list is fresh
--
-- Why:  cover for a sanctioned party is forbidden (0085 refuses it once a
--       flag exists); this is how the flag comes to exist without relying on
--       someone remembering to look. Everything is staff-only; a client
--       never learns that a match was raised.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

alter table tci.workflow_settings
  add column sanctions_match_threshold numeric(3,2) not null default 0.60
    constraint workflow_settings_sanctions_threshold check (sanctions_match_threshold between 0.30 and 1.00),
  add column sanctions_list_stale_days smallint not null default 30
    constraint workflow_settings_sanctions_stale check (sanctions_list_stale_days between 1 and 365),
  add column sanctions_required_lists text[] not null default '{ofac_sdn,un,eu,uk}'
    constraint workflow_settings_sanctions_lists check (sanctions_required_lists <@ array['ofac_sdn', 'un', 'eu', 'uk']);

comment on column tci.workflow_settings.sanctions_match_threshold is
  '0091: the trigram similarity (0.30–1.00) from which a name on a sanctions list is a possible match.';
comment on column tci.workflow_settings.sanctions_list_stale_days is
  '0091: a required list published longer ago than this (or missing) opens sanctions_list_due.';
comment on column tci.workflow_settings.sanctions_required_lists is
  '0091: the official lists the reminder expects (ofac_sdn, un, eu, uk).';

create function tci.set_sanctions_settings(p_threshold numeric, p_stale_days smallint, p_required text[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform tci.require_role('admin');
  update tci.workflow_settings
     set sanctions_match_threshold = p_threshold,
         sanctions_list_stale_days = p_stale_days,
         sanctions_required_lists = coalesce(p_required, '{}')
   where id;
end $$;
revoke all on function tci.set_sanctions_settings(numeric, smallint, text[]) from public, anon;
grant execute on function tci.set_sanctions_settings(numeric, smallint, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Name normalisation
-- ---------------------------------------------------------------------------

-- One name for comparison: lower case, Cyrillic (Russian and Uzbek)
-- transliterated the Uzbek Latin way (х → x, ж → j, «kh» → x, «zh»/«dzh» →
-- j, so «Xo‘jayev», «Ходжаев» and «KHODZHAEV» meet), diacritics dropped,
-- apostrophes and dots removed, other punctuation to spaces, legal forms dropped. Explicit
-- upper-to-lower tables: lower() alone depends on the collation. Never
-- NULL-safe text for display — only for comparison.
create function tci.sanctions_normalise(p text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare v text;
begin
  if p is null then
    return null;
  end if;
  v := translate(p,
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯЎҚҒҲÀÁÂÃÄÅĀĂĄÇĆČĎĐÈÉÊËĒĖĘĚĞÌÍÎÏĪĮŁÑŃŇÒÓÔÕÖØŌŐŘŚŞŠȘŢŤȚÙÚÛÜŪŮŰŲÝŸŹŻŽ',
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюяўқғҳàáâãäåāăąçćčďđèéêëēėęěğìíîïīįłñńňòóôõöøōőřśşšșţťțùúûüūůűųýÿźżž');
  v := lower(v);
  v := replace(v, 'дж', 'j');
  v := replace(v, 'щ', 'shch');
  v := replace(v, 'ш', 'sh');
  v := replace(v, 'ч', 'ch');
  v := replace(v, 'ц', 'ts');
  v := replace(v, 'ю', 'yu');
  v := replace(v, 'я', 'ya');
  v := regexp_replace(v, '[ъь]', '', 'g');
  v := translate(v, 'абвгдеёжзийклмнопрстуфхыэўқғҳ', 'abvgdeejziyklmnoprstufxyeoqgh');
  v := translate(v, 'àáâãäåāăąçćčďđèéêëēėęěğìíîïīįıłñńňòóôõöøōőřśşšșţťțùúûüūůűųýÿźżž',
                    'aaaaaaaaacccddeeeeeeeegiiiiiiilnnnoooooooorsssstttuuuuuuuuyyzzz');
  v := replace(v, 'æ', 'ae');
  v := replace(v, 'œ', 'oe');
  v := replace(v, 'ß', 'ss');
  v := regexp_replace(v, '[‘’ʻʼ`´'']', '', 'g');
  -- «S.A.», «J.S.C.»: abbreviations close up before punctuation becomes space.
  v := replace(v, '.', '');
  v := replace(v, 'dzh', 'j');
  v := replace(v, 'zh', 'j');
  v := replace(v, 'kh', 'x');
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := regexp_replace(v,
    '\m(llc|ltd|limited|inc|incorporated|corp|corporation|co|company|jsc|ojsc|cjsc|pjsc|oao|zao|ooo|ao|pao|tov|mchj|aj|qk|xk|gmbh|ag|sa|sarl|srl|spa|bv|nv|plc|llp|lp|fze|fzco|fzc|kft|sro)\M',
    ' ', 'g');
  v := btrim(regexp_replace(v, '\s+', ' ', 'g'));
  return nullif(v, '');
end $$;
revoke all on function tci.sanctions_normalise(text) from public, anon;
grant execute on function tci.sanctions_normalise(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The lists
-- ---------------------------------------------------------------------------

create table tci.sanctions_list_imports (
  id            uuid primary key default gen_random_uuid(),
  list          text not null check (list in ('ofac_sdn', 'un', 'eu', 'uk', 'other')),
  list_name     text check (list_name is null or (btrim(list_name) <> '' and length(list_name) <= 120)),
  list_key      text not null generated always as (
                  case when list = 'other' then 'other:' || lower(btrim(coalesce(list_name, ''))) else list end) stored,
  published_at  date not null,
  file_name     text not null check (btrim(file_name) <> '' and length(file_name) <= 255),
  file_sha256   text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status        text not null default 'loading' check (status in ('loading', 'active', 'superseded', 'abandoned')),
  entry_count   integer not null default 0,
  name_count    integer not null default 0,
  delisted_count integer not null default 0,
  imported_by   uuid not null references auth.users (id),
  started_at    timestamptz not null default clock_timestamp(),
  activated_at  timestamptz,
  superseded_at timestamptz,
  constraint sanctions_list_imports_other check ((list = 'other') = (list_name is not null)),
  constraint sanctions_list_imports_activated check ((status in ('active', 'superseded')) = (activated_at is not null))
);
create unique index sanctions_list_imports_active on tci.sanctions_list_imports (list_key) where status = 'active';
comment on table tci.sanctions_list_imports is
  '0091: one row per sanctions list file imported (OFAC SDN, UN, EU, UK or another named list). Loaded in batches, then active; the previous active import of the same list is superseded. Written only by the import functions.';

create table tci.sanctions_list_entries (
  id                 uuid primary key default gen_random_uuid(),
  list_key           text not null,
  list_ref           text not null check (btrim(list_ref) <> '' and length(list_ref) <= 100),
  kind               text not null check (kind in ('person', 'entity', 'vessel', 'aircraft', 'other')),
  primary_name       text not null check (btrim(primary_name) <> '' and length(primary_name) <= 500),
  programmes         text[] not null default '{}',
  countries          text[] not null default '{}',
  birth_dates        text[] not null default '{}',
  listed_on          date,
  remarks            text check (remarks is null or length(remarks) <= 2000),
  first_import_id    uuid not null references tci.sanctions_list_imports (id),
  last_import_id     uuid not null references tci.sanctions_list_imports (id),
  delisted_at        timestamptz,
  delisted_import_id uuid references tci.sanctions_list_imports (id),
  constraint sanctions_list_entries_ref unique (list_key, list_ref),
  constraint sanctions_list_entries_delisted check ((delisted_at is null) = (delisted_import_id is null))
);
comment on table tci.sanctions_list_entries is
  '0091: one listed party per (list, the list''s own reference), as the latest import of that list published it. A party missing from a newer file is delisted (stamped), never deleted.';

create table tci.sanctions_list_names (
  entry_id       uuid not null references tci.sanctions_list_entries (id),
  name           text not null check (btrim(name) <> '' and length(name) <= 500),
  norm           text not null generated always as (coalesce(tci.sanctions_normalise(name), '')) stored,
  is_primary     boolean not null default false,
  last_import_id uuid not null references tci.sanctions_list_imports (id),
  primary key (entry_id, norm)
);
-- GiST, not GIN: candidates are the NEAREST names by trigram distance
-- (`<->`, a k-nearest-neighbour index scan), tens of milliseconds over the
-- four official lists, whatever the threshold.
create index sanctions_list_names_trgm on tci.sanctions_list_names using gist (norm extensions.gist_trgm_ops);
comment on table tci.sanctions_list_names is
  '0091: every name (primary and aliases) a listed party is known by, with its normalised form (tci.sanctions_normalise, trigram-indexed for nearest-neighbour search). A name is current while its last_import_id is its entry''s.';

-- Nobody but the import functions writes the lists.
alter table tci.sanctions_list_imports enable row level security;
alter table tci.sanctions_list_entries enable row level security;
alter table tci.sanctions_list_names enable row level security;
create policy "sanctions_list_imports: staff read" on tci.sanctions_list_imports for select to authenticated using (tci.is_staff());
create policy "sanctions_list_entries: staff read" on tci.sanctions_list_entries for select to authenticated using (tci.is_staff());
create policy "sanctions_list_names: staff read" on tci.sanctions_list_names for select to authenticated using (tci.is_staff());
grant select on tci.sanctions_list_imports, tci.sanctions_list_entries, tci.sanctions_list_names to authenticated;
grant select on tci.sanctions_list_imports, tci.sanctions_list_entries, tci.sanctions_list_names to service_role;

-- The regime a list stands for on a sanctions flag (0085's regimes).
create function tci.sanctions_list_regime(p_list_key text) returns text
language sql immutable set search_path = '' as $$
  select case p_list_key when 'ofac_sdn' then 'OFAC' when 'un' then 'UN' when 'eu' then 'EU' when 'uk' then 'UK' else 'other' end
$$;
revoke all on function tci.sanctions_list_regime(text) from public, anon;
grant execute on function tci.sanctions_list_regime(text) to authenticated, service_role;

-- Who imports lists: credit analysts (the process is theirs) and admin
-- (reference data).
create function tci.may_import_sanctions_lists() returns boolean
language sql stable security definer set search_path = '' as $$
  select tci.has_role('credit_analyst', 'admin')
$$;
revoke all on function tci.may_import_sanctions_lists() from public, anon;
grant execute on function tci.may_import_sanctions_lists() to authenticated, service_role;

create function tci.begin_sanctions_list_import(
  p_list text, p_list_name text, p_published_at date, p_file_name text, p_sha256 text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_key    text;
  v_active tci.sanctions_list_imports%rowtype;
  v_id     uuid;
begin
  perform tci.require_staff();
  if not tci.may_import_sanctions_lists() then
    raise exception 'sanctions_import_only: sanctions lists are imported by credit analysts and admin' using errcode = '42501';
  end if;
  if p_list is null or p_list not in ('ofac_sdn', 'un', 'eu', 'uk', 'other') then
    raise exception 'sanctions_list_unknown: %', p_list using errcode = 'P0001';
  end if;
  if p_list = 'other' and coalesce(btrim(p_list_name), '') = '' then
    raise exception 'sanctions_list_name_required: name the list' using errcode = 'P0001';
  end if;
  if p_published_at is null or p_published_at > current_date then
    raise exception 'sanctions_list_date: the list''s publication date is required and not in the future' using errcode = 'P0001';
  end if;
  v_key := case when p_list = 'other' then 'other:' || lower(btrim(p_list_name)) else p_list end;
  select * into v_active from tci.sanctions_list_imports i where i.list_key = v_key and i.status = 'active';
  if found and v_active.published_at > p_published_at then
    raise exception 'sanctions_list_older: the list in use was published on %', v_active.published_at
      using errcode = 'P0001';
  end if;
  if found and p_sha256 is not null and v_active.file_sha256 = lower(p_sha256) then
    raise exception 'sanctions_list_same: this file is the list in use' using errcode = 'P0001';
  end if;
  update tci.sanctions_list_imports
     set status = 'abandoned'
   where list_key = v_key and status = 'loading';
  insert into tci.sanctions_list_imports (list, list_name, published_at, file_name, file_sha256, imported_by)
  values (p_list, case when p_list = 'other' then btrim(p_list_name) end, p_published_at, btrim(p_file_name),
          lower(nullif(btrim(p_sha256), '')), (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function tci.begin_sanctions_list_import(text, text, date, text, text) from public, anon;
grant execute on function tci.begin_sanctions_list_import(text, text, date, text, text) to authenticated;

-- A batch of at most 1000 parties:
--   [{ "ref": "…", "kind": "person|entity|vessel|aircraft|other",
--      "names": [{ "n": "…", "p": true }, …],
--      "programmes": […], "countries": […], "birth_dates": […],
--      "listed_on": "YYYY-MM-DD" | null, "remarks": "…" | null }, …]
-- The same reference twice in one batch keeps the first.
create function tci.add_sanctions_list_entries(p_import uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_import tci.sanctions_list_imports%rowtype;
  v_batch  jsonb;
begin
  perform tci.require_staff();
  if not tci.may_import_sanctions_lists() then
    raise exception 'sanctions_import_only: sanctions lists are imported by credit analysts and admin' using errcode = '42501';
  end if;
  select * into v_import from tci.sanctions_list_imports where id = p_import for update;
  if not found then
    raise exception 'no sanctions list import %', p_import using errcode = 'P0002';
  end if;
  if v_import.status <> 'loading' then
    raise exception 'sanctions_import_not_loading: this import is %', v_import.status using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'sanctions_batch_shape: a batch is an array of at most 1000 parties' using errcode = 'P0001';
  end if;

  -- One row per reference, the first kept, as one jsonb array: the upsert
  -- and the names below read it back with jsonb_to_recordset.
  select coalesce(jsonb_agg(to_jsonb(b) order by b.ref), '[]'::jsonb)
    into v_batch
    from (
      select distinct on (btrim(x ->> 'ref'))
             btrim(x ->> 'ref') as ref, x ->> 'kind' as kind, coalesce(x -> 'names', '[]'::jsonb) as names,
             coalesce((select array_agg(left(btrim(v), 200)) from jsonb_array_elements_text(coalesce(x -> 'programmes', '[]')) v where btrim(v) <> ''), '{}') as programmes,
             coalesce((select array_agg(left(btrim(v), 200)) from jsonb_array_elements_text(coalesce(x -> 'countries', '[]')) v where btrim(v) <> ''), '{}') as countries,
             coalesce((select array_agg(left(btrim(v), 100)) from jsonb_array_elements_text(coalesce(x -> 'birth_dates', '[]')) v where btrim(v) <> ''), '{}') as birth_dates,
             nullif(x ->> 'listed_on', '')::date as listed_on,
             left(nullif(btrim(x ->> 'remarks'), ''), 2000) as remarks
        from jsonb_array_elements(p_rows) with ordinality as r(x, o)
       where coalesce(btrim(x ->> 'ref'), '') <> ''
       order by btrim(x ->> 'ref'), o
    ) b;

  if exists (select 1 from jsonb_to_recordset(v_batch) as b(names jsonb)
              where jsonb_typeof(b.names) <> 'array' or jsonb_array_length(b.names) = 0
                 or jsonb_array_length(b.names) > 300) then
    raise exception 'sanctions_batch_shape: every party needs 1 to 300 names' using errcode = 'P0001';
  end if;

  with b as (
    select * from jsonb_to_recordset(v_batch) as b(ref text, kind text, names jsonb, programmes text[],
                                                    countries text[], birth_dates text[], listed_on date, remarks text)
  ),
  up as (
    insert into tci.sanctions_list_entries
      (list_key, list_ref, kind, primary_name, programmes, countries, birth_dates, listed_on, remarks,
       first_import_id, last_import_id)
    select v_import.list_key, b.ref, b.kind,
           left(btrim(coalesce((select n ->> 'n' from jsonb_array_elements(b.names) n where (n ->> 'p')::boolean limit 1),
                               b.names -> 0 ->> 'n')), 500),
           b.programmes, b.countries, b.birth_dates, b.listed_on, b.remarks, p_import, p_import
      from b
    on conflict (list_key, list_ref) do update
       set kind = excluded.kind, primary_name = excluded.primary_name, programmes = excluded.programmes,
           countries = excluded.countries, birth_dates = excluded.birth_dates, listed_on = excluded.listed_on,
           remarks = excluded.remarks, last_import_id = excluded.last_import_id,
           delisted_at = null, delisted_import_id = null
    returning id, list_ref
  )
  insert into tci.sanctions_list_names (entry_id, name, is_primary, last_import_id)
  select distinct on (up.id, tci.sanctions_normalise(left(btrim(n ->> 'n'), 500)))
         up.id, left(btrim(n ->> 'n'), 500), coalesce((n ->> 'p')::boolean, false), p_import
    from up
    join b on b.ref = up.list_ref
    cross join jsonb_array_elements(b.names) n
   where tci.sanctions_normalise(left(btrim(n ->> 'n'), 500)) is not null
   order by up.id, tci.sanctions_normalise(left(btrim(n ->> 'n'), 500)), coalesce((n ->> 'p')::boolean, false) desc
  on conflict (entry_id, norm) do update
     set name = excluded.name, is_primary = excluded.is_primary, last_import_id = excluded.last_import_id;

  return jsonb_array_length(v_batch);
end $$;
revoke all on function tci.add_sanctions_list_entries(uuid, jsonb) from public, anon;
grant execute on function tci.add_sanctions_list_entries(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Beneficial owners
-- ---------------------------------------------------------------------------

create table tci.entity_beneficial_owners (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references tci.legal_entities (id),
  full_name     text not null check (btrim(full_name) <> '' and length(full_name) <= 200),
  role          text not null default 'beneficial_owner' check (role in ('beneficial_owner', 'shareholder', 'director')),
  ownership_pct numeric(5,2) check (ownership_pct is null or (ownership_pct > 0 and ownership_pct <= 100)),
  birth_date    date,
  nationality   char(2) references tci.countries (code),
  source        text not null check (btrim(source) <> '' and length(source) <= 300),
  added_by      uuid not null references auth.users (id),
  added_at      timestamptz not null default now(),
  ended_by      uuid references auth.users (id),
  ended_at      timestamptz,
  end_reason    text,
  constraint entity_beneficial_owners_end check (
    (ended_at is null) = (ended_by is null) and (ended_at is null or btrim(coalesce(end_reason, '')) <> ''))
);
create index entity_beneficial_owners_entity on tci.entity_beneficial_owners (entity_id) where ended_at is null;
comment on table tci.entity_beneficial_owners is
  '0091: the people behind a company — beneficial owners, shareholders, directors — screened against the sanctions lists with the company. Ended with a reason, never deleted or edited.';

create function tci.guard_beneficial_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.ended_at is not null
     or row(new.entity_id, new.full_name, new.role, new.ownership_pct, new.birth_date, new.nationality,
            new.source, new.added_by, new.added_at)
        is distinct from
        row(old.entity_id, old.full_name, old.role, old.ownership_pct, old.birth_date, old.nationality,
            old.source, old.added_by, old.added_at) then
    raise exception 'beneficial_owner_immutable: a beneficial owner is only ended, once' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger entity_beneficial_owners_immutable before update on tci.entity_beneficial_owners
  for each row execute function tci.guard_beneficial_owner();
revoke all on function tci.guard_beneficial_owner() from public, anon, authenticated;

alter table tci.entity_beneficial_owners enable row level security;
create policy "entity_beneficial_owners: staff read" on tci.entity_beneficial_owners for select to authenticated using (tci.is_staff());
grant select on tci.entity_beneficial_owners to authenticated;
grant select on tci.entity_beneficial_owners to service_role;

-- ---------------------------------------------------------------------------
-- 5. Screening
-- ---------------------------------------------------------------------------

create table tci.sanctions_screenings (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references tci.legal_entities (id),
  reason       text not null check (reason in ('rating', 'limit_request', 'list_import', 'owners_changed', 'manual')),
  lists        jsonb not null default '[]'::jsonb,
  subjects     integer not null default 0,
  candidates   integer not null default 0,
  new_matches  integer not null default 0,
  pending      integer not null default 0,
  outcome      text not null check (outcome in ('clear', 'possible_match', 'no_lists')),
  screened_by  uuid references auth.users (id),
  screened_at  timestamptz not null default clock_timestamp()
);
create index sanctions_screenings_entity on tci.sanctions_screenings (entity_id, screened_at desc);
comment on table tci.sanctions_screenings is
  '0091: one row per screening of a company (and its owners and beneficial owners) against the sanctions lists in use: why it ran, against which imports, what it found. Written only by tci.screen_entity_internal.';

create table tci.sanctions_matches (
  id                 uuid primary key default gen_random_uuid(),
  entity_id          uuid not null references tci.legal_entities (id),
  subject_kind       text not null check (subject_kind in ('entity', 'owner', 'beneficial_owner')),
  subject_key        text not null,
  subject_entity_id  uuid references tci.legal_entities (id),
  subject_owner_id   uuid references tci.entity_beneficial_owners (id),
  subject_name       text not null,
  subject_norm       text not null,
  list_key           text not null,
  list_ref           text not null,
  entry_id           uuid not null references tci.sanctions_list_entries (id),
  matched_name       text not null,
  score              numeric(4,3) not null check (score > 0 and score <= 1),
  entry_snapshot     jsonb not null,
  first_screening_id uuid not null references tci.sanctions_screenings (id) deferrable initially deferred,
  status             text not null default 'pending' check (status in ('pending', 'confirmed', 'cleared', 'retired')),
  resolved_by        uuid references auth.users (id),
  resolved_at        timestamptz,
  resolution_note    text,
  retired_reason     text check (retired_reason is null or retired_reason in ('subject_gone', 'delisted')),
  flag_id            uuid references tci.sanction_flags (id),
  created_at         timestamptz not null default clock_timestamp(),
  constraint sanctions_matches_subject check (
    (subject_kind in ('entity', 'owner') and subject_entity_id is not null and subject_owner_id is null)
    or (subject_kind = 'beneficial_owner' and subject_owner_id is not null and subject_entity_id is null)),
  constraint sanctions_matches_resolution check (
    (status = 'pending' and resolved_at is null and resolved_by is null and retired_reason is null)
    or (status in ('confirmed', 'cleared') and resolved_at is not null and resolved_by is not null
        and btrim(coalesce(resolution_note, '')) <> '' and retired_reason is null)
    or (status = 'retired' and resolved_at is not null and resolved_by is null and retired_reason is not null)),
  constraint sanctions_matches_flag check ((flag_id is not null) = (status = 'confirmed'))
);
create unique index sanctions_matches_once on tci.sanctions_matches
  (entity_id, subject_key, subject_norm, list_key, list_ref) where status <> 'retired';
create index sanctions_matches_pending on tci.sanctions_matches (entity_id) where status = 'pending';
comment on table tci.sanctions_matches is
  '0091: a possible match of a company, a company above it or one of their beneficial owners with a party on a sanctions list in use. Pending until a credit analyst confirms (a sanctions flag is set) or clears it; retired by itself when the subject or the listing is gone. Remembered per (company, subject, name, list entry): a cleared match is never raised again for the same name.';

create function tci.guard_sanctions_match() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'pending'
     or row(new.entity_id, new.subject_kind, new.subject_key, new.subject_entity_id, new.subject_owner_id,
            new.subject_name, new.subject_norm, new.list_key, new.list_ref, new.entry_id, new.matched_name,
            new.score, new.entry_snapshot, new.first_screening_id, new.created_at)
        is distinct from
        row(old.entity_id, old.subject_kind, old.subject_key, old.subject_entity_id, old.subject_owner_id,
            old.subject_name, old.subject_norm, old.list_key, old.list_ref, old.entry_id, old.matched_name,
            old.score, old.entry_snapshot, old.first_screening_id, old.created_at) then
    raise exception 'sanctions_match_immutable: a match is resolved once' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger sanctions_matches_immutable before update on tci.sanctions_matches
  for each row execute function tci.guard_sanctions_match();
revoke all on function tci.guard_sanctions_match() from public, anon, authenticated;

alter table tci.sanctions_screenings enable row level security;
alter table tci.sanctions_matches enable row level security;
create policy "sanctions_screenings: staff read" on tci.sanctions_screenings for select to authenticated using (tci.is_staff());
create policy "sanctions_matches: staff read" on tci.sanctions_matches for select to authenticated using (tci.is_staff());
grant select on tci.sanctions_screenings, tci.sanctions_matches to authenticated;
grant select on tci.sanctions_screenings, tci.sanctions_matches to service_role;

-- How two normalised names compare: their trigram similarity, or 0.9 when
-- every word of one (two words at least, and at least half as many as the
-- other has) is a word of the other — «Ramzan Kadyrov» in «Kadyrov Ramzan
-- Akhmatovich», «Bank Melli» in «Bank Melli Iran», whatever the order; two
-- generic words lost in a long name do not. One-word names count only by
-- similarity.
create function tci.sanctions_name_score(p_a text, p_b text) returns numeric
language sql immutable parallel safe set search_path = '' as $$
  with a as (select array(select distinct w from unnest(string_to_array(p_a, ' ')) w where length(w) >= 2) as t),
       b as (select array(select distinct w from unnest(string_to_array(p_b, ' ')) w where length(w) >= 2) as t)
  select round(greatest(
           extensions.similarity(p_a, p_b)::numeric,
           case when (cardinality(a.t) >= 2 and a.t <@ b.t and cardinality(a.t) * 2 >= cardinality(b.t))
                  or (cardinality(b.t) >= 2 and b.t <@ a.t and cardinality(b.t) * 2 >= cardinality(a.t))
                then 0.9 else 0 end), 3)
    from a, b
$$;
revoke all on function tci.sanctions_name_score(text, text) from public, anon;
grant execute on function tci.sanctions_name_score(text, text) to authenticated, service_role;

-- Candidates for one name among the lists in use: the 300 nearest names
-- (trigram distance), scored, the best name of each listed party at or
-- above the threshold, people or companies.
create function tci.sanctions_candidates_internal(p_name text, p_kinds text[], p_threshold numeric, p_limit integer)
returns table (entry_id uuid, matched_name text, score numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_norm text := tci.sanctions_normalise(p_name);
begin
  perform tci.require_staff_or_internal();
  if v_norm is null or length(v_norm) < 3 then
    return;
  end if;
  return query
    select c.entry_id, c.matched_name, c.score
      from (select distinct on (e.id) e.id as entry_id, n.name as matched_name,
                   tci.sanctions_name_score(n.norm, v_norm) as score
              from (select x.entry_id, x.name, x.norm, x.is_primary, x.last_import_id
                      from tci.sanctions_list_names x
                     order by x.norm operator(extensions.<->) v_norm
                     limit 300) n
              join tci.sanctions_list_entries e on e.id = n.entry_id
              join tci.sanctions_list_imports i on i.id = e.last_import_id and i.status = 'active'
             where n.last_import_id = e.last_import_id
               and e.delisted_at is null
               and e.kind = any (p_kinds)
             order by e.id, tci.sanctions_name_score(n.norm, v_norm) desc, n.is_primary desc) c
     where c.score >= p_threshold
     order by c.score desc, c.matched_name
     limit greatest(p_limit, 1);
end $$;
revoke all on function tci.sanctions_candidates_internal(text, text[], numeric, integer) from public, anon, authenticated;
grant execute on function tci.sanctions_candidates_internal(text, text[], numeric, integer) to service_role;

-- Who is screened with a company: the company itself, every company above
-- it through live ownership or control links (cycle-safe: a node is never
-- re-entered on its path; capped at the group depth), and the live
-- beneficial owners, shareholders and directors of all of them.
create function tci.sanctions_subjects_internal(p_entity uuid)
returns table (subject_kind text, subject_key text, subject_entity_id uuid, subject_owner_id uuid,
               name text, person boolean, depth integer, via_entity_id uuid, role text, ownership_pct numeric)
language sql stable security definer set search_path = '' as $$
  with recursive up (id, path, depth) as (
    select p_entity, array[p_entity], 0
    union all
    select r.parent_entity_id, u.path || r.parent_entity_id, u.depth + 1
      from up u
      join tci.entity_relationships r on r.child_entity_id = u.id
     where r.relationship_type in ('ownership', 'control')
       and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date)
       and not (r.parent_entity_id = any (u.path))
       and u.depth < coalesce((select s.group_depth_cap from tci.workflow_settings s where s.id), 10)
  ), companies as (
    select distinct on (id) id, depth from up order by id, depth
  )
  select case when c.depth = 0 then 'entity' else 'owner' end, 'e:' || c.id::text, c.id, null::uuid,
         e.name, false, c.depth, c.id, null::text, null::numeric
    from companies c join tci.legal_entities e on e.id = c.id
  union all
  select 'beneficial_owner', 'o:' || b.id::text, null::uuid, b.id,
         b.full_name, true, c.depth, b.entity_id, b.role, b.ownership_pct
    from companies c join tci.entity_beneficial_owners b on b.entity_id = c.id and b.ended_at is null
$$;
revoke all on function tci.sanctions_subjects_internal(uuid) from public, anon, authenticated;
grant execute on function tci.sanctions_subjects_internal(uuid) to service_role;

-- The least-loaded active credit analyst: fewest open sanctions tasks, then
-- the longest since their last one, then by id (stable). Null when there is
-- nobody; the task then goes to the role.
create function tci.pick_credit_analyst() returns uuid
language sql stable security definer set search_path = '' as $$
  select ur.user_id
    from tci.user_roles ur
    join auth.users u on u.id = ur.user_id
   where ur.role = 'credit_analyst'
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until <= now())
   order by
     (select count(*) from tci.tasks t
       where t.target_user = ur.user_id and t.status = 'open'
         and t.task_type in ('sanctions_match_review', 'sanctions_list_due')),
     (select max(t.created_at) from tci.tasks t
       where t.target_user = ur.user_id and t.task_type in ('sanctions_match_review', 'sanctions_list_due')) nulls first,
     ur.user_id
   limit 1
$$;
revoke all on function tci.pick_credit_analyst() from public, anon, authenticated;
grant execute on function tci.pick_credit_analyst() to service_role;

-- One review task per company while anything is pending, for the
-- least-loaded analyst; closed when nothing is.
create function tci.sync_sanctions_review_task(p_entity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pending integer;
  v_user    uuid;
begin
  perform tci.require_internal_call();
  select count(*) into v_pending from tci.sanctions_matches m where m.entity_id = p_entity and m.status = 'pending';
  if v_pending = 0 then
    update tci.tasks t
       set status = 'done', completed_at = now()
     where t.task_type = 'sanctions_match_review' and t.object_id = p_entity and t.status = 'open';
    return;
  end if;
  if exists (select 1 from tci.tasks t
              where t.task_type = 'sanctions_match_review' and t.object_id = p_entity and t.status = 'open') then
    update tci.tasks t
       set params = t.params || jsonb_build_object('matches', v_pending)
     where t.task_type = 'sanctions_match_review' and t.object_id = p_entity and t.status = 'open';
    return;
  end if;
  v_user := tci.pick_credit_analyst();
  perform tci.open_task('sanctions_match_review', 'legal_entity', p_entity,
    'agenda.tasks.sanctions_match_review',
    jsonb_build_object('entity_id', p_entity, 'entity_name', (select e.name from tci.legal_entities e where e.id = p_entity),
                       'matches', v_pending),
    'credit_analyst'::tci.user_role, v_user, now() + interval '2 days', 'high', null);
end $$;
revoke all on function tci.sync_sanctions_review_task(uuid) from public, anon, authenticated;
grant execute on function tci.sync_sanctions_review_task(uuid) to service_role;

-- The screening itself. Internal: the triggers and the staff functions below
-- call it with the trusted-call token.
create function tci.screen_entity_internal(p_entity uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id        uuid := gen_random_uuid();
  v_lists     jsonb;
  v_threshold numeric;
  v_subjects  integer := 0;
  v_found     integer := 0;
  v_new       integer := 0;
  v_n         integer;
  v_before    integer;
  v_pending   integer;
  v_keys      text[] := '{}';
  v_s         record;
  v_c         record;
begin
  perform tci.require_internal_call();
  if not exists (select 1 from tci.legal_entities e where e.id = p_entity) then
    raise exception 'no company %', p_entity using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('import_id', i.id, 'list', i.list_key, 'published_at', i.published_at)
                            order by i.list_key), '[]'::jsonb)
    into v_lists
    from tci.sanctions_list_imports i where i.status = 'active';
  select count(*) into v_before from tci.sanctions_matches m where m.entity_id = p_entity and m.status = 'pending';

  if jsonb_array_length(v_lists) = 0 then
    insert into tci.sanctions_screenings (id, entity_id, reason, lists, outcome, pending, screened_by)
    values (v_id, p_entity, p_reason, v_lists, 'no_lists', v_before, (select auth.uid()));
    return jsonb_build_object('screening_id', v_id, 'outcome', 'no_lists', 'new_matches', 0, 'pending', v_before);
  end if;

  select s.sanctions_match_threshold into v_threshold from tci.workflow_settings s where s.id;

  for v_s in select * from tci.sanctions_subjects_internal(p_entity) loop
    v_subjects := v_subjects + 1;
    v_keys := v_keys || v_s.subject_key;
    for v_c in
      select k.entry_id, k.matched_name, k.score, e.list_key, e.list_ref, e.kind, e.primary_name,
             e.programmes, e.countries, e.birth_dates, e.listed_on, i.published_at, i.id as import_id
        from tci.sanctions_candidates_internal(v_s.name,
               case when v_s.person then array['person'] else array['entity', 'other'] end, v_threshold, 10) k
        join tci.sanctions_list_entries e on e.id = k.entry_id
        join tci.sanctions_list_imports i on i.id = e.last_import_id
    loop
      v_found := v_found + 1;
      insert into tci.sanctions_matches
        (entity_id, subject_kind, subject_key, subject_entity_id, subject_owner_id, subject_name, subject_norm,
         list_key, list_ref, entry_id, matched_name, score, entry_snapshot, first_screening_id)
      values
        (p_entity, v_s.subject_kind, v_s.subject_key, v_s.subject_entity_id, v_s.subject_owner_id, v_s.name,
         coalesce(tci.sanctions_normalise(v_s.name), ''), v_c.list_key, v_c.list_ref, v_c.entry_id, v_c.matched_name, v_c.score,
         jsonb_build_object('kind', v_c.kind, 'primary_name', v_c.primary_name, 'programmes', to_jsonb(v_c.programmes),
                            'countries', to_jsonb(v_c.countries), 'birth_dates', to_jsonb(v_c.birth_dates),
                            'listed_on', v_c.listed_on, 'published_at', v_c.published_at, 'import_id', v_c.import_id,
                            'via_entity_id', v_s.via_entity_id, 'depth', v_s.depth, 'role', v_s.role),
         v_id)
      on conflict (entity_id, subject_key, subject_norm, list_key, list_ref) where status <> 'retired' do nothing;
      get diagnostics v_n = row_count;
      v_new := v_new + v_n;
    end loop;
  end loop;

  -- A pending match whose subject is no longer screened with the company, or
  -- whose party has left the list, retires by itself.
  update tci.sanctions_matches m
     set status = 'retired', resolved_at = now(),
         retired_reason = case when not (m.subject_key = any (v_keys)) then 'subject_gone' else 'delisted' end
   where m.entity_id = p_entity and m.status = 'pending'
     and (not (m.subject_key = any (v_keys))
          or not exists (select 1 from tci.sanctions_list_entries e
                          where e.list_key = m.list_key and e.list_ref = m.list_ref and e.delisted_at is null));

  select count(*) into v_pending from tci.sanctions_matches m where m.entity_id = p_entity and m.status = 'pending';
  insert into tci.sanctions_screenings (id, entity_id, reason, lists, subjects, candidates, new_matches, pending,
                                        outcome, screened_by)
  values (v_id, p_entity, p_reason, v_lists, v_subjects, v_found, v_new, v_pending,
          case when v_pending > 0 then 'possible_match' else 'clear' end, (select auth.uid()));

  perform tci.sync_sanctions_review_task(p_entity);
  if v_pending <> v_before then
    perform tci.recheck_buyer_adt(p_entity);
  end if;
  return jsonb_build_object('screening_id', v_id, 'outcome', case when v_pending > 0 then 'possible_match' else 'clear' end,
                            'subjects', v_subjects, 'new_matches', v_new, 'pending', v_pending);
end $$;
revoke all on function tci.screen_entity_internal(uuid, text) from public, anon, authenticated;
grant execute on function tci.screen_entity_internal(uuid, text) to service_role;

-- Screen a company now (any staff — the tools are everyone's).
create function tci.screen_entity_now(p_entity uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform tci.require_staff();
  perform tci.begin_trusted_call();
  return tci.screen_entity_internal(p_entity, 'manual');
end $$;
revoke all on function tci.screen_entity_now(uuid) from public, anon;
grant execute on function tci.screen_entity_now(uuid) to authenticated;

-- Screen a company and every company below it that has been screened before
-- (an owner, a link or a name changed): their subjects changed too.
create function tci.rescreen_from(p_entity uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  perform tci.require_internal_call();
  if not exists (select 1 from tci.sanctions_list_imports i where i.status = 'active') then
    return 0;
  end if;
  for v_id in
    with recursive down (id, path, depth) as (
      select p_entity, array[p_entity], 0
      union all
      select r.child_entity_id, d.path || r.child_entity_id, d.depth + 1
        from down d
        join tci.entity_relationships r on r.parent_entity_id = d.id
       where r.relationship_type in ('ownership', 'control')
         and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date)
         and not (r.child_entity_id = any (d.path))
         and d.depth < coalesce((select s.group_depth_cap from tci.workflow_settings s where s.id), 10)
    )
    select distinct d.id from down d
     where d.id = p_entity
        or exists (select 1 from tci.sanctions_screenings x where x.entity_id = d.id)
  loop
    perform tci.screen_entity_internal(v_id, p_reason);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function tci.rescreen_from(uuid, text) from public, anon, authenticated;
grant execute on function tci.rescreen_from(uuid, text) to service_role;

-- The companies kept screened: buyers with an open limit request or a limit
-- in force, policyholders of live policies, applicants and buyers of live
-- submissions.
create function tci.sanctions_population() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select r.entity_id from tci.credit_limit_requests r
   where r.status in ('submitted', 'information_gathering', 'under_review', 'escalated')
  union
  select v.entity_id from tci.v_effective_limits v where v.outcome in ('approved', 'partial')
  union
  select p.entity_id from tci.policies p where p.status in ('active', 'suspended')
  union
  select ir.entity_id from tci.insurance_requests ir
   where ir.entity_id is not null and ir.status not in ('draft', 'declined', 'withdrawn', 'bound')
  union
  select b.entity_id from tci.insurance_request_buyers b
    join tci.insurance_requests ir on ir.id = b.request_id
   where b.entity_id is not null and ir.status not in ('draft', 'declined', 'withdrawn', 'bound')
$$;
revoke all on function tci.sanctions_population() from public, anon, authenticated;
grant execute on function tci.sanctions_population() to service_role;

-- Which of them have not been screened since the latest list took effect.
create function tci.sanctions_due_entities() returns table (entity_id uuid, last_screened_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with t as (select max(i.activated_at) as at from tci.sanctions_list_imports i where i.status = 'active'),
       pop as (select p as entity_id from tci.sanctions_population() p),
       last as (
         select pop.entity_id,
                (select max(x.screened_at) from tci.sanctions_screenings x
                  where x.entity_id = pop.entity_id and x.outcome <> 'no_lists') as last_at
           from pop)
  select l.entity_id, l.last_at
    from last l, t
   where t.at is not null and (l.last_at is null or l.last_at < t.at)
$$;
revoke all on function tci.sanctions_due_entities() from public, anon, authenticated;
grant execute on function tci.sanctions_due_entities() to service_role;

-- Screen the next companies due (any staff: the import screen drives it in
-- batches until nothing is left; refresh_agenda does a few at a time).
create function tci.rescreen_sanctions_due(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  perform tci.require_staff_or_internal();
  perform tci.begin_trusted_call();
  for v_id in
    select d.entity_id from tci.sanctions_due_entities() d
     order by d.last_screened_at nulls first, d.entity_id
     limit greatest(least(coalesce(p_limit, 100), 500), 1)
  loop
    perform tci.screen_entity_internal(v_id, 'list_import');
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('screened', v_count, 'remaining', (select count(*) from tci.sanctions_due_entities()));
end $$;
revoke all on function tci.rescreen_sanctions_due(integer) from public, anon;
grant execute on function tci.rescreen_sanctions_due(integer) to authenticated, service_role;

-- Finishing an import: the parties missing from it are delisted, the
-- previous import of the list is superseded, this one takes effect. A file
-- with fewer than 90 % of the parties of the list in use (a truncated
-- download?) needs p_confirm_shrink: the lists change by a few per cent.
create function tci.finish_sanctions_list_import(p_import uuid, p_confirm_shrink boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_import   tci.sanctions_list_imports%rowtype;
  v_prev     tci.sanctions_list_imports%rowtype;
  v_entries  integer;
  v_names    integer;
  v_delisted integer;
  v_entity   uuid;
begin
  perform tci.require_staff();
  if not tci.may_import_sanctions_lists() then
    raise exception 'sanctions_import_only: sanctions lists are imported by credit analysts and admin' using errcode = '42501';
  end if;
  perform tci.begin_trusted_call();
  select * into v_import from tci.sanctions_list_imports where id = p_import for update;
  if not found then
    raise exception 'no sanctions list import %', p_import using errcode = 'P0002';
  end if;
  if v_import.status <> 'loading' then
    raise exception 'sanctions_import_not_loading: this import is %', v_import.status using errcode = 'P0001';
  end if;
  select count(*) into v_entries from tci.sanctions_list_entries e where e.last_import_id = p_import;
  select count(*) into v_names from tci.sanctions_list_names n where n.last_import_id = p_import;
  if v_entries = 0 then
    raise exception 'sanctions_list_empty: no party was loaded from this file' using errcode = 'P0001';
  end if;
  select * into v_prev from tci.sanctions_list_imports i where i.list_key = v_import.list_key and i.status = 'active' for update;
  if found and v_entries * 10 < v_prev.entry_count * 9 and not coalesce(p_confirm_shrink, false) then
    raise exception 'sanctions_list_shrunk: % parties against % in the list in use', v_entries, v_prev.entry_count
      using errcode = 'P0001';
  end if;

  update tci.sanctions_list_entries e
     set delisted_at = now(), delisted_import_id = p_import
   where e.list_key = v_import.list_key and e.delisted_at is null and e.last_import_id <> p_import;
  get diagnostics v_delisted = row_count;

  -- A pending match on a party that has left the list retires at once.
  for v_entity in
    with retired as (
      update tci.sanctions_matches m
         set status = 'retired', resolved_at = now(), retired_reason = 'delisted'
       where m.status = 'pending' and m.list_key = v_import.list_key
         and exists (select 1 from tci.sanctions_list_entries e
                      where e.list_key = m.list_key and e.list_ref = m.list_ref and e.delisted_import_id = p_import)
      returning m.entity_id)
    select distinct entity_id from retired
  loop
    perform tci.sync_sanctions_review_task(v_entity);
    perform tci.recheck_buyer_adt(v_entity);
  end loop;

  if v_prev.id is not null then
    update tci.sanctions_list_imports set status = 'superseded', superseded_at = now() where id = v_prev.id;
  end if;
  update tci.sanctions_list_imports
     set status = 'active', activated_at = clock_timestamp(),
         entry_count = v_entries, name_count = v_names, delisted_count = v_delisted
   where id = p_import;

  perform tci.emit_workflow_event('sanctions.list_imported', 'sanctions_list', p_import,
    jsonb_build_object('list', v_import.list_key, 'published_at', v_import.published_at,
                       'entries', v_entries, 'delisted', v_delisted), null, null);
  perform tci.refresh_sanctions_list_task();
  return jsonb_build_object('import_id', p_import, 'entries', v_entries, 'names', v_names, 'delisted', v_delisted,
                            'due', (select count(*) from tci.sanctions_due_entities()));
end $$;

-- The reminder: one open sanctions_list_due while a required list is missing
-- or older than the setting, for the least-loaded credit analyst.
create function tci.refresh_sanctions_list_task() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_days     smallint;
  v_required text[];
  v_stale    text[];
  v_nil      uuid := '00000000-0000-0000-0000-000000000000';
begin
  perform tci.require_internal_call();
  select s.sanctions_list_stale_days, s.sanctions_required_lists into v_days, v_required
    from tci.workflow_settings s where s.id;
  select coalesce(array_agg(l order by l), '{}') into v_stale
    from unnest(v_required) l
   where not exists (select 1 from tci.sanctions_list_imports i
                      where i.list_key = l and i.status = 'active' and i.published_at >= current_date - v_days);
  if cardinality(v_stale) = 0 then
    update tci.tasks t
       set status = 'done', completed_at = now()
     where t.task_type = 'sanctions_list_due' and t.status = 'open';
    return 0;
  end if;
  if exists (select 1 from tci.tasks t where t.task_type = 'sanctions_list_due' and t.status = 'open') then
    update tci.tasks t
       set params = jsonb_build_object('lists', to_jsonb(v_stale), 'days', v_days)
     where t.task_type = 'sanctions_list_due' and t.status = 'open'
       and t.params is distinct from jsonb_build_object('lists', to_jsonb(v_stale), 'days', v_days);
    return 0;
  end if;
  perform tci.open_task('sanctions_list_due', 'sanctions_list', v_nil,
    'agenda.tasks.sanctions_list_due',
    jsonb_build_object('lists', to_jsonb(v_stale), 'days', v_days),
    'credit_analyst'::tci.user_role, tci.pick_credit_analyst(), null, 'normal', null);
  return 1;
end $$;
revoke all on function tci.refresh_sanctions_list_task() from public, anon, authenticated;
grant execute on function tci.refresh_sanctions_list_task() to service_role;

revoke all on function tci.finish_sanctions_list_import(uuid, boolean) from public, anon;
grant execute on function tci.finish_sanctions_list_import(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Resolving a match, beneficial owners, the tools
-- ---------------------------------------------------------------------------

create function tci.resolve_sanctions_match(p_match uuid, p_outcome text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_match  tci.sanctions_matches%rowtype;
  v_regime text;
  v_flag   uuid;
  v_set    jsonb;
  v_pending integer;
begin
  perform tci.require_role('credit_analyst');
  if p_outcome is null or p_outcome not in ('confirmed', 'cleared') then
    raise exception 'sanctions_match_outcome: confirm or clear' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'sanctions_match_note_required: say why' using errcode = 'P0001';
  end if;
  perform tci.begin_trusted_call();
  select * into v_match from tci.sanctions_matches where id = p_match for update;
  if not found then
    raise exception 'no sanctions match %', p_match using errcode = 'P0002';
  end if;
  if v_match.status <> 'pending' then
    raise exception 'sanctions_match_resolved: this match is %', v_match.status using errcode = 'P0001';
  end if;

  if p_outcome = 'confirmed' then
    v_regime := tci.sanctions_list_regime(v_match.list_key);
    select f.id into v_flag from tci.sanction_flags f
     where f.scope = 'entity' and f.entity_id = v_match.entity_id and f.regime = v_regime and f.lifted_at is null;
    if v_flag is null then
      v_set := tci.set_sanction_flag('entity', null, v_match.entity_id, v_regime,
        case v_match.list_key when 'ofac_sdn' then 'OFAC SDN' when 'un' then 'UN Security Council consolidated list'
             when 'eu' then 'EU consolidated financial sanctions list' when 'uk' then 'UK Sanctions List'
             else substr(v_match.list_key, 7) end
          || ' (' || (v_match.entry_snapshot ->> 'published_at') || ')',
        v_match.list_ref, current_date, btrim(p_note));
      v_flag := (v_set ->> 'flag_id')::uuid;
    end if;
  end if;

  update tci.sanctions_matches
     set status = p_outcome, resolved_by = (select auth.uid()), resolved_at = now(),
         resolution_note = btrim(p_note), flag_id = v_flag
   where id = p_match;

  perform tci.sync_sanctions_review_task(v_match.entity_id);
  perform tci.recheck_buyer_adt(v_match.entity_id);
  select count(*) into v_pending from tci.sanctions_matches m where m.entity_id = v_match.entity_id and m.status = 'pending';
  perform tci.emit_workflow_event('sanctions.match_resolved', 'legal_entity', v_match.entity_id,
    jsonb_build_object('match_id', p_match, 'outcome', p_outcome, 'flag_id', v_flag, 'pending', v_pending), null, null);
  return jsonb_build_object('match_id', p_match, 'status', p_outcome, 'flag_id', v_flag, 'pending', v_pending);
end $$;
revoke all on function tci.resolve_sanctions_match(uuid, text, text) from public, anon;
grant execute on function tci.resolve_sanctions_match(uuid, text, text) to authenticated;

create function tci.add_beneficial_owner(
  p_entity uuid, p_full_name text, p_role text, p_ownership_pct numeric, p_birth_date date,
  p_nationality char, p_source text)
returns tci.entity_beneficial_owners
language plpgsql security definer set search_path = '' as $$
declare v_row tci.entity_beneficial_owners%rowtype;
begin
  perform tci.require_role('information_manager', 'credit_analyst');
  if not exists (select 1 from tci.legal_entities e where e.id = p_entity) then
    raise exception 'no company %', p_entity using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'beneficial_owner_name_required: the person''s full name' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_source), '') = '' then
    raise exception 'beneficial_owner_source_required: where it was read' using errcode = 'P0001';
  end if;
  if p_birth_date is not null and p_birth_date > current_date then
    raise exception 'beneficial_owner_birth_date: not in the future' using errcode = 'P0001';
  end if;
  perform tci.begin_trusted_call();
  insert into tci.entity_beneficial_owners (entity_id, full_name, role, ownership_pct, birth_date, nationality, source, added_by)
  values (p_entity, btrim(p_full_name), coalesce(p_role, 'beneficial_owner'), p_ownership_pct, p_birth_date,
          upper(nullif(btrim(p_nationality), '')), btrim(p_source), (select auth.uid()))
  returning * into v_row;
  perform tci.rescreen_from(p_entity, 'owners_changed');
  return v_row;
end $$;
revoke all on function tci.add_beneficial_owner(uuid, text, text, numeric, date, char, text) from public, anon;
grant execute on function tci.add_beneficial_owner(uuid, text, text, numeric, date, char, text) to authenticated;

create function tci.end_beneficial_owner(p_owner uuid, p_reason text) returns tci.entity_beneficial_owners
language plpgsql security definer set search_path = '' as $$
declare v_row tci.entity_beneficial_owners%rowtype;
begin
  perform tci.require_role('information_manager', 'credit_analyst');
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'beneficial_owner_end_reason: say why' using errcode = 'P0001';
  end if;
  perform tci.begin_trusted_call();
  update tci.entity_beneficial_owners
     set ended_by = (select auth.uid()), ended_at = now(), end_reason = btrim(p_reason)
   where id = p_owner and ended_at is null
   returning * into v_row;
  if not found then
    raise exception 'no current beneficial owner %', p_owner using errcode = 'P0002';
  end if;
  perform tci.rescreen_from(v_row.entity_id, 'owners_changed');
  return v_row;
end $$;
revoke all on function tci.end_beneficial_owner(uuid, text) from public, anon;
grant execute on function tci.end_beneficial_owner(uuid, text) to authenticated;

-- The names screened with a company, for checking by hand (any staff).
create function tci.sanctions_subjects(p_entity uuid)
returns table (subject_kind text, subject_key text, subject_entity_id uuid, subject_owner_id uuid,
               name text, person boolean, depth integer, via_entity_id uuid, role text, ownership_pct numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform tci.require_staff();
  return query select * from tci.sanctions_subjects_internal(p_entity) order by 7, 6, 5;
end $$;
revoke all on function tci.sanctions_subjects(uuid) from public, anon;
grant execute on function tci.sanctions_subjects(uuid) to authenticated;

-- A name against the lists in use (any staff). Recorded nowhere: a search is
-- a look, not a screening.
create function tci.sanctions_search(p_name text, p_person boolean default null, p_threshold numeric default 0.4,
                                     p_limit integer default 25)
returns table (entry_id uuid, list_key text, list_ref text, kind text, primary_name text, matched_name text,
               score numeric, programmes text[], countries text[], birth_dates text[], listed_on date,
               published_at date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform tci.require_staff();
  if coalesce(length(btrim(p_name)), 0) < 3 then
    raise exception 'sanctions_search_short: at least three characters' using errcode = 'P0001';
  end if;
  return query
    select e.id, e.list_key, e.list_ref, e.kind, e.primary_name, k.matched_name, k.score,
           e.programmes, e.countries, e.birth_dates, e.listed_on, i.published_at
      from tci.sanctions_candidates_internal(btrim(p_name),
             case when p_person is null then array['person', 'entity', 'vessel', 'aircraft', 'other']
                  when p_person then array['person'] else array['entity', 'vessel', 'aircraft', 'other'] end,
             greatest(least(coalesce(p_threshold, 0.4), 1), 0.2), least(greatest(coalesce(p_limit, 25), 1), 100)) k
      join tci.sanctions_list_entries e on e.id = k.entry_id
      join tci.sanctions_list_imports i on i.id = e.last_import_id
     order by k.score desc, e.primary_name;
end $$;
revoke all on function tci.sanctions_search(text, boolean, numeric, integer) from public, anon;
grant execute on function tci.sanctions_search(text, boolean, numeric, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. When screening runs by itself
-- ---------------------------------------------------------------------------

-- A rating and a submitted limit request screen the buyer — before the
-- information routing and the auto decision (trigger names sort after
-- zx_limit_withdrawal and before zy_ / zz_).
create function tci.handle_sanctions_screening_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_entity uuid;
begin
  if new.event_type not in ('rating.created', 'limit.request_submitted') then
    return null;
  end if;
  perform tci.begin_trusted_call();
  if not exists (select 1 from tci.sanctions_list_imports i where i.status = 'active') then
    return null;
  end if;
  v_entity := coalesce((new.payload ->> 'entity_id')::uuid,
    case when new.event_type = 'limit.request_submitted'
         then (select r.entity_id from tci.credit_limit_requests r where r.id = new.object_id) end);
  if v_entity is null
     or exists (select 1 from tci.sanctions_screenings x where x.entity_id = v_entity and x.screened_at >= now()) then
    return null;
  end if;
  perform tci.screen_entity_internal(v_entity,
    case when new.event_type = 'rating.created' then 'rating' else 'limit_request' end);
  return null;
end $$;
create trigger workflow_events_zxs_sanctions_screening after insert on tci.workflow_events
  for each row execute function tci.handle_sanctions_screening_event();
revoke all on function tci.handle_sanctions_screening_event() from public, anon, authenticated;

-- An ownership or control link added, changed or ended: the child and the
-- companies below it that have been screened are screened again.
create function tci.handle_sanctions_relationship() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.relationship_type not in ('ownership', 'control')
     and (tg_op = 'INSERT' or old.relationship_type not in ('ownership', 'control')) then
    return null;
  end if;
  perform tci.begin_trusted_call();
  if exists (select 1 from tci.sanctions_screenings x where x.entity_id = new.child_entity_id) then
    perform tci.rescreen_from(new.child_entity_id, 'owners_changed');
  end if;
  return null;
end $$;
create trigger entity_relationships_sanctions after insert or update on tci.entity_relationships
  for each row execute function tci.handle_sanctions_relationship();
revoke all on function tci.handle_sanctions_relationship() from public, anon, authenticated;

-- A company renamed: screened again when it has been screened before.
create function tci.handle_sanctions_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is not distinct from old.name then
    return null;
  end if;
  perform tci.begin_trusted_call();
  if exists (select 1 from tci.sanctions_screenings x where x.entity_id = new.id) then
    perform tci.rescreen_from(new.id, 'owners_changed');
  end if;
  return null;
end $$;
create trigger legal_entities_sanctions_rename after update of name on tci.legal_entities
  for each row execute function tci.handle_sanctions_rename();
revoke all on function tci.handle_sanctions_rename() from public, anon, authenticated;

-- No approving credit decision while a possible match is pending — whoever
-- writes it (a validator, the committee, the owner's scripts).
create function tci.guard_sanctions_screening_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'credit' and new.outcome in ('approved', 'partial')
     and exists (select 1 from tci.sanctions_matches m
                   join tci.credit_limit_requests r on r.entity_id = m.entity_id
                  where r.id = new.request_id and m.status = 'pending') then
    raise exception 'sanctions_screening_pending: a possible sanctions match on this buyer is not reviewed yet'
      using errcode = 'P0001', detail = 'sanctions.screening.pending';
  end if;
  return new;
end $$;
create trigger credit_limit_decisions_sanctions_screening before insert on tci.credit_limit_decisions
  for each row execute function tci.guard_sanctions_screening_decision();
revoke all on function tci.guard_sanctions_screening_decision() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The auto decision stops on a pending match (and a live ADT is
--    suspended by it) — 0061's stops, in order, plus one at the end.
-- ---------------------------------------------------------------------------

create or replace function tci.adt_buyer_stops(p_entity_id uuid)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_out     text[] := '{}';
  v_age     integer;
  v_latest  date;
begin
  perform tci.require_internal_call();
  if exists (select 1 from tci.overdue_notifications n where n.entity_id = p_entity_id and n.status = 'open') then
    v_out := v_out || 'open_noa'::text;
  end if;
  if exists (select 1 from tci.claims c where c.entity_id = p_entity_id and c.status not in ('draft', 'withdrawn')) then
    v_out := v_out || 'claims'::text;
  end if;
  if exists (select 1 from tci.credit_limit_decisions d
               join tci.credit_limit_requests r on r.id = d.request_id
              where r.entity_id = p_entity_id and d.outcome = 'revoked' and d.lifecycle = 'effective') then
    v_out := v_out || 'limit_revoked'::text;
  end if;
  if exists (select 1 from tci.buyer_adt_blocks b where b.entity_id = p_entity_id and b.blocked) then
    v_out := v_out || 'manual_block'::text;
  end if;
  select s.adt_financials_max_age_months into v_age from tci.workflow_settings s where s.id;
  select max(f.period_end_date) into v_latest from tci.financial_statements f where f.entity_id = p_entity_id;
  if v_latest is null then
    v_out := v_out || 'no_financials'::text;
  elsif v_latest < (current_date - make_interval(months => v_age))::date then
    v_out := v_out || 'stale_financials'::text;
  end if;
  -- 0091: a possible sanctions match not yet reviewed.
  if exists (select 1 from tci.sanctions_matches m where m.entity_id = p_entity_id and m.status = 'pending') then
    v_out := v_out || 'sanctions_match'::text;
  end if;
  return v_out;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Sanctions flags are the credit analysts' (admin reads)
-- ---------------------------------------------------------------------------

create or replace function tci.may_manage_sanctions() returns boolean
language sql stable security definer set search_path = '' as $$
  select tci.has_role('credit_analyst')
$$;

-- ---------------------------------------------------------------------------
-- 10. Lazily, from refresh_agenda (which calls retire_sanction_tasks): a
--     few companies due for screening, and the list reminder.
-- ---------------------------------------------------------------------------

create or replace function tci.retire_sanction_tasks() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform tci.require_staff_or_internal();
  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'sanctions_limit_review' and t.status = 'open'
     and not exists (select 1 from tci.v_effective_limits v
                      where v.request_id = t.object_id and v.outcome in ('approved', 'partial'));
  -- 0091
  perform tci.begin_trusted_call();
  perform tci.rescreen_sanctions_due(10);
  perform tci.refresh_sanctions_list_task();
end $$;

-- ---------------------------------------------------------------------------
-- 11. Views
-- ---------------------------------------------------------------------------

create view tci.v_entity_sanctions_status with (security_invoker = true) as
with lists as (
  select max(i.activated_at) as activated_at from tci.sanctions_list_imports i where i.status = 'active'
)
select e.id as entity_id,
       exists (select 1 from tci.sanction_flags f
                where f.scope = 'entity' and f.entity_id = e.id
                  and f.lifted_at is null and f.effective_from <= current_date) as company_flagged,
       exists (select 1 from tci.sanction_flags f
                where f.scope = 'country' and f.country_code = e.country_code
                  and f.lifted_at is null and f.effective_from <= current_date) as country_flagged,
       (select count(*) from tci.sanctions_matches m where m.entity_id = e.id and m.status = 'pending')::integer as pending_matches,
       ls.screened_at as last_screened_at,
       ls.outcome as last_outcome,
       lists.activated_at as lists_activated_at,
       case
         when exists (select 1 from tci.sanction_flags f
                       where f.scope = 'entity' and f.entity_id = e.id
                         and f.lifted_at is null and f.effective_from <= current_date) then 'sanctioned'
         when exists (select 1 from tci.sanction_flags f
                       where f.scope = 'country' and f.country_code = e.country_code
                         and f.lifted_at is null and f.effective_from <= current_date) then 'country'
         when exists (select 1 from tci.sanctions_matches m where m.entity_id = e.id and m.status = 'pending') then 'possible_match'
         when ls.screened_at is null then 'not_screened'
         when ls.screened_at < lists.activated_at then 'outdated'
         else 'clear'
       end as status
  from tci.legal_entities e
  cross join lists
  left join lateral (
    select x.screened_at, x.outcome from tci.sanctions_screenings x
     where x.entity_id = e.id and x.outcome <> 'no_lists'
     order by x.screened_at desc limit 1) ls on true;
comment on view tci.v_entity_sanctions_status is
  '0091: each company''s sanctions state for the registry and limit tables: sanctioned (a live flag on the company), country (a live flag on its country), possible_match (a match pending review), not_screened, outdated (screened before the latest list took effect) or clear. Staff only (RLS of the tables read).';
grant select on tci.v_entity_sanctions_status to authenticated, service_role;

create view tci.v_sanctions_lists with (security_invoker = true) as
with keys as (
  select unnest(s.sanctions_required_lists) as list_key, true as required from tci.workflow_settings s where s.id
  union
  select i.list_key, false from tci.sanctions_list_imports i where i.status = 'active'
), k as (
  select list_key, bool_or(required) as required from keys group by list_key
)
select k.list_key, k.required,
       i.id as import_id, i.list_name, i.published_at, i.file_name, i.entry_count, i.name_count, i.delisted_count,
       i.imported_by, i.activated_at,
       (i.id is null or i.published_at < current_date - (select s.sanctions_list_stale_days from tci.workflow_settings s where s.id)) as stale
  from k
  left join tci.sanctions_list_imports i on i.list_key = k.list_key and i.status = 'active';
comment on view tci.v_sanctions_lists is
  '0091: each required or imported sanctions list: the import in use (publication date, counts) and whether it is missing or older than workflow_settings.sanctions_list_stale_days. Staff only.';
grant select on tci.v_sanctions_lists to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. Checks
-- ---------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  -- The normalisation brings the Cyrillic and the Russian-transliterated
  -- spellings of one name together, near the Uzbek Latin one, and drops
  -- legal forms.
  if tci.sanctions_normalise('ООО «Ходжаев Трейд»') <> 'xojaev treyd'
     or tci.sanctions_normalise('KHODZHAEV TREYD LLC') <> 'xojaev treyd'
     or extensions.similarity(tci.sanctions_normalise('Xo‘jayev Treyd MChJ'), 'xojaev treyd') < 0.6 then
    raise exception '0091: the normalisation does not meet: %, %, %',
      tci.sanctions_normalise('ООО «Ходжаев Трейд»'), tci.sanctions_normalise('KHODZHAEV TREYD LLC'),
      tci.sanctions_normalise('Xo‘jayev Treyd MChJ');
  end if;
  if tci.sanctions_normalise('Société Générale S.A.') <> 'societe generale' or tci.sanctions_normalise('LLC') is not null then
    raise exception '0091: diacritics or a bare legal form: %', tci.sanctions_normalise('Société Générale S.A.');
  end if;
  -- No API role inserts into or updates any of the new tables (none holds a
  -- removal grant either: only SELECT is granted).
  select string_agg(t || ':' || p, ', ') into v_bad
    from unnest(array['sanctions_list_imports', 'sanctions_list_entries', 'sanctions_list_names',
                      'entity_beneficial_owners', 'sanctions_screenings', 'sanctions_matches']) t,
         unnest(array['insert', 'update']) p
   where has_table_privilege('authenticated', 'tci.' || t, p) or has_table_privilege('anon', 'tci.' || t, p);
  if v_bad is not null then
    raise exception '0091: API write privileges on %', v_bad;
  end if;
  -- The auto decision has the new stop, last.
  if pg_get_functiondef('tci.adt_buyer_stops'::regproc) not like '%''sanctions_match''::text;%return v_out;%' then
    raise exception '0091: adt_buyer_stops lost the sanctions stop';
  end if;
  -- The internals stay closed to the API.
  if has_function_privilege('authenticated', 'tci.screen_entity_internal(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'tci.sanctions_candidates_internal(text, text[], numeric, integer)', 'execute')
     or has_function_privilege('authenticated', 'tci.pick_credit_analyst()', 'execute') then
    raise exception '0091: a screening internal is executable by authenticated';
  end if;
end $$;
