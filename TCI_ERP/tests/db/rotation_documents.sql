-- Tests for migration 0048: a temporary password must really be changed
-- before the rotation flag clears, and a claim document is registered from
-- what Storage holds. Run against the local replay harness:
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/rotation_documents.sql
--
-- One transaction, rolled back. API roles are impersonated with
-- set_config('role', 'authenticated') + request.jwt.claims, and the
-- internal-call token is cleared at every switch.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, encrypted_password) values
  ('99999999-0000-4000-8000-0000000000d1', 'rd-temp@t',   'hash-A'),
  ('99999999-0000-4000-8000-0000000000c1', 'rd-credit@t', 'x'),
  ('99999999-0000-4000-8000-0000000000c3', 'rd-claims@t', 'x'),
  ('99999999-0000-4000-8000-0000000000c4', 'rd-sales@t',  'x');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000000d1', 'sales'),
  ('99999999-0000-4000-8000-0000000000c1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000000c3', 'claims'),
  ('99999999-0000-4000-8000-0000000000c4', 'sales');
insert into tci.user_profiles (user_id, must_change_password)
values ('99999999-0000-4000-8000-0000000000d1', true);

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000000c3"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000000e1', 'RD Holder', 'AD', '99999999-0000-4000-8000-0000000000c1'),
  ('99999999-0000-4000-8000-0000000000e2', 'RD Buyer', 'AD', '99999999-0000-4000-8000-0000000000c1');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000000f1', '99999999-0000-4000-8000-0000000000e1', 'RD-1', 'whole_turnover',
  'draft', current_date, current_date + 365, 'UZS', 90, 0, 0.1, 1000, 0, 30, 60, 90, 'monthly',
  '99999999-0000-4000-8000-0000000000c3', 100000);
insert into tci.claims (id, claim_number, policy_id, entity_id, currency_code)
values ('99999999-0000-4000-8000-0000000000b1', 'CL-RD-1', '99999999-0000-4000-8000-0000000000f1',
        '99999999-0000-4000-8000-0000000000e2', 'UZS');

-- what the Storage API would have written for three uploads by sales
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('claim-documents', 'claims/99999999-0000-4000-8000-0000000000b1/invoice.pdf',
   '99999999-0000-4000-8000-0000000000c4', '{"size": 100, "mimetype": "application/pdf"}'),
  ('claim-documents', 'claims/99999999-0000-4000-8000-0000000000b1/evil.pdf',
   '99999999-0000-4000-8000-0000000000c4', '{"size": 100, "mimetype": "application/x-msdownload"}'),
  ('claim-documents', 'claims/99999999-0000-4000-8000-0000000000b1/orphan.pdf',
   '99999999-0000-4000-8000-0000000000c4', '{"size": 5, "mimetype": "application/pdf"}');

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
    raise exception 'rotation_documents: % refused with % instead of %', p_label, v_state, p_state;
  end;
  raise exception 'rotation_documents: % was NOT refused', p_label;
end $$;

do $$
declare
  v_doc  tci.claim_documents%rowtype;
  v_path text;
  v_n    int;
begin
  -- ---- rotation ---------------------------------------------------------
  if (select temp_password_hash from tci.user_profiles where user_id = '99999999-0000-4000-8000-0000000000d1') is null then
    raise exception 'rotation_documents: the temporary password was not captured';
  end if;

  -- 1. the flag cannot be cleared while the password is still the temporary one
  perform pg_temp.act('99999999-0000-4000-8000-0000000000d1');
  perform pg_temp.refused('select tci.complete_password_change()', 'P0001', 'rotation without a change');

  -- 2. the hash is not readable, not even by its owner
  perform pg_temp.refused('select temp_password_hash from tci.user_profiles', '42501', 'reading the hash');
  perform must_change_password from tci.user_profiles where user_id = '99999999-0000-4000-8000-0000000000d1';

  -- 3. after a real change it clears, and the hash goes with it
  perform set_config('role', 'postgres', true);
  update auth.users set encrypted_password = 'hash-B' where id = '99999999-0000-4000-8000-0000000000d1';
  perform pg_temp.act('99999999-0000-4000-8000-0000000000d1');
  perform tci.complete_password_change();
  perform set_config('role', 'postgres', true);
  if exists (select 1 from tci.user_profiles where user_id = '99999999-0000-4000-8000-0000000000d1'
              and (must_change_password or temp_password_hash is not null)) then
    raise exception 'rotation_documents: a real change did not clear the flag and the hash';
  end if;

  -- 4. a reset (both provisioning paths re-write the flag after the password)
  --    captures the NEW temporary password, also when the flag was already set
  update auth.users set encrypted_password = 'hash-C' where id = '99999999-0000-4000-8000-0000000000d1';
  insert into tci.user_profiles (user_id, must_change_password) values ('99999999-0000-4000-8000-0000000000d1', true)
  on conflict (user_id) do update set must_change_password = true;
  update auth.users set encrypted_password = 'hash-D' where id = '99999999-0000-4000-8000-0000000000d1';
  insert into tci.user_profiles (user_id, must_change_password) values ('99999999-0000-4000-8000-0000000000d1', true)
  on conflict (user_id) do update set must_change_password = true;
  if (select temp_password_hash from tci.user_profiles where user_id = '99999999-0000-4000-8000-0000000000d1')
     is distinct from tci.security_hash('hash-D') then
    raise exception 'rotation_documents: a second reset did not capture the latest temporary password';
  end if;
  perform pg_temp.act('99999999-0000-4000-8000-0000000000d1');
  perform pg_temp.refused('select tci.complete_password_change()', 'P0001', 'rotation after a reset');

  -- ---- claim documents --------------------------------------------------
  -- 5. a path nobody uploaded is not a document
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c4');
  perform pg_temp.refused($q$select tci.register_claim_document('99999999-0000-4000-8000-0000000000b1',
    'claims/99999999-0000-4000-8000-0000000000b1/ghost.pdf', 'invoice', 'ghost.pdf', 10, 'application/pdf')$q$,
    'P0002', 'registering a phantom file');

  -- 6. nor is someone else's upload
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c3');
  perform pg_temp.refused($q$select tci.register_claim_document('99999999-0000-4000-8000-0000000000b1',
    'claims/99999999-0000-4000-8000-0000000000b1/invoice.pdf', 'invoice', 'invoice.pdf', 100, 'application/pdf')$q$,
    '42501', 'registering another user''s file');

  -- 7. size and type come from Storage, whatever the browser claims
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c4');
  v_doc := tci.register_claim_document('99999999-0000-4000-8000-0000000000b1',
    'claims/99999999-0000-4000-8000-0000000000b1/invoice.pdf', 'invoice', 'invoice.pdf', 1, 'image/png');
  if v_doc.size_bytes <> 100 or v_doc.content_type <> 'application/pdf' then
    raise exception 'rotation_documents: the register stored % / % instead of Storage''s 100 / application/pdf',
      v_doc.size_bytes, v_doc.content_type;
  end if;
  perform pg_temp.refused($q$select tci.register_claim_document('99999999-0000-4000-8000-0000000000b1',
    'claims/99999999-0000-4000-8000-0000000000b1/invoice.pdf', 'invoice', 'invoice.pdf', 100, 'application/pdf')$q$,
    'P0001', 'registering the same file twice');
  perform pg_temp.refused($q$select tci.register_claim_document('99999999-0000-4000-8000-0000000000b1',
    'claims/99999999-0000-4000-8000-0000000000b1/evil.pdf', 'invoice', 'evil.pdf', 100, 'application/pdf')$q$,
    'P0001', 'an executable announced as a pdf');

  -- 8. the uploader removes an unregistered object, never a registered one
  delete from storage.objects where name = 'claims/99999999-0000-4000-8000-0000000000b1/invoice.pdf';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'rotation_documents: a registered object was deleted under its register row'; end if;
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c1');
  delete from storage.objects where name = 'claims/99999999-0000-4000-8000-0000000000b1/orphan.pdf';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'rotation_documents: a stranger removed an upload'; end if;
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c4');
  delete from storage.objects where name = 'claims/99999999-0000-4000-8000-0000000000b1/orphan.pdf';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'rotation_documents: the uploader could not remove an orphaned upload'; end if;

  -- 9. deleting the document hands back the path, and the bytes can then go
  v_path := tci.delete_claim_document(v_doc.id);
  if v_path <> 'claims/99999999-0000-4000-8000-0000000000b1/invoice.pdf' then
    raise exception 'rotation_documents: delete_claim_document returned %', v_path;
  end if;
  delete from storage.objects where name = v_path;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'rotation_documents: the uploader could not remove a deleted document''s file'; end if;

  -- 10. claims may replace an object, but not move it under another claim
  perform pg_temp.act('99999999-0000-4000-8000-0000000000c3');
  perform pg_temp.refused($q$update storage.objects
       set name = 'claims/99999999-0000-4000-8000-0000000000b9/evil.pdf'
     where name = 'claims/99999999-0000-4000-8000-0000000000b1/evil.pdf'$q$,
    '42501', 'moving an object to another claim');
  perform set_config('role', 'postgres', true);
end $$;

do $$ begin raise notice 'rotation_documents: OK — rotation needs a new password; documents are registered from Storage; uploads can be cleaned up'; end $$;
rollback;
