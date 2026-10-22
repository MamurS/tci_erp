-- Tests for migration 0058: commercial offers (КП) published to the portal,
-- the versioned brochure and the media library.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/commercial_offers.sql
--
-- One transaction, rolled back. API roles are impersonated; the
-- internal-call token is cleared at every actor switch. Every UPDATE carries
-- a WHERE clause.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000006a1', 'kp-sales@t'),
  ('99999999-0000-4000-8000-0000000006a2', 'kp-commercial@t'),
  ('99999999-0000-4000-8000-0000000006a3', 'kp-credit@t'),
  ('99999999-0000-4000-8000-0000000006a4', 'kp-client@t'),
  ('99999999-0000-4000-8000-0000000006a5', 'kp-other-client@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000006a1', 'sales'),
  ('99999999-0000-4000-8000-0000000006a2', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000006a3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000006a4', 'client'),
  ('99999999-0000-4000-8000-0000000006a5', 'client');
insert into tci.user_profiles (user_id, full_name, must_change_password, phone) values
  ('99999999-0000-4000-8000-0000000006a1', 'KP Sales Person', false, '+998 00 000 00 00'),
  ('99999999-0000-4000-8000-0000000006a2', 'KP Commercial', false, null),
  ('99999999-0000-4000-8000-0000000006a3', 'KP Credit', false, null),
  ('99999999-0000-4000-8000-0000000006a4', 'KP Client', false, null),
  ('99999999-0000-4000-8000-0000000006a5', 'KP Other', false, null)
on conflict (user_id) do update set must_change_password = false, full_name = excluded.full_name, phone = excluded.phone;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000006a2"}', true);
-- A PROSPECT (no policy), its competitor, and two buyers.
insert into tci.legal_entities (id, name, country_code, registration_number, created_by) values
  ('99999999-0000-4000-8000-0000000006e1', 'KP Prospect LLC', 'UZ', 'KP-1', '99999999-0000-4000-8000-0000000006a2'),
  ('99999999-0000-4000-8000-0000000006e2', 'KP Other LLC', 'UZ', 'KP-2', '99999999-0000-4000-8000-0000000006a2'),
  ('99999999-0000-4000-8000-0000000006e3', 'KP Buyer Approved', 'KZ', 'KP-3', '99999999-0000-4000-8000-0000000006a2'),
  ('99999999-0000-4000-8000-0000000006e4', 'KP Buyer Pending', 'TR', 'KP-4', '99999999-0000-4000-8000-0000000006a2');
insert into tci.policyholder_users (user_id, entity_id) values
  ('99999999-0000-4000-8000-0000000006a4', '99999999-0000-4000-8000-0000000006e1'),
  ('99999999-0000-4000-8000-0000000006a5', '99999999-0000-4000-8000-0000000006e2');
update tci.insurer_profile set legal_name = 'KP Insurer JSC', phone = '+998 71 000 00 00' where id;

-- Two submissions: one still in underwriting with no terms, one for the offer.
insert into tci.insurance_requests (id, entity_id, request_number, status, created_by) values
  ('99999999-0000-4000-8000-0000000006b1', '99999999-0000-4000-8000-0000000006e1', 'KP-IR-1', 'underwriting',
   '99999999-0000-4000-8000-0000000006a1'),
  ('99999999-0000-4000-8000-0000000006b2', '99999999-0000-4000-8000-0000000006e2', 'KP-IR-2', 'sales_confirmation',
   '99999999-0000-4000-8000-0000000006a1');
update tci.insurance_requests
   set product_structure = 'whole_turnover', currency_code = 'USD', insured_percentage = 90,
       premium_rate_pct = 0.15, minimum_premium = 12000, max_liability_amount = 600000,
       discretionary_limit = 20000, nql_amount = 1000, waiting_period_days = 30,
       max_extension_period_days = 60, max_payment_terms_days = 90,
       declaration_frequency = 'quarterly', estimated_annual_turnover = 10000000
 where id = '99999999-0000-4000-8000-0000000006b2';
insert into tci.insurance_request_buyers (request_id, entity_id, requested_amount, requested_payment_terms_days,
                                          resolution_status, created_by) values
  ('99999999-0000-4000-8000-0000000006b1', '99999999-0000-4000-8000-0000000006e3', 100000, 60, 'ready',
   '99999999-0000-4000-8000-0000000006a1'),
  ('99999999-0000-4000-8000-0000000006b1', '99999999-0000-4000-8000-0000000006e4', 50000, 90, 'ready',
   '99999999-0000-4000-8000-0000000006a1');

-- An approved credit decision for one buyer inside submission 1 (trusted
-- fixture: decisions are workflow-written).
select tci.begin_trusted_call();
insert into tci.credit_limit_requests (id, entity_id, insurance_request_id, requested_amount, currency_code, status, requested_by)
values ('99999999-0000-4000-8000-0000000006c1', '99999999-0000-4000-8000-0000000006e3',
        '99999999-0000-4000-8000-0000000006b1', 100000, 'USD', 'decided', '99999999-0000-4000-8000-0000000006a1');
insert into tci.credit_limit_decisions (request_id, outcome, approved_amount, currency_code, payment_terms_days,
                                        decided_by, released_at, release_kind)
values ('99999999-0000-4000-8000-0000000006c1', 'approved', 80000, 'USD', 60,
        '99999999-0000-4000-8000-0000000006a3', now(), 'immediate');
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('tci.internal_call', '', true);
end $$;

create function pg_temp.refused(p_sql text, p_state text, p_label text) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state then return; end if;
    raise exception 'commercial_offers: % refused with % (%) instead of %', p_label, v_state, v_msg, p_state;
  end;
  raise exception 'commercial_offers: % was NOT refused', p_label;
end $$;

do $$
declare
  c_sales  constant uuid := '99999999-0000-4000-8000-0000000006a1';
  c_comm   constant uuid := '99999999-0000-4000-8000-0000000006a2';
  c_credit constant uuid := '99999999-0000-4000-8000-0000000006a3';
  c_client constant uuid := '99999999-0000-4000-8000-0000000006a4';
  c_other  constant uuid := '99999999-0000-4000-8000-0000000006a5';
  c_req    constant uuid := '99999999-0000-4000-8000-0000000006b1';
  c_req2   constant uuid := '99999999-0000-4000-8000-0000000006b2';
  v_offer  tci.commercial_offers%rowtype;
  v_ver    tci.commercial_offer_versions%rowtype;
  v_bro    tci.brochure_versions%rowtype;
  v_asset  tci.media_assets%rowtype;
  v_data   jsonb;
  v_n      int;
  v_s      text;
  v_texts  constant jsonb := '{"why_tci": "Receivables are your largest asset.", "next_steps": "Accept in the portal."}';
begin
  -- 1. Who may prepare an offer, and when.
  perform pg_temp.act(c_credit);
  perform pg_temp.refused(format($q$select tci.create_commercial_offer(%L, 'ru', %L::jsonb)$q$, c_req, v_texts),
    '42501', 'credit underwriting prepares an offer');
  perform pg_temp.act(c_client);
  perform pg_temp.refused(format($q$select tci.create_commercial_offer(%L, 'ru', %L::jsonb)$q$, c_req, v_texts),
    '42501', 'a client prepares an offer');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format($q$select tci.create_commercial_offer(%L, 'ru', %L::jsonb)$q$, c_req, v_texts),
    'P0001', 'an offer while the submission is in underwriting');

  perform pg_temp.owner();
  update tci.insurance_requests set status = 'commercial_review' where id = c_req;
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format($q$select tci.create_commercial_offer(%L, 'ru', %L::jsonb)$q$, c_req, v_texts),
    'P0001', 'an offer without proposed terms');

  perform pg_temp.owner();
  update tci.insurance_requests
     set product_structure = 'whole_turnover', currency_code = 'USD', insured_percentage = 90,
         premium_rate_pct = 0.15, minimum_premium = 12000, max_liability_amount = 600000,
         discretionary_limit = 20000, nql_amount = 1000, deductible_each_loss = 500,
         waiting_period_days = 30, max_extension_period_days = 60, max_payment_terms_days = 90,
         declaration_frequency = 'quarterly', estimated_annual_turnover = 10000000
   where id = c_req;

  -- 2. Generate in ru: the database composes the data.
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format($q$select tci.create_commercial_offer(%L, 'de', %L::jsonb)$q$, c_req, v_texts),
    'P0001', 'an offer in a language we do not print');
  perform pg_temp.refused(format($q$select tci.create_commercial_offer(%L, 'ru', %L::jsonb, current_date - 5)$q$, c_req, v_texts),
    'P0001', 'an offer valid until a past day');
  v_offer := tci.create_commercial_offer(c_req, 'ru', v_texts);
  if v_offer.offer_number !~ '^KP-\d{4}-\d{4}$' or v_offer.status <> 'draft'
     or v_offer.valid_until <> tci.offer_today() + 30 or v_offer.entity_id <> '99999999-0000-4000-8000-0000000006e1' then
    raise exception 'commercial_offers: unexpected new offer %', row_to_json(v_offer);
  end if;
  select * into v_ver from tci.commercial_offer_versions where id = v_offer.current_version_id;
  v_data := v_ver.data;
  if v_ver.version_no <> 1 or v_ver.brochure_version_id is not null
     or v_data #>> '{client,name}' <> 'KP Prospect LLC'
     or v_data #>> '{terms,currency_code}' <> 'USD'
     or (v_data #>> '{premium,estimated_premium}')::numeric <> 15000
     or (v_data #>> '{premium,estimated_premium_due}')::numeric <> 15000
     or (v_data #>> '{premium,instalments}')::int <> 4
     or (v_data #>> '{premium,instalment_amount}')::numeric <> 3000
     or v_data #>> '{insurer,legal_name}' <> 'KP Insurer JSC'
     or v_data #>> '{contact,name}' <> 'KP Sales Person' then
    raise exception 'commercial_offers: version 1 data is wrong: %', v_data;
  end if;
  -- buyers: approved at the decided amount, the other indicative at the request
  if (select count(*) from jsonb_array_elements(v_data -> 'buyers') b
       where b ->> 'name' = 'KP Buyer Approved' and b ->> 'basis' = 'approved'
         and (b ->> 'offered_amount')::numeric = 80000 and (b ->> 'requested_amount')::numeric = 100000) <> 1
     or (select count(*) from jsonb_array_elements(v_data -> 'buyers') b
          where b ->> 'name' = 'KP Buyer Pending' and b ->> 'basis' = 'indicative'
            and (b ->> 'offered_amount')::numeric = 50000) <> 1 then
    raise exception 'commercial_offers: buyer limits wrong: %', v_data -> 'buyers';
  end if;
  -- never an internal field
  if v_data::text ~* '"(grade|grade_band|score|based_on_assessment_id|decided_by|hold_comment|comment|authority|amount_uzs|engine)' then
    raise exception 'commercial_offers: the offer data carries an internal field: %', v_data;
  end if;
  perform pg_temp.refused(format($q$select tci.create_commercial_offer(%L, 'en', %L::jsonb)$q$, c_req, v_texts),
    'P0001', 'a second live offer for the same submission');

  -- the client sees nothing of a draft
  perform pg_temp.act(c_client);
  if exists (select 1 from tci.v_client_offers) or exists (select 1 from tci.commercial_offers)
     or exists (select 1 from tci.commercial_offer_versions) then
    raise exception 'commercial_offers: a client reads an unpublished offer';
  end if;

  -- 3. The brochure: admin/sales only, the current one is the latest published.
  perform pg_temp.act(c_credit);
  perform pg_temp.refused($q$select tci.save_brochure_version('{"sections": []}'::jsonb)$q$, '42501', 'credit edits the brochure');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused($q$select tci.save_brochure_version('{"sections": "no"}'::jsonb)$q$, 'P0001', 'a brochure without sections');
  perform pg_temp.refused($q$select tci.save_brochure_version('{"sections": [{"key": "what", "image_asset_id": "99999999-0000-4000-8000-000000000699"}]}'::jsonb)$q$,
    'P0001', 'a brochure naming an image that is not in the library');
  v_bro := tci.save_brochure_version('{"sections": [{"key": "what", "title": {"ru": "Что такое страхование"}, "body": {"ru": "Текст"}}]}', 'first');
  if v_bro.status <> 'draft' or tci.current_brochure_version() is not null then
    raise exception 'commercial_offers: a saved brochure must stay a draft until published';
  end if;
  v_bro := tci.publish_brochure_version(v_bro.id);
  if v_bro.status <> 'published' or tci.current_brochure_version() <> v_bro.id then
    raise exception 'commercial_offers: the published brochure must be current';
  end if;
  perform pg_temp.refused(format($q$select tci.publish_brochure_version(%L)$q$, v_bro.id), 'P0001', 'publishing a brochure twice');

  -- 4. Editing: every save is a version, never a lost update.
  v_ver := tci.save_offer_version(v_offer.id, 1, v_texts || '{"why_tci": "Edited block."}', tci.offer_today() + 20, true, 'edited');
  if v_ver.version_no <> 2 or v_ver.brochure_version_id <> v_bro.id or v_ver.texts ->> 'why_tci' <> 'Edited block.' then
    raise exception 'commercial_offers: version 2 must carry the edit and the current brochure';
  end if;
  perform pg_temp.refused(format($q$select tci.save_offer_version(%L, 1, '{}'::jsonb, current_date + 10)$q$, v_offer.id),
    'P0001', 'saving on top of an old version');
  perform pg_temp.refused(format($q$select tci.save_offer_version(%L, 2, '{}'::jsonb, current_date - 1)$q$, v_offer.id),
    'P0001', 'a version valid until a past day');
  perform pg_temp.refused(format($q$select tci.save_offer_version(%L, 2, '[]'::jsonb, current_date + 10)$q$, v_offer.id),
    'P0001', 'texts that are not an object');

  -- 5. Publishing: sales' step, from sales confirmation.
  perform pg_temp.act(c_comm);
  perform pg_temp.refused(format($q$select tci.publish_offer(%L)$q$, v_offer.id), '42501', 'commercial underwriting publishes');
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format($q$select tci.publish_offer(%L)$q$, v_offer.id), 'P0001', 'publishing during the commercial review');
  perform pg_temp.act(c_comm);
  perform tci.advance_insurance_request(c_req, 'sales_confirmation', null);
  perform pg_temp.act(c_sales);
  v_offer := tci.publish_offer(v_offer.id);
  if v_offer.status <> 'published' or v_offer.valid_until <> tci.offer_today() + 20
     or (select version_no from tci.commercial_offer_versions where id = v_offer.published_version_id) <> 2
     or (select status from tci.insurance_requests where id = c_req) <> 'client_review' then
    raise exception 'commercial_offers: publish must pin version 2 and hand the submission to the client';
  end if;
  perform pg_temp.refused(format($q$select tci.publish_offer(%L)$q$, v_offer.id), 'P0001', 'republishing an unchanged offer');
  select count(*) into v_n from tci.v_commercial_offers where id = v_offer.id and has_portal_users and is_prospect
                                                          and effective_status = 'published';
  if v_n <> 1 then
    raise exception 'commercial_offers: the staff view must say prospect, with portal users, published';
  end if;

  -- 6. The client reads what was published, and only that.
  perform pg_temp.act(c_other);
  if exists (select 1 from tci.v_client_offers) then
    raise exception 'commercial_offers: another client reads this offer';
  end if;
  perform pg_temp.refused(format($q$select tci.client_view_offer(%L)$q$, v_offer.id), 'P0002', 'another client opens the offer');
  perform pg_temp.act(c_client);
  select count(*) into v_n from tci.v_client_offers
   where id = v_offer.id and version_no = 2 and texts ->> 'why_tci' = 'Edited block.'
     and brochure_version_no = v_bro.version_no and data #>> '{terms,currency_code}' = 'USD';
  if v_n <> 1 then
    raise exception 'commercial_offers: the client must read published version 2 with its brochure';
  end if;
  if exists (select 1 from tci.commercial_offers) then
    raise exception 'commercial_offers: a client reads the offers base table';
  end if;
  perform tci.client_view_offer(v_offer.id);
  perform pg_temp.owner();
  select * into v_offer from tci.commercial_offers where id = v_offer.id;
  if v_offer.status <> 'viewed' or v_offer.first_viewed_at is null or v_offer.published_viewed_at is null then
    raise exception 'commercial_offers: the first view must be recorded';
  end if;
  select count(*) into v_n from tci.tasks
   where task_type::text = 'offer_viewed' and object_id = v_offer.id and status = 'open' and target_role = 'sales';
  if v_n <> 1 then
    raise exception 'commercial_offers: the first view must tell sales (% tasks)', v_n;
  end if;

  -- 7. Case 2: the client asks for changes -> back to sales with the comment.
  perform pg_temp.act(c_client);
  perform pg_temp.refused(format($q$select tci.client_request_offer_changes(%L, '  ')$q$, v_offer.id), 'P0001', 'changes without a comment');
  perform tci.client_request_offer_changes(v_offer.id, 'Lower the rate, please');
  perform pg_temp.owner();
  select * into v_offer from tci.commercial_offers where id = v_offer.id;
  if v_offer.status <> 'changes_requested' or v_offer.client_comment <> 'Lower the rate, please'
     or (select status from tci.insurance_requests where id = c_req) <> 'sales_confirmation' then
    raise exception 'commercial_offers: changes must return the submission to sales with the comment';
  end if;
  if exists (select 1 from tci.tasks where task_type::text = 'offer_viewed' and object_id = v_offer.id and status = 'open') then
    raise exception 'commercial_offers: the viewed task must close once the client answered';
  end if;
  select count(*) into v_n from tci.tasks
   where task_type = 'submission_sales_confirmation' and object_id = c_req and status = 'open';
  if v_n <> 1 then
    raise exception 'commercial_offers: the change request must reopen sales'' task (% open)', v_n;
  end if;

  -- 8. Edit and republish: the new version supersedes the old in the portal.
  perform pg_temp.act(c_sales);
  perform tci.save_offer_version(v_offer.id, 2, v_texts || '{"why_tci": "Revised."}', tci.offer_today() + 2, true, 'rate');
  v_offer := tci.publish_offer(v_offer.id);
  perform pg_temp.act(c_client);
  if (select version_no from tci.v_client_offers where id = v_offer.id) <> 3 then
    raise exception 'commercial_offers: the republished version must supersede the old one';
  end if;

  -- an offer two days from its end opens offer_expiring for sales
  perform pg_temp.owner();
  perform tci.begin_trusted_call();
  perform tci.refresh_offer_tasks();
  perform set_config('tci.internal_call', '', true);
  select count(*) into v_n from tci.tasks
   where task_type::text = 'offer_expiring' and object_id = v_offer.id and status = 'open';
  if v_n <> 1 then
    raise exception 'commercial_offers: an offer close to its end must open offer_expiring';
  end if;

  -- 9. Case 3: expiry refuses acceptance, from the offer and from the submission.
  update tci.commercial_offers set valid_until = tci.offer_today() - 1 where id = v_offer.id;
  perform pg_temp.act(c_client);
  if (select effective_status from tci.v_client_offers where id = v_offer.id) <> 'expired' then
    raise exception 'commercial_offers: the portal must show the offer as expired';
  end if;
  perform pg_temp.refused(format($q$select tci.client_accept_offer(%L)$q$, v_offer.id), 'P0001', 'accepting an expired offer');
  perform pg_temp.refused(format($q$select tci.client_respond_to_submission(%L, 'accept')$q$, c_req), 'P0001',
    'accepting the submission of an expired offer');
  perform pg_temp.owner();
  perform tci.begin_trusted_call();
  perform tci.refresh_offer_tasks();
  perform set_config('tci.internal_call', '', true);
  if not exists (select 1 from tci.tasks where task_type::text = 'offer_expired' and object_id = v_offer.id and status = 'open')
     or exists (select 1 from tci.tasks where task_type::text = 'offer_expiring' and object_id = v_offer.id and status = 'open') then
    raise exception 'commercial_offers: expiry must replace offer_expiring with offer_expired';
  end if;
  update tci.commercial_offers set valid_until = tci.offer_today() + 2 where id = v_offer.id;

  -- 10. Case 1: accept = the submission's own acceptance.
  perform pg_temp.act(c_client);
  perform tci.client_accept_offer(v_offer.id);
  perform pg_temp.owner();
  select * into v_offer from tci.commercial_offers where id = v_offer.id;
  if v_offer.status <> 'accepted' or v_offer.answered_at is null
     or (select status from tci.insurance_requests where id = c_req) <> 'accepted' then
    raise exception 'commercial_offers: accepting must accept the submission and settle the offer';
  end if;
  if exists (select 1 from tci.tasks where task_type::text in ('offer_viewed', 'offer_expiring', 'offer_expired')
                                        and object_id = v_offer.id and status = 'open') then
    raise exception 'commercial_offers: an accepted offer keeps no open task';
  end if;
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format($q$select tci.withdraw_offer(%L, 'late')$q$, v_offer.id), 'P0001', 'withdrawing an accepted offer');
  perform pg_temp.refused(format($q$select tci.save_offer_version(%L, 3, '{}'::jsonb, current_date + 5)$q$, v_offer.id),
    'P0001', 'editing an accepted offer');

  -- 11. Withdrawing a published offer hands the submission back to sales.
  v_offer := tci.create_commercial_offer(c_req2, 'en', v_texts);
  v_offer := tci.publish_offer(v_offer.id);
  perform pg_temp.refused(format($q$select tci.withdraw_offer(%L, ' ')$q$, v_offer.id), 'P0001', 'withdrawing without a reason');
  v_offer := tci.withdraw_offer(v_offer.id, 'terms superseded');
  if v_offer.status <> 'withdrawn' or (select status from tci.insurance_requests where id = c_req2) <> 'sales_confirmation' then
    raise exception 'commercial_offers: withdrawal must return the submission to sales';
  end if;
  perform pg_temp.act(c_other);
  select status::text into v_s from tci.v_client_offers where id = v_offer.id and texts is null and data is null;
  if v_s is distinct from 'withdrawn' then
    raise exception 'commercial_offers: a withdrawn offer shows as withdrawn without its content';
  end if;
  perform pg_temp.refused(format($q$select tci.client_accept_offer(%L)$q$, v_offer.id), 'P0001', 'accepting a withdrawn offer');

  -- 11b. The fix: a client still cannot enter internal workflow code directly,
  --      and a decline from the submissions page settles the offer too.
  perform pg_temp.act(c_client);
  perform pg_temp.refused($q$select tci.begin_internal_call()$q$, '42501', 'a client entering internal workflow code');
  perform pg_temp.owner();
  update tci.insurance_requests set status = 'sales_confirmation' where id = c_req2;
  perform pg_temp.act(c_sales);
  v_offer := tci.create_commercial_offer(c_req2, 'uz', v_texts);
  v_offer := tci.publish_offer(v_offer.id);
  perform pg_temp.act(c_other);
  perform tci.client_respond_to_submission(c_req2, 'decline', 'Not now');
  perform pg_temp.owner();
  select * into v_offer from tci.commercial_offers where id = v_offer.id;
  if v_offer.status <> 'declined' or v_offer.client_comment <> 'Not now' then
    raise exception 'commercial_offers: a decline of the submission must settle the offer as declined';
  end if;

  -- 12. Nothing is written directly, and versions never change.
  perform pg_temp.act(c_sales);
  perform pg_temp.refused(format($q$update tci.commercial_offers set status = 'accepted' where id = %L$q$, v_offer.id),
    '42501', 'a direct status change');
  perform pg_temp.refused(format($q$insert into tci.commercial_offer_versions (offer_id, version_no, texts, data, valid_until, author_id) values (%L, 9, '{}', '{}', current_date, %L)$q$, v_offer.id, c_sales),
    '42501', 'a direct version insert');
  perform pg_temp.owner();
  perform pg_temp.refused(format($q$update tci.commercial_offer_versions set note = 'x' where offer_id = %L$q$, v_offer.id),
    '42501', 'the owner rewriting a version');
  perform pg_temp.refused(format($q$update tci.brochure_versions set content = '{"sections": []}' where id = %L$q$, v_bro.id),
    '42501', 'the owner rewriting a brochure version');

  -- 13. The media library: a licence and alt text in three languages, or nothing.
  perform pg_temp.act(c_sales);
  perform pg_temp.refused($q$select tci.register_media_asset('99999999-0000-4000-8000-0000000006f1.png', 'image/png',
    '{"en": "Warehouse", "ru": "Склад", "uz": "Ombor"}', 'Owner upload', 'Owner''s own photo')$q$, 'P0002', 'registering a file that was not uploaded');
  perform pg_temp.owner();
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media-assets', '99999999-0000-4000-8000-0000000006f1.png', c_sales::text);
  perform pg_temp.act(c_sales);
  perform pg_temp.refused($q$select tci.register_media_asset('99999999-0000-4000-8000-0000000006f1.png', 'image/png',
    '{"en": "Warehouse", "ru": "Склад"}', 'Owner upload', 'Owner''s own photo')$q$, '23514', 'alt text missing a language');
  perform pg_temp.refused($q$select tci.register_media_asset('99999999-0000-4000-8000-0000000006f1.png', 'image/png',
    '{"en": "Warehouse", "ru": "Склад", "uz": "Ombor"}', 'Owner upload', '  ')$q$, '23514', 'an image without a licence');
  v_asset := tci.register_media_asset('99999999-0000-4000-8000-0000000006f1.png', 'image/png',
    '{"en": "Warehouse", "ru": "Склад", "uz": "Ombor"}', 'Owner upload', 'Owner''s own photo, all rights');
  v_bro := tci.save_brochure_version(jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('key', 'what', 'image_asset_id', v_asset.id, 'image_path', 'forged.png'))));
  if v_bro.content #>> '{sections,0,image_path}' <> v_asset.storage_path
     or v_bro.content #>> '{sections,0,image_alt,uz}' <> 'Ombor' then
    raise exception 'commercial_offers: the brochure must stamp the library''s path and alt text, not the browser''s';
  end if;
  perform tci.retire_media_asset(v_asset.id);
  perform pg_temp.refused(format($q$select tci.save_brochure_version(jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('key', 'what', 'image_asset_id', %L::uuid))))$q$, v_asset.id),
    'P0001', 'a new brochure with a retired image');
  perform pg_temp.act(c_client);
  if exists (select 1 from tci.media_assets) or exists (select 1 from tci.brochure_versions) then
    raise exception 'commercial_offers: a client reads the media library or brochure table';
  end if;
  perform pg_temp.refused($q$select tci.register_media_asset('x.png', 'image/png', '{}', 'a', 'b')$q$, '42501', 'a client registers an image');

  raise notice 'commercial_offers: OK — gated generation from the submission, server-composed data with approved/indicative limits and no internal field, versioned edits, brochure embedded, publish hands over, viewed recorded and sales told, changes return to sales, republish supersedes, expiry refuses acceptance everywhere, accept is the submission''s step, withdrawal hands back, immutable versions, licensed media only';
end $$;

rollback;
