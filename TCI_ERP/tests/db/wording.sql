-- Tests for migration 0050: wording templates and generated documents.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/wording.sql
--
-- One transaction, rolled back. API roles are impersonated; the
-- internal-call token is cleared at every actor switch.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000000c1', 'w-credit@t'),
  ('99999999-0000-4000-8000-0000000000c2', 'w-commercial@t'),
  ('99999999-0000-4000-8000-0000000000c4', 'w-sales@t'),
  ('99999999-0000-4000-8000-0000000000c5', 'w-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000000c1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000000c2', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000000c4', 'sales'),
  ('99999999-0000-4000-8000-0000000000c5', 'client');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000000c2"}', true);
insert into tci.legal_entities (id, name, country_code, registration_number, created_by) values
  ('99999999-0000-4000-8000-0000000000e1', 'W Holder LLC', 'RU', '7701', '99999999-0000-4000-8000-0000000000c2'),
  ('99999999-0000-4000-8000-0000000000e2', 'W Buyer GmbH', 'DE', 'HRB 1', '99999999-0000-4000-8000-0000000000c2');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000000f1', '99999999-0000-4000-8000-0000000000e1', 'W-1', 'whole_turnover',
  'draft', '2026-01-01', '2026-12-31', 'USD', 90, 500, 0.15, 10000, 25000, 30, 60, 90, 'monthly',
  '99999999-0000-4000-8000-0000000000c2', 1000000);
insert into tci.credit_limit_requests (id, policy_id, entity_id, requested_amount, currency_code, status, requested_by)
values ('99999999-0000-4000-8000-0000000000a1', '99999999-0000-4000-8000-0000000000f1',
        '99999999-0000-4000-8000-0000000000e2', 50000, 'USD', 'decided', '99999999-0000-4000-8000-0000000000c4');
insert into tci.credit_limit_decisions (id, request_id, outcome, approved_amount, currency_code, lifecycle, decided_by, payment_terms_days)
values ('99999999-0000-4000-8000-0000000000d1', '99999999-0000-4000-8000-0000000000a1', 'approved', 40000, 'USD',
        'effective', '99999999-0000-4000-8000-0000000000c1', 60);
update tci.insurer_profile set legal_name = 'W Insurer JSC', license_number = 'L-1' where id;

-- What the Storage API would have written for these uploads.
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('wording', 'templates/99999999-0000-4000-8000-000000000071/ru.docx', '99999999-0000-4000-8000-0000000000c2', '{"size": 2048}'),
  ('wording', 'templates/99999999-0000-4000-8000-000000000072/ru2.docx', '99999999-0000-4000-8000-0000000000c2', '{"size": 4096}'),
  ('wording', 'templates/99999999-0000-4000-8000-000000000073/bad.docx', '99999999-0000-4000-8000-0000000000c2', '{"size": 10}'),
  ('wording', 'templates/99999999-0000-4000-8000-000000000074/theirs.docx', '99999999-0000-4000-8000-0000000000c4', '{"size": 10}'),
  ('wording', 'documents/99999999-0000-4000-8000-0000000000f1/99999999-0000-4000-8000-000000000081.docx',
   '99999999-0000-4000-8000-0000000000c4', '{"size": 9000}');

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.refused(p_sql text, p_state text, p_label text) returns void language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state = p_state then return; end if;
    raise exception 'wording: % refused with % instead of %', p_label, v_state, p_state;
  end;
  raise exception 'wording: % was NOT refused', p_label;
end $$;

do $$
declare
  v_t   tci.wording_templates%rowtype;
  v_doc tci.policy_documents%rowtype;
  v_m   jsonb;
  v_n   int;
begin
  -- 1. credit underwriting cannot register a template
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c1');
  perform pg_temp.refused($q$select tci.register_wording_template('99999999-0000-4000-8000-000000000071', 'RU', null, 'RU', 'ru',
    'whole_turnover', 'templates/99999999-0000-4000-8000-000000000071/ru.docx', 'ru.docx', '{}')$q$,
    '42501', 'credit registers a template');

  -- 2. the commercial underwriter: path, existence and ownership are checked
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c2');
  perform pg_temp.refused($q$select tci.register_wording_template('99999999-0000-4000-8000-000000000071', 'RU', null, 'RU', 'ru',
    'whole_turnover', 'templates/elsewhere/ru.docx', 'ru.docx', '{}')$q$, 'P0001', 'a path outside templates/<id>/');
  perform pg_temp.refused($q$select tci.register_wording_template('99999999-0000-4000-8000-000000000075', 'RU', null, 'RU', 'ru',
    'whole_turnover', 'templates/99999999-0000-4000-8000-000000000075/ghost.docx', 'ghost.docx', '{}')$q$, 'P0002', 'a phantom template');
  perform pg_temp.refused($q$select tci.register_wording_template('99999999-0000-4000-8000-000000000074', 'RU', null, 'RU', 'ru',
    'whole_turnover', 'templates/99999999-0000-4000-8000-000000000074/theirs.docx', 'theirs.docx', '{}')$q$, '42501', 'someone else''s upload');

  v_t := tci.register_wording_template('99999999-0000-4000-8000-000000000071', 'RU policy', 'v1', 'RU', 'ru',
    'whole_turnover', 'templates/99999999-0000-4000-8000-000000000071/ru.docx', 'ru.docx',
    array['policy.number', 'limits', 'limits.buyer_name']);
  if v_t.version <> 1 or v_t.status <> 'draft' or v_t.size_bytes <> 2048 then
    raise exception 'wording: first registration is version 1, draft, size from storage (got %, %, %)', v_t.version, v_t.status, v_t.size_bytes;
  end if;
  v_t := tci.register_wording_template('99999999-0000-4000-8000-000000000072', 'RU policy', 'v2', 'RU', 'ru',
    'whole_turnover', 'templates/99999999-0000-4000-8000-000000000072/ru2.docx', 'ru2.docx', array['policy.number']);
  if v_t.version <> 2 then raise exception 'wording: second upload of the same key must be version 2'; end if;
  v_t := tci.register_wording_template('99999999-0000-4000-8000-000000000073', 'RU bad', null, 'RU', 'ru',
    'whole_turnover', 'templates/99999999-0000-4000-8000-000000000073/bad.docx', 'bad.docx', array['policy.secret']);

  -- 3. activation: unknown placeholders refused; one active per key; retired stays retired
  perform pg_temp.refused($q$select tci.set_wording_template_status('99999999-0000-4000-8000-000000000073', 'active')$q$,
    'P0001', 'activating a template with unknown placeholders');
  perform tci.set_wording_template_status('99999999-0000-4000-8000-000000000071', 'active');
  perform tci.set_wording_template_status('99999999-0000-4000-8000-000000000072', 'active');
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from tci.wording_templates where status = 'active' and country_code = 'RU';
  if v_n <> 1 or (select status from tci.wording_templates where id = '99999999-0000-4000-8000-000000000071') <> 'retired' then
    raise exception 'wording: activating v2 must retire v1 (active count %)', v_n;
  end if;
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c2');
  perform pg_temp.refused($q$select tci.set_wording_template_status('99999999-0000-4000-8000-000000000071', 'active')$q$,
    'P0001', 're-activating a retired version');

  -- 4. the API writes nothing directly
  perform pg_temp.refused($q$insert into tci.wording_templates (id, name, language, version, storage_path, file_name, size_bytes, uploaded_by)
    values (gen_random_uuid(), 'x', 'ru', 9, 'x', 'x.docx', 1, '99999999-0000-4000-8000-0000000000c2')$q$, '42501', 'a direct template insert');
  perform pg_temp.refused($q$update tci.wording_templates set status = 'active' where id = '99999999-0000-4000-8000-000000000073'$q$, '42501', 'a direct status change');

  -- 5. merge data: the database says what the document says
  v_m := tci.wording_merge_data('99999999-0000-4000-8000-0000000000f1', null);
  if v_m #>> '{policy,number}' <> 'W-1' or v_m #>> '{insurer,name}' <> 'W Insurer JSC'
     or v_m #>> '{policyholder,name}' <> 'W Holder LLC'
     or jsonb_array_length(v_m -> 'limits') <> 1 or v_m #>> '{limits,0,buyer_name}' <> 'W Buyer GmbH'
     or (v_m #>> '{limits,0,amount}')::numeric <> 40000 then
    raise exception 'wording: unexpected merge data %', v_m;
  end if;
  perform pg_temp.refused($q$select tci.wording_merge_data('99999999-0000-4000-8000-0000000000f1', '99999999-0000-4000-8000-0000000000f1')$q$,
    'P0001', 'two targets at once');

  -- 6. a client gets nothing
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c5');
  perform pg_temp.refused($q$select tci.wording_merge_data('99999999-0000-4000-8000-0000000000f1', null)$q$, '42501', 'a client reads merge data');
  if exists (select 1 from tci.wording_templates) or exists (select 1 from tci.insurer_profile) then
    raise exception 'wording: a client can read templates or the insurer profile';
  end if;

  -- 7. sales registers a generated document; the snapshot is server-made
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c4');
  perform pg_temp.refused($q$select tci.register_policy_document('99999999-0000-4000-8000-000000000081', '99999999-0000-4000-8000-0000000000f1', null,
    '99999999-0000-4000-8000-000000000073', 'documents/99999999-0000-4000-8000-0000000000f1/99999999-0000-4000-8000-000000000081.docx', 'W-1.docx')$q$,
    'P0001', 'generating from a draft template');
  v_doc := tci.register_policy_document('99999999-0000-4000-8000-000000000081', '99999999-0000-4000-8000-0000000000f1', null,
    '99999999-0000-4000-8000-000000000072', 'documents/99999999-0000-4000-8000-0000000000f1/99999999-0000-4000-8000-000000000081.docx', 'W-1.docx');
  if v_doc.template_version <> 2 or v_doc.merge_data #>> '{policy,number}' <> 'W-1' then
    raise exception 'wording: the document must record template v2 and the merge data';
  end if;
  perform pg_temp.refused($q$update tci.policy_documents set file_name = 'x' where id = '99999999-0000-4000-8000-000000000081'$q$, '42501', 'rewriting a generated document');

  -- 8. storage: who may upload where; nothing can be replaced
  perform pg_temp.refused($q$insert into storage.objects (bucket_id, name, owner_id) values ('wording', 'templates/x/y.docx', '99999999-0000-4000-8000-0000000000c4')$q$,
    '42501', 'sales uploads a template');
  insert into storage.objects (bucket_id, name, owner_id) values ('wording', 'documents/x/y.docx', '99999999-0000-4000-8000-0000000000c4');
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c1');
  perform pg_temp.refused($q$insert into storage.objects (bucket_id, name, owner_id) values ('wording', 'documents/x/z.docx', '99999999-0000-4000-8000-0000000000c1')$q$,
    '42501', 'credit uploads a document');
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c2');
  update storage.objects set name = 'templates/x/replaced.docx' where bucket_id = 'wording';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'wording: a stored template or document was replaced'; end if;
  perform set_config('role', 'postgres', true);
end $$;

do $$ begin raise notice 'wording: OK — gated registration, versioning, one active per key, server-made merge data, immutable storage'; end $$;
rollback;
