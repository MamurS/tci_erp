-- 0088_external_ratings.sql
--
-- What: a REFERENCE country rating from a credit insurer's published list —
--       today Allianz Trade's Country Risk Rating (owner request
--       2026-10-27) — shown next to the OECD category and never used by
--       anything that decides.
--       * tci.country_reference_ratings — one immutable row per entry:
--         country, source ('allianz_trade'), the medium-term Country Grade
--         (AA, A, BB, B, C, D) and the short-term Country Risk Level (1–4),
--         published together as e.g. «BB2»; the date of the publication it
--         was read from, where it was read (required) and a note. A row
--         with no grade records that the source no longer rates the
--         country (a note is then required).
--       * the rating in use per (country, source) is the latest by the
--         publication date, then by entry time (v_country_reference_ratings):
--         a rating read from an older publication is kept, not used.
--       * set_country_reference_rating (one country) and
--         import_country_reference_ratings (a list pasted from the
--         publication) — admin, who keeps reference data, and credit
--         analysts, who read country risk. Staff read; clients read nothing.
--       * tci.entity_agency_ratings (owner request 2026-10-27): a company's
--         PUBLIC credit rating by a rating agency — S&P, Moody's, Fitch,
--         a national agency (Ahbor-Reyting, SAIPRO, ACRA, Expert RA) or
--         another named one — on its international or national scale,
--         long or short term, with the outlook, the date of the action and
--         where it was published. The latest per (company, agency, scale,
--         term) is in use (v_entity_agency_ratings); a row with no rating
--         records a withdrawal (a note says so). Entered by the information
--         desk and credit analysts through set_entity_agency_rating; staff
--         read; shown on the company card beside our own grade.
-- Why:  the OECD category says whether a sovereign repays export credits;
--       an insurer's country rating says how companies there pay. The
--       credit desk wants both on one screen. It stays a reference:
--       Allianz Trade's ratings are its published content, entered by hand
--       under its terms of use, and the cover matrix, the auto decision and
--       the engine read only the OECD and internal categories (asserted
--       below). Not a driver, so no four eyes.
--
-- An agency's rating of a company is the same kind of thing: public,
-- informative, and not ours — it is shown beside our grade, never in
-- place of it, and nothing that decides reads it.
--
-- No API role inserts, updates or deletes either table; a trigger refuses
-- any UPDATE, owner included. The rows are the history.

create table tci.country_reference_ratings (
  id            uuid primary key default gen_random_uuid(),
  country_code  char(2) not null references tci.countries (code),
  source        text not null check (source in ('allianz_trade')),
  grade         text check (grade in ('AA', 'A', 'BB', 'B', 'C', 'D')),
  risk_level    smallint check (risk_level between 1 and 4),
  as_of         date not null,
  reference     text not null check (btrim(reference) <> '' and length(reference) <= 500),
  note          text check (length(note) <= 1000),
  entered_by    uuid not null references auth.users (id),
  -- the clock, not the transaction: two entries in one call still order
  entered_at    timestamptz not null default clock_timestamp(),
  constraint country_reference_ratings_pair check ((grade is null) = (risk_level is null)),
  constraint country_reference_ratings_cleared_note check (grade is not null or btrim(coalesce(note, '')) <> '')
);
create index country_reference_ratings_latest
  on tci.country_reference_ratings (country_code, source, as_of desc, entered_at desc);
comment on table tci.country_reference_ratings is
  '0088: a credit insurer''s published country rating (Allianz Trade: Country Grade AA–D + Country Risk Level 1–4), entered for reference. The latest by as_of, then entered_at, is in use; no grade = no longer rated. Never read by a decision, the cover matrix or the engine.';

create function tci.guard_country_reference_rating() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'reference_rating_immutable: an entry is never changed; enter a new one' using errcode = 'P0001';
end $$;
revoke all on function tci.guard_country_reference_rating() from public, anon, authenticated;
create trigger country_reference_ratings_immutable
  before update on tci.country_reference_ratings
  for each row execute function tci.guard_country_reference_rating();

alter table tci.country_reference_ratings enable row level security;
create policy "country_reference_ratings: staff read" on tci.country_reference_ratings
  for select to authenticated using (tci.is_staff());
revoke all on tci.country_reference_ratings from public, anon, authenticated;
grant select on tci.country_reference_ratings to authenticated;
grant select, insert on tci.country_reference_ratings to service_role;

-- The rating in use per (country, source).
create view tci.v_country_reference_ratings with (security_invoker = true) as
  select distinct on (r.country_code, r.source)
         r.id, r.country_code, r.source, r.grade, r.risk_level,
         case when r.grade is not null then r.grade || r.risk_level end as rating,
         r.as_of, r.reference, r.note, r.entered_by, r.entered_at
    from tci.country_reference_ratings r
   where tci.is_staff()
   order by r.country_code, r.source, r.as_of desc, r.entered_at desc;
comment on view tci.v_country_reference_ratings is
  '0088: the reference rating in use per country and source (latest publication, then latest entry); rating is null when the source no longer rates the country. Staff only; reference, never a driver.';
revoke all on tci.v_country_reference_ratings from public, anon;
grant select on tci.v_country_reference_ratings to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

-- «BB2» → (BB, 2); anything else → null.
create function tci.parse_reference_rating(p_rating text)
returns table (grade text, risk_level smallint)
language sql immutable set search_path = '' as $$
  select m[1], m[2]::smallint
    from regexp_match(upper(btrim(coalesce(p_rating, ''))), '^(AA|A|BB|B|C|D)([1-4])$') m
   where m is not null
$$;
grant execute on function tci.parse_reference_rating(text) to authenticated, service_role;
revoke all on function tci.parse_reference_rating(text) from public, anon;

-- One country. An empty rating records that the source no longer rates it
-- (a note says so). Refused: a future publication date, an unknown source
-- or country, a malformed rating, and an entry identical to the one in use.
create function tci.set_country_reference_rating(
  p_country char, p_source text, p_rating text, p_as_of date, p_reference text, p_note text default null)
returns tci.country_reference_ratings
language plpgsql security definer set search_path = '' as $$
declare
  v_grade text;
  v_level smallint;
  v_live tci.country_reference_ratings;
  v_row tci.country_reference_ratings;
begin
  perform tci.require_role('admin', 'credit_analyst');
  if p_source is distinct from 'allianz_trade' then
    raise exception 'reference_rating_source: unknown source %', p_source using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.countries where code = upper(p_country)) then
    raise exception 'country % not found', p_country using errcode = 'P0002';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'reference_rating_as_of: the publication date is required and cannot be in the future' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reference), '') = '' then
    raise exception 'reference_rating_reference: say where the rating was read' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_rating), '') <> '' then
    select r.grade, r.risk_level into v_grade, v_level from tci.parse_reference_rating(p_rating) r;
    if v_grade is null then
      raise exception 'reference_rating_invalid: % is not a rating of the scale (AA1 … D4)', p_rating using errcode = 'P0001';
    end if;
  elsif coalesce(btrim(p_note), '') = '' then
    raise exception 'reference_rating_cleared_note: say why the source no longer rates the country' using errcode = 'P0001';
  end if;

  select * into v_live from tci.country_reference_ratings r
   where r.country_code = upper(p_country) and r.source = p_source
   order by r.as_of desc, r.entered_at desc limit 1;
  if v_live.id is not null and v_live.as_of = p_as_of
     and v_live.grade is not distinct from v_grade and v_live.risk_level is not distinct from v_level then
    raise exception 'reference_rating_unchanged: this rating of this publication is already recorded' using errcode = 'P0001';
  end if;

  insert into tci.country_reference_ratings (country_code, source, grade, risk_level, as_of, reference, note, entered_by)
  values (upper(p_country), p_source, v_grade, v_level, p_as_of, btrim(p_reference), nullif(btrim(p_note), ''), (select auth.uid()))
  returning * into v_row;
  return v_row;
end $$;
revoke all on function tci.set_country_reference_rating(char, text, text, date, text, text) from public, anon;
grant execute on function tci.set_country_reference_rating(char, text, text, date, text, text) to authenticated, service_role;

-- A list from one publication: [{country_code, rating}]. All or nothing —
-- an unknown country, a malformed rating or a country twice refuses the
-- whole list, naming them. A row identical to the rating in use from the
-- same publication is skipped; countries the list leaves out are untouched.
create function tci.import_country_reference_ratings(p_source text, p_as_of date, p_reference text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_bad text[];
  v_inserted integer;
  v_total integer;
begin
  perform tci.require_role('admin', 'credit_analyst');
  if p_source is distinct from 'allianz_trade' then
    raise exception 'reference_rating_source: unknown source %', p_source using errcode = 'P0001';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'reference_rating_as_of: the publication date is required and cannot be in the future' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reference), '') = '' then
    raise exception 'reference_rating_reference: say where the rating was read' using errcode = 'P0001';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'reference_rating_empty: the list holds no rating' using errcode = 'P0001';
  end if;
  v_total := jsonb_array_length(p_rows);

  select array_agg(distinct upper(r ->> 'country_code')) into v_bad
    from jsonb_array_elements(p_rows) r
   where not exists (select 1 from tci.countries c where c.code = upper(r ->> 'country_code'));
  if v_bad is not null then
    raise exception 'reference_rating_unknown: %', array_to_string(v_bad, ', ')
      using errcode = 'P0001', detail = array_to_string(v_bad, ',');
  end if;
  select array_agg(upper(r ->> 'country_code')) into v_bad
    from jsonb_array_elements(p_rows) r
   where not exists (select 1 from tci.parse_reference_rating(r ->> 'rating'));
  if v_bad is not null then
    raise exception 'reference_rating_invalid: %', array_to_string(v_bad, ', ')
      using errcode = 'P0001', detail = array_to_string(v_bad, ',');
  end if;
  if v_total <> (select count(distinct upper(r ->> 'country_code')) from jsonb_array_elements(p_rows) r) then
    raise exception 'reference_rating_duplicate: a country appears twice in the list' using errcode = 'P0001';
  end if;

  with incoming as (
    select upper(r ->> 'country_code') as country_code, pr.grade, pr.risk_level
      from jsonb_array_elements(p_rows) r
      cross join lateral tci.parse_reference_rating(r ->> 'rating') pr
  ),
  live as (
    select distinct on (x.country_code) x.country_code, x.grade, x.risk_level, x.as_of
      from tci.country_reference_ratings x
     where x.source = p_source
     order by x.country_code, x.as_of desc, x.entered_at desc
  )
  insert into tci.country_reference_ratings (country_code, source, grade, risk_level, as_of, reference, entered_by)
  select i.country_code, p_source, i.grade, i.risk_level, p_as_of, btrim(p_reference), (select auth.uid())
    from incoming i
    left join live l on l.country_code = i.country_code
   where not (l.country_code is not null and l.as_of = p_as_of
              and l.grade is not distinct from i.grade and l.risk_level is not distinct from i.risk_level);
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('inserted', v_inserted, 'unchanged', v_total - v_inserted);
end $$;
revoke all on function tci.import_country_reference_ratings(text, date, text, jsonb) from public, anon;
grant execute on function tci.import_country_reference_ratings(text, date, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A company's public ratings by rating agencies
-- ---------------------------------------------------------------------------

create table tci.entity_agency_ratings (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references tci.legal_entities (id),
  agency        text not null check (agency in ('sp', 'moodys', 'fitch', 'ahbor_reyting', 'saipro', 'acra', 'expert_ra', 'other')),
  -- the agency's name when it is none of the listed ones
  agency_name   text check (length(agency_name) <= 100),
  scale         text not null check (scale in ('international', 'national')),
  term          text not null default 'long' check (term in ('long', 'short')),
  -- as the agency writes it: «BB-», «Ba3», «A-1+», «uzA+», «AA(uzb)», «ruA-»
  rating        text check (rating ~ '^[A-Za-z0-9][A-Za-z0-9+./() -]{0,19}$'),
  outlook       text check (outlook in ('positive', 'stable', 'negative', 'developing',
                                        'watch_positive', 'watch_negative', 'watch_developing')),
  as_of         date not null,
  reference     text not null check (btrim(reference) <> '' and length(reference) <= 500),
  note          text check (length(note) <= 1000),
  entered_by    uuid not null references auth.users (id),
  entered_at    timestamptz not null default clock_timestamp(),
  constraint entity_agency_ratings_other_named
    check ((agency = 'other') = (btrim(coalesce(agency_name, '')) <> '')),
  constraint entity_agency_ratings_withdrawn_note
    check (rating is not null or btrim(coalesce(note, '')) <> ''),
  constraint entity_agency_ratings_withdrawn_outlook
    check (rating is not null or outlook is null)
);
create index entity_agency_ratings_latest
  on tci.entity_agency_ratings (entity_id, agency, scale, term, as_of desc, entered_at desc);
comment on table tci.entity_agency_ratings is
  '0088: a company''s public credit rating by a rating agency (international or national scale, long or short term, outlook), entered for reference with the date of the rating action and where it was published. The latest per (company, agency, scale, term) is in use; no rating = withdrawn. Never read by a decision or the engine.';

create function tci.guard_entity_agency_rating() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'agency_rating_immutable: an entry is never changed; enter a new one' using errcode = 'P0001';
end $$;
revoke all on function tci.guard_entity_agency_rating() from public, anon, authenticated;
create trigger entity_agency_ratings_immutable
  before update on tci.entity_agency_ratings
  for each row execute function tci.guard_entity_agency_rating();

alter table tci.entity_agency_ratings enable row level security;
create policy "entity_agency_ratings: staff read" on tci.entity_agency_ratings
  for select to authenticated using (tci.is_staff());
revoke all on tci.entity_agency_ratings from public, anon, authenticated;
grant select on tci.entity_agency_ratings to authenticated;
grant select, insert on tci.entity_agency_ratings to service_role;

-- The rating in use per (company, agency, scale, term).
create view tci.v_entity_agency_ratings with (security_invoker = true) as
  select distinct on (r.entity_id, r.agency, coalesce(r.agency_name, ''), r.scale, r.term)
         r.id, r.entity_id, r.agency, r.agency_name, r.scale, r.term, r.rating, r.outlook,
         r.as_of, r.reference, r.note, r.entered_by, r.entered_at
    from tci.entity_agency_ratings r
   where tci.is_staff()
   order by r.entity_id, r.agency, coalesce(r.agency_name, ''), r.scale, r.term, r.as_of desc, r.entered_at desc;
comment on view tci.v_entity_agency_ratings is
  '0088: each agency''s rating of a company in use (latest rating action, then latest entry); rating is null when withdrawn. Staff only; reference, never a driver.';
revoke all on tci.v_entity_agency_ratings from public, anon;
grant select on tci.v_entity_agency_ratings to authenticated, service_role;

-- One rating action. An empty rating records a withdrawal (a note says
-- so). Refused: a future date, a missing source, an unnamed «other»
-- agency, a malformed rating or outlook, and an entry identical to the one
-- in use for the same date.
create function tci.set_entity_agency_rating(
  p_entity uuid, p_agency text, p_agency_name text, p_scale text, p_term text,
  p_rating text, p_outlook text, p_as_of date, p_reference text, p_note text default null)
returns tci.entity_agency_ratings
language plpgsql security definer set search_path = '' as $$
declare
  v_rating text := nullif(btrim(coalesce(p_rating, '')), '');
  v_name text := case when p_agency = 'other' then nullif(btrim(coalesce(p_agency_name, '')), '') end;
  v_live tci.entity_agency_ratings;
  v_row tci.entity_agency_ratings;
begin
  perform tci.require_role('information_manager', 'credit_analyst');
  if not exists (select 1 from tci.legal_entities where id = p_entity) then
    raise exception 'company % not found', p_entity using errcode = 'P0002';
  end if;
  if p_agency is null or p_agency not in ('sp', 'moodys', 'fitch', 'ahbor_reyting', 'saipro', 'acra', 'expert_ra', 'other') then
    raise exception 'agency_rating_agency: unknown agency %', p_agency using errcode = 'P0001';
  end if;
  if p_agency = 'other' and v_name is null then
    raise exception 'agency_rating_agency_name: name the agency' using errcode = 'P0001';
  end if;
  if p_scale is null or p_scale not in ('international', 'national')
     or p_term is null or p_term not in ('long', 'short') then
    raise exception 'agency_rating_scale: say which scale and which term' using errcode = 'P0001';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'agency_rating_as_of: the date of the rating action is required and cannot be in the future' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reference), '') = '' then
    raise exception 'agency_rating_reference: say where the rating was published' using errcode = 'P0001';
  end if;
  if v_rating is not null and v_rating !~ '^[A-Za-z0-9][A-Za-z0-9+./() -]{0,19}$' then
    raise exception 'agency_rating_invalid: % is not a rating as an agency writes it', p_rating using errcode = 'P0001';
  end if;
  if v_rating is null and coalesce(btrim(p_note), '') = '' then
    raise exception 'agency_rating_withdrawn_note: say why the rating is withdrawn' using errcode = 'P0001';
  end if;
  if p_outlook is not null and (v_rating is null or p_outlook not in
       ('positive', 'stable', 'negative', 'developing', 'watch_positive', 'watch_negative', 'watch_developing')) then
    raise exception 'agency_rating_outlook: % is not an outlook of a rating in force', p_outlook using errcode = 'P0001';
  end if;

  select * into v_live from tci.entity_agency_ratings r
   where r.entity_id = p_entity and r.agency = p_agency and coalesce(r.agency_name, '') = coalesce(v_name, '')
     and r.scale = p_scale and r.term = p_term
   order by r.as_of desc, r.entered_at desc limit 1;
  if v_live.id is not null and v_live.as_of = p_as_of
     and v_live.rating is not distinct from v_rating and v_live.outlook is not distinct from p_outlook then
    raise exception 'agency_rating_unchanged: this rating action is already recorded' using errcode = 'P0001';
  end if;

  insert into tci.entity_agency_ratings (entity_id, agency, agency_name, scale, term, rating, outlook, as_of, reference, note, entered_by)
  values (p_entity, p_agency, v_name, p_scale, p_term, v_rating, p_outlook, p_as_of, btrim(p_reference),
          nullif(btrim(p_note), ''), (select auth.uid()))
  returning * into v_row;
  return v_row;
end $$;
revoke all on function tci.set_entity_agency_rating(uuid, text, text, text, text, text, text, date, text, text) from public, anon;
grant execute on function tci.set_entity_agency_rating(uuid, text, text, text, text, text, text, date, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  -- A reference, never a driver: nothing that decides reads it.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci'
     and p.prosrc like '%country_reference_ratings%'
     and p.proname not in ('set_country_reference_rating', 'import_country_reference_ratings');
  if v_bad is not null then
    raise exception '0088: only the two writers may name the reference ratings, not %', v_bad;
  end if;
  if exists (select 1 from pg_views where schemaname = 'tci' and viewname <> 'v_country_reference_ratings'
               and definition like '%country_reference_ratings%') then
    raise exception '0088: a view other than v_country_reference_ratings reads the reference ratings';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci'
     and p.prosrc like '%entity_agency_ratings%'
     and p.proname <> 'set_entity_agency_rating';
  if v_bad is not null then
    raise exception '0088: only its writer may name the agency ratings, not %', v_bad;
  end if;
  if exists (select 1 from pg_views where schemaname = 'tci' and viewname <> 'v_entity_agency_ratings'
               and definition like '%entity_agency_ratings%') then
    raise exception '0088: a view other than v_entity_agency_ratings reads the agency ratings';
  end if;
  if has_table_privilege('authenticated', 'tci.entity_agency_ratings', 'insert')
     or has_table_privilege('authenticated', 'tci.entity_agency_ratings', 'update')
     or has_table_privilege('authenticated', 'tci.entity_agency_ratings', 'delete') then
    raise exception '0088: authenticated may write the agency ratings';
  end if;
  if has_table_privilege('authenticated', 'tci.country_reference_ratings', 'insert')
     or has_table_privilege('authenticated', 'tci.country_reference_ratings', 'update')
     or has_table_privilege('authenticated', 'tci.country_reference_ratings', 'delete') then
    raise exception '0088: authenticated may write the reference ratings';
  end if;
  if (select count(*) from tci.parse_reference_rating('bb2')) <> 1
     or (select count(*) from tci.parse_reference_rating('AAA1')) <> 0
     or (select count(*) from tci.parse_reference_rating('B5')) <> 0 then
    raise exception '0088: parse_reference_rating reads the scale wrongly';
  end if;
end $$;
