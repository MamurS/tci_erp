-- Tests for migration 0071: authority levels, routing (direct with the skipped
-- ranks told / sequential), and the committee's vote (quorum, majority, the
-- chair's casting vote, conflicts barred, everything immutable).
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/authority_levels.sql
--
-- One transaction, rolled back. API roles impersonated; the internal-call
-- token cleared at every actor switch. Every UPDATE carries a WHERE clause.
-- Amounts are in UZS and the band is `unrated`.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-0000000071a1', 'al-c1@t'),     -- credit rank 1 (100k)
  ('99999999-0000-4000-8000-0000000071a2', 'al-c2@t'),     -- credit rank 2 (300k)
  ('99999999-0000-4000-8000-0000000071a3', 'al-c3@t'),     -- credit rank 3 (500k)
  ('99999999-0000-4000-8000-0000000071b1', 'al-m1@t'),     -- committee, chair
  ('99999999-0000-4000-8000-0000000071b2', 'al-m2@t'),     -- committee
  ('99999999-0000-4000-8000-0000000071b3', 'al-m3@t'),     -- committee
  ('99999999-0000-4000-8000-0000000071b4', 'al-m4@t'),     -- committee
  ('99999999-0000-4000-8000-0000000071a6', 'al-sales@t'),
  ('99999999-0000-4000-8000-0000000071a7', 'al-comm@t'),
  ('99999999-0000-4000-8000-0000000071a8', 'al-admin@t');
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000071a1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000071a2', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000071a3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000071b1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000071b2', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000071b3', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000071b4', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000071a6', 'sales'),
  ('99999999-0000-4000-8000-0000000071a7', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000071a8', 'admin');
insert into tci.user_profiles (user_id, full_name, must_change_password)
select u.id, 'AL ' || split_part(u.email, '@', 1), false from auth.users u where u.email like 'al-%@t'
on conflict (user_id) do update set must_change_password = false;

select set_config('request.jwt.claims', '{"sub": "99999999-0000-4000-8000-0000000071a6"}', true);
insert into tci.legal_entities (id, name, country_code, created_by) values
  ('99999999-0000-4000-8000-0000000071e1', 'AL Holder', 'UZ', '99999999-0000-4000-8000-0000000071a6'),
  ('99999999-0000-4000-8000-0000000071e2', 'AL Buyer One', 'KZ', '99999999-0000-4000-8000-0000000071a6'),
  ('99999999-0000-4000-8000-0000000071e3', 'AL Buyer Two', 'KZ', '99999999-0000-4000-8000-0000000071a6'),
  ('99999999-0000-4000-8000-0000000071e4', 'AL Buyer Three', 'KZ', '99999999-0000-4000-8000-0000000071a6'),
  ('99999999-0000-4000-8000-0000000071e5', 'AL Buyer Four', 'KZ', '99999999-0000-4000-8000-0000000071a6'),
  ('99999999-0000-4000-8000-0000000071e6', 'AL Buyer Five', 'KZ', '99999999-0000-4000-8000-0000000071a6');
insert into tci.insurance_requests (id, entity_id, request_number, status, created_by) values
  ('99999999-0000-4000-8000-0000000071f1', '99999999-0000-4000-8000-0000000071e1', 'AL-IR-1', 'underwriting',
   '99999999-0000-4000-8000-0000000071a6');
select tci.begin_trusted_call();
insert into tci.credit_limit_requests (id, entity_id, insurance_request_id, requested_amount, currency_code, status, requested_by) values
  ('99999999-0000-4000-8000-0000000071c1', '99999999-0000-4000-8000-0000000071e2', '99999999-0000-4000-8000-0000000071f1', 400000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000071a6'),
  ('99999999-0000-4000-8000-0000000071c2', '99999999-0000-4000-8000-0000000071e3', '99999999-0000-4000-8000-0000000071f1', 2000000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000071a6'),
  ('99999999-0000-4000-8000-0000000071c3', '99999999-0000-4000-8000-0000000071e4', '99999999-0000-4000-8000-0000000071f1', 2000000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000071a6'),
  ('99999999-0000-4000-8000-0000000071c4', '99999999-0000-4000-8000-0000000071e5', '99999999-0000-4000-8000-0000000071f1', 2000000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000071a6'),
  -- raised by a committee member: m3 never sits on it
  ('99999999-0000-4000-8000-0000000071c5', '99999999-0000-4000-8000-0000000071e6', '99999999-0000-4000-8000-0000000071f1', 2000000, 'UZS', 'submitted', '99999999-0000-4000-8000-0000000071b3');
select set_config('tci.internal_call', '', true);

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('tci.resolving_validation', '', true);
  perform set_config('tci.committee_resolution', '', true);
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
    raise exception 'authority_levels: % refused with % (%) instead of % %', p_label, v_state, v_msg, p_state, coalesce(p_fragment, '');
  end;
  raise exception 'authority_levels: % was NOT refused', p_label;
end $$;
grant execute on function pg_temp.refused(text, text, text, text) to authenticated;

create function pg_temp.level(p_stream text, p_rank int) returns uuid language sql as $$
  select id from tci.authority_levels where stream::text = p_stream and rank = p_rank
$$;
grant execute on function pg_temp.level(text, int) to authenticated;

do $$
declare
  c_c1    constant uuid := '99999999-0000-4000-8000-0000000071a1';
  c_c2    constant uuid := '99999999-0000-4000-8000-0000000071a2';
  c_c3    constant uuid := '99999999-0000-4000-8000-0000000071a3';
  c_m1    constant uuid := '99999999-0000-4000-8000-0000000071b1';
  c_m2    constant uuid := '99999999-0000-4000-8000-0000000071b2';
  c_m3    constant uuid := '99999999-0000-4000-8000-0000000071b3';
  c_m4    constant uuid := '99999999-0000-4000-8000-0000000071b4';
  c_sales constant uuid := '99999999-0000-4000-8000-0000000071a6';
  c_comm  constant uuid := '99999999-0000-4000-8000-0000000071a7';
  c_admin constant uuid := '99999999-0000-4000-8000-0000000071a8';
  c_r1    constant uuid := '99999999-0000-4000-8000-0000000071c1';
  c_r2    constant uuid := '99999999-0000-4000-8000-0000000071c2';
  c_r3    constant uuid := '99999999-0000-4000-8000-0000000071c3';
  c_r4    constant uuid := '99999999-0000-4000-8000-0000000071c4';
  c_r5    constant uuid := '99999999-0000-4000-8000-0000000071c5';
  v       jsonb;
  v_val   uuid;
  v_val2  uuid;
  v_dec   tci.credit_limit_decisions%rowtype;
  v_task  uuid;
begin
  -- 1. Setting up the levels is admin's, and checked.
  perform pg_temp.act(c_c1);
  perform pg_temp.refused(format('select tci.add_authority_level_member(%L, %L)', pg_temp.level('credit', 1), c_c1),
                          '42501', 'a member added by a non-admin');
  perform pg_temp.refused('select tci.set_authority_routing(''sequential'')', '42501', 'routing set by a non-admin');
  perform pg_temp.act(c_admin);
  perform tci.save_authority_level_grant(pg_temp.level('credit', 1), 'unrated', 100000, 'UZS');
  perform tci.save_authority_level_grant(pg_temp.level('credit', 2), 'unrated', 300000, 'UZS');
  perform tci.save_authority_level_grant(pg_temp.level('credit', 3), 'unrated', 200000, 'UZS');
  -- a new grant replaces the live one for the band
  perform tci.save_authority_level_grant(pg_temp.level('credit', 3), 'unrated', 500000, 'UZS');
  perform set_config('role', 'postgres', true);
  if (select count(*) from tci.authority_level_grants
       where level_id = pg_temp.level('credit', 3) and (valid_to is null or valid_to >= current_date)) <> 1 then
    raise exception 'authority_levels: a level grant was not replaced';
  end if;
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('select tci.save_authority_level_grant(%L, ''unrated'', 1, ''UZS'')', pg_temp.level('credit', 5)),
                          'P0001', 'a cap on the committee', 'committee_unlimited');
  perform tci.add_authority_level_member(pg_temp.level('credit', 1), c_c1);
  perform tci.add_authority_level_member(pg_temp.level('credit', 2), c_c2);
  perform tci.add_authority_level_member(pg_temp.level('credit', 3), c_c3);
  perform pg_temp.refused(format('select tci.add_authority_level_member(%L, %L)', pg_temp.level('credit', 2), c_c1),
                          'P0001', 'a second rank in one stream', 'level_member_one_rank');
  perform pg_temp.refused(format('select tci.add_authority_level_member(%L, %L)', pg_temp.level('credit', 2), c_comm),
                          'P0001', 'a member of another department', 'level_member_wrong_department');
  perform tci.add_authority_level_member(pg_temp.level('credit', 5), c_m1);
  perform tci.add_authority_level_member(pg_temp.level('credit', 5), c_m2);
  perform tci.add_authority_level_member(pg_temp.level('credit', 5), c_m3);
  perform tci.add_authority_level_member(pg_temp.level('credit', 5), c_m4);
  -- a committee seat besides a rank is allowed
  perform tci.add_authority_level_member(pg_temp.level('credit', 5), c_c3);
  perform pg_temp.refused(format('select tci.set_committee_chair(%L, %L)', pg_temp.level('credit', 5), c_c2),
                          'P0001', 'a chair who is not a member', 'chair_not_member');
  perform tci.set_committee_chair(pg_temp.level('credit', 5), c_m1);
  perform pg_temp.refused('select tci.set_authority_routing(''both'')', 'P0001', 'an unknown routing', 'authority_routing_invalid');
  -- the level's authority counts as the member's
  perform pg_temp.act(c_c2);
  if tci.my_authority_uzs('unrated') <> 300000 then
    raise exception 'authority_levels: the level authority does not count (%)', tci.my_authority_uzs('unrated');
  end if;
  -- a stream without levels has nowhere to go
  perform pg_temp.act(c_comm);
  v := tci.validation_route_preview(c_r1, 'commercial', 'unrated', 900000, 'UZS');
  if (v ->> 'available')::boolean then
    raise exception 'authority_levels: an empty stream offered a route: %', v;
  end if;

  -- 2. Sequential routing: rank by rank; an approval beyond the approver's
  --    own authority goes on to the next rank.
  perform pg_temp.act(c_admin);
  perform tci.set_authority_routing('sequential');
  perform pg_temp.act(c_c1);
  v := tci.submit_limit_for_validation(c_r1, null, 'approved', 400000, 'UZS', current_date, null, '[]'::jsonb, null);
  v_val := (v ->> 'validation_id')::uuid;
  if (v ->> 'rank')::int <> 2 then
    raise exception 'authority_levels: sequential routing skipped rank 2: %', v;
  end if;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from tci.tasks where task_type = 'limit_validation_fyi' and object_id = v_val) then
    raise exception 'authority_levels: sequential routing told a skipped rank';
  end if;
  perform pg_temp.act(c_c2);
  v := tci.resolve_limit_validation(v_val, 'approve', null, null, 'Fine from my side');
  if v ->> 'result' <> 'forwarded' or (v ->> 'rank')::int <> 3 then
    raise exception 'authority_levels: an approval beyond 300k was not passed to rank 3: %', v;
  end if;
  v_val2 := (v ->> 'validation_id')::uuid;
  perform pg_temp.act(c_c3);
  v := tci.resolve_limit_validation(v_val2, 'approve');
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from tci.credit_limit_decisions where id = (v ->> 'decision_id')::uuid
                  and decided_by = c_c3 and approved_amount = 400000 and validation_id = v_val2) then
    raise exception 'authority_levels: rank 3 did not decide the sequential chain';
  end if;

  -- 3. Direct routing: 2M is beyond every rank: the committee, ranks 2 and 3
  --    told for information.
  perform pg_temp.act(c_admin);
  perform tci.set_authority_routing('direct');
  perform pg_temp.act(c_c1);
  v := tci.submit_limit_for_validation(c_r2, null, 'approved', 2000000, 'UZS', current_date, null, '[]'::jsonb, null);
  v_val := (v ->> 'validation_id')::uuid;
  if (v ->> 'rank')::int <> 5 then
    raise exception 'authority_levels: 2M did not go to the committee: %', v;
  end if;
  perform set_config('role', 'postgres', true);
  if (select count(*) from tci.tasks where task_type = 'limit_validation_fyi' and object_id = v_val
        and target_user in (c_c2, c_c3)) <> 2 then
    raise exception 'authority_levels: the skipped ranks were not told';
  end if;
  if (select count(*) from tci.tasks where task_type = 'limit_validation' and object_id = v_val
        and title_key = 'agenda.tasks.limit_validation_committee' and status = 'open') <> 5 then
    raise exception 'authority_levels: every committee member should have the vote in the Agenda';
  end if;
  -- the information is read and put away by hand
  perform pg_temp.act(c_c2);
  select id into v_task from tci.tasks where task_type = 'limit_validation_fyi' and object_id = v_val and target_user = c_c2;
  perform tci.complete_task(v_task);

  -- The committee decides by vote, never by a single answer.
  perform pg_temp.act(c_m2);
  perform pg_temp.refused(format('select tci.resolve_limit_validation(%L, %L)', v_val, 'approve'), 'P0001',
                          'a single member answering for the committee', 'committee_votes_decide');
  -- A conflict bars the member.
  perform pg_temp.act(c_m4);
  perform pg_temp.refused(format('select tci.declare_committee_conflict(%L, '' '')', v_val), 'P0001',
                          'a conflict without a reason', 'committee_conflict_reason_required');
  perform tci.declare_committee_conflict(v_val, 'Board seat at the buyer''s parent');
  perform pg_temp.refused(format('select tci.cast_committee_vote(%L, ''approve'')', v_val), '42501',
                          'a conflicted member voting', 'committee_not_eligible');
  -- Electorate m1, m2, m3, c3 (4). One vote is not a quorum.
  perform pg_temp.act(c_m2);
  perform tci.cast_committee_vote(v_val, 'approve', null);
  perform pg_temp.refused(format('select tci.cast_committee_vote(%L, ''reject'', ''x'')', v_val), 'P0001',
                          'voting twice', 'committee_already_voted');
  perform pg_temp.act(c_m1);
  perform pg_temp.refused(format('select tci.close_committee_vote(%L)', v_val), 'P0001', 'closing without a quorum', 'committee_no_quorum');
  perform pg_temp.act(c_m3);
  perform pg_temp.refused(format('select tci.cast_committee_vote(%L, ''reject'')', v_val), 'P0001',
                          'rejecting without a reason', 'validation_comment_required');
  perform tci.cast_committee_vote(v_val, 'reject', 'Concentration');
  -- 1 : 1 with half voted — only the chair closes, and a tie without the
  -- chair's vote would go back to the author.
  perform pg_temp.refused(format('select tci.close_committee_vote(%L, ''x'')', v_val), '42501',
                          'a member closing while the chair sits', 'committee_chair_closes');
  perform pg_temp.act(c_m1);
  v := tci.validation_step_state(v_val);
  if not (v -> 'committee' ->> 'quorum_met')::boolean or (v -> 'committee' ->> 'electorate')::int <> 4
     or not (v -> 'committee' ->> 'i_may_close')::boolean or not (v -> 'committee' ->> 'i_may_vote')::boolean then
    raise exception 'authority_levels: the chair''s view of the vote is wrong: %', v -> 'committee';
  end if;
  perform pg_temp.refused(format('select tci.close_committee_vote(%L)', v_val), 'P0001',
                          'a tie returned without minutes', 'committee_comment_required');
  -- The chair votes approve: 2 : 1, approved, the decision is the chair's.
  perform tci.cast_committee_vote(v_val, 'approve', null);
  v := tci.close_committee_vote(v_val, 'Approved by majority');
  perform set_config('role', 'postgres', true);
  select * into v_dec from tci.credit_limit_decisions where id = (v ->> 'decision_id')::uuid;
  if v_dec.outcome <> 'approved' or v_dec.approved_amount <> 2000000 or v_dec.decided_by <> c_m1
     or v_dec.validation_id <> v_val then
    raise exception 'authority_levels: the committee''s approval is wrong: %', row_to_json(v_dec);
  end if;
  if exists (select 1 from tci.tasks where task_type = 'limit_validation' and object_id = v_val and status = 'open') then
    raise exception 'authority_levels: committee tasks stayed open after the vote';
  end if;
  -- Votes are records: never changed, never written directly.
  perform pg_temp.refused(format('update tci.committee_votes set vote = ''reject'' where validation_id = %L', v_val),
                          '42501', 'an owner changing a vote');
  perform pg_temp.act(c_m2);
  perform pg_temp.refused(format('insert into tci.committee_votes (validation_id, voter, vote) values (%L, %L, ''approve'')', v_val, c_m2),
                          '42501', 'a direct vote');

  -- 4. A tie is broken by the chair's vote: here a rejection.
  perform pg_temp.act(c_c1);
  v := tci.submit_limit_for_validation(c_r3, null, 'approved', 2000000, 'UZS', current_date, null, '[]'::jsonb, null);
  v_val := (v ->> 'validation_id')::uuid;
  perform pg_temp.act(c_m1);
  perform tci.cast_committee_vote(v_val, 'reject', 'Too large for the buyer');
  perform pg_temp.act(c_m2);
  perform tci.cast_committee_vote(v_val, 'approve', null);
  perform pg_temp.act(c_m3);
  perform tci.cast_committee_vote(v_val, 'abstain', null);
  perform pg_temp.act(c_m1);
  v := tci.close_committee_vote(v_val, 'Chair''s casting vote');
  if v ->> 'result' <> 'rejected' or v -> 'committee' ->> 'action' <> 'reject' then
    raise exception 'authority_levels: the chair''s casting vote did not decide the tie: %', v;
  end if;
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from tci.credit_limit_decisions where request_id = c_r3 and outcome = 'declined'
                  and decided_by = c_m1 and validation_id = v_val) then
    raise exception 'authority_levels: the committee''s rejection did not decline';
  end if;

  -- 5. The chair conflicted: any eligible member closes.
  perform pg_temp.act(c_c1);
  v := tci.submit_limit_for_validation(c_r4, null, 'approved', 2000000, 'UZS', current_date, null, '[]'::jsonb, null);
  v_val := (v ->> 'validation_id')::uuid;
  perform pg_temp.act(c_m1);
  perform tci.declare_committee_conflict(v_val, 'Related to the policyholder');
  perform pg_temp.act(c_m2);
  perform tci.cast_committee_vote(v_val, 'approve', null);
  perform pg_temp.act(c_m3);
  perform tci.cast_committee_vote(v_val, 'approve', null);
  v := tci.close_committee_vote(v_val, null);
  if v ->> 'result' <> 'approved' then
    raise exception 'authority_levels: a member could not close while the chair is conflicted: %', v;
  end if;

  -- 6. The requester never sits on their own request.
  perform pg_temp.act(c_c1);
  v := tci.submit_limit_for_validation(c_r5, null, 'approved', 2000000, 'UZS', current_date, null, '[]'::jsonb, null);
  v_val := (v ->> 'validation_id')::uuid;
  perform pg_temp.act(c_m1);
  v := tci.validation_step_state(v_val);
  if exists (select 1 from jsonb_array_elements(v -> 'answerers') a where (a ->> 'user_id')::uuid = c_m3) then
    raise exception 'authority_levels: the requester is offered a vote on their own request';
  end if;
  perform pg_temp.act(c_m3);
  perform pg_temp.refused(format('select tci.cast_committee_vote(%L, ''approve'')', v_val), '42501',
                          'the requester voting', 'committee_not_eligible');

  -- 7. Leaving the committee ends the chair; admin still decides nothing.
  perform pg_temp.act(c_admin);
  perform tci.end_authority_level_member((select id from tci.authority_level_members
                                           where level_id = pg_temp.level('credit', 5) and user_id = c_m1));
  perform set_config('role', 'postgres', true);
  if (select chair_id from tci.authority_levels where id = pg_temp.level('credit', 5)) is not null then
    raise exception 'authority_levels: a chair who left is still the chair';
  end if;
  perform pg_temp.act(c_admin);
  perform pg_temp.refused(format('select tci.cast_committee_vote(%L, ''approve'')', v_val), '42501', 'admin voting');
  perform set_config('role', 'postgres', true);
  perform set_config('tci.internal_call', '', true);

  raise notice 'authority_levels: OK — levels set up by admin and checked, level authority counts, sequential rank by rank with approvals passed on, direct to the covering level with skipped ranks told, the committee by vote only, conflicts barred, quorum, majority, the chair''s casting vote, a member closes when the chair cannot, the requester never sits, votes immutable';
end;
$$;

rollback;
