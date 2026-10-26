-- Tests for migration 0054: data requests, their routing to information
-- managers, the Agenda they drive, and the data freshness list.
--
--   psql -v ON_ERROR_STOP=1 -f tests/db/data_management.sql
--
-- One transaction, rolled back. API roles are impersonated; the
-- internal-call token is cleared at every actor switch. Every UPDATE carries
-- a WHERE clause (the canonical tooling holds one without).

\set ON_ERROR_STOP on
begin;

-- actors: two active information managers, a banned one (never picked), a
-- credit underwriter who asks, a commercial underwriter who must not see the
-- underwriter's requests, an admin and a client
insert into auth.users (id, email, banned_until) values
  ('99999999-0000-4000-8000-0000000002a1', 'd-im-a@t', null),
  ('99999999-0000-4000-8000-0000000002a2', 'd-im-b@t', null),
  ('99999999-0000-4000-8000-0000000002a3', 'd-im-banned@t', now() + interval '100 years'),
  ('99999999-0000-4000-8000-0000000002b1', 'd-credit@t', null),
  ('99999999-0000-4000-8000-0000000002b2', 'd-commercial@t', null),
  ('99999999-0000-4000-8000-0000000002b9', 'd-admin@t', null),
  ('99999999-0000-4000-8000-0000000002c1', 'd-client@t', null);
insert into tci.user_roles (user_id, role) values
  ('99999999-0000-4000-8000-0000000002a1', 'information_manager'),
  ('99999999-0000-4000-8000-0000000002a2', 'information_manager'),
  ('99999999-0000-4000-8000-0000000002a3', 'information_manager'),
  ('99999999-0000-4000-8000-0000000002b1', 'credit_underwriter'),
  ('99999999-0000-4000-8000-0000000002b2', 'commercial_underwriter'),
  ('99999999-0000-4000-8000-0000000002b9', 'admin'),
  ('99999999-0000-4000-8000-0000000002c1', 'client');

-- information managers outside the fixture are set aside for the
-- transaction (banned, rolled back), so the routing below is deterministic
update auth.users u set banned_until = now() + interval '1 day'
 where u.id in (select ur.user_id from tci.user_roles ur where ur.role = 'information_manager')
   and u.id not in ('99999999-0000-4000-8000-0000000002a1', '99999999-0000-4000-8000-0000000002a2',
                    '99999999-0000-4000-8000-0000000002a3');

-- a company already in the registry, by registration number
insert into tci.legal_entities (id, name, country_code, registration_number, created_by) values
  ('99999999-0000-4000-8000-0000000002e1', 'D Known LLC', 'UZ', 'D-REG-1', '99999999-0000-4000-8000-0000000002b9');

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('tci.internal_call', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

create temp table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

do $$
declare
  v_res   jsonb;
  v_res2  jsonb;
  v_req   tci.entity_requests%rowtype;
  v_n     int;
  v_task  tci.tasks%rowtype;
  v_first uuid;
begin
  -- 1. a credit underwriter asks for a company that is not there
  perform pg_temp.act('99999999-0000-4000-8000-0000000002b1');
  v_res := tci.request_entity('Delcreda MChJ', 'uz', null, 'Buyer of a prospect');
  if v_res ->> 'result' <> 'requested' or (v_res ->> 'request_number') !~ '^DR-\d{4}-\d{4}$' then
    raise exception 'data: first request %', v_res;
  end if;
  v_first := (v_res ->> 'assigned_to')::uuid;
  if v_first not in ('99999999-0000-4000-8000-0000000002a1', '99999999-0000-4000-8000-0000000002a2') then
    raise exception 'data: assigned to % — not an active information manager', v_first;
  end if;
  insert into t_ids values ('r1', (v_res ->> 'request_id')::uuid);

  -- the same company again (any case, any spacing) joins the open request
  v_res2 := tci.request_entity('  delcreda mchj ', 'UZ');
  if v_res2 ->> 'result' <> 'already_requested' or v_res2 ->> 'request_id' <> v_res ->> 'request_id' then
    raise exception 'data: a duplicate request was filed: %', v_res2;
  end if;

  -- a registration number we already hold points at the company instead
  v_res2 := tci.request_entity('Whatever', 'UZ', 'D-REG-1');
  if v_res2 ->> 'result' <> 'exists' or v_res2 ->> 'entity_id' <> '99999999-0000-4000-8000-0000000002e1' then
    raise exception 'data: a known registration number was requested: %', v_res2;
  end if;

  -- 2. the second request goes to the OTHER information manager (least loaded);
  --    the banned one is never picked
  v_res2 := tci.request_entity('Second Co', 'DE');
  if (v_res2 ->> 'assigned_to')::uuid = v_first
     or (v_res2 ->> 'assigned_to')::uuid = '99999999-0000-4000-8000-0000000002a3' then
    raise exception 'data: second request not balanced: %', v_res2;
  end if;
  insert into t_ids values ('r2', (v_res2 ->> 'request_id')::uuid);

  -- an unknown country and an empty name are refused by rule
  begin
    perform tci.request_entity('X', 'ZZ');
    raise exception 'data: unknown country accepted';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform tci.request_entity('   ', 'UZ');
    raise exception 'data: empty name accepted';
  exception when sqlstate 'P0001' then null;
  end;

  -- 3. the task is in the ASSIGNEE's Agenda, addressed to the person
  perform set_config('role', 'postgres', true);
  select * into v_task from tci.tasks
   where object_id = (select id from t_ids where k = 'r1') and status = 'open';
  if v_task.task_type::text <> 'entity_requested' or v_task.target_user <> v_first
     or v_task.target_role is distinct from 'information_manager' or v_task.priority::text <> 'high' then
    raise exception 'data: task %', row_to_json(v_task);
  end if;

  -- 4. who may do what
  perform pg_temp.act('99999999-0000-4000-8000-0000000002c1');
  begin
    perform tci.request_entity('Client Co', 'UZ');
    raise exception 'data: a client filed a request';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform tci.staff_directory();
    raise exception 'data: a client read the staff directory';
  exception when sqlstate '42501' then null;
  end;
  if exists (select 1 from tci.entity_requests) then
    raise exception 'data: a client can read requests';
  end if;

  perform pg_temp.act('99999999-0000-4000-8000-0000000002b1');
  begin
    perform tci.take_entity_request((select id from t_ids where k = 'r1'));
    raise exception 'data: an underwriter took a request';
  exception when sqlstate '42501' then null;
  end;
  select count(*) into v_n from tci.entity_requests;
  if v_n <> 2 then raise exception 'data: the requester sees % of their own 2 requests', v_n; end if;

  perform pg_temp.act('99999999-0000-4000-8000-0000000002b2');
  if exists (select 1 from tci.entity_requests) then
    raise exception 'data: a colleague can read someone else''s requests';
  end if;
  if not exists (select 1 from tci.staff_directory() d where d.user_id = '99999999-0000-4000-8000-0000000002a1')
     or exists (select 1 from tci.staff_directory() d where d.user_id = '99999999-0000-4000-8000-0000000002c1') then
    raise exception 'data: staff directory lists the wrong people';
  end if;

  -- 5. the other information manager takes request 1: the task moves
  perform pg_temp.act(case when v_first = '99999999-0000-4000-8000-0000000002a1'
                           then '99999999-0000-4000-8000-0000000002a2'::uuid
                           else '99999999-0000-4000-8000-0000000002a1'::uuid end);
  select count(*) into v_n from tci.entity_requests;
  if v_n <> 2 then raise exception 'data: an information manager sees % of 2 requests', v_n; end if;
  v_req := tci.take_entity_request((select id from t_ids where k = 'r1'));
  if v_req.assigned_to = v_first or v_req.status::text <> 'in_progress' then
    raise exception 'data: take %', row_to_json(v_req);
  end if;
  perform set_config('role', 'postgres', true);
  if (select count(*) from tci.tasks where object_id = v_req.id and status = 'open') <> 1
     or (select target_user from tci.tasks where object_id = v_req.id and status = 'open') <> v_req.assigned_to
     or (select status::text from tci.tasks where object_id = v_req.id and target_user = v_first) <> 'cancelled' then
    raise exception 'data: the task did not move with the request';
  end if;

  -- 6. resolving: created needs a company; a rejection needs a reason
  perform pg_temp.act(v_req.assigned_to);
  begin
    perform tci.resolve_entity_request(v_req.id, 'created', null, null);
    raise exception 'data: created without a company';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform tci.resolve_entity_request((select id from t_ids where k = 'r2'), 'rejected', null, '  ');
    raise exception 'data: rejected without a reason';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform tci.resolve_entity_request(v_req.id, 'updated', null, null);
    raise exception 'data: a company request ended as updated';
  exception when sqlstate 'P0001' then null;
  end;

  perform set_config('role', 'postgres', true);
  insert into tci.legal_entities (id, name, country_code, created_by)
  values ('99999999-0000-4000-8000-0000000002e2', 'Delcreda MChJ', 'UZ', v_req.assigned_to);
  perform pg_temp.act(v_req.assigned_to);
  v_req := tci.resolve_entity_request(v_req.id, 'created', '99999999-0000-4000-8000-0000000002e2', null);
  if v_req.status::text <> 'created' or v_req.entity_id <> '99999999-0000-4000-8000-0000000002e2'
     or v_req.resolved_at is null then
    raise exception 'data: resolve %', row_to_json(v_req);
  end if;
  begin
    perform tci.resolve_entity_request(v_req.id, 'rejected', null, 'again');
    raise exception 'data: a resolved request was resolved twice';
  exception when sqlstate 'P0001' then null;
  end;

  -- the assignee's task is done, and the requester is told
  perform set_config('role', 'postgres', true);
  if exists (select 1 from tci.tasks where object_id = v_req.id and status = 'open'
              and task_type::text = 'entity_requested') then
    raise exception 'data: the information manager''s task stayed open';
  end if;
  select * into v_task from tci.tasks where object_id = v_req.id and status = 'open';
  if v_task.task_type::text <> 'entity_request_resolved'
     or v_task.target_user <> '99999999-0000-4000-8000-0000000002b1'
     or v_task.title_key <> 'agenda.tasks.entity_request_resolved_created' then
    raise exception 'data: requester task %', row_to_json(v_task);
  end if;
  -- and closes it by hand — the one new manual type
  perform pg_temp.act('99999999-0000-4000-8000-0000000002b1');
  perform tci.complete_task(v_task.id);

  -- 7. reassigning: admin may not (0065: admin is technical); the holder
  --    hands request 2 to a named information manager; a
  --    non-information-manager cannot hold it
  perform pg_temp.act('99999999-0000-4000-8000-0000000002b9');
  begin
    perform tci.assign_entity_request((select id from t_ids where k = 'r2'), '99999999-0000-4000-8000-0000000002a1');
    raise exception 'data: admin reassigned a data request';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.act((select assigned_to from tci.entity_requests where id = (select id from t_ids where k = 'r2')));
  begin
    perform tci.assign_entity_request((select id from t_ids where k = 'r2'), '99999999-0000-4000-8000-0000000002b1');
    raise exception 'data: assigned to an underwriter';
  exception when sqlstate 'P0001' then null;
  end;
  v_req := tci.assign_entity_request((select id from t_ids where k = 'r2'), '99999999-0000-4000-8000-0000000002a1');
  if v_req.assigned_to <> '99999999-0000-4000-8000-0000000002a1' then
    raise exception 'data: reassign %', row_to_json(v_req);
  end if;
  v_req := tci.resolve_entity_request(v_req.id, 'rejected', null, 'Not a real company');
  if v_req.status::text <> 'rejected' then raise exception 'data: reject %', row_to_json(v_req); end if;

  -- 8. statements: one open request per company; it ends as updated
  perform pg_temp.act('99999999-0000-4000-8000-0000000002b2');
  v_res := tci.request_statements_update('99999999-0000-4000-8000-0000000002e1', 'FY2025 arrived by e-mail');
  v_res2 := tci.request_statements_update('99999999-0000-4000-8000-0000000002e1');
  if v_res ->> 'result' <> 'requested' or v_res2 ->> 'result' <> 'already_requested' then
    raise exception 'data: statements requests % / %', v_res, v_res2;
  end if;
  perform set_config('role', 'postgres', true);
  if (select task_type::text from tci.tasks where object_id = (v_res ->> 'request_id')::uuid and status = 'open')
     <> 'statements_requested' then
    raise exception 'data: statements task missing';
  end if;
  perform pg_temp.act((v_res ->> 'assigned_to')::uuid);
  v_req := tci.resolve_entity_request((v_res ->> 'request_id')::uuid, 'updated', null, null);
  if v_req.status::text <> 'updated' or v_req.entity_id <> '99999999-0000-4000-8000-0000000002e1' then
    raise exception 'data: statements resolve %', row_to_json(v_req);
  end if;

  -- 9. nobody active: the task goes to the ROLE and is not lost
  perform set_config('role', 'postgres', true);
  update auth.users set banned_until = now() + interval '1 day'
   where id in ('99999999-0000-4000-8000-0000000002a1', '99999999-0000-4000-8000-0000000002a2');
  perform pg_temp.act('99999999-0000-4000-8000-0000000002b1');
  v_res := tci.request_entity('Orphan Co', 'KZ');
  perform set_config('role', 'postgres', true);
  if v_res ->> 'assigned_to' is not null
     or (select target_role::text from tci.tasks where object_id = (v_res ->> 'request_id')::uuid and status = 'open')
        <> 'information_manager' then
    raise exception 'data: unassigned request %', v_res;
  end if;
end $$;

-- 10. data freshness: a company with an active policy and no statements
do $$
declare v_r record;
begin
  perform set_config('role', 'postgres', true);
  insert into tci.policies (id, entity_id, policy_number, product_structure, status, inception_date, expiry_date,
    currency_code, insured_percentage, nql_amount, premium_rate_pct, minimum_premium, discretionary_limit,
    waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency, created_by, max_liability_amount)
  values ('99999999-0000-4000-8000-0000000002f1', '99999999-0000-4000-8000-0000000002e1', 'D-1', 'whole_turnover',
    'draft', current_date - 30, current_date + 300, 'UZS', 90, 0, 0.15, 10000, 25000, 30, 60, 90, 'monthly',
    '99999999-0000-4000-8000-0000000002b9', 1000000);
  -- 0047: a policy is inserted as a draft; activating it here goes around the
  -- workflow on purpose, as the owner, for the fixture only.
  alter table tci.policies disable trigger user;
  update tci.policies set status = 'active' where id = '99999999-0000-4000-8000-0000000002f1';
  alter table tci.policies enable trigger user;

  perform pg_temp.act('99999999-0000-4000-8000-0000000002b2');
  select * into v_r from tci.v_data_freshness where entity_id = '99999999-0000-4000-8000-0000000002e1';
  if not found or v_r.reason <> 'no_statements' or not v_r.missing_address or not v_r.missing_industry
     or v_r.missing_registration or not v_r.is_policyholder then
    raise exception 'data: freshness row %', row_to_json(v_r);
  end if;
  perform pg_temp.act('99999999-0000-4000-8000-0000000002c1');
  if exists (select 1 from tci.v_data_freshness) then
    raise exception 'data: a client can read the freshness list';
  end if;
  perform set_config('role', 'postgres', true);
end $$;

do $$ begin raise notice 'data_management: OK — routing, duplicates, permissions, task moves, resolution, freshness'; end $$;
rollback;
