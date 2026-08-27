-- 0018_admin_users_view.sql
-- What: tci.v_admin_users - email, last sign-in and the role set per user,
--       readable by admins only. Supports the Phase 3b "Users & roles"
--       admin screen.
-- Why:  auth.users is not exposed through PostgREST and must never be. This
--       view is deliberately NOT security_invoker: it runs with the owner's
--       rights so it can read auth.users, and it filters itself down to
--       nothing unless the CALLER is an admin (tci.has_role is SECURITY
--       DEFINER and resolves the caller, not the owner).

create view tci.v_admin_users as
select
  u.id as user_id,
  u.email::text as email,
  u.last_sign_in_at,
  u.created_at,
  coalesce(
    (select array_agg(ur.role order by ur.role) from tci.user_roles ur where ur.user_id = u.id),
    '{}'::tci.user_role[]
  ) as roles
from auth.users u
where tci.has_role('admin');

comment on view tci.v_admin_users is
  'Admin-only user directory (email, last sign-in, roles). Returns no rows to non-admins.';

grant select on tci.v_admin_users to authenticated, service_role;
