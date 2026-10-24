-- Tests for migrations 0060 and 0071: limit decisions validated up the
-- authority levels (0071 replaced the named validator of 0060).
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/limit_validation.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.
-- Amounts are in UZS and the band is `unrated` (no assessment), so the
-- authority arithmetic is plain.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000008a1', 'val-junior@t'),     -- credit, 100k
  ('99999999-0000-4000-8000-0000000008a2', 'val-middle@t'),     -- credit, 300k (junior's manager)
  ('99999999-0000-4000-8000-0000000008a3', 'val-senior@t'),     -- credit, 1M
  ('99999999-0000-4000-8000-0000000008a4', 'val-comm-junior@t'),-- commercial, 100k
  ('99999999-0000-4000-8000-0000000008a5', 'val-comm-senior@t'),-- commercial, 1M
  ('99999999-0000-4000-8000-0000000008a6', 'val-sales@t'),
  ('99999999-0000-4000-8000-0000000008a7', 'val-outsider@t'),   -- credit, 1M, not in any chain
  ('99999999-0000-4000-8000-0000000008a8', 'val-admin@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000008a1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000008a2', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000008a3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000008a4', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000008a5', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000008a6', 'sales'),
  ('99999999-0000-4000-8000-0000000008a7', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000008a8', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password) values
  ('99999999-0000-4000-8000-0000000008a1', 'Val Junior', false),
  ('99999999-0000-4000-8000-0000000008a2', 'Val Middle', false),
  ('99999999-0000-4000-8000-0000000008a3', 'Val Senior', false),
  ('99999999-0000-4000-8000-0000000008a4', 'Val Comm Junior', false),
  ('99999999-0000-4000-8000-0000000008a5', 'Val Comm Senior', false),
  ('99999999-0000-4000-8000-0000000008a6', 'Val Sales', false),
  ('99999999-0000-4000-8000-0000000008a7', 'Val Outsider', false),
  ('99999999-0000-4000-8000-0000000008a8', 'Val Admin', false)
on conflict (user_id) do update set must_change_password = false, full_name = excluded.full_name;
insert into tci.authority_grants (user_id, applies_to, grade_band, max_amount, currency_code, valid_from, created_by) values
  ('99999999-0000-4000-8000-0000000008a1', 'credit', 'unrated', 100000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000008a8'),
  ('99999999-0000-4000-8000-0000000008a2', 'credit', 'unrated', 300000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000008a8'),
  ('99999999-0000-4000-8000-0000000008a3', 'credit', 'unrated', 1000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000008a8'),
  ('99999999-0000-4000-8000-0000000008a7', 'credit', 'unrated', 1000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000008a8'),
  ('99999999-0000-4000-8000-0000000008a4', 'commercial', 'unrated', 100000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000008a8'),
  ('99999999-0000-4000-8000-0000000008a5', 'commercial', 'unrated', 1000000, 'UZS', current_date - 1, '99999999-0000-4000-8000-0000000008a8');

-- 0071: the levels. Credit: junior rank 1, middle rank 2 (300k), senior and
-- outsider rank 3 (1M). Commercial: comm junior rank 1, comm senior rank 3.
insert into tci.authority_level_grants (level_id, grade_band, max_amount, currency_code, valid_from)
select l.id, 'unrated', a.amount, 'UZS', current_date - 1
  from tci.authority_levels l
  join (values ('credit', 1, 100000), ('credit', 2, 300000), ('credit', 3, 1000000),
               ('commercial', 1, 100000), ('commercial', 3, 1000000)) a(stream, rank, amount)
    on l.stream::text = a.stream and l.rank = a.rank;
insert into tci.authority_level_members (level_id, user_id, valid_from)
select l.id, m.uid::uuid, current_date - 1
  from tci.authority_levels l
  join (values ('credit', 1, '99999999-0000-4000-8000-0000000008a1'), ('credit', 2, '99999999-0000-4000-8000-0000000008a2'),
               ('credit', 3, '99999999-0000-4000-8000-0000000008a3'), ('credit', 3, '99999999-0000-4000-8000-0000000008a7'),
               ('commercial', 1, '99999999-0000-4000-8000-0000000008a4'), ('commercial', 3, '99999999-0000-4000-8000-0000000008a5')) m(stream, rank, uid)
    on l.stream::text = m.stream and l.rank = m.rank;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000008a6"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000008e1', 'Val Holder', 'UZ', '99999999-0000-4000-8000-0000000008a6'),
  ('99999999-0000-4000-8000-0000000008e2', 'Val Buyer One', 'KZ', '99999999-0000-4000-8000-0000000008a6'),
  ('99999999-0000-4000-8000-0000000008e3', 'Val Buyer Two', 'KZ', '99999999-0000-4000-8000-0000000008a6'),
  ('99999999-0000-4000-8000-0000000008e4', 'Val Buyer Three', 'TR', '99999999-0000-4000-8000-0000000008a6');
insert into tci.insurance_requests (id, entity_id, request_number, status, created_by) values
  ('99999999-0000-4000-8000-0000000008b1', '99999999-0000-4000-8000-0000000008e1', 'VAL-IR-1', 'underwriting',
   '99999999-0000-4000-8000-0000000008a6');
select tci.begin_trusted_call();
insert into tci.credit_limit_requests (id, entity_id, insurance_request_id, requested_amount, currency_code, status, requested_by) values
  ('99999999-0000-4000-8000-0000000008c1', '99999999-0000-4000-8000-0000000008e2', '99999999-0000-4000-8000-0000000008b1', 500000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000008a6'),
  ('99999999-0000-4000-8000-0000000008c2', '99999999-0000-4000-8000-0000000008e3', '99999999-0000-4000-8000-0000000008b1', 200000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000008a6'),
  ('99999999-0000-4000-8000-0000000008c3', '99999999-0000-4000-8000-0000000008e4', '99999999-0000-4000-8000-0000000008b1', 80000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000008a6');
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('tci.resolving_validation', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

create function pg_temp.refused(p_sql text, p_state text, p_label text, p_fragment text default null) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state and (p_fragment is null or position(p_fragment in v_msg) > 0) then return; end if;
    raise exception 'limit_validation: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'limit_validation: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

do $$
declare
  c_junior constant uuid := '99999999-0000-4000-8000-0000000008a1';
  c_middle constant uuid := '99999999-0000-4000-8000-0000000008a2';
  c_senior constant uuid := '99999999-0000-4000-8000-0000000008a3';
  c_cj     constant uuid := '99999999-0000-4000-8000-0000000008a4';
  c_cs     constant uuid := '99999999-0000-4000-8000-0000000008a5';
  c_sales  constant uuid := '99999999-0000-4000-8000-0000000008a6';
  c_out    constant uuid := '99999999-0000-4000-8000-0000000008a7';
  c_admin  constant uuid := '99999999-0000-4000-8000-0000000008a8';
  c_r1     constant uuid := '99999999-0000-4000-8000-0000000008c1';
  c_r2     constant uuid := '99999999-0000-4000-8000-0000000008c2';
  c_r3     constant uuid := '99999999-0000-4000-8000-0000000008c3';
  v        jsonb;
  v_val    uuid;
  v_val2   uuid;
  v_dec    tci.credit_limit_decisions%rowtype;
  v_n      int;
begin
  -- 0. The manager is set by admin only.
  perform pg_temp.act(c_junior);
  perform pg_temp.refused(format('select tci.set_user_manager(%L, %L)', c_junior, c_senior), '42501', 'manager set by a non-admin');
  perform pg_temp.act(c_admin);
  perform tci.set_user_manager(c_junior, c_middle);
  perform pg_temp.refused(format('select tci.set_user_manager(%L, %L)', c_junior, c_junior), 'P0001', 'self as manager', 'manager_is_self');

  -- 1. Beyond authority nothing is recorded: decide answers needs_validation.
  perform pg_temp.act(c_junior);
  v := tci.decide_limit_request(c_r1, 'approved', 500000, 'UZS');
  if v ->> 'result' <> 'needs_validation' then
    raise exception 'limit_validation: over authority answered %', v;
  end if;
  perform set_config('role', 'postgres', true);
  if (select status from tci.credit_limit_requests where id = c_r1) <> 'submitted'
     or exists (select 1 from tci.credit_limit_decisions where request_id = c_r1) then
    raise exception 'limit_validation: an over-authority attempt changed something';
  end if;

  -- 2. Where it would go (direct routing): 500k to rank 3 (senior, outsider),
  --    rank 2 told; 200k to rank 2 (middle).
  perform pg_temp.act(c_junior);
  v := tci.validation_route_preview(c_r1, 'credit', 'unrated', 500000, 'UZS');
  if (v ->> 'rank')::int <> 3 or v ->> 'kind' <> 'required' or jsonb_array_length(v -> 'members') <> 2
     or (v -> 'fyi' -> 0 ->> 'user_id')::uuid <> c_middle then
    raise exception 'limit_validation: wrong route for 500k: %', v;
  end if;
  v := tci.validation_route_preview(c_r2, 'credit', 'unrated', 200000, 'UZS');
  if (v ->> 'rank')::int <> 2 or (v -> 'members' -> 0 ->> 'user_id')::uuid <> c_middle then
    raise exception 'limit_validation: wrong route for 200k: %', v;
  end if;

  -- 3. A validator is never named any more; voluntary needs a comment.
  perform pg_temp.refused(format('select tci.submit_limit_for_validation(%L, %L, %L, 500000, %L)', c_r1, c_senior, 'approved', 'UZS'),
                          'P0001', 'a named validator', 'named_validator_retired');
  perform pg_temp.refused(format('select tci.submit_limit_for_validation(%L, null, %L, 80000, %L)', c_r3, 'approved', 'UZS'),
                          'P0001', 'voluntary without a comment', 'validation_comment_required');

  -- 4. The chain on r2 (200k): junior -> rank 2 (middle).
  v := tci.submit_limit_for_validation(c_r2, null, 'approved', 200000, 'UZS', current_date, null,
                                       '[]'::jsonb, 'Strong payment history');
  v_val := (v ->> 'validation_id')::uuid;
  if v ->> 'kind' <> 'required' or (v ->> 'rank')::int <> 2 then
    raise exception 'limit_validation: 200k above 100k did not go to rank 2: %', v;
  end if;
  perform set_config('role', 'postgres', true);
  if (select status from tci.credit_limit_requests where id = c_r2) <> 'escalated' then
    raise exception 'limit_validation: the request is not parked while on validation';
  end if;
  if not exists (select 1 from tci.tasks where task_type = 'limit_validation' and object_id = v_val
                  and target_user = c_middle and status = 'open' and priority = 'urgent') then
    raise exception 'limit_validation: the level member got no urgent task';
  end if;
  -- Nobody else decides a request on validation.
  perform pg_temp.act(c_senior);
  perform pg_temp.refused(format('select tci.decide_limit_request(%L, %L, 200000, %L)', c_r2, 'approved', 'UZS'),
                          'P0001', 'deciding a request on validation', 'limit_validation_pending');
  -- ... and only a member of the level answers.
  perform pg_temp.refused(format('select tci.resolve_limit_validation(%L, %L)', v_val, 'approve'), '42501', 'answer by a non-member');
  -- RLS: someone outside the chain and its levels sees nothing of it.
  perform pg_temp.act(c_out);
  select count(*) into v_n from tci.limit_validations;
  if v_n <> 0 then
    raise exception 'limit_validation: an outsider sees % validation rows', v_n;
  end if;
  select count(*) into v_n from tci.limit_validation_history(c_r2);
  if v_n <> 0 then
    raise exception 'limit_validation: an outsider reads the history';
  end if;
  -- ... but anyone on staff may know it is on validation, and at which rank.
  select count(*) into v_n from tci.limit_request_validation_levels(array[c_r2]) where rank = 2;
  if v_n <> 1 then
    raise exception 'limit_validation: the on-validation level is not visible';
  end if;
  select count(*) into v_n from tci.limit_request_validation_state(array[c_r2]) where validator_id is null;
  if v_n <> 1 then
    raise exception 'limit_validation: a level step is missing from the on-validation state';
  end if;

  -- Middle modifies it to 350k: beyond THEIR authority => refused.
  perform pg_temp.act(c_middle);
  perform pg_temp.refused(format('select tci.resolve_limit_validation(%L, %L, 350000)', v_val, 'approve_modified'),
                          'P0001', 'approving beyond the member''s authority', 'validation_beyond_authority');
  -- Forward: to the next rank up (3), never to a chosen person.
  v := tci.resolve_limit_validation(v_val, 'forward', null, null, 'Above my comfort');
  v_val2 := (v ->> 'validation_id')::uuid;
  if (v ->> 'rank')::int <> 3 then
    raise exception 'limit_validation: the forward did not go to rank 3: %', v;
  end if;
  perform set_config('role', 'postgres', true);
  if (select status from tci.limit_validations where id = v_val) <> 'forwarded'
     or (select chain_id from tci.limit_validations where id = v_val2) <> v_val
     or (select forwarded_by from tci.limit_validations where id = v_val2) <> c_middle then
    raise exception 'limit_validation: the forward did not chain';
  end if;
  if exists (select 1 from tci.tasks where task_type = 'limit_validation' and object_id = v_val and status = 'open') then
    raise exception 'limit_validation: the forwarded step left its task open';
  end if;
  if (select count(*) from tci.tasks where task_type = 'limit_validation' and object_id = v_val2 and status = 'open'
        and target_user in (c_senior, c_out)) <> 2 then
    raise exception 'limit_validation: both rank 3 members should have the forwarded step';
  end if;

  -- Senior approves modified (180k): a partial decision by senior, linked.
  perform pg_temp.act(c_senior);
  v := tci.resolve_limit_validation(v_val2, 'approve_modified', 180000, null, 'Partial, seasonal peak');
  perform set_config('role', 'postgres', true);
  select * into v_dec from tci.credit_limit_decisions where id = (v ->> 'decision_id')::uuid;
  if v_dec.outcome <> 'partial' or v_dec.approved_amount <> 180000 or v_dec.decided_by <> c_senior
     or v_dec.validation_id <> v_val2 then
    raise exception 'limit_validation: the validated decision is wrong: %', row_to_json(v_dec);
  end if;
  if (select status from tci.credit_limit_requests where id = c_r2) <> 'decided' then
    raise exception 'limit_validation: the request is not decided after validation';
  end if;
  if not exists (select 1 from tci.tasks where task_type = 'limit_validation_result' and target_user = c_junior
                  and title_key = 'agenda.tasks.limit_validation_result_approved_modified' and status = 'open') then
    raise exception 'limit_validation: the author was not told';
  end if;
  if exists (select 1 from tci.tasks where task_type = 'limit_validation' and object_id = v_val2 and status = 'open') then
    raise exception 'limit_validation: the other rank 3 member still holds the answered step';
  end if;
  -- A resolved step is final.
  perform pg_temp.act(c_out);
  perform pg_temp.refused(format('select tci.resolve_limit_validation(%L, %L)', v_val2, 'approve'), 'P0001', 'answering twice', 'validation_closed');
  -- The chain's history, with names, for its people.
  perform pg_temp.act(c_junior);
  select count(*) into v_n from tci.limit_validation_history(c_r2);
  if v_n <> 2 then
    raise exception 'limit_validation: the author sees % history steps, not 2', v_n;
  end if;

  -- 5. Return and reject on r1 (500k): junior -> rank 3 directly, rank 2 told.
  v := tci.submit_limit_for_validation(c_r1, null, 'approved', 500000, 'UZS', current_date, null, '[]'::jsonb, null);
  v_val := (v ->> 'validation_id')::uuid;
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from tci.tasks where task_type = 'limit_validation_fyi' and object_id = v_val
                  and target_user = c_middle and status = 'open') then
    raise exception 'limit_validation: the skipped rank was not told';
  end if;
  perform pg_temp.act(c_senior);
  perform pg_temp.refused(format('select tci.resolve_limit_validation(%L, %L)', v_val, 'return'), 'P0001', 'return without a comment', 'validation_comment_required');
  perform tci.resolve_limit_validation(v_val, 'return', null, null, 'Get the 2025 statements first');
  perform set_config('role', 'postgres', true);
  if (select status from tci.credit_limit_requests where id = c_r1) <> 'under_review' then
    raise exception 'limit_validation: a return did not reopen the request';
  end if;
  if not exists (select 1 from tci.tasks where task_type = 'limit_validation_result' and target_user = c_junior
                  and title_key = 'agenda.tasks.limit_validation_result_returned' and priority = 'high') then
    raise exception 'limit_validation: the return did not reach the author';
  end if;
  perform pg_temp.act(c_junior);
  v := tci.submit_limit_for_validation(c_r1, null, 'approved', 500000, 'UZS', current_date, null, '[]'::jsonb, null);
  v_val := (v ->> 'validation_id')::uuid;
  perform pg_temp.act(c_out);
  perform tci.resolve_limit_validation(v_val, 'reject', null, null, 'Too concentrated');
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from tci.credit_limit_decisions where request_id = c_r1 and outcome = 'declined'
                  and decided_by = c_out and validation_id = v_val) then
    raise exception 'limit_validation: a rejection did not decline the limit';
  end if;

  -- 6. Commercial stream on r2's credit decision (180k).
  perform pg_temp.act(c_cj);
  v := tci.adjust_limit_commercial(v_dec.id, 250000);
  if v ->> 'result' <> 'needs_validation' then
    raise exception 'limit_validation: a commercial increase over authority answered %', v;
  end if;
  -- A reduction is never authority-checked and needs no validation.
  perform pg_temp.refused(format('select tci.submit_adjustment_for_validation(%L, null, 50000)', v_dec.id),
                          'P0001', 'validating a reduction', 'validation_not_for_reduction');
  v := tci.submit_adjustment_for_validation(v_dec.id, null, 250000, 90, null);
  v_val := (v ->> 'validation_id')::uuid;
  if (v ->> 'rank')::int <> 3 then
    raise exception 'limit_validation: the commercial proposal did not go to rank 3: %', v;
  end if;
  perform set_config('role', 'postgres', true);
  if not (select held from tci.credit_limit_decisions where id = v_dec.id) then
    raise exception 'limit_validation: the credit decision is not held while the adjustment is weighed';
  end if;
  perform pg_temp.act(c_cs);
  v := tci.resolve_limit_validation(v_val, 'approve');
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from tci.credit_limit_decisions where id = (v ->> 'decision_id')::uuid
                  and stage = 'commercial' and approved_amount = 250000 and payment_terms_days = 90
                  and validation_id = v_val and released_at is null) then
    raise exception 'limit_validation: the validated adjustment is wrong';
  end if;
  if (select held from tci.credit_limit_decisions where id = v_dec.id) then
    raise exception 'limit_validation: the credit decision stayed held';
  end if;

  -- 7. No direct writes.
  perform pg_temp.act(c_senior);
  perform pg_temp.refused(format('insert into tci.limit_validations (chain_id, request_id, stream, kind, outcome, currency_code, grade_band, proposed_by, validator_id) values (gen_random_uuid(), %L, %L, %L, %L, %L, %L, %L, %L)',
                          c_r3, 'credit', 'voluntary', 'declined', 'UZS', 'unrated', c_senior, c_out),
                          '42501', 'a direct insert');
  perform set_config('role', 'postgres', true);
  perform set_config('tci.internal_call', '', true);

  raise notice 'limit_validation: OK — over authority records nothing and goes to the authority level that covers it (the skipped rank told), no named validator, voluntary needs a comment, any member of the level answers, forward to the next rank, approve-modified within the member''s authority, return reopens, reject declines, commercial hold and release, author told, RLS to the chain and its levels, no direct writes';
end;
$$;

rollback;
