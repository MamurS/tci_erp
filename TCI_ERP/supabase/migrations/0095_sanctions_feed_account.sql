-- What: a FEED ACCOUNT — a sign-in that holds no role and may do exactly one
--       thing: import the official sanctions lists (0091). The daily GitHub
--       Actions job (.github/workflows/sanctions-lists.yml) signs in as one.
--         * tci.feed_accounts (user, scope 'sanctions_lists'), written by
--           nobody through the API; admin reads it.
--         * tci.is_feed_account(scope): the caller is a live feed account of
--           that scope — not banned or deleted, no forced password change,
--           and holding NO role at all (give it a role and it stops being a
--           feed).
--         * begin / add / finish_sanctions_list_import and
--           rescreen_sanctions_due accept a feed account in place of their
--           staff gate; everyone else is gated exactly as in 0091. A feed
--           may NOT confirm a shrunken list (sanctions_shrink_needs_person,
--           42501): a file with far fewer parties than the list in use is
--           a person's call.
-- Why:  the owner asked for the lists to update themselves (2026-10-28).
--       A credit analyst account in CI would be handed sanctions reviews by
--       the least-loaded picker and offered as a colleague everywhere, and an
--       admin account would carry user management in a CI secret. A feed
--       account holds no role, so every other gate, policy and picker in
--       the system already leaves it out: has_role, is_staff and
--       acting_role answer false / NULL for it.

-- ---------------------------------------------------------------------------
-- 1. Feed accounts
-- ---------------------------------------------------------------------------

create table tci.feed_accounts (
  user_id    uuid not null references auth.users (id),
  scope      text not null check (scope in ('sanctions_lists')),
  note       text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  primary key (user_id, scope)
);
comment on table tci.feed_accounts is
  '0095: sign-ins that hold no role and may run one automated feed (scope). Written by the owner in SQL, never through the API.';

alter table tci.feed_accounts enable row level security;
create policy "feed_accounts: admin read" on tci.feed_accounts for select to authenticated
  using (tci.has_role('admin'));
grant select on tci.feed_accounts to authenticated;
grant select on tci.feed_accounts to service_role;

-- Reads auth.users, user_roles and user_profiles of the caller, which an
-- account without a role cannot read itself: SECURITY DEFINER, and reachable
-- only from the definer functions below (no grant to an API role).
create function tci.is_feed_account(p_scope text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from tci.feed_accounts f
      join auth.users u on u.id = f.user_id
     where f.user_id = (select auth.uid())
       and f.scope = p_scope
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
       and not exists (select 1 from tci.user_roles r where r.user_id = f.user_id)
       and not coalesce((select p.must_change_password from tci.user_profiles p where p.user_id = f.user_id), false))
$$;
revoke all on function tci.is_feed_account(text) from public, anon, authenticated;
grant execute on function tci.is_feed_account(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The import functions accept a feed account
--
-- Rebuilt from their own definitions by one textual change each (as 0065 and
-- 0067 did), so nothing else in their bodies can drift: the staff gate is
-- wrapped in "unless a sanctions feed". Each change must apply exactly once.
-- ---------------------------------------------------------------------------

do $$
declare
  v_gate constant text :=
    E'  perform tci.require_staff();\n' ||
    E'  if not tci.may_import_sanctions_lists() then\n' ||
    E'    raise exception ''sanctions_import_only: sanctions lists are imported by credit analysts and admin'' using errcode = ''42501'';\n' ||
    E'  end if;\n';
  v_feed_gate constant text :=
    E'  if not tci.is_feed_account(''sanctions_lists'') then\n' ||
    E'    perform tci.require_staff();\n' ||
    E'    if not tci.may_import_sanctions_lists() then\n' ||
    E'      raise exception ''sanctions_import_only: sanctions lists are imported by credit analysts and admin'' using errcode = ''42501'';\n' ||
    E'    end if;\n' ||
    E'  end if;\n';
  v_shrink constant text :=
    E'  if coalesce(p_confirm_shrink, false) and tci.is_feed_account(''sanctions_lists'') then\n' ||
    E'    raise exception ''sanctions_shrink_needs_person: a shrunken list is confirmed by a person, never by a feed'' using errcode = ''42501'';\n' ||
    E'  end if;\n';
  v_rescreen_gate constant text := E'  perform tci.require_staff_or_internal();\n';
  v_rescreen_feed constant text :=
    E'  if not tci.is_feed_account(''sanctions_lists'') then\n' ||
    E'    perform tci.require_staff_or_internal();\n' ||
    E'  end if;\n';
  v_fn   regprocedure;
  v_def  text;
  v_new  text;
  v_from text;
  v_to   text;
begin
  foreach v_fn in array array[
    'tci.begin_sanctions_list_import(text, text, date, text, text)'::regprocedure,
    'tci.add_sanctions_list_entries(uuid, jsonb)'::regprocedure,
    'tci.finish_sanctions_list_import(uuid, boolean)'::regprocedure,
    'tci.rescreen_sanctions_due(integer)'::regprocedure]
  loop
    v_def := pg_get_functiondef(v_fn);
    if v_fn = 'tci.rescreen_sanctions_due(integer)'::regprocedure then
      v_from := v_rescreen_gate;
      v_to := v_rescreen_feed;
    elsif v_fn = 'tci.finish_sanctions_list_import(uuid, boolean)'::regprocedure then
      v_from := v_gate;
      v_to := v_feed_gate || v_shrink;
    else
      v_from := v_gate;
      v_to := v_feed_gate;
    end if;
    if (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 then
      raise exception '0095: the gate of % is not where it was written in 0091', v_fn;
    end if;
    v_new := replace(v_def, v_from, v_to);
    execute v_new;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Checks
-- ---------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci'
     and p.proname in ('begin_sanctions_list_import', 'add_sanctions_list_entries',
                       'finish_sanctions_list_import', 'rescreen_sanctions_due')
     and p.prosrc not like '%tci.is_feed_account(''sanctions_lists'')%';
  if v_bad is not null then
    raise exception '0095: no feed gate in %', v_bad;
  end if;
  if (select p.prosrc from pg_proc p where p.oid = 'tci.finish_sanctions_list_import(uuid, boolean)'::regprocedure)
       not like '%sanctions_shrink_needs_person%' then
    raise exception '0095: finish_sanctions_list_import lets a feed confirm a shrunken list';
  end if;
  -- The feed check is reachable only from definer code: no API role runs it.
  if has_function_privilege('authenticated', 'tci.is_feed_account(text)', 'execute')
     or has_function_privilege('anon', 'tci.is_feed_account(text)', 'execute') then
    raise exception '0095: tci.is_feed_account is executable by an API role';
  end if;
  -- Nobody writes feed accounts through the API.
  if has_table_privilege('authenticated', 'tci.feed_accounts', 'insert')
     or has_table_privilege('authenticated', 'tci.feed_accounts', 'update') then
    raise exception '0095: tci.feed_accounts is writable by authenticated';
  end if;
end $$;
