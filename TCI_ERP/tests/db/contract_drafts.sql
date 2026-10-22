-- Tests for migration 0057: contract drafts edited in the app — immutable
-- versions, the status machine, the review task, the signed scan and the
-- client's read-only view.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/contract_drafts.sql
--
-- One transaction, rolled back. API roles are impersonated; the
-- internal-call token is cleared at every actor switch. Every UPDATE carries
-- a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000005a1', 'cd-sales@t'),
  ('99999999-0000-4000-8000-0000000005a2', 'cd-commercial@t'),
  ('99999999-0000-4000-8000-0000000005a3', 'cd-credit@t'),
  ('99999999-0000-4000-8000-0000000005a4', 'cd-client@t'),
  ('99999999-0000-4000-8000-0000000005a5', 'cd-other-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000005a1', 'sales'),
  ('99999999-0000-4000-8000-0000000005a2', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000005a3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000005a4', 'client'),
  ('99999999-0000-4000-8000-0000000005a5', 'client');

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000005a2"}', true);
insert into tci.legal_entities (id, name, country_code, registration_number, created_by) values
  ('99999999-0000-4000-8000-0000000005e1', 'CD Holder LLC', 'UZ', 'CD-1', '99999999-0000-4000-8000-0000000005a2'),
  ('99999999-0000-4000-8000-0000000005e2', 'CD Other LLC', 'UZ', 'CD-2', '99999999-0000-4000-8000-0000000005a2');
insert into tci.policyholder_users (user_id, entity_id) values
  ('99999999-0000-4000-8000-0000000005a4', '99999999-0000-4000-8000-0000000005e1'),
  ('99999999-0000-4000-8000-0000000005a5', '99999999-0000-4000-8000-0000000005e2');
insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
  currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
  waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
values ('99999999-0000-4000-8000-0000000005f1', '99999999-0000-4000-8000-0000000005e1', 'CD-POL-1', 'whole_turnover',
  'draft', '2026-01-01', '2026-12-31', 'USD', 90, 500, 0.15, 10000, 25000, 30, 60, 90, 'monthly',
  '99999999-0000-4000-8000-0000000005a2', 1000000);
insert into tci.insurance_requests (id, entity_id, request_number, status, created_by) values
  ('99999999-0000-4000-8000-0000000005b1', '99999999-0000-4000-8000-0000000005e1', 'CD-IR-1', 'draft',
   '99999999-0000-4000-8000-0000000005a1');
insert into tci.wording_templates (id, name, language, version, status, storage_path, file_name, size_bytes, uploaded_by) values
  ('99999999-0000-4000-8000-000000000571', 'CD active', 'ru', 901, 'active', 'templates/cd/a.docx', 'a.docx', 10,
   '99999999-0000-4000-8000-0000000005a2'),
  ('99999999-0000-4000-8000-000000000572', 'CD draft', 'ru', 902, 'draft', 'templates/cd/b.docx', 'b.docx', 10,
   '99999999-0000-4000-8000-0000000005a2');

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.refused(p_sql text, p_state text, p_label text) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state then return; end if;
    raise exception 'contract_drafts: % refused with % (%) instead of %', p_label, v_state, v_msg, p_state;
  end;
  raise exception 'contract_drafts: % was NOT refused', p_label;
end $$;

-- A document with one clause and one merge field.
create function pg_temp.doc(p_text text, p_value text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 2, 'numbered', true),
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Subject'))),
    jsonb_build_object('type', 'paragraph', 'attrs', jsonb_build_object('clause', true),
      'content', jsonb_build_array(
        jsonb_build_object('type', 'text', 'text', p_text),
        jsonb_build_object('type', 'mergeField', 'attrs',
          jsonb_build_object('path', 'policy.number', 'index', null, 'value', p_value))))))
$$;
grant execute on function pg_temp.doc(text, text) to authenticated;

do $$
declare
  v_draft tci.contract_drafts%rowtype;
  v_ver   tci.contract_versions%rowtype;
  v_c     tci.contract_draft_comments%rowtype;
  v_n     int;
  v_id    uuid;
  v_json  jsonb;
begin
  -- 1. who may create
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a3');
  perform pg_temp.refused($q$select tci.create_contract_draft('99999999-0000-4000-8000-0000000005f1', null,
    '99999999-0000-4000-8000-000000000571', pg_temp.doc('A', 'CD-POL-1'))$q$, '42501', 'credit creates a draft');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a4');
  perform pg_temp.refused($q$select tci.create_contract_draft('99999999-0000-4000-8000-0000000005f1', null,
    '99999999-0000-4000-8000-000000000571', pg_temp.doc('A', 'CD-POL-1'))$q$, '42501', 'a client creates a draft');

  perform pg_temp.act('99999999-0000-4000-8000-0000000005a1');
  perform pg_temp.refused($q$select tci.create_contract_draft('99999999-0000-4000-8000-0000000005f1', null,
    '99999999-0000-4000-8000-000000000572', pg_temp.doc('A', 'CD-POL-1'))$q$, 'P0001', 'generating from a draft template');
  perform pg_temp.refused($q$select tci.create_contract_draft(null, '99999999-0000-4000-8000-0000000005b1',
    '99999999-0000-4000-8000-000000000571', pg_temp.doc('A', 'x'))$q$, 'P0001', 'a draft for a submission still in draft');
  perform pg_temp.refused($q$select tci.create_contract_draft('99999999-0000-4000-8000-0000000005f1', null,
    '99999999-0000-4000-8000-000000000571', '{"type":"paragraph"}'::jsonb)$q$, 'P0001', 'content that is not a document');

  -- 2. sales generates the first version
  v_draft := tci.create_contract_draft('99999999-0000-4000-8000-0000000005f1', null,
    '99999999-0000-4000-8000-000000000571', pg_temp.doc('The insurer covers ', 'CD-POL-1'), 'first');
  if v_draft.status <> 'draft' or v_draft.current_version_no <> 1 or v_draft.draft_number !~ '^CD-\d{4}-\d{4}$'
     or v_draft.language <> 'ru' then
    raise exception 'contract_drafts: unexpected new draft %', row_to_json(v_draft);
  end if;
  select * into v_ver from tci.contract_versions where id = v_draft.current_version_id;
  if v_ver.source <> 'generated' or v_ver.template_version <> 901 or v_ver.merge_data #>> '{policy,number}' <> 'CD-POL-1'
     or v_ver.content_hash <> md5(v_ver.content::text) or v_ver.author_id <> '99999999-0000-4000-8000-0000000005a1' then
    raise exception 'contract_drafts: version 1 must be generated, hashed and carry the server merge data';
  end if;
  perform pg_temp.refused($q$select tci.create_contract_draft('99999999-0000-4000-8000-0000000005f1', null,
    '99999999-0000-4000-8000-000000000571', pg_temp.doc('B', 'x'))$q$, 'P0001', 'a second draft for the same policy');

  -- 3. saving: a new version each time, never a lost update
  v_ver := tci.save_contract_version(v_draft.id, 1, pg_temp.doc('The insurer shall cover ', 'CD-POL-1'), 'manual', 'wording');
  if v_ver.version_no <> 2 or v_ver.source <> 'manual' or v_ver.change_note <> 'wording' then
    raise exception 'contract_drafts: manual save must be version 2';
  end if;
  perform pg_temp.refused(format($q$select tci.save_contract_version(%L, 1, pg_temp.doc('Stale', 'x'), 'manual')$q$, v_draft.id),
    'P0001', 'saving on top of an old version');
  perform pg_temp.refused(format($q$select tci.save_contract_version(%L, 2, pg_temp.doc('The insurer shall cover ', 'CD-POL-1'), 'manual')$q$, v_draft.id),
    'P0001', 'saving an unchanged document');
  perform pg_temp.refused(format($q$select tci.save_contract_version(%L, 2, pg_temp.doc('x', 'y'), 'restored')$q$, v_draft.id),
    'P0001', 'saving as restored through the save function');

  -- 4. a field refresh may change field values only
  perform pg_temp.refused(format($q$select tci.save_contract_version(%L, 2, pg_temp.doc('Edited words ', 'CD-POL-2'), 'refreshed')$q$, v_draft.id),
    'P0001', 'a refresh that changes the words');
  v_ver := tci.save_contract_version(v_draft.id, 2, pg_temp.doc('The insurer shall cover ', 'CD-POL-2'), 'refreshed');
  if v_ver.version_no <> 3 or v_ver.source <> 'refreshed' then
    raise exception 'contract_drafts: a values-only refresh must be version 3';
  end if;

  -- 5. regeneration over manual edits needs confirmation
  if not tci.contract_has_manual_edits(v_draft.id) then
    raise exception 'contract_drafts: version 2 was a manual edit';
  end if;
  perform pg_temp.refused(format($q$select tci.save_contract_version(%L, 3, pg_temp.doc('Regenerated ', 'CD-POL-1'), 'generated',
    null, '99999999-0000-4000-8000-000000000571')$q$, v_draft.id), 'P0001', 'regenerating over manual edits unconfirmed');
  v_ver := tci.save_contract_version(v_draft.id, 3, pg_temp.doc('Regenerated ', 'CD-POL-1'), 'generated',
    null, '99999999-0000-4000-8000-000000000571', true);
  if v_ver.version_no <> 4 or tci.contract_has_manual_edits(v_draft.id) then
    raise exception 'contract_drafts: a confirmed regeneration is version 4 and leaves no manual edits after it';
  end if;

  -- 6. restore = a new version with the old content; history never rewinds
  v_ver := tci.restore_contract_version(v_draft.id, 4, 2, 'back to v2');
  if v_ver.version_no <> 5 or v_ver.source <> 'restored' or v_ver.restored_from_version <> 2
     or v_ver.content_hash <> (select content_hash from tci.contract_versions where draft_id = v_draft.id and version_no = 2) then
    raise exception 'contract_drafts: restore must append version 5 with version 2''s content';
  end if;
  perform pg_temp.refused(format($q$select tci.restore_contract_version(%L, 5, 2)$q$, v_draft.id), 'P0001', 'restoring what is already current');
  perform pg_temp.refused(format($q$select tci.restore_contract_version(%L, 5, 42)$q$, v_draft.id), 'P0002', 'restoring a phantom version');
  select count(*) into v_n from tci.contract_versions where draft_id = v_draft.id;
  if v_n <> 5 then raise exception 'contract_drafts: expected five versions, got %', v_n; end if;

  -- 7. versions are immutable: refused to the API by grants, to the owner by triggers
  perform pg_temp.refused(format($q$update tci.contract_versions set change_note = 'x' where draft_id = %L$q$, v_draft.id),
    '42501', 'an API update of a version');
  perform pg_temp.refused(format($q$delete from tci.contract_versions where draft_id = %L$q$, v_draft.id),
    '42501', 'an API removal of a version');
  perform pg_temp.refused(format($q$insert into tci.contract_versions (draft_id, version_no, content, content_hash, source, author_id)
    values (%L, 9, pg_temp.doc('x', 'y'), 'h', 'manual', '99999999-0000-4000-8000-0000000005a1')$q$, v_draft.id),
    '42501', 'an API insert of a version');
  perform pg_temp.refused(format($q$update tci.contract_drafts set status = 'signed' where id = %L$q$, v_draft.id),
    '42501', 'an API status change');
  perform set_config('role', 'postgres', true);
  perform pg_temp.refused(format($q$update tci.contract_versions set change_note = 'x' where draft_id = %L$q$, v_draft.id),
    '42501', 'the owner updating a version');
  perform pg_temp.refused(format($q$delete from tci.contract_versions where draft_id = %L$q$, v_draft.id),
    '42501', 'the owner removing a version');

  -- 8. the status machine and the review task
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a1');
  perform pg_temp.refused(format($q$select tci.change_contract_status(%L, 'agreed')$q$, v_draft.id), 'P0001', 'draft straight to agreed');
  perform pg_temp.refused(format($q$select tci.share_contract_draft(%L, true)$q$, v_draft.id), 'P0001', 'sharing a draft that is not under review');
  v_draft := tci.change_contract_status(v_draft.id, 'under_review', 'please review');
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from tci.tasks
   where object_id = v_draft.id and task_type = 'contract_review' and status = 'open'
     and target_role = 'commercial_underwriter' and params ->> 'comment' = 'please review'
     and params ->> 'reference' = 'CD-POL-1';
  if v_n <> 1 then raise exception 'contract_drafts: under review must open one contract_review task for commercial underwriting'; end if;

  -- editing stays allowed under review
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a1');
  v_ver := tci.save_contract_version(v_draft.id, 5, pg_temp.doc('Reviewed words ', 'CD-POL-1'), 'manual');
  if v_ver.version_no <> 6 then raise exception 'contract_drafts: a save under review is version 6'; end if;

  -- share the current version; the client reads it and comments
  v_draft := tci.share_contract_draft(v_draft.id, true);
  if v_draft.shared_version_id <> v_ver.id then raise exception 'contract_drafts: sharing pins the current version'; end if;
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a4');
  select count(*) into v_n from tci.v_client_contract_drafts where id = v_draft.id and version_no = 6
    and content #>> '{content,1,content,0,text}' = 'Reviewed words ';
  if v_n <> 1 then raise exception 'contract_drafts: the client must read the shared version'; end if;
  if exists (select 1 from tci.contract_drafts) or exists (select 1 from tci.contract_versions)
     or exists (select 1 from tci.contract_draft_comments) then
    raise exception 'contract_drafts: a client can read the base tables';
  end if;
  v_c := tci.client_comment_contract_draft(v_draft.id, 'Please change clause 1.1');
  if v_c.author_side <> 'client' or v_c.version_id <> v_ver.id then
    raise exception 'contract_drafts: the client comment must be client-side, on the shared version';
  end if;
  perform pg_temp.refused(format($q$select tci.add_contract_comment(%L, 'x')$q$, v_draft.id), '42501', 'a client using the staff comment');
  perform pg_temp.refused(format($q$select tci.save_contract_version(%L, 6, pg_temp.doc('Client edit', 'x'), 'manual')$q$, v_draft.id),
    '42501', 'a client editing');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a5');
  if exists (select 1 from tci.v_client_contract_drafts) then
    raise exception 'contract_drafts: another policyholder sees the draft';
  end if;
  perform pg_temp.refused(format($q$select tci.client_comment_contract_draft(%L, 'hi')$q$, v_draft.id), 'P0002', 'another policyholder comments');

  -- staff: a reviewer comments; the client never sees staff comments
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a3');
  v_c := tci.add_contract_comment(v_draft.id, 'Internal: rate looks thin');
  perform pg_temp.refused(format($q$select tci.add_contract_comment(%L, '   ')$q$, v_draft.id), 'P0001', 'an empty comment');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a4');
  select count(*) into v_n from tci.v_client_contract_comments where draft_id = v_draft.id;
  if v_n <> 1 then raise exception 'contract_drafts: the client sees its own comment only (got %)', v_n; end if;
  perform set_config('role', 'postgres', true);
  if (select params ->> 'client_comment' from tci.tasks
       where object_id = v_draft.id and task_type = 'contract_review' and status = 'open') <> 'Please change clause 1.1' then
    raise exception 'contract_drafts: the client comment must ride on the review task';
  end if;
  perform pg_temp.refused(format($q$update tci.contract_draft_comments set body = 'x' where draft_id = %L$q$, v_draft.id),
    '42501', 'the owner rewriting a comment');

  -- agreeing is commercial underwriting's
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a1');
  perform pg_temp.refused(format($q$select tci.change_contract_status(%L, 'agreed')$q$, v_draft.id), '42501', 'sales agrees');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a2');
  v_draft := tci.change_contract_status(v_draft.id, 'agreed');
  perform set_config('role', 'postgres', true);
  if exists (select 1 from tci.tasks where object_id = v_draft.id and task_type = 'contract_review' and status = 'open') then
    raise exception 'contract_drafts: leaving review must close the review task';
  end if;
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a2');
  perform pg_temp.refused(format($q$select tci.save_contract_version(%L, 6, pg_temp.doc('Late edit', 'x'), 'manual')$q$, v_draft.id),
    'P0001', 'editing an agreed draft');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a4');
  perform pg_temp.refused(format($q$select tci.client_comment_contract_draft(%L, 'late')$q$, v_draft.id), 'P0001', 'a client comment once agreed');

  -- agreed -> draft needs a reason; then back through review to agreed
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a2');
  perform pg_temp.refused(format($q$select tci.change_contract_status(%L, 'draft')$q$, v_draft.id), 'P0001', 'reopening without a reason');
  v_draft := tci.change_contract_status(v_draft.id, 'draft', 'client asked for a change');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a4');
  if exists (select 1 from tci.v_client_contract_drafts) then
    raise exception 'contract_drafts: a draft back in draft must not be visible to the client';
  end if;
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a2');
  v_draft := tci.change_contract_status(v_draft.id, 'under_review');
  v_draft := tci.change_contract_status(v_draft.id, 'agreed');
  select count(*) into v_n from tci.contract_draft_status_history where draft_id = v_draft.id;
  if v_n <> 5 then raise exception 'contract_drafts: five status changes so far, got %', v_n; end if;

  -- 9. signing: only with the scan the caller uploaded, only when agreed
  perform pg_temp.refused(format($q$select tci.change_contract_status(%L, 'signed')$q$, v_draft.id), 'P0001', 'signing without a scan');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a3');
  perform pg_temp.refused(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('contract-scans', %L, '99999999-0000-4000-8000-0000000005a3')$q$,
    v_draft.id || '/scan.pdf'), '42501', 'credit uploads a scan');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a1');
  perform pg_temp.refused($q$insert into storage.objects (bucket_id, name, owner_id) values ('contract-scans', '99999999-0000-4000-8000-0000000005ff/scan.pdf', '99999999-0000-4000-8000-0000000005a1')$q$,
    '42501', 'a scan for a draft that does not exist');
  insert into storage.objects (bucket_id, name, owner_id) values ('contract-scans', v_draft.id || '/scan.pdf', '99999999-0000-4000-8000-0000000005a1');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a2');
  perform pg_temp.refused(format($q$select tci.sign_contract_draft(%L, 6, %L, 'signed.pdf')$q$, v_draft.id, v_draft.id || '/scan.pdf'),
    '42501', 'attaching someone else''s upload');
  perform pg_temp.refused(format($q$select tci.sign_contract_draft(%L, 6, %L, 'signed.pdf')$q$, v_draft.id, v_draft.id || '/ghost.pdf'),
    'P0002', 'attaching a scan that is not in storage');
  perform pg_temp.refused(format($q$select tci.sign_contract_draft(%L, 6, 'elsewhere/scan.pdf', 'signed.pdf')$q$, v_draft.id),
    'P0001', 'a scan outside the draft folder');
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a1');
  perform pg_temp.refused(format($q$select tci.sign_contract_draft(%L, 5, %L, 'signed.pdf')$q$, v_draft.id, v_draft.id || '/scan.pdf'),
    'P0001', 'signing another version than the agreed one');
  v_draft := tci.sign_contract_draft(v_draft.id, 6, v_draft.id || '/scan.pdf', 'signed.pdf');
  if v_draft.status <> 'signed' or v_draft.signed_version_id <> v_draft.current_version_id or v_draft.signed_scan_name <> 'signed.pdf' then
    raise exception 'contract_drafts: signing must lock the agreed version with its scan';
  end if;

  -- 10. signed is locked forever
  perform pg_temp.refused(format($q$select tci.save_contract_version(%L, 6, pg_temp.doc('After signing', 'x'), 'manual')$q$, v_draft.id),
    'P0001', 'editing a signed contract');
  perform pg_temp.refused(format($q$select tci.restore_contract_version(%L, 6, 1)$q$, v_draft.id), 'P0001', 'restoring on a signed contract');
  perform pg_temp.refused(format($q$select tci.change_contract_status(%L, 'draft', 'reopen')$q$, v_draft.id), 'P0001', 'reopening a signed contract');
  perform pg_temp.refused(format($q$select tci.share_contract_draft(%L, false)$q$, v_draft.id), 'P0001', 'unsharing a signed contract');
  perform pg_temp.refused(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('contract-scans', %L, '99999999-0000-4000-8000-0000000005a1')$q$,
    v_draft.id || '/second.pdf'), '42501', 'a second scan after signing');
  perform set_config('role', 'postgres', true);
  perform pg_temp.refused(format($q$update tci.contract_drafts set language = 'en' where id = %L$q$, v_draft.id),
    'P0001', 'the owner changing a signed draft');
  -- the client still reads the shared version of a signed contract
  perform pg_temp.act('99999999-0000-4000-8000-0000000005a4');
  select count(*) into v_n from tci.v_client_contract_drafts where id = v_draft.id and status = 'signed';
  if v_n <> 1 then raise exception 'contract_drafts: the client must still read a signed shared contract'; end if;

  -- 11. nothing reaches anon
  perform set_config('role', 'postgres', true);
  if has_function_privilege('anon', 'tci.create_contract_draft(uuid, uuid, uuid, jsonb, text)', 'execute')
     or has_function_privilege('anon', 'tci.client_comment_contract_draft(uuid, text)', 'execute')
     or has_table_privilege('anon', 'tci.v_client_contract_drafts', 'select') then
    raise exception 'contract_drafts: anon reaches the contract functions';
  end if;
end $$;

do $$ begin raise notice 'contract_drafts: OK — gated generation, append-only versions (API and owner refused), conflict-safe saves, values-only refresh, confirmed regeneration, restore as a new version, machine + review task, client read-only view and comments, signed scan, signed is final'; end $$;
rollback;
