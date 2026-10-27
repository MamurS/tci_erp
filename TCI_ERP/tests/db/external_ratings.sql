-- Tests for migration 0088: external ratings. Part 1, reference country
-- ratings (Allianz Trade) —
-- who may enter them (admin, credit analysts), who may read them (staff,
-- never a client), the scale (AA1 … D4), the rating in use (latest
-- publication, then latest entry; an older publication is kept, not used),
-- clearing with a note, the list import (all or nothing, identical rows
-- skipped) and immutability. Part 2, a company's public agency ratings —
-- who enters them (the information desk, credit analysts; not admin, not
-- sales), staff read, the rating in use per agency / scale / term, a
-- withdrawal with a note, and what is refused.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/country_reference_ratings.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000088a1', 'crr-admin@t'),
  ('99999999-0000-4000-8000-0000000088a2', 'crr-analyst@t'),
  ('99999999-0000-4000-8000-0000000088a3', 'crr-cu@t'),
  ('99999999-0000-4000-8000-0000000088a4', 'crr-sales@t'),
  ('99999999-0000-4000-8000-0000000088a5', 'crr-client@t'),
  ('99999999-0000-4000-8000-0000000088a6', 'crr-im@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000088a1', 'admin'),
  ('99999999-0000-4000-8000-0000000088a2', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000088a3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000088a4', 'sales'),
  ('99999999-0000-4000-8000-0000000088a5', 'client'),
  ('99999999-0000-4000-8000-0000000088a6', 'information_manager');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'CRR ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'crr-%@t'
on conflict (user_id) do update set must_change_password = false;
-- A buyer in China, whose cover requirement must not move.
select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000088a4"}', true);
insert into tci.legal_entities (id, name, country_code, created_by, industry_id) values
  ('99999999-0000-4000-8000-0000000088ff', 'CRR Buyer', 'CN', '99999999-0000-4000-8000-0000000088a4', 'FOOD');
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

create function pg_temp.owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('tci.internal_call', '', true);
end $$;
grant execute on function pg_temp.owner() to authenticated;

create function pg_temp.refused(p_sql text, p_state text, p_label text) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state then return; end if;
    raise exception 'external_ratings: % refused with % (%) instead of %', p_label, v_state, v_msg, p_state;
  end;
  raise exception 'external_ratings: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text) to authenticated;

do $$
declare
  c_admin   constant uuid := '99999999-0000-4000-8000-0000000088a1';
  c_analyst constant uuid := '99999999-0000-4000-8000-0000000088a2';
  c_cu      constant uuid := '99999999-0000-4000-8000-0000000088a3';
  c_sales   constant uuid := '99999999-0000-4000-8000-0000000088a4';
  c_client  constant uuid := '99999999-0000-4000-8000-0000000088a5';
  c_im      constant uuid := '99999999-0000-4000-8000-0000000088a6';
  c_buyer   constant uuid := '99999999-0000-4000-8000-0000000088ff';
  v_agency  tci.entity_agency_ratings;
  v_row tci.country_reference_ratings;
  v     jsonb;
  v_live record;
  v_n   integer;
  v_cover_before integer;
begin
  -- The cover matrix before: a reference rating must not move it.
  perform pg_temp.owner();
  v_cover_before := tci.cover_required_rank_internal('99999999-0000-4000-8000-0000000088ff'::uuid);
  if v_cover_before is null then raise exception 'external_ratings: the fixture buyer has no cover requirement'; end if;

  -- 1. Admin and a credit analyst enter; the scale is read case-blind.
  perform pg_temp.act(c_admin);
  v_row := tci.set_country_reference_rating('de', 'allianz_trade', 'a1', current_date - 10, 'Allianz Trade country report, Germany');
  if v_row.grade <> 'A' or v_row.risk_level <> 1 or v_row.country_code <> 'DE' then
    raise exception 'external_ratings: A1 was read as % %', v_row.grade, v_row.risk_level;
  end if;
  perform pg_temp.act(c_analyst);
  perform tci.set_country_reference_rating('CN', 'allianz_trade', 'BB2', current_date - 10, 'Allianz Trade country report, China');

  -- 2. Nobody else writes; the table is closed to direct writes.
  perform pg_temp.act(c_cu);
  perform pg_temp.refused($q$select tci.set_country_reference_rating('UZ', 'allianz_trade', 'C3', current_date, 'x')$q$, '42501', 'an underwriter entering');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused($q$select tci.import_country_reference_ratings('allianz_trade', current_date, 'x', '[{"country_code":"UZ","rating":"C3"}]'::jsonb)$q$, '42501', 'sales importing');
  perform pg_temp.act(c_analyst);
  perform pg_temp.refused($q$insert into tci.country_reference_ratings (country_code, source, grade, risk_level, as_of, reference, entered_by) values ('UZ', 'allianz_trade', 'C', 3, current_date, 'x', auth.uid())$q$, '42501', 'a direct insert');

  -- 3. Staff read, a client reads nothing.
  perform pg_temp.act(c_sales);
  select count(*) into v_n from tci.v_country_reference_ratings where country_code in ('DE', 'CN');
  if v_n <> 2 then raise exception 'external_ratings: sales sees % ratings, expected 2', v_n; end if;
  perform pg_temp.act(c_client);
  select count(*) into v_n from tci.v_country_reference_ratings;
  if v_n <> 0 then raise exception 'external_ratings: a client sees % ratings', v_n; end if;
  select count(*) into v_n from tci.country_reference_ratings;
  if v_n <> 0 then raise exception 'external_ratings: a client reads the table'; end if;

  -- 4. What is refused, by rule.
  perform pg_temp.act(c_analyst);
  perform pg_temp.refused($q$select tci.set_country_reference_rating('UZ', 'allianz_trade', 'A5', current_date, 'x')$q$, 'P0001', 'a level of 5');
  perform pg_temp.refused($q$select tci.set_country_reference_rating('UZ', 'allianz_trade', 'AAA1', current_date, 'x')$q$, 'P0001', 'a grade off the scale');
  perform pg_temp.refused($q$select tci.set_country_reference_rating('UZ', 'allianz_trade', 'C3', current_date + 1, 'x')$q$, 'P0001', 'a future publication');
  perform pg_temp.refused($q$select tci.set_country_reference_rating('UZ', 'allianz_trade', 'C3', current_date, '  ')$q$, 'P0001', 'no reference');
  perform pg_temp.refused($q$select tci.set_country_reference_rating('UZ', 'coface', 'C3', current_date, 'x')$q$, 'P0001', 'an unknown source');
  perform pg_temp.refused($q$select tci.set_country_reference_rating('QQ', 'allianz_trade', 'C3', current_date, 'x')$q$, 'P0002', 'an unknown country');
  perform pg_temp.refused($q$select tci.set_country_reference_rating('CN', 'allianz_trade', 'BB2', current_date - 10, 'again')$q$, 'P0001', 'the same rating of the same publication');
  perform pg_temp.refused($q$select tci.set_country_reference_rating('CN', 'allianz_trade', '', current_date, 'x')$q$, 'P0001', 'clearing without a note');

  -- 5. The rating in use: a newer publication wins; an older one entered
  --    later is kept and not used.
  perform tci.set_country_reference_rating('CN', 'allianz_trade', 'B3', current_date - 2, 'Allianz Trade update');
  perform tci.set_country_reference_rating('CN', 'allianz_trade', 'A1', current_date - 300, 'an old report');
  select * into v_live from tci.v_country_reference_ratings where country_code = 'CN' and source = 'allianz_trade';
  if v_live.rating <> 'B3' or v_live.as_of <> current_date - 2 then
    raise exception 'external_ratings: the rating in use is % of %, expected B3', v_live.rating, v_live.as_of;
  end if;
  select count(*) into v_n from tci.country_reference_ratings where country_code = 'CN';
  if v_n <> 3 then raise exception 'external_ratings: CN has % entries, expected 3 (history kept)', v_n; end if;

  -- 6. Cleared with a note: no rating in use, the entry stays.
  perform tci.set_country_reference_rating('CN', 'allianz_trade', null, current_date, 'Allianz Trade country list', 'No longer rated');
  select * into v_live from tci.v_country_reference_ratings where country_code = 'CN' and source = 'allianz_trade';
  if v_live.rating is not null or v_live.note <> 'No longer rated' then
    raise exception 'external_ratings: a cleared rating still reads %', v_live.rating;
  end if;

  -- 7. The list import: all or nothing, naming what is wrong.
  perform pg_temp.refused($q$select tci.import_country_reference_ratings('allianz_trade', current_date, 'list', '[{"country_code":"UZ","rating":"C3"},{"country_code":"QQ","rating":"B1"}]'::jsonb)$q$, 'P0001', 'a list with an unknown country');
  perform pg_temp.refused($q$select tci.import_country_reference_ratings('allianz_trade', current_date, 'list', '[{"country_code":"UZ","rating":"C3"},{"country_code":"KZ","rating":"E1"}]'::jsonb)$q$, 'P0001', 'a list with a bad rating');
  perform pg_temp.refused($q$select tci.import_country_reference_ratings('allianz_trade', current_date, 'list', '[{"country_code":"UZ","rating":"C3"},{"country_code":"uz","rating":"C2"}]'::jsonb)$q$, 'P0001', 'a list with a country twice');
  perform pg_temp.refused($q$select tci.import_country_reference_ratings('allianz_trade', current_date, 'list', '[]'::jsonb)$q$, 'P0001', 'an empty list');
  select count(*) into v_n from tci.country_reference_ratings where country_code in ('UZ', 'KZ');
  if v_n <> 0 then raise exception 'external_ratings: a refused list wrote % rows', v_n; end if;

  perform pg_temp.act(c_admin);
  v := tci.import_country_reference_ratings('allianz_trade', current_date - 10, 'Allianz Trade Country Risk Atlas',
         '[{"country_code":"UZ","rating":"c3"},{"country_code":"KZ","rating":"BB2"},{"country_code":"DE","rating":"A1"}]'::jsonb);
  if (v ->> 'inserted')::int <> 2 or (v ->> 'unchanged')::int <> 1 then
    raise exception 'external_ratings: the import answered %, expected 2 inserted and DE unchanged', v;
  end if;
  v := tci.import_country_reference_ratings('allianz_trade', current_date - 10, 'again',
         '[{"country_code":"UZ","rating":"C3"},{"country_code":"KZ","rating":"BB2"}]'::jsonb);
  if (v ->> 'inserted')::int <> 0 then
    raise exception 'external_ratings: a repeated list inserted %', v;
  end if;

  -- 8. Immutable, owner included.
  perform pg_temp.owner();
  perform pg_temp.refused(format($q$update tci.country_reference_ratings set grade = 'D' where id = %L$q$, v_row.id), 'P0001', 'an update by the owner');

  -- 9. A reference, never a driver: the cover matrix did not move.
  if tci.cover_required_rank_internal('99999999-0000-4000-8000-0000000088ff'::uuid) is distinct from v_cover_before then
    raise exception 'external_ratings: a reference rating moved the cover matrix';
  end if;


  -- 10. A company's agency ratings: the information desk and credit analysts.
  perform pg_temp.act(c_im);
  v_agency := tci.set_entity_agency_rating(c_buyer, 'sp', null, 'international', 'long', 'BB-', 'stable',
                current_date - 30, 'S&P Global Ratings research update');
  if v_agency.rating <> 'BB-' or v_agency.outlook <> 'stable' then
    raise exception 'external_ratings: the S&P rating reads % %', v_agency.rating, v_agency.outlook;
  end if;
  perform pg_temp.act(c_analyst);
  perform tci.set_entity_agency_rating(c_buyer, 'fitch', null, 'national', 'long', 'AA(uzb)', 'positive',
            current_date - 20, 'Fitch rating action commentary');
  perform tci.set_entity_agency_rating(c_buyer, 'other', 'Local Agency', 'national', 'short', 'uzA-1', null,
            current_date - 20, 'agency site');
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'moodys', null, 'international', 'long', 'Ba3', 'stable', current_date, 'x')$q$, c_buyer), '42501', 'admin entering an agency rating');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'moodys', null, 'international', 'long', 'Ba3', 'stable', current_date, 'x')$q$, c_buyer), '42501', 'sales entering an agency rating');
  perform pg_temp.refused($q$insert into tci.entity_agency_ratings (entity_id, agency, scale, term, rating, as_of, reference, entered_by) values ('99999999-0000-4000-8000-0000000088ff', 'sp', 'international', 'long', 'A', current_date, 'x', auth.uid())$q$, '42501', 'a direct insert of an agency rating');
  select count(*) into v_n from tci.v_entity_agency_ratings where entity_id = c_buyer;
  if v_n <> 3 then raise exception 'external_ratings: sales sees % agency ratings, expected 3', v_n; end if;
  perform pg_temp.act(c_client);
  select count(*) into v_n from tci.v_entity_agency_ratings;
  if v_n <> 0 then raise exception 'external_ratings: a client sees % agency ratings', v_n; end if;

  perform pg_temp.act(c_im);
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'other', '  ', 'international', 'long', 'A', null, current_date, 'x')$q$, c_buyer), 'P0001', 'an unnamed other agency');
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'sp', null, 'international', 'long', 'BB-;x', null, current_date, 'x')$q$, c_buyer), 'P0001', 'a malformed rating');
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'sp', null, 'international', 'long', 'BB-', 'sideways', current_date, 'x')$q$, c_buyer), 'P0001', 'an unknown outlook');
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'sp', null, 'global', 'long', 'BB-', null, current_date, 'x')$q$, c_buyer), 'P0001', 'an unknown scale');
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'sp', null, 'international', 'long', 'BB-', null, current_date + 1, 'x')$q$, c_buyer), 'P0001', 'a future rating action');
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'sp', null, 'international', 'long', 'BB-', null, current_date, '')$q$, c_buyer), 'P0001', 'no source');
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'sp', null, 'international', 'long', null, 'stable', current_date, 'x', 'withdrawn')$q$, c_buyer), 'P0001', 'an outlook on a withdrawal');
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'sp', null, 'international', 'long', null, null, current_date, 'x')$q$, c_buyer), 'P0001', 'a withdrawal without a note');
  perform pg_temp.refused(format($q$select tci.set_entity_agency_rating(%L, 'sp', null, 'international', 'long', 'BB-', 'stable', current_date - 30, 'again')$q$, c_buyer), 'P0001', 'the same rating action twice');
  perform pg_temp.refused($q$select tci.set_entity_agency_rating('99999999-0000-4000-8000-00000000ffff', 'sp', null, 'international', 'long', 'A', null, current_date, 'x')$q$, 'P0002', 'an unknown company');

  -- An upgrade, then a withdrawal: the latest action is in use, the history stays.
  perform tci.set_entity_agency_rating(c_buyer, 'sp', null, 'international', 'long', 'BB', 'positive', current_date - 5, 'upgrade');
  select count(*) into v_n from tci.v_entity_agency_ratings where entity_id = c_buyer and agency = 'sp' and rating = 'BB';
  if v_n <> 1 then raise exception 'external_ratings: the S&P upgrade is not in use'; end if;
  perform tci.set_entity_agency_rating(c_buyer, 'sp', null, 'international', 'long', null, null, current_date, 'withdrawal notice', 'Withdrawn at the issuer''s request');
  select count(*) into v_n from tci.v_entity_agency_ratings where entity_id = c_buyer and agency = 'sp' and rating is null;
  if v_n <> 1 then raise exception 'external_ratings: the S&P withdrawal is not in use'; end if;
  select count(*) into v_n from tci.entity_agency_ratings where entity_id = c_buyer and agency = 'sp';
  if v_n <> 3 then raise exception 'external_ratings: S&P has % entries, expected 3', v_n; end if;
  perform pg_temp.owner();
  perform pg_temp.refused(format($q$update tci.entity_agency_ratings set rating = 'AAA' where id = %L$q$, v_agency.id), 'P0001', 'an agency rating updated by the owner');

  raise notice 'external_ratings: OK — admin and credit analysts enter Allianz Trade ratings (AA1 … D4, read case-blind), nobody else and never directly; staff read, a client reads nothing; malformed, future, unreferenced, unknown and repeated entries are refused by rule; the latest publication is in use and an older one is kept; a cleared rating needs a note; a list imports all or nothing and skips what is already recorded; entries never change; the cover matrix ignores them; a company''s agency ratings are entered by the information desk and credit analysts (not admin, not sales, never directly), read by staff only, the latest action per agency, scale and term is in use, a withdrawal needs a note and takes no outlook, and malformed, future, unsourced and repeated entries are refused';
end $$;

rollback;
