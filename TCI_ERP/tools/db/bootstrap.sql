-- tools/db/bootstrap.sql — a minimal Supabase stub for replaying the TCI
-- migration chain on a plain PostgreSQL 16/17 (local or a CI service
-- container). Run it ONCE on a fresh, empty database, before migration 0001;
-- tools/db/replay.sh does that for you.
--
-- What it provides is exactly what the migrations reference and nothing
-- more: the API roles (anon, authenticated, service_role, the GoTrue role
-- supabase_auth_admin, authenticator), pgcrypto and pg_trgm in schema
-- `extensions` (NOT public — that is where Supabase keeps them, and 0043's
-- unqualified gen_random_bytes() depends on the database search_path below),
-- the parts of `auth` the migrations and tests touch, and the parts of
-- `storage` the claim-documents and wording buckets need.
--
-- It is a stub, not Supabase: no GoTrue, no PostgREST, no Storage API. The
-- tests in tests/db/*.sql therefore impersonate the API roles with
-- set_config('role', …) + request.jwt.claims, as PostgREST would.
--
-- Never run this against canonical or any real Supabase project.

-- Minimal Supabase stub for replaying TCI migrations locally.
-- Roles are cluster-wide, so a second database on the same server reuses them.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role supabase_auth_admin login noinherit; create role authenticator noinherit login;
    grant anon, authenticated, service_role to authenticator;
  end if;
end $$;
create schema extensions;
create extension pgcrypto with schema extensions;
create extension pg_trgm with schema extensions;
-- Supabase sets the database search_path to `public, extensions`. Applies to
-- sessions opened after this one, i.e. to every migration file replay.sh runs.
do $$ begin
  execute format('alter database %I set search_path = public, extensions', current_database());
end $$;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid, aud text, role text,
  email text, encrypted_password text, email_confirmed_at timestamptz,
  last_sign_in_at timestamptz, raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now(),
  updated_at timestamptz default now(), banned_until timestamptz, deleted_at timestamptz,
  is_sso_user boolean default false, is_anonymous boolean default false, phone text,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text
);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), email text);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now(), factor_id uuid, aal text,
  not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet, tag text);
create table auth.refresh_tokens (id bigserial primary key, token text, user_id varchar, revoked boolean, created_at timestamptz default now(), updated_at timestamptz, parent varchar, session_id uuid references auth.sessions(id) on delete cascade);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  friendly_name text, factor_type text, status text, created_at timestamptz default now(), updated_at timestamptz default now(), secret text, phone text, last_challenged_at timestamptz);
create table auth.audit_log_entries (instance_id uuid, id uuid primary key default gen_random_uuid(), payload json, created_at timestamptz default now(), ip_address varchar(64) default '');
-- auth.uid() / role() / jwt() / email() read the claims the way Supabase does:
-- the legacy per-claim GUC first, then the request.jwt.claims JSON.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create function auth.email() returns text language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email') $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create function storage.extension(name text) returns text language sql immutable as $$
  select reverse(split_part(reverse(name), '.', 1)) $$;
grant all on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
