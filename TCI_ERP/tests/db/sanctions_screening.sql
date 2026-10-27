-- tests/db/sanctions_screening.sql — migration 0091 (sanctions screening),
-- with role impersonation, in one transaction rolled back at the end:
--
--   1. Lists: imported by credit analysts and admin only, in batches; the
--      newer file takes effect, an older one is refused, a much smaller one
--      needs confirming, a party missing from it is delisted.
--   2. Screening runs by itself at a limit request (before the auto
--      decision), at a rating, at a new beneficial owner and a new ownership
--      link; it finds the company, its owner company and its beneficial
--      owners, people against people.
--   3. Matches go to the least-loaded credit analyst, one task per company;
--      an approving decision and the auto decision are stopped while one is
--      pending; confirming sets a sanctions flag, clearing is remembered.
--   4. Flags are the credit analysts'; the search and the subject list are
--      every staff member's; clients see none of it; no API role writes.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000091a1', 'ssc-an1@t'),
  ('99999999-0000-4000-8000-0000000091a2', 'ssc-an2@t'),
  ('99999999-0000-4000-8000-0000000091b1', 'ssc-cu@t'),
  ('99999999-0000-4000-8000-0000000091c1', 'ssc-sales@t'),
  ('99999999-0000-4000-8000-0000000091c2', 'ssc-admin@t'),
  ('99999999-0000-4000-8000-0000000091c3', 'ssc-client@t'),
  ('99999999-0000-4000-8000-0000000091c4', 'ssc-im@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000091a1', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000091a2', 'credit_analyst'),
  ('99999999-0000-4000-8000-0000000091b1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000091c1', 'sales'),
  ('99999999-0000-4000-8000-0000000091c2', 'admin'),
  ('99999999-0000-4000-8000-0000000091c3', 'client'),
  ('99999999-0000-4000-8000-0000000091c4', 'information_manager');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'SSC ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'ssc-%@t'
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000091c1"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000091e0', 'SSC Holder', 'UZ', '99999999-0000-4000-8000-0000000091c1');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000091f1', '99999999-0000-4000-8000-0000000091e0', 'SSC-P1', 'whole_turnover', 'draft',
   current_date - 30, current_date + 330, 'UZS', 90, 0, 0.15, 10000, 0, 30, 60, 90, 'monthly',
   '99999999-0000-4000-8000-0000000091c1', 100000000);
update tci.policies set status = 'active' where id = '99999999-0000-4000-8000-0000000091f1';
insert into tci.policyholder_users (entity_id, user_id, created_by) values
  ('99999999-0000-4000-8000-0000000091e0', '99999999-0000-4000-8000-0000000091c3', '99999999-0000-4000-8000-0000000091c1');
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

create function pg_temp.refused(p_sql text, p_state text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'sanctions_screening: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'sanctions_screening: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

-- A buyer with what a decision and an auto decision need.
create function pg_temp.buyer(p_id uuid, p_name text) returns void
language plpgsql as $$
begin
  perform pg_temp.owner();
  insert into tci.legal_entities (id, name, country_code, created_by, registration_number, address, industry_id)
  values (p_id, p_name, 'DE', '99999999-0000-4000-8000-0000000091c1', 'SSC-' || right(p_id::text, 4), 'Somewhere', 'FOOD');
  insert into tci.financial_statements (id, entity_id, statement_kind, fiscal_year, period_end_date, currency_code, created_by)
  values (p_id, p_id, 'annual', extract(year from current_date - 120)::int, current_date - 120, 'UZS', '99999999-0000-4000-8000-0000000091a1');
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
    inputs_snapshot, calculation_trace, engine_version, created_by)
  values (p_id, p_id, 30, 'B1', 50000000, 'UZS', '{}', '{}', 't', '99999999-0000-4000-8000-0000000091a1');
  perform set_config('tci.internal_call', '', true);
end $$;

create function pg_temp.submit(p_buyer uuid, p_amount numeric) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_temp.owner();
  insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
  values (v_id, '99999999-0000-4000-8000-0000000091f1', p_buyer, p_amount, 'UZS', 'draft', '99999999-0000-4000-8000-0000000091c1');
  perform pg_temp.act('99999999-0000-4000-8000-0000000091c1');
  perform tci.submit_limit_request(v_id);
  perform pg_temp.owner();
  return v_id;
end $$;
grant execute on function pg_temp.submit(uuid, numeric) to authenticated;

select pg_temp.buyer('99999999-0000-4000-8000-0000000091d1', 'SSC Clean Foods');
select pg_temp.buyer('99999999-0000-4000-8000-0000000091d2', 'Ochre Lantern Shipping LLC');
select pg_temp.buyer('99999999-0000-4000-8000-0000000091d3', 'SSC Daughter Foods');
select pg_temp.buyer('99999999-0000-4000-8000-0000000091d4', 'Ochre Lantern Shipping Limited');
select pg_temp.owner();
insert into tci.legal_entities (id, name, country_code, created_by)
values ('99999999-0000-4000-8000-0000000091d9', 'Vermilion Quarry Holdings', 'AE', '99999999-0000-4000-8000-0000000091c1');

do $$
declare
  c_an1    constant uuid := '99999999-0000-4000-8000-0000000091a1';
  c_an2    constant uuid := '99999999-0000-4000-8000-0000000091a2';
  c_cu     constant uuid := '99999999-0000-4000-8000-0000000091b1';
  c_sales  constant uuid := '99999999-0000-4000-8000-0000000091c1';
  c_admin  constant uuid := '99999999-0000-4000-8000-0000000091c2';
  c_client constant uuid := '99999999-0000-4000-8000-0000000091c3';
  c_im     constant uuid := '99999999-0000-4000-8000-0000000091c4';
  c_clean  constant uuid := '99999999-0000-4000-8000-0000000091d1';
  c_listed constant uuid := '99999999-0000-4000-8000-0000000091d2';
  c_child  constant uuid := '99999999-0000-4000-8000-0000000091d3';
  c_twin   constant uuid := '99999999-0000-4000-8000-0000000091d4';
  c_parent constant uuid := '99999999-0000-4000-8000-0000000091d9';
  v_imp    uuid;
  v_imp2   uuid;
  v        jsonb;
  v_req    uuid;
  v_req2   uuid;
  v_match  uuid;
  v_ubo    tci.entity_beneficial_owners;
  v_n      integer;
  v_user   uuid;
  v_users  uuid[];
  v_before bigint;
  v_rows   jsonb := jsonb_build_array(
    jsonb_build_object('ref', 'SSC-E1', 'kind', 'entity',
      'names', jsonb_build_array(jsonb_build_object('n', 'OCHRE LANTERN SHIPPING CO', 'p', true),
                                 jsonb_build_object('n', 'Охра Лантерн Шиппинг', 'p', false)),
      'programmes', jsonb_build_array('TEST'), 'countries', jsonb_build_array('Narnia')),
    jsonb_build_object('ref', 'SSC-E2', 'kind', 'entity',
      'names', jsonb_build_array(jsonb_build_object('n', 'VERMILION QUARRY HOLDINGS', 'p', true))),
    jsonb_build_object('ref', 'SSC-P1', 'kind', 'person',
      'names', jsonb_build_array(jsonb_build_object('n', 'ZELENKOV, Bartholomew Ignatyevich', 'p', true)),
      'birth_dates', jsonb_build_array('1961')),
    jsonb_build_object('ref', 'SSC-P2', 'kind', 'person',
      'names', jsonb_build_array(jsonb_build_object('n', 'SSC CLEAN FOODS', 'p', true))));
begin
  -- 1. Lists -----------------------------------------------------------------
  perform pg_temp.act(c_sales);
  perform pg_temp.refused('select tci.begin_sanctions_list_import(''un'', null, current_date, ''x.xml'')',
                          '42501', 'a list import by sales', 'sanctions_import_only');
  perform pg_temp.act(c_client);
  perform pg_temp.refused('select tci.begin_sanctions_list_import(''un'', null, current_date, ''x.xml'')',
                          '42501', 'a list import by a client');
  perform pg_temp.act(c_an1);
  perform pg_temp.refused('select tci.begin_sanctions_list_import(''other'', null, current_date, ''x.csv'')',
                          'P0001', 'another list without a name', 'sanctions_list_name_required');
  v_imp := tci.begin_sanctions_list_import('un', null, current_date - 2, 'consolidated.xml', repeat('a', 64));
  perform pg_temp.refused(format('select tci.finish_sanctions_list_import(%L)', v_imp),
                          'P0001', 'an empty import', 'sanctions_list_empty');
  perform pg_temp.refused(format('select tci.add_sanctions_list_entries(%L, %L)', v_imp,
                                 '[{"ref": "X", "kind": "entity", "names": []}]'),
                          'P0001', 'a party without names', 'sanctions_batch_shape');
  -- Two batches; the same party twice is one party.
  perform tci.add_sanctions_list_entries(v_imp, jsonb_build_array(v_rows -> 0, v_rows -> 1));
  perform tci.add_sanctions_list_entries(v_imp, jsonb_build_array(v_rows -> 2, v_rows -> 3, v_rows -> 0));
  v := tci.finish_sanctions_list_import(v_imp);
  if (v ->> 'entries')::int <> 4 or (v ->> 'names')::int <> 5 then
    raise exception 'sanctions_screening: the import counted %', v;
  end if;
  perform pg_temp.refused(format('select tci.add_sanctions_list_entries(%L, %L)', v_imp, '[]'),
                          'P0001', 'a batch into a finished import', 'sanctions_import_not_loading');
  perform pg_temp.refused('select tci.begin_sanctions_list_import(''un'', null, current_date - 3, ''old.xml'')',
                          'P0001', 'an older file', 'sanctions_list_older');
  perform pg_temp.refused(format('select tci.begin_sanctions_list_import(''un'', null, current_date - 2, ''same.xml'', %L)', repeat('a', 64)),
                          'P0001', 'the same file again', 'sanctions_list_same');

  -- The search is every staff member's, never a client's.
  perform pg_temp.act(c_sales);
  if not exists (select 1 from tci.sanctions_search('Ochre Lantern Shipping') s where s.list_ref = 'SSC-E1' and s.score >= 0.9) then
    raise exception 'sanctions_screening: the search did not find the listed company';
  end if;
  if not exists (select 1 from tci.sanctions_search('ООО «Охра Лантерн Шиппинг»') s where s.list_ref = 'SSC-E1') then
    raise exception 'sanctions_screening: the Cyrillic alias was not found';
  end if;
  if exists (select 1 from tci.sanctions_search('Ochre Lantern Shipping', true) s) then
    raise exception 'sanctions_screening: a company name matched a person';
  end if;
  perform pg_temp.act(c_client);
  perform pg_temp.refused('select * from tci.sanctions_search(''Ochre Lantern'')', '42501', 'a client searching the lists');

  -- 2. A limit request screens the buyer; a listed buyer gets a match, a task
  --    for one analyst, and no decision.
  v_req := pg_temp.submit(c_clean, 1000000);
  if (select count(*) from tci.sanctions_screenings s where s.entity_id = c_clean and s.reason = 'limit_request' and s.outcome = 'clear') <> 1 then
    raise exception 'sanctions_screening: the clean buyer was not screened once at the request';
  end if;
  -- A company's name never matches a listed PERSON of the same name.
  if exists (select 1 from tci.sanctions_matches m where m.entity_id = c_clean) then
    raise exception 'sanctions_screening: a company matched a person';
  end if;
  v_req2 := pg_temp.submit(c_listed, 1000000);
  select m.id into v_match from tci.sanctions_matches m
   where m.entity_id = c_listed and m.list_ref = 'SSC-E1' and m.subject_kind = 'entity' and m.status = 'pending';
  if v_match is null then
    raise exception 'sanctions_screening: the listed buyer raised no match';
  end if;
  select t.target_user into v_user from tci.tasks t
   where t.task_type = 'sanctions_match_review' and t.object_id = c_listed and t.status = 'open'
     and t.target_role = 'credit_analyst';
  if v_user is null or v_user not in (c_an1, c_an2) then
    raise exception 'sanctions_screening: the review task went to %', v_user;
  end if;
  v_users := array[v_user];
  -- A second company with a match goes to the OTHER analyst (least loaded).
  perform pg_temp.act(c_sales);
  perform tci.screen_entity_now(c_twin);
  perform pg_temp.owner();
  select t.target_user into v_user from tci.tasks t
   where t.task_type = 'sanctions_match_review' and t.object_id = c_twin and t.status = 'open';
  if v_user is null or v_user = v_users[1] then
    raise exception 'sanctions_screening: the second task was not given to the other analyst (%)', v_user;
  end if;
  -- The auto decision stops on it, and no approving decision is written.
  perform tci.begin_trusted_call();
  if not ('sanctions_match' = any (tci.adt_buyer_stops(c_listed))) then
    raise exception 'sanctions_screening: the auto decision does not stop on a pending match';
  end if;
  perform pg_temp.owner();
  perform pg_temp.refused(format(
      'insert into tci.credit_limit_decisions (request_id, stage, outcome, approved_amount, currency_code, valid_from, decided_by) values (%L, ''credit'', ''approved'', 1, ''UZS'', current_date, %L)',
      v_req2, c_cu),
    'P0001', 'an approving decision while a match is pending', 'sanctions_screening_pending');
  -- A decline stays possible.
  perform pg_temp.owner();
  if (select status from tci.v_entity_sanctions_status where entity_id = c_listed) <> 'possible_match' then
    raise exception 'sanctions_screening: the status column does not say possible_match';
  end if;

  -- 3. Owners: a link to a listed owner company rescreens the child, which
  --    was screened before; a beneficial owner is screened against people.
  perform pg_temp.act(c_sales);
  perform tci.screen_entity_now(c_child);
  perform pg_temp.owner();
  insert into tci.entity_relationships (parent_entity_id, child_entity_id, relationship_type, ownership_pct, created_by)
  values (c_parent, c_child, 'ownership', 60, c_sales);
  if not exists (select 1 from tci.sanctions_matches m
                  where m.entity_id = c_child and m.subject_kind = 'owner' and m.subject_entity_id = c_parent
                    and m.list_ref = 'SSC-E2' and m.status = 'pending') then
    raise exception 'sanctions_screening: the listed owner company was not found through the link';
  end if;
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format('select tci.add_beneficial_owner(%L, ''X'', ''beneficial_owner'', 50, null, null, ''register'')', c_clean),
                          '42501', 'a beneficial owner entered by sales');
  perform pg_temp.act(c_im);
  perform pg_temp.refused(format('select tci.add_beneficial_owner(%L, ''Somebody'', ''beneficial_owner'', 50, null, null, '' '')', c_clean),
                          'P0001', 'a beneficial owner without a source', 'beneficial_owner_source_required');
  v_ubo := tci.add_beneficial_owner(c_clean, 'Bartholomew Zelenkov', 'beneficial_owner', 75, '1961-04-02', 'RU', 'State register extract');
  perform pg_temp.owner();
  select m.id into v_match from tci.sanctions_matches m
   where m.entity_id = c_clean and m.subject_kind = 'beneficial_owner' and m.subject_owner_id = v_ubo.id
     and m.list_ref = 'SSC-P1' and m.status = 'pending';
  if v_match is null then
    raise exception 'sanctions_screening: the beneficial owner (words in another order) was not matched';
  end if;

  -- 4. Resolving: credit analysts only, with a note; clearing is remembered.
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('select tci.resolve_sanctions_match(%L, ''cleared'', ''x'')', v_match), '42501', 'admin resolving');
  perform pg_temp.act(c_cu);
  perform pg_temp.refused(format('select tci.resolve_sanctions_match(%L, ''cleared'', ''x'')', v_match), '42501', 'credit underwriting resolving');
  perform pg_temp.act(c_an1);
  perform pg_temp.refused(format('select tci.resolve_sanctions_match(%L, ''cleared'', '' '')', v_match),
                          'P0001', 'a resolution without a note', 'sanctions_match_note_required');
  v := tci.resolve_sanctions_match(v_match, 'cleared', 'Different person: born 1961-04-02 in Tula, the listed one in Omsk.');
  if v ->> 'status' <> 'cleared' or (v ->> 'pending')::int <> 0 then
    raise exception 'sanctions_screening: clearing answered %', v;
  end if;
  perform pg_temp.owner();
  if exists (select 1 from tci.tasks t where t.task_type = 'sanctions_match_review' and t.object_id = c_clean and t.status = 'open') then
    raise exception 'sanctions_screening: the review task stayed open with nothing pending';
  end if;
  perform pg_temp.act(c_an1);
  perform pg_temp.refused(format('select tci.resolve_sanctions_match(%L, ''confirmed'', ''x'')', v_match),
                          'P0001', 'a match resolved twice', 'sanctions_match_resolved');
  v := tci.screen_entity_now(c_clean);
  if (v ->> 'new_matches')::int <> 0 or v ->> 'outcome' <> 'clear' then
    raise exception 'sanctions_screening: a cleared match came back: %', v;
  end if;
  -- Confirming sets the flag (UN), with the limit reviews of 0085.
  select m.id into v_match from tci.sanctions_matches m where m.entity_id = c_listed and m.status = 'pending' limit 1;
  v := tci.resolve_sanctions_match(v_match, 'confirmed', 'Same company: registration and address agree.');
  perform pg_temp.owner();
  if (v ->> 'flag_id') is null
     or not exists (select 1 from tci.sanction_flags f where f.id = (v ->> 'flag_id')::uuid
                     and f.scope = 'entity' and f.entity_id = c_listed and f.regime = 'UN' and f.reference = 'SSC-E1') then
    raise exception 'sanctions_screening: confirming set no UN flag: %', v;
  end if;
  if tci.cover_block_internal(c_listed) <> 'company'
     or (select status from tci.v_entity_sanctions_status where entity_id = c_listed) <> 'sanctioned' then
    raise exception 'sanctions_screening: a confirmed match does not block cover';
  end if;
  perform pg_temp.refused(format('update tci.sanctions_matches set resolution_note = ''x'' where id = %L', v_match),
                          'P0001', 'a resolved match changed', 'sanctions_match_immutable');

  -- 5. Flags are the credit analysts'.
  perform pg_temp.act(c_admin);
  perform pg_temp.refused('select tci.set_sanction_flag(''country'', ''IR'', null, ''UN'', ''x'')', '42501',
                          'a flag by admin', 'sanctions_manage_only');
  if not exists (select 1 from tci.sanction_flags) then
    raise exception 'sanctions_screening: admin no longer reads the flags';
  end if;

  -- 6. A newer file without a party delists it; its pending matches retire.
  perform pg_temp.act(c_admin);
  v_imp2 := tci.begin_sanctions_list_import('un', null, current_date - 1, 'consolidated-2.xml');
  perform tci.add_sanctions_list_entries(v_imp2, jsonb_build_array(v_rows -> 0, v_rows -> 2));
  perform pg_temp.refused(format('select tci.finish_sanctions_list_import(%L)', v_imp2),
                          'P0001', 'a file with far fewer parties', 'sanctions_list_shrunk');
  v := tci.finish_sanctions_list_import(v_imp2, true);
  if (v ->> 'delisted')::int <> 2 then
    raise exception 'sanctions_screening: the newer file delisted %', v;
  end if;
  perform pg_temp.owner();
  if exists (select 1 from tci.sanctions_matches m where m.entity_id = c_child and m.list_ref = 'SSC-E2' and m.status = 'pending')
     or not exists (select 1 from tci.sanctions_matches m where m.entity_id = c_child and m.list_ref = 'SSC-E2'
                     and m.status = 'retired' and m.retired_reason = 'delisted') then
    raise exception 'sanctions_screening: the delisted party''s match did not retire: %', v;
  end if;
  if exists (select 1 from tci.tasks t where t.task_type = 'sanctions_match_review' and t.object_id = c_child and t.status = 'open') then
    raise exception 'sanctions_screening: the review task outlived the delisting';
  end if;
  -- Every company with live business is due again after the new list.
  perform pg_temp.act(c_an2);
  v := tci.rescreen_sanctions_due(100);
  if (v ->> 'screened')::int < 2 or (v ->> 'remaining')::int <> 0 then
    raise exception 'sanctions_screening: the rescreen after the import answered %', v;
  end if;

  -- 7. The reminder: the other required lists are missing.
  perform pg_temp.act(c_an1);
  perform tci.refresh_agenda();
  perform pg_temp.owner();
  if not exists (select 1 from tci.tasks t where t.task_type = 'sanctions_list_due' and t.status = 'open'
                    and t.target_role = 'credit_analyst' and t.params -> 'lists' ? 'ofac_sdn'
                    and not (t.params -> 'lists' ? 'un')) then
    raise exception 'sanctions_screening: no reminder for the missing lists';
  end if;

  -- 8. Clients see nothing; no API role writes.
  perform pg_temp.act(c_client);
  select count(*) into v_n from tci.sanctions_matches;
  v_n := v_n + (select count(*) from tci.v_entity_sanctions_status) + (select count(*) from tci.sanctions_list_entries)
             + (select count(*) from tci.entity_beneficial_owners) + (select count(*) from tci.sanctions_screenings);
  if v_n <> 0 then
    raise exception 'sanctions_screening: a client sees % sanctions rows', v_n;
  end if;
  perform pg_temp.refused('select * from tci.sanctions_subjects(''99999999-0000-4000-8000-0000000091d1'')', '42501', 'a client reading the subjects');
  perform pg_temp.act(c_an1);
  perform pg_temp.refused(format('insert into tci.sanctions_matches (entity_id) values (%L)', c_clean), '42501', 'a match written directly');
  perform pg_temp.refused(format('update tci.entity_beneficial_owners set full_name = ''x'' where id = %L', v_ubo.id),
                          '42501', 'a beneficial owner edited directly');
  perform pg_temp.refused(format('select tci.screen_entity_internal(%L, ''manual'')', c_clean), '42501', 'the internal screening');
  -- Every staff member sees the names screened with a company.
  perform pg_temp.act(c_sales);
  if (select count(*) from tci.sanctions_subjects(c_child)) <> 2 then
    raise exception 'sanctions_screening: the child''s subjects are not itself and its owner';
  end if;

  raise notice 'sanctions_screening: OK — lists imported by analysts and admin in batches (older / same / shrunk refused, delisting), a limit request screens the buyer, owner companies and beneficial owners found (Cyrillic, word order), people against people, one task per company to the least-loaded analyst, no approving or auto decision while pending, confirm flags (UN) and blocks cover, clearing is remembered, flags are the analysts'', the list reminder, clients see nothing, no direct writes';
end $$;

rollback;
