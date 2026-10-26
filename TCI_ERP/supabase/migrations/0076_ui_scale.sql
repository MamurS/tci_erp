-- 0076_ui_scale.sql
--
-- What: each person's text size for the whole interface,
--       tci.user_profiles.ui_scale — 100, 125, 150, 175 or 200 per cent,
--       NULL meaning the application default (150 %, src/lib/uiScale.ts).
--       A person reads and writes their own value through the existing
--       "user_profiles: read own / update own" policies; the column grants
--       below are the only change to who may touch the table.
-- Why:  the owner asked for much larger text (2026-10-25). Scaling the
--       whole interface is a matter of taste and of the screen at hand, so
--       it is a per-person setting kept on the server (it follows the person
--       to any device), not a browser preference and not one global size.

alter table tci.user_profiles
  add column ui_scale smallint
    constraint user_profiles_ui_scale_check check (ui_scale in (100, 125, 150, 175, 200));

comment on column tci.user_profiles.ui_scale is
  'The person''s interface text size in per cent (100, 125, 150, 175, 200); NULL = the application default (0076).';

-- Column grants, as since 0048: a table-level grant would reopen the columns
-- no API role may see (temp_password_hash, sign_in_ack_at).
grant select (ui_scale), update (ui_scale) on tci.user_profiles to authenticated;
grant select (ui_scale), insert (ui_scale), update (ui_scale) on tci.user_profiles to service_role;

do $$
begin
  if has_column_privilege('anon', 'tci.user_profiles', 'ui_scale', 'select') then
    raise exception '0076: anon may read ui_scale';
  end if;
  if has_column_privilege('authenticated', 'tci.user_profiles', 'temp_password_hash', 'select')
     or has_column_privilege('authenticated', 'tci.user_profiles', 'must_change_password', 'update') then
    raise exception '0076: the 0048 column closure was widened';
  end if;
end;
$$;
