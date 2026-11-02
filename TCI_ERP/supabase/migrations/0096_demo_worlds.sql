-- What: DEMO DATA kept apart from real data in the one canonical project, as
--       the owner's sister app (mig-inward-re) does it:
--         1. Every business table gets is_demo. A person works in ONE world at a
--            time: tci.demo_mode() = their demo mode (user_profiles.ui_demo_mode,
--            switched in the user menu) — always on for a DEMO USER
--            (user_profiles.is_demo_user). A RESTRICTIVE row policy on every
--            business table shows and accepts only rows of the caller's world,
--            so lists, search, the Agenda, dashboards and every security_invoker
--            view follow without exception.
--         2. One guard trigger keeps the worlds apart: a row takes the world of
--            what it belongs to (every foreign key to another business table,
--            and a task's / event's object); its references must all be of one
--            world; is_demo never changes; outside trusted workflow code a
--            person writes only in their own world.
--         3. Demo companies are named «DEMO …», demo policies numbered
--            «DEMO-…» (checked).
--         4. Readers that run as the owner (SECURITY DEFINER) and pick a "grade
--            / category / flag in force" read the caller's world; demo users
--            are never routed real work (pickers, covering underwriters,
--            authority-level members, colleagues, hand-over).
--         5. The append-only guards let the controlled unload (0097) remove
--            demo rows, and nothing else.
--         6. Everything already in the database is TEST data (owner,
--            2026-11-02): it becomes demo data — the @demo.invalid accounts are
--            demo users, and the two real staff accounts start in demo mode so
--            they keep seeing it until they leave demo mode.
-- Why:  Prompt 32 (owner 2026-11-02): demo data that can be switched on and off,
--       never mixed with real data, so the system can be emptied for real use
--       with one switch and trained on safely.

-- ---------------------------------------------------------------------------
-- 1. Who is in which world
-- ---------------------------------------------------------------------------

alter table tci.user_profiles add column ui_demo_mode boolean not null default false;
alter table tci.user_profiles add column is_demo_user boolean not null default false;
comment on column tci.user_profiles.ui_demo_mode is
  '0096: the person works in the demo world (their own switch, user menu). Ignored for a demo user, who is always in it.';
comment on column tci.user_profiles.is_demo_user is
  '0096: a demo account (demo data set): always in the demo world, never routed real work, removed with the demo data. Written by the owner / the demo load, never through the API.';
-- 0048 reads user_profiles through column grants: the caller's own row (the
-- "read own" policy) and these two columns are what tci.demo_mode() reads.
grant select (ui_demo_mode, is_demo_user) on tci.user_profiles to authenticated;
grant update (ui_demo_mode) on tci.user_profiles to authenticated;

alter table tci.workflow_settings add column new_users_demo_mode boolean not null default false;
alter table tci.workflow_settings add column demo_loaded_at timestamptz;
alter table tci.workflow_settings add column demo_loaded_by uuid references auth.users (id);
comment on column tci.workflow_settings.new_users_demo_mode is
  '0096: a new login starts in demo mode (mig-inward-re''s setting; off by default here — admin switches it on for a training period).';

-- The caller's world. SECURITY INVOKER on purpose: it reads only the caller's
-- own profile row, which the "read own" policy shows; inside definer code it
-- reads the same row as the owner. No user (a job, the service role) = real.
create function tci.demo_mode() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select p.is_demo_user or p.ui_demo_mode
                     from tci.user_profiles p where p.user_id = (select auth.uid())), false)
$$;
revoke all on function tci.demo_mode() from public, anon;
grant execute on function tci.demo_mode() to authenticated, service_role;

-- Whether a person may be given work in the caller's world: in the real world,
-- never a demo user.
create function tci.user_in_world(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select tci.demo_mode()
      or not coalesce((select p.is_demo_user from tci.user_profiles p where p.user_id = p_user), false)
$$;
revoke all on function tci.user_in_world(uuid) from public, anon, authenticated;
grant execute on function tci.user_in_world(uuid) to service_role;

-- New logins start in the mode the setting says (missing = off).
create function tci.new_user_demo_mode() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.new_users_demo_mode from tci.workflow_settings s where s.id), false)
$$;
revoke all on function tci.new_user_demo_mode() from public, anon, authenticated;
grant execute on function tci.new_user_demo_mode() to service_role;
alter table tci.user_profiles alter column ui_demo_mode set default tci.new_user_demo_mode();

-- ---------------------------------------------------------------------------
-- 2. The flag
--
-- Added with DEFAULT TRUE: every row already there is test data and becomes
-- demo data without an UPDATE (so no immutability trigger fires); new rows
-- then default to the writer's world.
-- ---------------------------------------------------------------------------

create function tci.demo_world_tables() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'legal_entities', 'financial_statements', 'balance_sheets', 'income_statements', 'local_statement_values',
    'credit_assessments', 'entity_relationships', 'entity_relationship_suggestions', 'entity_beneficial_owners',
    'entity_agency_ratings', 'entity_requests', 'buyer_adt', 'buyer_adt_blocks', 'auto_decision_attempts',
    'group_limits', 'group_ratings', 'sanction_flags', 'sanctions_screenings', 'sanctions_matches',
    'policyholder_tier_overrides', 'policyholder_users', 'client_buyer_proposals',
    'policies', 'policy_status_history', 'policy_documents', 'premium_instalments', 'premium_entries',
    'premium_payments', 'bank_statement_imports', 'bank_statement_lines', 'declarations', 'declaration_lines',
    'overdue_notifications', 'claims', 'claim_invoices', 'claim_invoice_verdicts', 'claim_payments',
    'claim_status_history', 'claim_documents', 'recoveries',
    'insurance_requests', 'insurance_request_buyers', 'insurance_request_history',
    'commercial_offers', 'commercial_offer_versions',
    'contract_drafts', 'contract_versions', 'contract_draft_comments', 'contract_draft_status_history',
    'credit_limit_requests', 'credit_limit_decisions', 'decision_conditions', 'limit_validations',
    'committee_votes', 'committee_conflicts', 'limit_information_waivers', 'limit_request_amendments',
    'rating_proposals', 'rating_proposal_steps', 'rating_votes', 'rating_conflicts',
    'sector_reviews', 'country_risk_overrides',
    'tasks', 'task_comments', 'task_transfers', 'workflow_events']
$$;
revoke all on function tci.demo_world_tables() from public, anon;
grant execute on function tci.demo_world_tables() to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array tci.demo_world_tables() loop
    execute format('alter table tci.%I add column is_demo boolean not null default true', t);
    execute format('alter table tci.%I alter column is_demo set default tci.demo_mode()', t);
    execute format('create index %I on tci.%I (is_demo)', t || '_is_demo_idx', t);
  end loop;
end $$;

-- Shared objects (lists, sectors, OECD imports) are nobody's demo: their
-- reminders and their imports' events are real.
update tci.workflow_events set is_demo = false
 where object_type in ('sanctions_list', 'country_risk_import', 'country_risk_list') and is_demo;
update tci.tasks set is_demo = false
 where object_type in ('sanctions_list', 'country_risk_import', 'country_risk_list') and is_demo;

-- ---------------------------------------------------------------------------
-- 3. The links the guard follows
-- ---------------------------------------------------------------------------

create table tci.demo_links (
  tbl        text not null,
  col        text not null,
  parent     text not null,
  parent_col text not null,
  primary key (tbl, col)
);
comment on table tci.demo_links is
  '0096: every single-column foreign key from a business table to another business table — the guard takes a row''s world from them. Rebuilt by tci.refresh_demo_links() (a migration that adds a business table or link calls it).';
alter table tci.demo_links enable row level security;
revoke all on tci.demo_links from anon, authenticated;
grant select on tci.demo_links to service_role;

create function tci.refresh_demo_links() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform tci.require_internal_call();
  truncate tci.demo_links;
  insert into tci.demo_links (tbl, col, parent, parent_col)
  select cl.relname, a.attname, pl.relname, pa.attname
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_class pl on pl.oid = c.confrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
   where c.contype = 'f' and c.connamespace = 'tci'::regnamespace
     and array_length(c.conkey, 1) = 1
     and cl.relname = any (tci.demo_world_tables())
     and pl.relname = any (tci.demo_world_tables());
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function tci.refresh_demo_links() from public, anon, authenticated;

select set_config('tci.internal_call', tci.internal_call_token(), true);
select tci.refresh_demo_links();
select set_config('tci.internal_call', '', true);

-- The table a task's / event's object lives in (null: a shared object).
create function tci.demo_object_table(p_object_type text) returns text
language sql immutable set search_path = '' as $$
  select case p_object_type
    when 'claim' then 'claims'
    when 'client_buyer_proposal' then 'client_buyer_proposals'
    when 'commercial_offer' then 'commercial_offers'
    when 'contract_draft' then 'contract_drafts'
    when 'credit_assessment' then 'credit_assessments'
    when 'credit_limit_decision' then 'credit_limit_decisions'
    when 'credit_limit_request' then 'credit_limit_requests'
    when 'declaration' then 'declarations'
    when 'entity_request' then 'entity_requests'
    when 'insurance_request' then 'insurance_requests'
    when 'legal_entity' then 'legal_entities'
    when 'overdue_notification' then 'overdue_notifications'
    when 'policy' then 'policies'
    when 'premium_instalment' then 'premium_instalments'
    when 'rating_proposal' then 'rating_proposals'
    when 'rating_proposal_step' then 'rating_proposal_steps'
    when 'limit_validation' then 'limit_validations'
    when 'sanction_flag' then 'sanction_flags'
    when 'sanctions_match' then 'sanctions_matches'
    when 'sector_review' then 'sector_reviews'
    when 'country_risk_override' then 'country_risk_overrides'
    when 'bank_statement_import' then 'bank_statement_imports'
  end
$$;
revoke all on function tci.demo_object_table(text) from public, anon;
grant execute on function tci.demo_object_table(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The guard
-- ---------------------------------------------------------------------------

-- The unload (0097) is the only thing that removes demo rows from the
-- append-only tables: it marks the transaction AND carries the internal token.
-- SECURITY INVOKER: the guards that ask it are invoker trigger functions, and
-- it reads nothing but the transaction's own settings.
create function tci.demo_unload_active() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('tci.demo_unload', true), '') = 'on' and tci.internal_call_ok()
$$;
revoke all on function tci.demo_unload_active() from public, anon;
grant execute on function tci.demo_unload_active() to authenticated, service_role;

create function tci.demo_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row     jsonb;
  v_world   boolean;
  v_w       boolean;
  v_link    record;
  v_val     text;
  v_table   text;
  v_trusted boolean := tci.internal_call_ok();
  v_person  boolean := (select auth.uid()) is not null;
begin
  if tg_op = 'DELETE' then
    if tci.demo_unload_active() and not old.is_demo then
      raise exception 'demo_unload_real_row: the demo unload never removes real data (%)', tg_table_name
        using errcode = '42501';
    end if;
    if v_person and not v_trusted and old.is_demo <> tci.demo_mode() then
      raise exception 'demo_world_wrong_mode: this row belongs to the other world' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and new.is_demo is distinct from old.is_demo then
    raise exception 'demo_world_immutable: a row never moves between demo and real data' using errcode = '42501';
  end if;

  -- the world of what the row belongs to; all of it one world
  v_row := to_jsonb(new);
  for v_link in select l.col, l.parent, l.parent_col from tci.demo_links l where l.tbl = tg_table_name loop
    v_val := v_row ->> v_link.col;
    continue when v_val is null;
    execute format('select is_demo from tci.%I where %I = $1::uuid', v_link.parent, v_link.parent_col)
      into v_w using v_val;
    continue when v_w is null;
    if v_world is null then
      v_world := v_w;
    elsif v_world <> v_w then
      raise exception 'demo_world_mixed: % links demo and real data (%)', tg_table_name, v_link.col
        using errcode = '23514';
    end if;
  end loop;

  if tg_table_name in ('tasks', 'workflow_events') then
    v_table := tci.demo_object_table(v_row ->> 'object_type');
    if v_table is not null and v_row ->> 'object_id' is not null then
      execute format('select is_demo from tci.%I where id = $1::uuid', v_table) into v_w using v_row ->> 'object_id';
      if v_w is not null then
        if v_world is not null and v_world <> v_w then
          raise exception 'demo_world_mixed: % links demo and real data (object)', tg_table_name using errcode = '23514';
        end if;
        v_world := v_w;
      end if;
    elsif v_row ->> 'object_type' in ('sanctions_list', 'country_risk_import', 'country_risk_list') then
      v_world := false;      -- the official lists and the OECD list are real
    end if;
  end if;

  if v_world is not null then
    if tg_op = 'UPDATE' and v_world <> old.is_demo then
      raise exception 'demo_world_mixed: % would link to the other world', tg_table_name using errcode = '23514';
    end if;
    new.is_demo := v_world;
  end if;

  -- a real task is never addressed to a demo person (it falls back to the
  -- department): lazy real-world tasks can be opened while a demo user acts
  if tg_table_name = 'tasks' and not new.is_demo and v_row ->> 'target_user' is not null
     and exists (select 1 from tci.user_profiles p
                  where p.user_id = (v_row ->> 'target_user')::uuid and p.is_demo_user) then
    new.target_user := null;
    if new.target_role is null then
      new.status := 'cancelled';
    end if;
  end if;

  -- recognisable in every list, screenshot and export
  if tg_table_name = 'legal_entities' then
    if new.is_demo and new.name not like 'DEMO %' then
      new.name := 'DEMO ' || new.name;
    elsif not new.is_demo and new.name like 'DEMO %' then
      raise exception 'demo_name_reserved: names starting with «DEMO » are reserved for demo data' using errcode = '23514';
    end if;
  elsif tg_table_name = 'policies' then
    if new.is_demo and new.policy_number not like 'DEMO-%' then
      new.policy_number := 'DEMO-' || new.policy_number;
    elsif not new.is_demo and new.policy_number like 'DEMO-%' then
      raise exception 'demo_name_reserved: policy numbers starting with «DEMO-» are reserved for demo data' using errcode = '23514';
    end if;
  end if;

  -- outside trusted workflow code a person writes only in their own world
  if v_person and not v_trusted and new.is_demo <> tci.demo_mode() then
    raise exception 'demo_world_wrong_mode: you are in % mode: this row is %',
      case when tci.demo_mode() then 'demo' else 'normal' end,
      case when new.is_demo then 'demo data' else 'real data' end
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function tci.demo_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Existing test data is demo data: names and numbers say so
-- ---------------------------------------------------------------------------

alter table tci.legal_entities disable trigger user;
update tci.legal_entities set name = 'DEMO ' || name where is_demo and name not like 'DEMO %';
alter table tci.legal_entities enable trigger user;
alter table tci.policies disable trigger user;
update tci.policies set policy_number = 'DEMO-' || policy_number where is_demo and policy_number not like 'DEMO-%';
alter table tci.policies enable trigger user;

alter table tci.legal_entities add constraint legal_entities_demo_name check ((name like 'DEMO %') = is_demo);
alter table tci.policies add constraint policies_demo_number check ((policy_number like 'DEMO-%') = is_demo);

do $$
declare t text;
begin
  foreach t in array tci.demo_world_tables() loop
    -- «zz» so it runs after the tables' own BEFORE triggers (numbering, defaults)
    execute format('create trigger zz_demo_guard before insert or update or delete on tci.%I '
                   'for each row execute function tci.demo_guard()', t);
    -- who sees and writes what: one restrictive policy per business table
    execute format('alter table tci.%I enable row level security', t);
    execute format('create policy %I on tci.%I as restrictive for all to authenticated '
                   'using (is_demo = (select tci.demo_mode())) with check (is_demo = (select tci.demo_mode()))',
                   t || ': demo world', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. People: the demo accounts and the two real staff accounts
-- ---------------------------------------------------------------------------

update tci.user_profiles p set is_demo_user = true
  from auth.users u
 where u.id = p.user_id and lower(u.email) like '%@demo.invalid' and not p.is_demo_user;
insert into tci.user_profiles (user_id, full_name, must_change_password, is_demo_user, ui_demo_mode)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)), false, true, true
  from auth.users u
 where lower(u.email) like '%@demo.invalid'
   and not exists (select 1 from tci.user_profiles p where p.user_id = u.id);
-- the real staff accounts keep seeing what they saw (all of it test data)
update tci.user_profiles p set ui_demo_mode = true
  from auth.users u
 where u.id = p.user_id and not p.is_demo_user and not p.ui_demo_mode
   and lower(u.email) not like '%@demo.invalid'
   and exists (select 1 from tci.user_roles r where r.user_id = p.user_id);

-- ---------------------------------------------------------------------------
-- 7. The append-only guards let the controlled unload remove demo rows
--
-- Rebuilt from their own definitions by one textual change each (as 0065,
-- 0067 and 0095 did): the body starts with "a demo row under the unload
-- passes". Each change must apply exactly once.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn  regprocedure;
  v_def text;
  v_new text;
begin
  foreach v_fn in array array[
    'tci.guard_workflow_write()'::regprocedure,
    'tci.refuse_contract_history_change()'::regprocedure,
    'tci.guard_limit_request_amendment()'::regprocedure,
    'tci.guard_sanction_flag()'::regprocedure,
    'tci.guard_sector_review()'::regprocedure,
    'tci.guard_country_override()'::regprocedure,
    'tci.task_comments_immutable()'::regprocedure]
  loop
    v_def := pg_get_functiondef(v_fn);
    if v_def !~ E'\\$function\\$\\s*begin\\s' and v_def !~ E'\\$function\\$\\s*declare\\s' then
      raise exception '0096: % does not start where it was written', v_fn;
    end if;
    -- after the first «begin» of the body
    v_new := regexp_replace(v_def, E'(\\$function\\$(?:\\s*declare[\\s\\S]*?)?\\s*begin)',
      E'\\1\n  if tg_op = ''DELETE'' and old.is_demo and tci.demo_unload_active() then\n    return old;\n  end if;', '');
    if v_new = v_def then
      raise exception '0096: no change in %', v_fn;
    end if;
    execute v_new;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Readers that run as the owner read the caller's world; demo users are
--    never routed real work
-- ---------------------------------------------------------------------------

create function pg_temp.patch(p_fn regprocedure, p_from text, p_to text, p_times integer default 1)
returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn);
begin
  if (length(v_def) - length(replace(v_def, p_from, ''))) / length(p_from) <> p_times then
    raise exception '0096: % does not contain % exactly % time(s)', p_fn, p_from, p_times;
  end if;
  execute replace(v_def, p_from, p_to);
end $$;

-- the grade / category / flag in force is the caller's world's
select pg_temp.patch('tci.sector_current_review(uuid)',
  'where r.sector_id = p_sector and r.status = ''approved''',
  'where r.sector_id = p_sector and r.status = ''approved'' and r.is_demo = tci.demo_mode()');
select pg_temp.patch('tci.country_risk(character)',
  'where o.country_code = p_country and o.status = ''approved'')',
  'where o.country_code = p_country and o.status = ''approved'' and o.is_demo = tci.demo_mode())');
select pg_temp.patch('tci.cover_required_rank_internal(uuid)',
  'where o.country_code = v_country and o.status = ''approved'')',
  'where o.country_code = v_country and o.status = ''approved'' and o.is_demo = tci.demo_mode())');
select pg_temp.patch('tci.cover_concentration(uuid, uuid)',
  'where o.country_code = e.country_code and o.status = ''approved'')',
  'where o.country_code = e.country_code and o.status = ''approved'' and o.is_demo = e.is_demo)');
select pg_temp.patch('tci.country_risk_changes(jsonb)',
  'join tci.legal_entities e on e.id = v.entity_id' || E'\n' || '     where v.outcome',
  'join tci.legal_entities e on e.id = v.entity_id and e.is_demo = tci.demo_mode()' || E'\n' || '     where v.outcome');
select pg_temp.patch('tci.country_risk_changes(jsonb)',
  'o.country_code::text = ch.country_code and o.status = ''approved''',
  'o.country_code::text = ch.country_code and o.status = ''approved'' and o.is_demo = tci.demo_mode()');
-- a country flag counts in its own world (a company flag is the company's)
select pg_temp.patch('tci.cover_block_internal(uuid)',
  'where f.scope = ''country'' and e.id = p_entity',
  'where f.scope = ''country'' and e.id = p_entity and f.is_demo = e.is_demo');
select pg_temp.patch('tci.buyer_risk_context(uuid)',
  '(f.scope = ''country'' and f.country_code = v_e.country_code))',
  '(f.scope = ''country'' and f.country_code = v_e.country_code and f.is_demo = v_e.is_demo))');
select pg_temp.patch('tci.set_sanction_flag(text, character, uuid, text, text, text, date, text)',
  'where v.outcome in (''approved'', ''partial'') and v.policy_id is not null',
  'where v.outcome in (''approved'', ''partial'') and v.policy_id is not null and e.is_demo = v_flag.is_demo');
-- a sector downgrade lists the buyers of its own world
select pg_temp.patch('tci.sector_review_in_force(tci.sector_reviews, text)',
  'join tci.legal_entities e on e.id = v.entity_id',
  'join tci.legal_entities e on e.id = v.entity_id and e.is_demo = p_review.is_demo', 2);
-- the quarterly sector task, per world (the demo world only while demo data is loaded)
select pg_temp.patch('tci.refresh_sector_tasks()',
  'where t.task_type = ''sector_review_due'' and t.status = ''open''',
  'where t.task_type = ''sector_review_due'' and t.status = ''open'' and t.is_demo = tci.demo_mode()');
select pg_temp.patch('tci.refresh_sector_tasks()',
  'where r.sector_id = t.object_id and r.quarter_start = v_q',
  'where r.sector_id = t.object_id and r.quarter_start = v_q and r.is_demo = t.is_demo');
select pg_temp.patch('tci.refresh_sector_tasks()',
  'where s.analyst_id is not null',
  'where s.analyst_id is not null and tci.user_in_world(s.analyst_id)'
  || E'\n       and (not tci.demo_mode() or exists (select 1 from tci.legal_entities d where d.is_demo))');
select pg_temp.patch('tci.refresh_sector_tasks()',
  'where r.sector_id = s.id and r.quarter_start = v_q',
  'where r.sector_id = s.id and r.quarter_start = v_q and r.is_demo = tci.demo_mode()');
-- registry searches that run as the owner
select pg_temp.patch('tci.client_search_entities(text, integer)',
  'where tci.has_role(''client'')',
  'where tci.has_role(''client'') and e.is_demo = tci.demo_mode()');
select pg_temp.patch('tci.request_entity(text, text, text, text)',
  'where e.country_code = v_country and e.registration_number = v_reg;',
  'where e.country_code = v_country and e.registration_number = v_reg and e.is_demo = tci.demo_mode();');
select pg_temp.patch('tci.request_entity(text, text, text, text)',
  'where r.kind = ''new_company'' and r.status in (''new'', ''in_progress'')',
  'where r.kind = ''new_company'' and r.status in (''new'', ''in_progress'') and r.is_demo = tci.demo_mode()');
-- covering underwriters
select pg_temp.patch('tci.underwriters_covering(tci.grade_band, numeric, character)',
  'where ur.role = ''credit_underwriter''',
  'where ur.role = ''credit_underwriter'' and tci.user_in_world(ur.user_id)');

-- every «active person» filter: in the real world, never a demo user
do $$
declare
  v_fn  regprocedure;
  v_def text;
  v_new text;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'tci'::regnamespace
       and p.proname in ('check_validator', 'level_eligible_members', 'may_take_task', 'pick_credit_analyst',
                         'pick_information_manager', 'rating_colleagues_excluding',
                         'rating_level_members_excluding', 'task_transfer_candidates', 'validation_candidates')
  loop
    v_def := pg_get_functiondef(v_fn);
    v_new := regexp_replace(v_def, E'(\\w+)\\.banned_until <= now\\(\\)\\)',
                            E'\\1.banned_until <= now()) and tci.user_in_world(\\1.id)', 'g');
    if v_new = v_def then
      raise exception '0096: no active-person filter in %', v_fn;
    end if;
    execute v_new;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Admin: what is there, and proof the worlds never touch
-- ---------------------------------------------------------------------------

create function tci.demo_data_counts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t     text;
  n     bigint;
  v_out jsonb := '{}'::jsonb;
begin
  perform tci.require_role('admin');
  foreach t in array tci.demo_world_tables() loop
    execute format('select count(*) from tci.%I where is_demo', t) into n;
    v_out := v_out || jsonb_build_object(t, n);
  end loop;
  return jsonb_build_object(
    'tables', v_out,
    'demo_users', (select count(*) from tci.user_profiles p where p.is_demo_user),
    'loaded_at', (select s.demo_loaded_at from tci.workflow_settings s where s.id),
    'loaded_by', (select s.demo_loaded_by from tci.workflow_settings s where s.id),
    'new_users_demo_mode', (select s.new_users_demo_mode from tci.workflow_settings s where s.id),
    'loaded', exists (select 1 from tci.legal_entities e where e.is_demo));
end $$;
revoke all on function tci.demo_data_counts() from public, anon;
grant execute on function tci.demo_data_counts() to authenticated;

-- One row per link that crosses worlds (empty = clean).
create function tci.demo_link_violations()
returns table (tbl text, col text, parent text, row_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_link record;
  n      bigint;
begin
  perform tci.require_role('admin');
  for v_link in select l.tbl, l.col, l.parent, l.parent_col from tci.demo_links l order by 1, 2 loop
    execute format('select count(*) from tci.%I c join tci.%I p on p.%I = c.%I where c.is_demo <> p.is_demo',
                   v_link.tbl, v_link.parent, v_link.parent_col, v_link.col) into n;
    if n > 0 then
      tbl := v_link.tbl; col := v_link.col; parent := v_link.parent; row_count := n;
      return next;
    end if;
  end loop;
  for tbl in select unnest(array['tasks', 'workflow_events']) loop
    execute format('select count(*) from tci.%I x where tci.demo_object_table(x.object_type) is not null '
                   'and x.object_id is not null and tci.demo_object_world(x.object_type, x.object_id) is distinct from x.is_demo '
                   'and tci.demo_object_world(x.object_type, x.object_id) is not null', tbl) into n;
    if n > 0 then
      col := 'object_id'; parent := '(object)'; row_count := n;
      return next;
    end if;
  end loop;
  select 'legal_entities', 'name', '(DEMO prefix)', count(*) into tbl, col, parent, row_count
    from tci.legal_entities e where (e.name like 'DEMO %') <> e.is_demo;
  if row_count > 0 then return next; end if;
end $$;
revoke all on function tci.demo_link_violations() from public, anon;
grant execute on function tci.demo_link_violations() to authenticated;

create function tci.demo_object_world(p_object_type text, p_object_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_table text := tci.demo_object_table(p_object_type);
  v_w     boolean;
begin
  if v_table is null or p_object_id is null then
    return null;
  end if;
  execute format('select is_demo from tci.%I where id = $1', v_table) into v_w using p_object_id;
  return v_w;
end $$;
revoke all on function tci.demo_object_world(text, uuid) from public, anon, authenticated;

-- The admin's switch for new logins.
create function tci.set_new_users_demo_mode(p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform tci.require_role('admin');
  if p_on is null then
    raise exception 'new_users_demo_mode: on or off' using errcode = 'P0001';
  end if;
  update tci.workflow_settings set new_users_demo_mode = p_on where id;
  return p_on;
end $$;
revoke all on function tci.set_new_users_demo_mode(boolean) from public, anon;
grant execute on function tci.set_new_users_demo_mode(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Checks
-- ---------------------------------------------------------------------------

do $$
declare
  t     text;
  v_bad text;
  n     bigint;
begin
  -- every business table: the flag, the guard and the restrictive policy
  foreach t in array tci.demo_world_tables() loop
    if not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'tci' and c.table_name = t and c.column_name = 'is_demo') then
      raise exception '0096: % has no is_demo', t;
    end if;
    if not exists (select 1 from pg_trigger g where g.tgrelid = ('tci.' || t)::regclass and g.tgname = 'zz_demo_guard') then
      raise exception '0096: % has no demo guard', t;
    end if;
    if not exists (select 1 from pg_policy p where p.polrelid = ('tci.' || t)::regclass
                    and p.polname = t || ': demo world' and not p.polpermissive) then
      raise exception '0096: % has no restrictive demo policy', t;
    end if;
  end loop;
  -- every foreign key between business tables is followed
  select string_agg(cl.relname || '.' || a.attname, ', ') into v_bad
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_class pl on pl.oid = c.confrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.connamespace = 'tci'::regnamespace
     and cl.relname = any (tci.demo_world_tables()) and pl.relname = any (tci.demo_world_tables())
     and not exists (select 1 from tci.demo_links l where l.tbl = cl.relname and l.col = a.attname);
  if v_bad is not null then
    raise exception '0096: links not followed: %', v_bad;
  end if;
  -- the existing data is all of one world per link
  select count(*) into n from tci.legal_entities where not is_demo;
  if n > 0 then
    raise exception '0096: % real companies found; this migration expects only test data', n;
  end if;
  if exists (select 1 from tci.legal_entities e where (e.name like 'DEMO %') <> e.is_demo) then
    raise exception '0096: a company name does not say its world';
  end if;
  -- the readers run only as the owner or as trusted code
  if has_function_privilege('authenticated', 'tci.user_in_world(uuid)', 'execute')
     or has_function_privilege('authenticated', 'tci.demo_guard()', 'execute') then
    raise exception '0096: an internal demo function is executable by authenticated';
  end if;
  if (select prosecdef from pg_proc where oid = 'tci.demo_mode()'::regprocedure) then
    raise exception '0096: tci.demo_mode must be SECURITY INVOKER (it reads only the caller''s row)';
  end if;
  -- every append-only guard lets the unload through, and only the unload
  select string_agg(p.proname, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'tci'::regnamespace
     and p.proname in ('guard_workflow_write', 'refuse_contract_history_change', 'guard_limit_request_amendment',
                       'guard_sanction_flag', 'guard_sector_review', 'guard_country_override', 'task_comments_immutable')
     and p.prosrc not like '%old.is_demo and tci.demo_unload_active()%';
  if v_bad is not null then
    raise exception '0096: no unload passage in %', v_bad;
  end if;
end $$;
