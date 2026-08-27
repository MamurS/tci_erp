-- 0022_user_profiles.sql
-- What: tci.user_profiles - the in-app, RLS-readable mirror of the auth
--       user_metadata written at provisioning time, plus
--       tci.v_entity_client_users so sales can see who has portal access to
--       a company without ever touching auth.users.
-- Why:  users are created by the analytics service with the service_role
--       key (that key must never reach the browser), and it stamps
--       user_metadata.must_change_password. The browser cannot read
--       another user's metadata and should not have to parse its own JWT to
--       find out whether it must rotate a temporary password - so the flag
--       is mirrored into an ordinary RLS-guarded table the app can query.
--
-- Honest limitation: must_change_password is a UX gate, not a security
-- boundary. The owner of the row can clear it without actually changing the
-- password (they are already authenticated - skipping the rotation only
-- hurts them). Real enforcement would need a hook on auth.users, which
-- hosted Supabase does not give us.

create table tci.user_profiles (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  full_name            text,
  must_change_password boolean not null default true,
  password_changed_at  timestamptz,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table tci.user_profiles is
  'In-app mirror of provisioning metadata (display name, temp-password rotation flag). Written by the provisioning service with the service_role key; read through RLS by the app.';
comment on column tci.user_profiles.must_change_password is
  'True while the user still holds the temporary password issued at provisioning. UX gate only - see the migration header.';
comment on column tci.user_profiles.created_by is
  'Who provisioned this user. Drives the sales/commercial read policy below.';

create index user_profiles_created_by_idx on tci.user_profiles (created_by);

create trigger user_profiles_set_updated_at
  before update on tci.user_profiles
  for each row execute function tci.set_updated_at();

alter table tci.user_profiles enable row level security;

-- Everyone sees their own row - this is what the forced-change gate reads.
create policy "user_profiles: read own"
  on tci.user_profiles for select to authenticated
  using (user_id = (select auth.uid()));

-- ...and may maintain it. The column grants below keep this to the display
-- name and the rotation flag; role and provenance are not self-serviceable.
create policy "user_profiles: update own"
  on tci.user_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "user_profiles: admin manage"
  on tci.user_profiles for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

-- Sales and commercial underwriting provision client users; they see the
-- rows they created, and nothing else.
create policy "user_profiles: provisioner reads own intake"
  on tci.user_profiles for select to authenticated
  using (
    tci.has_role('sales', 'commercial_underwriter')
    and created_by = (select auth.uid())
  );

grant select on tci.user_profiles to authenticated;
grant update (full_name, must_change_password, password_changed_at)
  on tci.user_profiles to authenticated;
grant all on tci.user_profiles to service_role;

-- ---------------------------------------------------------------------------
-- Clearing the flag
-- ---------------------------------------------------------------------------

-- The password change itself happens through supabase.auth.updateUser();
-- this records that it did. SECURITY DEFINER so the row exists even for a
-- user provisioned before this migration (upsert, not update).
create function tci.complete_password_change()
returns tci.user_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.user_profiles%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = 'P0004';
  end if;

  insert into tci.user_profiles (user_id, must_change_password, password_changed_at)
  values ((select auth.uid()), false, now())
  on conflict (user_id) do update
    set must_change_password = false,
        password_changed_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function tci.complete_password_change() from public, anon;
grant execute on function tci.complete_password_change() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Client portal users of a company
-- ---------------------------------------------------------------------------

-- Deliberately NOT security_invoker: it runs with the owner's rights so it
-- can read auth.users, and filters itself to nothing unless the CALLER may
-- provision client access (tci.has_role is SECURITY DEFINER and resolves the
-- caller, not the owner). Same construction as tci.v_admin_users (0018).
create view tci.v_entity_client_users as
select
  pu.entity_id,
  u.id                    as user_id,
  u.email::text           as email,
  p.full_name,
  u.last_sign_in_at,
  u.created_at,
  coalesce(p.must_change_password, false) as must_change_password,
  (u.banned_until is not null and u.banned_until > now()) as disabled
from tci.policyholder_users pu
join auth.users u on u.id = pu.user_id
left join tci.user_profiles p on p.user_id = u.id
where tci.has_role('admin', 'sales', 'commercial_underwriter');

comment on view tci.v_entity_client_users is
  'Portal users per company, for the «Client access» section. Returns no rows unless the caller is admin, sales or commercial underwriting.';

grant select on tci.v_entity_client_users to authenticated, service_role;

-- The admin directory gains the same provisioning columns.
drop view tci.v_admin_users;
create view tci.v_admin_users as
select
  u.id as user_id,
  u.email::text as email,
  u.last_sign_in_at,
  u.created_at,
  coalesce(
    (select array_agg(ur.role order by ur.role) from tci.user_roles ur where ur.user_id = u.id),
    '{}'::tci.user_role[]
  ) as roles,
  p.full_name,
  coalesce(p.must_change_password, false) as must_change_password,
  (u.banned_until is not null and u.banned_until > now()) as disabled
from auth.users u
left join tci.user_profiles p on p.user_id = u.id
where tci.has_role('admin');

comment on view tci.v_admin_users is
  'Admin-only user directory (email, last sign-in, roles, provisioning state). Returns no rows to non-admins.';

grant select on tci.v_admin_users to authenticated, service_role;
