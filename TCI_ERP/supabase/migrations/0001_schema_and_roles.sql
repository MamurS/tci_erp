-- 0001_schema_and_roles.sql
-- What: dedicated `tci` schema, user role model (tci.user_roles + tci.user_role enum),
--       helper tci.current_user_role(), RLS.
-- Why:  all TCI objects live in their own schema (we never assume we are alone in the DB);
--       roles are the foundation for every later RLS policy.

create schema if not exists tci;

-- PostgREST needs USAGE to serve API requests against this schema
-- (schema must also be listed in the project's "Exposed schemas" / config.toml api.schemas).
grant usage on schema tci to authenticated, service_role;

-- Application roles. Enum values stay in English; UI translates labels.
create type tci.user_role as enum (
  'admin',
  'senior_underwriter',
  'underwriter',
  'policyholder'
);

create table tci.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       tci.user_role not null,
  created_at timestamptz not null default now()
);

comment on table tci.user_roles is 'One role per user. Users are created by admins (no self-signup).';

alter table tci.user_roles enable row level security;

-- Helper for RLS policies across the whole schema.
-- SECURITY DEFINER so policies on tci.user_roles itself do not recurse.
create or replace function tci.current_user_role()
returns tci.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from tci.user_roles where user_id = (select auth.uid())
$$;

revoke execute on function tci.current_user_role() from public, anon;
grant execute on function tci.current_user_role() to authenticated, service_role;

-- Users can read their own role.
create policy "user_roles: read own"
  on tci.user_roles for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Only admins manage roles (and can read all).
create policy "user_roles: admin all"
  on tci.user_roles for all
  to authenticated
  using (tci.current_user_role() = 'admin')
  with check (tci.current_user_role() = 'admin');

grant select, insert, update, delete on tci.user_roles to authenticated;
grant all on tci.user_roles to service_role;
