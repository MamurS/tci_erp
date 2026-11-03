-- canonical-apply-0096-0098.sql — the owner's step for migrations 0096–0098
-- (demo data, guided tour) on the canonical project (tci_erp, ref
-- reunqrpeumokqgarknge). Run it in the Supabase SQL Editor of that project.
--
-- Why yours: the MCP tooling held 0096 (it names DELETE / DROP inside function
-- bodies) for an approval question that got no answer (2026-11-02).
--
-- What it does: applies 0096 (every business table gets is_demo; the existing
-- test data becomes the DEMO world — its companies renamed «DEMO …», policy
-- numbers «DEMO-…»; the 13 @demo.invalid accounts become demo accounts and the
-- two staff accounts start in demo mode; the SECTOR GRADES stay real and are
-- shared by both worlds), 0097 (the load / unload functions — it LOADS NOTHING;
-- admin loads the demo book from Admin › «Демо-данные») and 0098 (tour
-- progress), checks that no row was added or lost, records the three files in
-- the migration ledger, and ends with ONE RESULT TABLE: per table, the rows and
-- how many of them are now demo (the editor shows only the last result).
--
-- HOW TO RUN:
--   1. Run it AS IS. It ends in ROLLBACK: a dry run, nothing is kept. Read the
--      result table.
--   2. If it looks right, change the LAST LINE from `rollback;` to `commit;`
--      and run it again.
-- One transaction: if any check fails, nothing is changed. Delete this file
-- once it has been committed and verified.

begin;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version in ('20261102130000','20261102140000','20261102150000')) then
    raise exception 'already applied: 0096–0098 are in the ledger — stop';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where name = '0095_sanctions_feed_account') then
    raise exception '0095 is not in the ledger — stop and ask';
  end if;
end $$;

create temp table _rows_before on commit drop as
select c.relname::text as tbl, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from tci.%I', c.relname), false, true, '')))[1]::text::bigint as n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
 where s.nspname = 'tci' and c.relkind in ('r', 'p');

-- ======================================================================
-- 0096_demo_worlds.sql  (md5 4cb62666617f28d50ed56973d3135c84)
-- ======================================================================
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
--            they keep seeing it until they leave demo mode. The sector
--            grades are the exception (owner, 2026-11-03): sector reviews are
--            SHARED, like the sanctions and OECD lists — both worlds read the
--            same grade, and nobody writes one from the demo world.
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
    'country_risk_overrides',
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

-- Shared objects (the sanctions lists, the OECD lists, the sectors and their
-- reviews) are nobody's demo: both worlds read them, and their reminders and
-- events are real. A real task is never addressed to a demo account (see the
-- guard): the ones already addressed to one go back to their department.
update tci.workflow_events set is_demo = false
 where object_type in ('sanctions_list', 'country_risk_import', 'country_risk_list', 'sector') and is_demo;
update tci.tasks set is_demo = false
 where object_type in ('sanctions_list', 'country_risk_import', 'country_risk_list', 'sector') and is_demo;
update tci.tasks t set target_user = null
  from auth.users u
 where u.id = t.target_user and lower(u.email) like '%@demo.invalid'
   and t.object_type in ('sanctions_list', 'country_risk_import', 'country_risk_list', 'sector')
   and t.target_role is not null;

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
    elsif v_row ->> 'object_type' in ('sanctions_list', 'country_risk_import', 'country_risk_list', 'sector') then
      v_world := false;      -- the official lists, the OECD list and the sectors are shared, so real
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
-- Sector reviews are SHARED (owner 2026-11-03): both worlds read the same
-- grade. Their downgrade task is real, so it lists real buyers only; the
-- quarterly task goes to a real analyst (a demo account is never routed real work).
select pg_temp.patch('tci.sector_review_in_force(tci.sector_reviews, text)',
  'join tci.legal_entities e on e.id = v.entity_id',
  'join tci.legal_entities e on e.id = v.entity_id and not e.is_demo', 2);
select pg_temp.patch('tci.refresh_sector_tasks()',
  'where s.analyst_id is not null',
  'where s.analyst_id is not null'
  || E'\n       and not coalesce((select p.is_demo_user from tci.user_profiles p where p.user_id = s.analyst_id), false)');

-- A sector review is real data: nobody writes one from the demo world, where
-- it would look like demo data and change the grade every real decision reads.
create function tci.sector_review_real_only() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is not null and tci.demo_mode() then
    raise exception 'demo_shared_write: sector grades are shared with real data; leave demo mode to review a sector'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function tci.sector_review_real_only() from public, anon;
grant execute on function tci.sector_review_real_only() to authenticated, service_role;
create trigger sector_reviews_real_only before insert or update on tci.sector_reviews
  for each row execute function tci.sector_review_real_only();
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
                       'guard_sanction_flag', 'guard_country_override', 'task_comments_immutable')
     and p.prosrc not like '%old.is_demo and tci.demo_unload_active()%';
  if v_bad is not null then
    raise exception '0096: no unload passage in %', v_bad;
  end if;
end $$;

-- ======================================================================
-- 0097_demo_seed.sql  (md5 f8c1fa20d087caad6f05e0033d52033b)
-- ======================================================================
-- What: LOAD and UNLOAD the demo data (admin, Администрирование › Демо-данные).
--         * tci.seed_demo_data(p_password) builds a coherent demo world
--           through the system's own workflow functions, acting as DEMO USERS
--           (one per role, @demo.invalid, created when missing): companies in
--           several countries and sectors with three years of statements,
--           ratings (confirmed, unconfirmed, a manual proposal at a colleague),
--           (sector grades are shared, not seeded), a country override waiting for the
--           head of credit analysis, policies in every status with premium
--           paid / partly paid / overdue and declarations, limit requests at
--           every stage — decided within authority, escalated up the levels
--           and approved, at the committee with votes cast, a commercial
--           increase on validation, held, declined, information gathering —
--           a corporate group over its limit, an overdue notification that
--           became a claim, submissions with offers and a contract draft, data
--           requests and a client's buyer proposal; then the lazy Agenda. All
--           dates are relative to today. Idempotent: while demo data is
--           loaded it changes nothing and answers the counts.
--         * tci.delete_demo_data() removes every demo row, and only demo rows,
--           in one controlled transaction (the only way the append-only tables
--           lose a row, 0096), removes the demo users (or, when a real record
--           still names one, strips their roles and bans them), and answers
--           the counts before and after.
-- Why:  Prompt 32 (owner 2026-11-02): one switch to fill the system for
--       training and screenshots and to empty it for real use.

-- ---------------------------------------------------------------------------
-- 1. Demo people
-- ---------------------------------------------------------------------------

create function tci.demo_people()
returns table (key text, full_name text, role tci.user_role)
language sql immutable set search_path = '' as $$
  values
    ('sales',            'Dilnoza Karimova',   'sales'::tci.user_role),
    ('commercial',       'Rustam Aliyev',      'commercial_underwriter'),
    ('commercial.head',  'Timur Abdullaev',    'commercial_underwriter'),
    ('credit.junior',    'Bekzod Tursunov',    'credit_underwriter'),
    ('credit',           'Nodira Yusupova',    'credit_underwriter'),
    ('credit.head',      'Akmal Rashidov',     'credit_underwriter'),
    ('credit.director',  'Shahnoza Mirzaeva',  'credit_underwriter'),
    ('analyst.senior',   'Gulnora Ergasheva',  'credit_analyst'),
    ('analyst',          'Jasur Khodjaev',     'credit_analyst'),
    ('info',             'Malika Nazarova',    'information_manager'),
    ('claims',           'Sardor Rakhimov',    'claims'),
    ('client',           'Aziz Saidov',        'client'),
    ('client.pharma',    'Lola Usmonova',      'client')
$$;
revoke all on function tci.demo_people() from public, anon;
grant execute on function tci.demo_people() to authenticated, service_role;

create function tci._demo_user(p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = 'demo.' || p_key || '@demo.invalid'
$$;
revoke all on function tci._demo_user(text) from public, anon, authenticated;

-- Act as a demo user (or, with null, as the admin who asked).
create function tci._demo_act(p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_key is null then
    v_id := nullif(current_setting('tci.demo_caller', true), '')::uuid;
  else
    v_id := tci._demo_user(p_key);
  end if;
  if v_id is null then
    raise exception 'demo user % is missing', p_key using errcode = 'P0002';
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  return v_id;
end $$;
revoke all on function tci._demo_act(text) from public, anon, authenticated;

-- Insert the given values into the columns the table has (generated columns
-- skipped): the same code serves Supabase's auth schema and the replay stub.
create function tci._demo_insert(p_schema text, p_table text, p_values jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_cols text;
  v_sel  text;
begin
  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position),
         string_agg(format('r.%I', c.column_name), ', ' order by c.ordinal_position)
    into v_cols, v_sel
    from information_schema.columns c
   where c.table_schema = p_schema and c.table_name = p_table and p_values ? c.column_name
     and c.is_generated = 'NEVER';
  execute format('insert into %I.%I (%s) select %s from jsonb_populate_record(null::%I.%I, $1) r',
                 p_schema, p_table, v_cols, v_sel, p_schema, p_table) using p_values;
end $$;
revoke all on function tci._demo_insert(text, text, jsonb) from public, anon, authenticated;

-- The demo accounts: created when missing, revived when a previous unload kept
-- them, always demo users, one role each. The password is set only when given.
create function tci._demo_ensure_people(p_password text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r      record;
  v_id   uuid;
  v_mail text;
  v_vals jsonb;
  v_new  integer := 0;
begin
  for r in select * from tci.demo_people() loop
    v_mail := 'demo.' || r.key || '@demo.invalid';
    select u.id into v_id from auth.users u where lower(u.email) = v_mail;
    if v_id is null then
      v_id := gen_random_uuid();
      -- exactly the columns GoTrue fills for an e-mail login (docs/create-user.sql),
      -- limited to those this database has (the replay harness stubs auth)
      v_vals := jsonb_build_object(
        'instance_id', '00000000-0000-0000-0000-000000000000', 'id', v_id, 'aud', 'authenticated',
        'role', 'authenticated', 'email', v_mail,
        'encrypted_password', extensions.crypt(coalesce(p_password, encode(extensions.gen_random_bytes(24), 'base64')),
                                               extensions.gen_salt('bf', 10)),
        'email_confirmed_at', now(), 'created_at', now(), 'updated_at', now(),
        'raw_app_meta_data', '{"provider":"email","providers":["email"]}'::jsonb,
        'raw_user_meta_data', jsonb_build_object('full_name', r.full_name),
        'confirmation_token', '', 'recovery_token', '', 'email_change_token_new', '', 'email_change', '',
        'email_change_token_current', '', 'phone_change', '', 'phone_change_token', '', 'reauthentication_token', '',
        'is_sso_user', false, 'is_anonymous', false);
      perform tci._demo_insert('auth', 'users', v_vals);
      perform tci._demo_insert('auth', 'identities', jsonb_build_object(
        'provider_id', v_id::text, 'user_id', v_id,
        'identity_data', jsonb_build_object('sub', v_id::text, 'email', v_mail, 'email_verified', true),
        'provider', 'email', 'created_at', now(), 'updated_at', now()));
      v_new := v_new + 1;
    else
      update auth.users set banned_until = null where id = v_id and banned_until is not null;
      if p_password is not null then
        update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10))
         where id = v_id;
      end if;
    end if;
    insert into tci.user_profiles (user_id, full_name, must_change_password, is_demo_user, ui_demo_mode)
    values (v_id, r.full_name, false, true, true)
    on conflict (user_id) do update
      set is_demo_user = true, ui_demo_mode = true, must_change_password = false,
          full_name = coalesce(tci.user_profiles.full_name, excluded.full_name);
    if not exists (select 1 from tci.user_roles ur where ur.user_id = v_id and ur.role = r.role) then
      insert into tci.user_roles (user_id, role) values (v_id, r.role);
    end if;
  end loop;
  update tci.user_profiles set senior_credit_analyst = true
   where user_id = tci._demo_user('analyst.senior') and not senior_credit_analyst;
  return v_new;
end $$;
revoke all on function tci._demo_ensure_people(text) from public, anon, authenticated;

-- The authority levels the demo escalations climb. Levels are shared
-- configuration: a missing level grant gets a default; demo people are seated
-- where they are not yet (in the real world nobody routes to them, 0096).
create function tci._demo_ensure_levels() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      record;
  v_lvl  uuid;
begin
  -- band authority per rank, in USD (rank 5 is the committee: unlimited)
  for r in select * from (values
      ('credit', 1, 'A', 250000), ('credit', 1, 'B', 120000), ('credit', 1, 'C', 40000), ('credit', 1, 'D', 10000), ('credit', 1, 'unrated', 5000),
      ('credit', 2, 'A', 1000000), ('credit', 2, 'B', 500000), ('credit', 2, 'C', 150000), ('credit', 2, 'D', 30000), ('credit', 2, 'unrated', 20000),
      ('credit', 3, 'A', 3000000), ('credit', 3, 'B', 1500000), ('credit', 3, 'C', 500000), ('credit', 3, 'D', 100000), ('credit', 3, 'unrated', 50000),
      ('credit', 4, 'A', 10000000), ('credit', 4, 'B', 5000000), ('credit', 4, 'C', 1500000), ('credit', 4, 'D', 300000), ('credit', 4, 'unrated', 150000),
      ('commercial', 1, 'A', 250000), ('commercial', 1, 'B', 120000), ('commercial', 1, 'C', 40000), ('commercial', 1, 'D', 10000), ('commercial', 1, 'unrated', 5000),
      ('commercial', 2, 'A', 800000), ('commercial', 2, 'B', 400000), ('commercial', 2, 'C', 120000), ('commercial', 2, 'D', 25000), ('commercial', 2, 'unrated', 15000),
      ('commercial', 3, 'A', 2000000), ('commercial', 3, 'B', 1000000), ('commercial', 3, 'C', 300000), ('commercial', 3, 'D', 60000), ('commercial', 3, 'unrated', 30000),
      ('commercial', 4, 'A', 6000000), ('commercial', 4, 'B', 3000000), ('commercial', 4, 'C', 1000000), ('commercial', 4, 'D', 150000), ('commercial', 4, 'unrated', 50000)
    ) as t(stream, rank, band, amount) loop
    select l.id into v_lvl from tci.authority_levels l where l.stream::text = r.stream and l.rank = r.rank;
    continue when v_lvl is null;
    if not exists (select 1 from tci.authority_level_grants g
                    where g.level_id = v_lvl and g.grade_band::text = r.band
                      and (g.valid_to is null or g.valid_to >= current_date)) then
      perform tci.save_authority_level_grant(v_lvl, r.band::tci.grade_band, r.amount, 'USD');
    end if;
  end loop;

  for r in select * from (values
      ('credit', 1, 'credit.junior'), ('credit', 2, 'credit'), ('credit', 3, 'credit.head'), ('credit', 4, 'credit.director'),
      ('credit', 5, 'credit.director'), ('credit', 5, 'credit.head'), ('credit', 5, 'credit'),
      ('commercial', 2, 'commercial'), ('commercial', 4, 'commercial.head'),
      ('commercial', 5, 'commercial.head'), ('commercial', 5, 'commercial')
    ) as t(stream, rank, who) loop
    select l.id into v_lvl from tci.authority_levels l where l.stream::text = r.stream and l.rank = r.rank;
    continue when v_lvl is null;
    if not exists (select 1 from tci.authority_level_members m
                    where m.level_id = v_lvl and m.user_id = tci._demo_user(r.who)
                      and (m.valid_to is null or m.valid_to >= current_date)) then
      begin
        perform tci.add_authority_level_member(v_lvl, tci._demo_user(r.who));
      exception when others then
        raise notice 'demo seed: %', sqlerrm;
      end;
    end if;
  end loop;
  for r in select * from (values ('credit', 'credit.director'), ('commercial', 'commercial.head')) as t(stream, who) loop
    select l.id into v_lvl from tci.authority_levels l where l.stream::text = r.stream and l.rank = 5;
    continue when v_lvl is null;
    if (select l.chair_id from tci.authority_levels l where l.id = v_lvl) is null then
      begin
        perform tci.set_committee_chair(v_lvl, tci._demo_user(r.who));
      exception when others then
        raise notice 'demo seed: %', sqlerrm;
      end;
    end if;
  end loop;
end $$;
revoke all on function tci._demo_ensure_levels() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Building blocks
-- ---------------------------------------------------------------------------

-- A company with three annual statements (the last three calendar years) from
-- a size and a profile; the accounting identities hold.
create function tci._demo_company(
  p_name text, p_country char(2), p_industry text, p_form text, p_reg text, p_founded int,
  p_city text, p_revenue numeric, p_margin numeric, p_equity_ratio numeric, p_growth numeric,
  p_currency char(3), p_statements boolean default true)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_st   uuid;
  v_y    int := extract(year from current_date)::int;
  k      int;
  rev    numeric; cogs numeric; dist numeric; adm numeric; op numeric; fin numeric; pbt numeric; tax numeric; np numeric;
  ta numeric; eq numeric; nca numeric; ca numeric; inv numeric; rec numeric; cash numeric; ppe numeric;
  ltb numeric; stb numeric; pay numeric; tl numeric; cl numeric; ncl numeric; share numeric; ret numeric;
begin
  insert into tci.legal_entities (name, legal_form, country_code, industry_id, registration_number, founded_date,
                                  website, address, contact_person, contact_email, created_by)
  values (p_name, p_form, p_country, p_industry, p_reg, make_date(p_founded, 3, 1),
          'https://' || lower(regexp_replace(p_name, '[^A-Za-z]+', '', 'g')) || '.example',
          p_city || ', ' || p_country, 'Demo Contact', 'contact@' || lower(regexp_replace(p_name, '[^A-Za-z]+', '', 'g')) || '.example',
          (select auth.uid()))
  returning id into v_id;
  if not p_statements then
    return v_id;
  end if;
  for k in 1..3 loop
    rev  := round(p_revenue / power(1 + p_growth, k - 1));
    cogs := round(rev * (1 - p_margin - 0.09));
    dist := round(rev * 0.05);
    adm  := round(rev * 0.04);
    op   := rev - cogs - dist - adm;
    ta   := round(rev * 0.75);
    eq   := round(ta * p_equity_ratio);
    tl   := ta - eq;
    ltb  := round(tl * 0.35);
    ncl  := ltb;
    cl   := tl - ncl;
    stb  := round(cl * 0.4);
    pay  := cl - stb;
    fin  := round((ltb + stb) * 0.11);
    pbt  := op - fin;
    tax  := greatest(round(pbt * 0.15), 0);
    np   := pbt - tax;
    share := round(eq * 0.3);
    ret  := eq - share;
    ppe  := round(ta * 0.42);
    nca  := ppe;
    ca   := ta - nca;
    inv  := round(ca * 0.38);
    rec  := round(ca * 0.42);
    cash := ca - inv - rec;
    insert into tci.financial_statements (entity_id, statement_kind, fiscal_year, period_end_date, currency_code, unit,
                                          audited, source, accounting_basis, report_type, mapping_status, created_by)
    values (v_id, 'annual', v_y - k, make_date(v_y - k, 12, 31), p_currency, 'thousands', k > 1, 'demo',
            'ifrs', 'statutory', 'n/a', (select auth.uid()))
    returning id into v_st;
    insert into tci.balance_sheets (statement_id, property_plant_equipment, total_non_current_assets, inventories,
      trade_receivables, cash_and_equivalents, total_current_assets, total_assets, share_capital, retained_earnings,
      total_equity, long_term_borrowings, total_non_current_liabilities, short_term_borrowings, trade_payables,
      total_current_liabilities, total_liabilities, total_equity_and_liabilities)
    values (v_st, ppe, nca, inv, rec, cash, ca, ta, share, ret, eq, ltb, ncl, stb, pay, cl, tl, ta);
    insert into tci.income_statements (statement_id, revenue, cost_of_sales, gross_profit, distribution_expenses,
      administrative_expenses, operating_profit, finance_costs, profit_before_tax, income_tax, net_profit,
      depreciation_amortization)
    values (v_st, rev, cogs, rev - cogs, dist, adm, op, fin, pbt, tax, np, round(ppe * 0.08));
  end loop;
  return v_id;
end $$;
revoke all on function tci._demo_company(text, char, text, text, text, int, text, numeric, numeric, numeric, numeric, char, boolean) from public, anon, authenticated;

-- An engine-style rating on the company's latest statement (the analytics
-- service is not hosted: the demo writes what the engine would).
create function tci._demo_rating(p_entity uuid, p_grade text, p_score numeric, p_limit numeric, p_currency char(3))
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into tci.credit_assessments (entity_id, statement_id, rating_score, rating_grade, suggested_limit,
                                      limit_currency, inputs_snapshot, calculation_trace, engine_version, source,
                                      created_by)
  values (p_entity,
          (select s.id from tci.financial_statements s where s.entity_id = p_entity
            order by s.period_end_date desc limit 1),
          p_score, p_grade, p_limit, p_currency,
          jsonb_build_object('demo', true),
          jsonb_build_array(jsonb_build_object('step', 'demo', 'note', 'Demo rating (no engine run)')),
          'demo', 'engine', (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function tci._demo_rating(uuid, text, numeric, numeric, char) from public, anon, authenticated;

-- A policy, drafted by commercial underwriting and (unless p_status = draft)
-- put in force; then moved to its status.
create function tci._demo_policy(
  p_holder uuid, p_number text, p_currency char(3), p_inception int, p_months int, p_rate numeric,
  p_min_premium numeric, p_dl numeric, p_max_liability numeric, p_nql numeric,
  p_frequency tci.declaration_frequency, p_status tci.policy_status)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform tci._demo_act('commercial');
  insert into tci.policies (entity_id, policy_number, product_structure, status, inception_date, expiry_date,
    currency_code, insured_percentage, max_liability_amount, nql_amount, deductible_each_loss, premium_rate_pct,
    minimum_premium, estimated_annual_turnover, discretionary_limit, waiting_period_days, max_extension_period_days,
    max_payment_terms_days, declaration_frequency, created_by)
  values (p_holder, p_number, 'whole_turnover', 'draft', current_date + p_inception,
          (current_date + p_inception + make_interval(months => p_months))::date - 1,
          p_currency, 90, p_max_liability, p_nql, 0, p_rate, p_min_premium, round(p_min_premium / p_rate * 100),
          p_dl, 30, 90, 120, p_frequency, (select auth.uid()))
  returning id into v_id;
  if p_status <> 'draft' then
    perform tci.change_policy_status(v_id, 'active', null);
    if p_status <> 'active' then
      perform tci.change_policy_status(v_id, p_status,
        case p_status when 'cancelled' then 'Policyholder sold the business' else 'Demo' end);
    end if;
  end if;
  return v_id;
end $$;
revoke all on function tci._demo_policy(uuid, text, char, int, int, numeric, numeric, numeric, numeric, numeric, tci.declaration_frequency, tci.policy_status) from public, anon, authenticated;

-- A limit request raised by sales on a policy (or a submission) and submitted.
create function tci._demo_request(p_policy uuid, p_submission uuid, p_buyer uuid, p_amount numeric,
                                  p_currency char(3), p_terms int, p_why text, p_submit boolean default true)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform tci._demo_act('sales');
  insert into tci.credit_limit_requests (policy_id, insurance_request_id, entity_id, requested_amount, currency_code,
                                         requested_payment_terms_days, justification, status, requested_by)
  values (p_policy, p_submission, p_buyer, p_amount, p_currency, p_terms, p_why, 'draft', (select auth.uid()))
  returning id into v_id;
  if p_submit then
    perform tci.submit_limit_request(v_id);
  end if;
  return v_id;
end $$;
revoke all on function tci._demo_request(uuid, uuid, uuid, numeric, char, int, text, boolean) from public, anon, authenticated;

-- A credit decision by a named underwriter: taken into review and decided;
-- answers the decision (or, beyond their authority, the validation step).
create function tci._demo_decide(p_request uuid, p_who text, p_outcome tci.decision_outcome, p_amount numeric,
                                 p_comment text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res jsonb;
  v_req tci.credit_limit_requests%rowtype;
  v_assessment uuid;
begin
  perform tci._demo_act(p_who);
  select * into v_req from tci.credit_limit_requests where id = p_request;
  if v_req.status = 'submitted' then
    perform tci.start_limit_review(p_request);
  end if;
  -- the decision rests on the buyer's current rating (its band decides the authority)
  select a.id into v_assessment from tci.credit_assessments a where a.entity_id = v_req.entity_id
   order by a.created_at desc limit 1;
  v_res := tci.decide_limit_request(p_request, p_outcome, p_amount, v_req.currency_code, current_date,
                                    (current_date + interval '12 months')::date, '[]'::jsonb, p_comment, v_assessment);
  if v_res ->> 'result' = 'needs_validation' then
    v_res := tci.submit_limit_for_validation(p_request, null, p_outcome, p_amount, v_req.currency_code, current_date,
                                             (current_date + interval '12 months')::date, '[]'::jsonb, p_comment, v_assessment);
    v_res := v_res || jsonb_build_object('escalated', true);
  end if;
  return v_res;
end $$;
revoke all on function tci._demo_decide(uuid, text, tci.decision_outcome, numeric, text) from public, anon, authenticated;

-- The pending validation step of a request.
create function tci._demo_step(p_request uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select v.id from tci.limit_validations v where v.request_id = p_request and v.status = 'pending'
   order by v.created_at desc limit 1
$$;
revoke all on function tci._demo_step(uuid) from public, anon, authenticated;

-- The demo person seated at the rank a pending step sits with (credit stream).
create function tci._demo_rank_member(p_step uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case l.rank when 1 then 'credit.junior' when 2 then 'credit' when 3 then 'credit.head'
                     when 4 then 'credit.director' else null end
    from tci.limit_validations v join tci.authority_levels l on l.id = v.level_id
   where v.id = p_step
$$;
revoke all on function tci._demo_rank_member(uuid) from public, anon, authenticated;

create function tci._demo_effective_decision(p_request uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.id from tci.credit_limit_decisions d
   where d.request_id = p_request and d.lifecycle = 'effective'
   order by (d.stage = 'commercial') desc, d.decided_at desc limit 1
$$;
revoke all on function tci._demo_effective_decision(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The demo world
-- ---------------------------------------------------------------------------

create function tci._seed_demo_world() returns void
language plpgsql security definer set search_path = '' as $$
declare
  y        int := extract(year from current_date)::int;
  -- policyholders
  p_tex uuid; p_pha uuid; p_cop uuid; p_agr uuid;
  -- buyers
  b_alm uuid; b_ist uuid; b_mos uuid; b_ham uuid; b_sha uuid; b_dub uuid; b_bis uuid; b_bak uuid;
  b_kyi uuid; b_lon uuid; b_del uuid; g_par uuid; g_log uuid; g_con uuid;
  -- policies
  pl_tex uuid; pl_pha uuid; pl_cop uuid; pl_draft uuid; pl_old uuid; pl_cnc uuid;
  -- requests and the rest
  r uuid; r2 uuid; v jsonb; v_step uuid; v_dec uuid; v_noa uuid; v_claim uuid; v_decl uuid; v_sub uuid;
  v_offer uuid; v_tpl uuid; v_draft uuid; a_alm uuid; a_ist uuid; a_mos uuid; a_ham uuid; a_sha uuid;
  a_dub uuid; a_bis uuid; a_kyi uuid; a_lon uuid; a_del uuid; a_par uuid; a_log uuid; a_con uuid;
  v_inst record; n int := 0;
begin
  -- ---------------------------------------------------------- companies
  perform tci._demo_act('info');
  p_tex := tci._demo_company('Samarkand Textile MChJ', 'UZ', 'TEXT', 'MChJ', 'DEMO-305112847', 2009, 'Samarkand', 182000000, 0.21, 0.46, 0.09, 'UZS');
  p_pha := tci._demo_company('Tashkent Pharma Distribution MChJ', 'UZ', 'PHAR', 'MChJ', 'DEMO-307551863', 2015, 'Tashkent', 96000000, 0.24, 0.40, 0.14, 'UZS');
  p_cop := tci._demo_company('Navoi Copper Trade MChJ', 'UZ', 'METL', 'MChJ', 'DEMO-306991204', 2012, 'Navoi', 410000000, 0.17, 0.52, 0.06, 'UZS');
  p_agr := tci._demo_company('Fergana Agro Export AJ', 'UZ', 'AGRI', 'AJ', 'DEMO-302447019', 2004, 'Fergana', 64000000, 0.19, 0.38, 0.11, 'UZS');
  b_alm := tci._demo_company('Almaty Retail Group LLP', 'KZ', 'RETL', 'LLP', 'DEMO-KZ-120340018855', 2006, 'Almaty', 86000, 0.22, 0.48, 0.08, 'USD');
  b_ist := tci._demo_company('Istanbul Tekstil A.S.', 'TR', 'TEXT', 'A.S.', 'DEMO-TR-4410227', 1998, 'Istanbul', 54000, 0.18, 0.41, 0.05, 'USD');
  b_mos := tci._demo_company('Moscow Fabric Trading LLC', 'RU', 'TEXT', 'LLC', 'DEMO-RU-7701995512', 2011, 'Moscow', 38000, 0.12, 0.27, -0.04, 'USD');
  b_ham := tci._demo_company('Hamburg Metals GmbH', 'DE', 'METL', 'GmbH', 'DEMO-DE-HRB88127', 1987, 'Hamburg', 240000, 0.16, 0.55, 0.04, 'EUR');
  b_sha := tci._demo_company('Shanghai Copper Industries Co Ltd', 'CN', 'METL', 'Co Ltd', 'DEMO-CN-9131000077', 2003, 'Shanghai', 380000, 0.14, 0.36, 0.07, 'USD');
  b_dub := tci._demo_company('Dubai Pharma Wholesale LLC', 'AE', 'PHAR', 'LLC', 'DEMO-AE-778812', 2013, 'Dubai', 47000, 0.23, 0.44, 0.12, 'USD');
  b_bis := tci._demo_company('Bishkek Medical Supply LLC', 'KG', 'PHAR', 'LLC', 'DEMO-KG-01908', 2016, 'Bishkek', 9800, 0.15, 0.22, -0.08, 'USD');
  b_bak := tci._demo_company('Baku Trading House LLC', 'AZ', 'FOOD', 'LLC', null, 2018, 'Baku', 0, 0, 0, 0, 'USD', false);
  update tci.legal_entities set address = null where id = b_bak;
  b_kyi := tci._demo_company('Kyiv Agro Trade LLC', 'UA', 'AGRI', 'LLC', 'DEMO-UA-40118822', 2014, 'Kyiv', 15000, 0.07, 0.14, -0.15, 'USD');
  b_lon := tci._demo_company('London Steel Distributors Ltd', 'GB', 'METL', 'Ltd', 'DEMO-GB-08812345', 1992, 'London', 160000, 0.15, 0.50, 0.03, 'GBP');
  b_del := tci._demo_company('Delhi Textile Mills Pvt Ltd', 'IN', 'TEXT', 'Pvt Ltd', 'DEMO-IN-U17110DL', 2001, 'Delhi', 72000, 0.17, 0.43, 0.10, 'USD');
  g_par := tci._demo_company('Caspian Holding JSC', 'KZ', 'CNST', 'JSC', 'DEMO-KZ-990440012', 2000, 'Astana', 520000, 0.15, 0.47, 0.05, 'USD');
  g_log := tci._demo_company('Caspian Logistics LLP', 'KZ', 'TRAN', 'LLP', 'DEMO-KZ-150840021', 2010, 'Aktau', 61000, 0.13, 0.35, 0.06, 'USD');
  g_con := tci._demo_company('Caspian Construction LLP', 'KZ', 'CNST', 'LLP', 'DEMO-KZ-160240033', 2012, 'Atyrau', 93000, 0.12, 0.31, 0.02, 'USD');

  -- ---------------------------------------------------------- the group
  perform tci._demo_act('info');
  perform tci.save_entity_relationship(g_par, g_log, 'ownership', 100, current_date - 900, null, 'manual', 'Demo group');
  perform tci.save_entity_relationship(g_par, g_con, 'ownership', 75, current_date - 900, null, 'manual', 'Demo group');

  -- sectors: none of their own — sector grades are shared with real data
  -- (owner 2026-11-03), so the demo book is rated against the real grades

  -- ---------------------------------------------------------- country override waiting for the head of credit analysis
  perform tci._demo_act('analyst');
  begin
    perform tci.propose_country_override('KZ', 3::smallint,
      'Demo: strong payment experience with Kazakh buyers over three years justifies one category better than the OECD list.');
  exception when others then
    raise notice 'demo seed: %', sqlerrm;
  end;

  -- ---------------------------------------------------------- ratings
  perform tci._demo_act('analyst');
  a_alm := tci._demo_rating(b_alm, 'A2', 82, 400000, 'USD');
  a_ist := tci._demo_rating(b_ist, 'B1', 68, 180000, 'USD');
  a_mos := tci._demo_rating(b_mos, 'C1', 44, 40000, 'USD');
  a_ham := tci._demo_rating(b_ham, 'A1', 88, 2500000, 'EUR');
  a_sha := tci._demo_rating(b_sha, 'B2', 61, 1200000, 'USD');
  a_dub := tci._demo_rating(b_dub, 'B1', 70, 250000, 'USD');
  a_bis := tci._demo_rating(b_bis, 'C2', 37, 25000, 'USD');
  a_kyi := tci._demo_rating(b_kyi, 'D', 21, 0, 'USD');
  a_lon := tci._demo_rating(b_lon, 'A2', 80, 900000, 'GBP');
  a_del := tci._demo_rating(b_del, 'B1', 66, 220000, 'USD');
  a_par := tci._demo_rating(g_par, 'B1', 67, 1500000, 'USD');
  a_log := tci._demo_rating(g_log, 'B2', 58, 300000, 'USD');
  a_con := tci._demo_rating(g_con, 'B2', 55, 350000, 'USD');
  -- four eyes: a colleague confirms most ratings; Delhi stays unconfirmed
  perform tci._demo_act('analyst.senior');
  foreach r in array array[a_alm, a_ist, a_mos, a_ham, a_sha, a_dub, a_bis, a_kyi, a_lon, a_par, a_log, a_con] loop
    perform tci.confirm_rating(r, null, null);
  end loop;
  -- a manual rating sent to a named colleague (a rating_proposal task for Gulnora)
  perform tci._demo_act('analyst');
  begin
    perform tci.submit_rating_scorecard(p_pha,
      jsonb_build_object('grade', 'B1', 'reason', 'consistent_with_subgrades', 'pillars', jsonb_build_array(
        jsonb_build_object('pillar', 'general', 'grade', 'B1', 'weight', 25, 'reason', 'long_track_record'),
        jsonb_build_object('pillar', 'balance_sheet', 'grade', 'B1', 'weight', 30, 'reason', 'low_leverage'),
        jsonb_build_object('pillar', 'profit_loss', 'grade', 'B1', 'weight', 25, 'reason', 'stable_results'),
        jsonb_build_object('pillar', 'payment', 'grade', 'B1', 'weight', 20, 'reason', 'prompt_payment'))),
      'Demo: a policyholder we also rate as a buyer for its own suppliers.', 'colleague',
      tci._demo_user('analyst.senior'), null, null);
  exception when others then
    raise notice 'demo seed: %', sqlerrm;
  end;

  -- ---------------------------------------------------------- policies in every status
  pl_tex := tci._demo_policy(p_tex, 'TCI-' || y || '-0101', 'USD', -200, 12, 0.18, 24000, 20000, 1500000, 1000, 'quarterly', 'active');
  pl_pha := tci._demo_policy(p_pha, 'TCI-' || y || '-0102', 'EUR', -120, 12, 0.21, 18000, 15000, 900000, 1000, 'monthly', 'active');
  pl_cop := tci._demo_policy(p_cop, 'TCI-' || y || '-0103', 'USD', -300, 24, 0.12, 60000, 50000, 6000000, 2000, 'quarterly', 'active');
  pl_draft := tci._demo_policy(p_agr, 'TCI-' || y || '-0104', 'USD', 20, 12, 0.20, 12000, 10000, 500000, 1000, 'quarterly', 'draft');
  pl_old := tci._demo_policy(p_tex, 'TCI-' || (y - 1) || '-0042', 'USD', -560, 12, 0.19, 20000, 20000, 1200000, 1000, 'quarterly', 'expired');
  pl_cnc := tci._demo_policy(p_pha, 'TCI-' || (y - 1) || '-0057', 'EUR', -420, 12, 0.22, 15000, 10000, 600000, 1000, 'monthly', 'cancelled');

  -- the portal users of the two policyholders
  insert into tci.policyholder_users (entity_id, user_id, created_by)
  values (p_tex, tci._demo_user('client'), tci._demo_user('sales')),
         (p_pha, tci._demo_user('client.pharma'), tci._demo_user('sales'))
  on conflict do nothing;

  -- ---------------------------------------------------------- limits at every stage
  -- decided within authority (rank 1, band A), released after the sales window
  r := tci._demo_request(pl_tex, null, b_alm, 150000, 'USD', 90, 'Long-standing buyer of cotton yarn, 8 years without delays.');
  perform tci._demo_decide(r, 'credit.junior', 'approved', 150000, 'Within authority; strong A2 rating.');
  -- approved credit, commercial increase beyond the commercial underwriter's authority: on validation
  r := tci._demo_request(pl_tex, null, b_ist, 120000, 'USD', 90, 'Seasonal increase for the autumn collection.');
  perform tci._demo_decide(r, 'credit', 'approved', 120000, 'Approved as requested.');
  v_dec := tci._demo_effective_decision(r);
  perform tci._demo_act('commercial');
  begin
    v := tci.adjust_limit_commercial(v_dec, 450000, null, 'Key account: the policyholder doubled its volumes.');
    if v ->> 'result' = 'needs_validation' then
      perform tci.submit_adjustment_for_validation(v_dec, null, 450000, null,
        'Key account: the policyholder doubled its volumes; beyond my authority.');
    end if;
  exception when others then
    raise notice 'demo seed: %', sqlerrm;
  end;
  -- waiting for a decision (the credit queue)
  r := tci._demo_request(pl_tex, null, b_mos, 60000, 'USD', 60, 'New buyer after a trade fair in Moscow.');
  -- under review
  r := tci._demo_request(pl_tex, null, b_del, 90000, 'USD', 90, 'Replacement for a supplier that left the market.');
  perform tci._demo_act('credit.junior');
  perform tci.start_limit_review(r);
  -- escalated up the levels and approved by the rank that covers it
  r := tci._demo_request(pl_cop, null, b_ham, 1800000, 'EUR', 120, 'Annual cathode contract, two shipments a month.');
  v := tci._demo_decide(r, 'credit.junior', 'approved', 1800000, 'Beyond my authority: recommend approval.');
  v_step := tci._demo_step(r);
  if v_step is not null then
    for n in 1..3 loop
      v_step := tci._demo_step(r);
      exit when v_step is null;
      exit when tci._demo_rank_member(v_step) is null;
      begin
        perform tci._demo_act(tci._demo_rank_member(v_step));
        perform tci.resolve_limit_validation(v_step, 'approve', null, null, 'Agreed: A1 buyer, long relationship.', null);
      exception when others then
        raise notice 'demo seed: %', sqlerrm;
      end;
    end loop;
  end if;
  -- at the committee: two votes cast, the chair still to close
  r := tci._demo_request(pl_cop, null, b_sha, 9000000, 'USD', 120, 'Framework contract for copper concentrate.');
  v := tci._demo_decide(r, 'credit.head', 'approved', 9000000, 'Above every rank: for the committee.');
  for n in 1..4 loop
    v_step := tci._demo_step(r);
    exit when v_step is null
          or (select l.rank from tci.limit_validations lv join tci.authority_levels l on l.id = lv.level_id
               where lv.id = v_step) = 5;
    begin
      exit when tci._demo_rank_member(v_step) is null;
      perform tci._demo_act(tci._demo_rank_member(v_step));
      perform tci.resolve_limit_validation(v_step, 'forward', null, null, 'For the committee.', null);
    exception when others then
      raise notice 'demo seed: %', sqlerrm;
      exit;
    end;
  end loop;
  v_step := tci._demo_step(r);
  if v_step is not null then
    begin
      perform tci._demo_act('credit');
      perform tci.cast_committee_vote(v_step, 'approve', 'Diversified buyer, acceptable concentration.');
      perform tci._demo_act('credit.director');
      perform tci.cast_committee_vote(v_step, 'reject', 'Exposure to one buyer too high for our capital.');
    exception when others then
      raise notice 'demo seed: %', sqlerrm;
    end;
  end if;
  -- decided by the head of credit within the rank's authority
  r := tci._demo_request(pl_cop, null, b_lon, 700000, 'GBP', 90, 'UK distribution partner for rolled products.');
  perform tci._demo_decide(r, 'credit.head', 'approved', 700000, 'Within authority for an A2 buyer.');
  -- the group: two members approved, the group limit below their sum
  r := tci._demo_request(pl_cop, null, g_log, 250000, 'USD', 90, 'Freight forwarding for copper exports.');
  perform tci._demo_decide(r, 'credit', 'approved', 250000, 'Within authority.');
  r := tci._demo_request(pl_cop, null, g_con, 300000, 'USD', 90, 'Copper cable for the construction arm.');
  perform tci._demo_decide(r, 'credit', 'approved', 300000, 'Within authority.');
  perform tci._demo_act('credit.director');
  begin
    perform tci.set_group_limit(g_par, 400000, 'USD', current_date, 'Demo: group cap after the holding''s results.');
  exception when others then
    raise notice 'demo seed: %', sqlerrm;
  end;
  -- pharma: approved and held by commercial underwriting; declined; one in information gathering
  r := tci._demo_request(pl_pha, null, b_dub, 200000, 'EUR', 90, 'Distributor for the Gulf region.');
  perform tci._demo_decide(r, 'credit', 'approved', 200000, 'Approved.');
  v_dec := tci._demo_effective_decision(r);
  perform tci._demo_act('sales');
  begin
    perform tci.hold_decision(v_dec, 'Holding until the policyholder confirms the payment terms.');
  exception when others then
    raise notice 'demo seed: %', sqlerrm;
  end;
  r := tci._demo_request(pl_pha, null, b_kyi, 80000, 'EUR', 120, 'Agricultural inputs on long terms.');
  perform tci._demo_decide(r, 'credit', 'declined', null, 'D grade and negative equity trend: not insurable.');
  r := tci._demo_request(pl_pha, null, b_bak, 50000, 'EUR', 60, 'New buyer, no statements yet.');
  -- the buyer that will default
  r := tci._demo_request(pl_pha, null, b_bis, 20000, 'EUR', 60, 'Hospital supplies in Kyrgyzstan.');
  perform tci._demo_decide(r, 'credit.junior', 'approved', 20000, 'Small limit, C2 buyer.');

  -- ---------------------------------------------------------- an overdue notification that became a claim
  perform tci._demo_act('client.pharma');
  begin
    v := tci.file_overdue_notification(pl_pha, b_bis, current_date - 75, 18500, 'EUR');
    v_noa := (v ->> 'id')::uuid;
  exception when others then
    raise notice 'demo seed: %', sqlerrm;
    v_noa := null;
  end;
  if v_noa is null then
    select n.id into v_noa from tci.overdue_notifications n where n.policy_id = pl_pha and n.entity_id = b_bis
     order by n.created_at desc limit 1;
  end if;
  if v_noa is not null then
    perform tci._demo_act('claims');
    begin
      v_claim := (tci.open_claim(pl_pha, b_bis, 'protracted_default', v_noa, null)).id;
      perform tci.save_claim_invoice(v_claim, 'INV-BIS-' || y || '-114', current_date - 140, current_date - 138,
                                     current_date - 78, 11200);
      perform tci.save_claim_invoice(v_claim, 'INV-BIS-' || y || '-131', current_date - 120, current_date - 118,
                                     current_date - 58, 7300);
    exception when others then
      raise notice 'demo seed: %', sqlerrm;
    end;
  end if;

  -- a second notice, past its waiting period and not yet claimed: the claims
  -- desk and the policyholder are told it can be claimed (refresh_agenda)
  perform tci._demo_act('claims');
  begin
    perform tci.file_overdue_notification(pl_cop, b_lon, current_date - 45, 64000, 'GBP');
  exception when others then
    raise notice 'demo seed: %', sqlerrm;
  end;

  -- ---------------------------------------------------------- declarations and premium
  perform tci._demo_act('client');
  for n in 1..2 loop
    begin
      v := tci.client_open_declaration(pl_tex, (date_trunc('quarter', current_date - (n * 3 || ' months')::interval))::date);
      v_decl := (v ->> 'declaration_id')::uuid;
      perform tci.client_save_declaration_line(v_decl, b_alm, 410000 + n * 20000, 0, null);
      perform tci.client_save_declaration_line(v_decl, b_ist, 260000 - n * 15000, 0, null);
      perform tci.client_save_declaration_line(v_decl, b_mos, 55000, 0, 'No limit yet: within the discretionary limit.');
      perform tci.client_submit_declaration(v_decl);
      if n = 2 then
        perform tci._demo_act('commercial');
        perform tci.accept_declaration(v_decl);
        perform tci._demo_act('client');
      end if;
    exception when others then
      raise notice 'demo seed: %', sqlerrm;
    end;
  end loop;
  -- premium: textile — the first instalment paid, the second partly, the rest open
  -- (one overdue); copper, pharma and the closed policies — everything past due
  -- paid except pharma's latest month (overdue)
  perform tci._demo_act('commercial');
  n := 0;
  for v_inst in select i.id, i.amount, i.due_date from tci.premium_instalments i
                 where i.policy_id = pl_tex order by i.due_date, i.sequence limit 2 loop
    n := n + 1;
    begin
      perform tci.record_premium_payment(pl_tex, case when n = 1 then v_inst.amount else round(v_inst.amount * 0.4, 2) end,
                                         least(v_inst.due_date + 3, current_date), null, 'DEMO-PAY-' || n);
    exception when others then
      raise notice 'demo seed: %', sqlerrm;
    end;
  end loop;
  for v_inst in select i.policy_id, i.amount, i.due_date from tci.premium_instalments i
                 where i.policy_id in (pl_cop, pl_pha, pl_old, pl_cnc) and i.due_date < current_date
                   and i.status <> 'cancelled'
                   and not (i.policy_id = pl_pha and i.due_date = (select max(j.due_date) from tci.premium_instalments j
                                                                    where j.policy_id = pl_pha and j.due_date < current_date))
                 order by i.policy_id, i.due_date, i.sequence loop
    begin
      perform tci.record_premium_payment(v_inst.policy_id, v_inst.amount, least(v_inst.due_date + 5, current_date), null, null);
    exception when others then
      raise notice 'demo seed: %', sqlerrm;
    end;
  end loop;

  -- ---------------------------------------------------------- submissions, an offer, a contract draft
  perform tci._demo_act('sales');
  for n in 1..4 loop
    insert into tci.insurance_requests (entity_id, request_number, status, product_structure, currency_code,
      insured_percentage, premium_rate_pct, minimum_premium, max_liability_amount, discretionary_limit, nql_amount,
      waiting_period_days, max_extension_period_days, max_payment_terms_days, declaration_frequency,
      estimated_annual_turnover, created_by, created_by_role, assigned_sales, notes)
    values (case when n = 4 then p_cop else p_agr end, 'DEMO-IR-' || y || '-' || lpad(n::text, 3, '0'), 'draft',
            'whole_turnover', 'USD', 90, 0.20, 12000, 500000, 10000, 1000, 30, 90, 120, 'quarterly',
            6000000, (select auth.uid()), 'sales', (select auth.uid()), 'Demo submission')
    returning id into v_sub;
    insert into tci.insurance_request_buyers (request_id, entity_id, proposed_name, requested_amount,
                                              requested_payment_terms_days, resolution_status, created_by)
    values (v_sub, b_alm, null, 100000, 90, 'ready', (select auth.uid()));
    begin
      if n >= 2 then
        perform tci._demo_act('sales');
        perform tci.advance_insurance_request(v_sub, 'submitted', null);
        perform tci.advance_insurance_request(v_sub, 'entity_resolution', null);
        perform tci.advance_insurance_request(v_sub, 'underwriting', null);
        r := tci._demo_request(null, v_sub, b_alm, 100000, 'USD', 90, 'Package buyer of the submission.');
        perform tci._demo_decide(r, 'credit.junior', 'approved', 100000, 'Package buyer, A2: approved.');
        perform tci._demo_act('commercial');
        perform tci.advance_insurance_request(v_sub, 'commercial_review', null);
      end if;
      if n >= 3 then
        perform tci.advance_insurance_request(v_sub, 'sales_confirmation', 'Terms agreed.');
        perform tci._demo_act('sales');
        v_offer := (tci.create_commercial_offer(v_sub, 'ru',
          jsonb_build_object('kind', 'kp', 'template', 'tci', 'template_version', 1, 'cover', 'navy',
                             'note', 'Demo offer'), current_date + 30, true)).id;
        if n = 4 then
          perform tci.publish_offer(v_offer);
        end if;
      end if;
    exception when others then
      raise notice 'demo seed: %', sqlerrm;
    end;
  end loop;
  -- a contract draft for the textile policy, from the active template if there is one
  select t.id into v_tpl from tci.wording_templates t where t.status = 'active' order by t.version desc limit 1;
  if v_tpl is not null then
    perform tci._demo_act('commercial');
    begin
      v_draft := (tci.create_contract_draft(pl_tex, null, v_tpl, jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
        jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 2, 'numbered', true),
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Subject of the contract'))),
        jsonb_build_object('type', 'paragraph', 'attrs', jsonb_build_object('clause', true),
          'content', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', 'The insurer covers the policyholder''s receivables under policy '),
            jsonb_build_object('type', 'mergeField', 'attrs',
              jsonb_build_object('path', 'policy.number', 'index', null, 'value', 'DEMO-TCI-' || y || '-0101')))))),
        'Demo draft')).id;
      perform tci.change_contract_status(v_draft, 'under_review', 'Please review the demo draft.');
    exception when others then
      raise notice 'demo seed: %', sqlerrm;
    end;
  end if;

  -- ---------------------------------------------------------- data requests and a client's buyer proposal
  perform tci._demo_act('sales');
  perform tci.request_entity('Minsk Dairy Export OJSC', 'BY', null, 'Prospect buyer named by Fergana Agro.');
  perform tci._demo_act('credit');
  perform tci.request_statements_update(b_del, 'Need the latest annual accounts before deciding.');
  perform tci._demo_act('client');
  begin
    perform tci.client_request_limit(pl_tex, null, 'Tbilisi Wine Export LLC', null, 'GE', 30000, 'USD', 60,
                                     'New buyer for our home textiles.');
  exception when others then
    raise notice 'demo seed: %', sqlerrm;
  end;

  -- ---------------------------------------------------------- the lazy Agenda, for the demo world
  perform tci._demo_act('credit');
  perform tci.refresh_agenda();
end $$;
revoke all on function tci._seed_demo_world() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Load, unload
-- ---------------------------------------------------------------------------

create function tci.seed_demo_data(p_password text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := (select auth.uid());
  v_claims text := current_setting('request.jwt.claims', true);
  v_new    integer;
begin
  perform tci.require_role('admin');
  if p_password is not null and length(p_password) < 12 then
    raise exception 'demo_password_short: the demo password needs at least 12 characters' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.legal_entities e where e.is_demo) then
    return tci.demo_data_counts() || jsonb_build_object('already_loaded', true);
  end if;
  perform set_config('tci.demo_caller', v_caller::text, true);
  perform tci.begin_trusted_call();
  v_new := tci._demo_ensure_people(p_password);
  perform tci._demo_ensure_levels();
  perform tci._seed_demo_world();
  update tci.workflow_settings set demo_loaded_at = now(), demo_loaded_by = v_caller where id;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return tci.demo_data_counts() || jsonb_build_object('already_loaded', false, 'demo_users_created', v_new);
end $$;
revoke all on function tci.seed_demo_data(text) from public, anon;
grant execute on function tci.seed_demo_data(text) to authenticated;

create function tci.delete_demo_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_user   record;
  v_gone   integer := 0;
  v_kept   jsonb := '[]'::jsonb;
begin
  perform tci.require_role('admin');
  v_before := tci.demo_data_counts();
  perform tci.begin_trusted_call();
  perform set_config('tci.demo_unload', 'on', true);

  -- a data request RESTRICTs its company: it goes first
  delete from tci.entity_requests where is_demo;
  -- everything else in one statement: the foreign keys between demo rows are
  -- checked at its end, so the order (and the cycles) do not matter
  with
    d01 as (delete from tci.task_transfers where is_demo returning 1),
    d02 as (delete from tci.task_comments where is_demo returning 1),
    d03 as (delete from tci.tasks where is_demo returning 1),
    d04 as (delete from tci.workflow_events where is_demo returning 1),
    d05 as (delete from tci.committee_votes where is_demo returning 1),
    d06 as (delete from tci.committee_conflicts where is_demo returning 1),
    d07 as (delete from tci.rating_votes where is_demo returning 1),
    d08 as (delete from tci.rating_conflicts where is_demo returning 1),
    d09 as (delete from tci.rating_proposal_steps where is_demo returning 1),
    d10 as (delete from tci.rating_proposals where is_demo returning 1),
    d11 as (delete from tci.limit_request_amendments where is_demo returning 1),
    d12 as (delete from tci.limit_information_waivers where is_demo returning 1),
    d13 as (delete from tci.auto_decision_attempts where is_demo returning 1),
    d14 as (delete from tci.decision_conditions where is_demo returning 1),
    d15 as (delete from tci.limit_validations where is_demo returning 1),
    d16 as (delete from tci.credit_limit_decisions where is_demo returning 1),
    d17 as (delete from tci.client_buyer_proposals where is_demo returning 1),
    d18 as (delete from tci.credit_limit_requests where is_demo returning 1),
    d19 as (delete from tci.recoveries where is_demo returning 1),
    d20 as (delete from tci.claim_payments where is_demo returning 1),
    d21 as (delete from tci.claim_invoice_verdicts where is_demo returning 1),
    d22 as (delete from tci.claim_invoices where is_demo returning 1),
    d23 as (delete from tci.claim_documents where is_demo returning 1),
    d24 as (delete from tci.claim_status_history where is_demo returning 1),
    d25 as (delete from tci.claims where is_demo returning 1),
    d26 as (delete from tci.overdue_notifications where is_demo returning 1),
    d27 as (delete from tci.premium_payments where is_demo returning 1),
    d28 as (delete from tci.bank_statement_lines where is_demo returning 1),
    d29 as (delete from tci.bank_statement_imports where is_demo returning 1),
    d30 as (delete from tci.premium_entries where is_demo returning 1),
    d31 as (delete from tci.premium_instalments where is_demo returning 1),
    d32 as (delete from tci.declaration_lines where is_demo returning 1),
    d33 as (delete from tci.declarations where is_demo returning 1),
    d34 as (delete from tci.contract_draft_comments where is_demo returning 1),
    d35 as (delete from tci.contract_draft_status_history where is_demo returning 1),
    d36 as (delete from tci.contract_versions where is_demo returning 1),
    d37 as (delete from tci.contract_drafts where is_demo returning 1),
    d38 as (delete from tci.commercial_offer_versions where is_demo returning 1),
    d39 as (delete from tci.commercial_offers where is_demo returning 1),
    d40 as (delete from tci.policy_documents where is_demo returning 1),
    d41 as (delete from tci.policy_status_history where is_demo returning 1),
    d42 as (delete from tci.insurance_request_history where is_demo returning 1),
    d43 as (delete from tci.insurance_request_buyers where is_demo returning 1),
    d44 as (delete from tci.insurance_requests where is_demo returning 1),
    d45 as (delete from tci.policyholder_users where is_demo returning 1),
    d46 as (delete from tci.policyholder_tier_overrides where is_demo returning 1),
    d47 as (delete from tci.policies where is_demo returning 1),
    d48 as (delete from tci.sanctions_matches where is_demo returning 1),
    d49 as (delete from tci.sanctions_screenings where is_demo returning 1),
    d50 as (delete from tci.sanction_flags where is_demo returning 1),
    d51 as (delete from tci.buyer_adt where is_demo returning 1),
    d52 as (delete from tci.buyer_adt_blocks where is_demo returning 1),
    d53 as (delete from tci.group_limits where is_demo returning 1),
    d54 as (delete from tci.group_ratings where is_demo returning 1),
    d55 as (delete from tci.entity_relationship_suggestions where is_demo returning 1),
    d56 as (delete from tci.entity_relationships where is_demo returning 1),
    d57 as (delete from tci.entity_beneficial_owners where is_demo returning 1),
    d58 as (delete from tci.entity_agency_ratings where is_demo returning 1),
    d59 as (delete from tci.credit_assessments where is_demo returning 1),
    d60 as (delete from tci.local_statement_values where is_demo returning 1),
    d61 as (delete from tci.income_statements where is_demo returning 1),
    d62 as (delete from tci.balance_sheets where is_demo returning 1),
    d63 as (delete from tci.financial_statements where is_demo returning 1),
    d65 as (delete from tci.country_risk_overrides where is_demo returning 1),
    d66 as (delete from tci.legal_entities where is_demo returning 1)
  select null into v_after;

  -- the demo people: removed, or (when a real record still names one) kept
  -- without roles and banned, so they can never sign in or be routed work
  for v_user in select p.user_id, u.email from tci.user_profiles p join auth.users u on u.id = p.user_id
                 where p.is_demo_user loop
    update tci.sectors set analyst_id = null where analyst_id = v_user.user_id;
    update tci.authority_level_members set valid_to = current_date - 1
     where user_id = v_user.user_id and (valid_to is null or valid_to >= current_date);
    update tci.authority_levels set chair_id = null where chair_id = v_user.user_id;
    begin
      delete from tci.acting_roles where user_id = v_user.user_id;
      delete from tci.authority_level_members where user_id = v_user.user_id;
      delete from tci.authority_grants where user_id = v_user.user_id;
      delete from tci.user_roles where user_id = v_user.user_id;
      delete from tci.user_profiles where user_id = v_user.user_id;
      delete from auth.identities where user_id = v_user.user_id;
      delete from auth.users where id = v_user.user_id;
      v_gone := v_gone + 1;
    exception when foreign_key_violation then
      delete from tci.user_roles where user_id = v_user.user_id;
      update auth.users set banned_until = 'infinity' where id = v_user.user_id;
      v_kept := v_kept || to_jsonb(v_user.email);
    end;
  end loop;

  update tci.workflow_settings set demo_loaded_at = null, demo_loaded_by = null where id;
  perform set_config('tci.demo_unload', '', true);
  v_after := tci.demo_data_counts();
  if exists (select 1 from jsonb_each_text(v_after -> 'tables') t where t.value::bigint > 0) then
    raise exception 'demo_unload_incomplete: % demo rows remain', v_after -> 'tables';
  end if;
  return jsonb_build_object('before', v_before, 'after', v_after,
                            'demo_users_removed', v_gone, 'demo_users_kept_banned', v_kept);
end $$;
revoke all on function tci.delete_demo_data() from public, anon;
grant execute on function tci.delete_demo_data() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Checks
-- ---------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  -- the unload names every business table
  select string_agg(t, ', ') into v_bad from unnest(tci.demo_world_tables()) t
   where (select prosrc from pg_proc where oid = 'tci.delete_demo_data()'::regprocedure) not like '%tci.' || t || ' where is_demo%';
  if v_bad is not null then
    raise exception '0097: the unload misses %', v_bad;
  end if;
  -- the internal builders are reachable only from the two admin functions
  select string_agg(p.proname, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and p.proname like '\_demo\_%'
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0097: executable by authenticated: %', v_bad;
  end if;
end $$;

-- ======================================================================
-- 0098_tour_progress.sql  (md5 af4c3b5ff954819a01e853dd9dcd660f)
-- ======================================================================
-- 0098_tour_progress.sql
--
-- What: each person's GUIDED TOUR progress on tci.user_profiles —
--       ui_tour_state jsonb, one entry per tour id (a role's tour such as
--       'credit_underwriter', the portal's 'client', a «What's new» tour such
--       as 'release:2026.11'): {"status": "completed" | "skipped",
--       "last_step": <step index>, "at": <ISO timestamp>}. NULL means no tour
--       recorded yet. A check keeps the shape (an object of such entries,
--       ids of at most 64 characters, at most 16 KB), so a write from the
--       browser cannot park anything else in the column. A person reads and
--       writes their own value through the existing "user_profiles: read own /
--       update own" policies; the column grants below are the only change to
--       who may touch the table.
-- Why:  Prompt 32 (owner, 2026-11): the tour starts by itself on the first
--       sign-in and when a release tour is due, and a tour completed or
--       skipped must never start by itself again — on any device, so the
--       record cannot live in the browser. src/features/tour/state.ts reads
--       it (in its own query: a database without this column only shows the
--       tour once per browser session).

alter table tci.user_profiles
  add column ui_tour_state jsonb
    constraint user_profiles_ui_tour_state_check check (
      jsonb_typeof(ui_tour_state) = 'object'
      and octet_length(ui_tour_state::text) <= 16384
      -- every key a tour id
      and not jsonb_path_exists(
        ui_tour_state,
        '$.keyvalue() ? (!(@.key like_regex "^[a-z0-9][a-z0-9_.:-]{0,63}$"))'
      )
      -- every value an object (strict: lax mode would unwrap an array of them)
      and not jsonb_path_exists(ui_tour_state, 'strict $.* ? (@.type() != "object")')
      -- every value {status, last_step: a whole number >= 0, at}
      and not jsonb_path_exists(
        ui_tour_state,
        '$.* ? (!(@.type() == "object"
                  && (@.status == "completed" || @.status == "skipped")
                  && exists (@.last_step ? (@.type() == "number" && @ >= 0 && @ == @.floor()))
                  && exists (@.at ? (@.type() == "string"))))'
      )
    );

comment on column tci.user_profiles.ui_tour_state is
  'The person''s guided tour progress: tour id -> {status completed|skipped, last_step, at}; NULL = no tour recorded yet (0098, src/features/tour/state.ts).';

-- Column grants, as 0076, 0081 and 0082: a table-level grant would reopen the
-- columns no API role may see (temp_password_hash, sign_in_ack_at).
grant select (ui_tour_state), update (ui_tour_state) on tci.user_profiles to authenticated;
grant select (ui_tour_state), insert (ui_tour_state), update (ui_tour_state) on tci.user_profiles to service_role;

do $$
begin
  if has_column_privilege('anon', 'tci.user_profiles', 'ui_tour_state', 'select')
     or has_column_privilege('anon', 'tci.user_profiles', 'ui_tour_state', 'update') then
    raise exception '0098: anon may read or write ui_tour_state';
  end if;
  if has_column_privilege('authenticated', 'tci.user_profiles', 'temp_password_hash', 'select')
     or has_column_privilege('authenticated', 'tci.user_profiles', 'must_change_password', 'update')
     or has_column_privilege('authenticated', 'tci.user_profiles', 'sign_in_ack_at', 'update') then
    raise exception '0098: the 0048 / 0062 column closure was widened';
  end if;
  -- The id test is a regex inside a jsonpath string: make sure it bites.
  if jsonb_path_exists('{"Sales!": {"status": "completed", "last_step": 0, "at": "x"}}'::jsonb,
                       '$.keyvalue() ? (!(@.key like_regex "^[a-z0-9][a-z0-9_.:-]{0,63}$"))') is not true then
    raise exception '0098: the tour id check lets a bad id through';
  end if;
end;
$$;

-- ======================================================================
-- checks
-- ======================================================================
do $$
declare
  r record;
  v_total bigint;
  v_changed int := 0;
begin
  for r in select b.tbl, b.n from _rows_before b order by b.tbl loop
    execute format('select count(*) from tci.%I', r.tbl) into v_total;
    if v_total <> r.n then v_changed := v_changed + 1; end if;
  end loop;
  if v_changed > 0 then
    raise exception 'row counts changed in % table(s) — nothing applied', v_changed;
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'tci' and column_name = 'is_demo')
     <> cardinality(tci.demo_world_tables()) then
    raise exception 'is_demo is not on every demo-world table';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'tci' and table_name = 'sector_reviews' and column_name = 'is_demo') then
    raise exception 'sector reviews must stay shared';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'tci' and table_name = 'user_profiles' and column_name = 'ui_tour_state') then
    raise exception '0098: ui_tour_state missing';
  end if;
  if exists (select 1 from tci.legal_entities where is_demo and name not like 'DEMO %')
     or exists (select 1 from tci.legal_entities where not is_demo and name like 'DEMO %') then
    raise exception 'DEMO prefix and is_demo disagree on legal_entities';
  end if;
end $$;

create temp table _report (ord int, item text, total_rows bigint, demo_rows bigint) on commit drop;
do $$
declare r record; v_total bigint; v_demo bigint; i int := 0;
begin
  for r in select t from unnest(tci.demo_world_tables()) t order by 1 loop
    execute format('select count(*), count(*) filter (where is_demo) from tci.%I', r.t) into v_total, v_demo;
    if v_total > 0 then
      i := i + 1;
      insert into _report values (i, r.t, v_total, v_demo);
    end if;
  end loop;
  insert into _report values
    (1000, 'sector_reviews (shared, stay real)', (select count(*) from tci.sector_reviews), 0),
    (1001, 'demo accounts', (select count(*) from tci.user_profiles where is_demo_user), null),
    (1002, 'staff accounts now in demo mode', (select count(*) from tci.user_profiles where ui_demo_mode and not is_demo_user), null);
end $$;

insert into supabase_migrations.schema_migrations (version, name, statements) values
  ('20261102130000', '0096_demo_worlds',
   array['-- applied by the owner with docs/deploy/canonical-apply-0096-0098.sql; the committed file is the authoritative text (md5 4cb62666617f28d50ed56973d3135c84)']),
  ('20261102140000', '0097_demo_seed',
   array['-- applied by the owner with docs/deploy/canonical-apply-0096-0098.sql; the committed file is the authoritative text (md5 f8c1fa20d087caad6f05e0033d52033b)']),
  ('20261102150000', '0098_tour_progress',
   array['-- applied by the owner with docs/deploy/canonical-apply-0096-0098.sql; the committed file is the authoritative text (md5 af4c3b5ff954819a01e853dd9dcd660f)']);

-- the result table the editor shows
select item, total_rows, demo_rows from _report order by ord;

-- DRY RUN: change this last line to `commit;` for the real run.
rollback;
