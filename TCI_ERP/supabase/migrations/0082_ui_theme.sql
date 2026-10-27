-- 0082_ui_theme.sql
--
-- What: each person's COLOUR THEME and LIGHT / DARK MODE on
--       tci.user_profiles — ui_theme ('blue', 'salad', 'teal', 'plum',
--       'graphite') and ui_mode ('light', 'dark', 'auto'), NULL meaning the
--       application default (blue, light; src/lib/uiTheme.ts). A theme
--       re-hues the brand colours only; dark mode recolours the screen at
--       the same contrast; paper is always light. A person reads and writes
--       their own values through the existing "user_profiles: read own /
--       update own" policies; the column grants below are the only change to
--       who may touch the table.
-- Why:  the owner asked for a choice of colour (a light salad green instead
--       of blue) and for light, dark and automatic modes (2026-10-27).

alter table tci.user_profiles
  add column ui_theme text
    constraint user_profiles_ui_theme_check check (ui_theme in ('blue', 'salad', 'teal', 'plum', 'graphite')),
  add column ui_mode text
    constraint user_profiles_ui_mode_check check (ui_mode in ('light', 'dark', 'auto'));

comment on column tci.user_profiles.ui_theme is
  'The person''s colour theme (blue, salad, teal, plum, graphite); NULL = the application default, blue (0082).';
comment on column tci.user_profiles.ui_mode is
  'The person''s light or dark mode (light, dark, auto = as the system); NULL = the application default, light (0082).';

-- Column grants, as 0076 and 0081: a table-level grant would reopen the
-- columns no API role may see (temp_password_hash, sign_in_ack_at).
grant select (ui_theme, ui_mode), update (ui_theme, ui_mode) on tci.user_profiles to authenticated;
grant select (ui_theme, ui_mode), insert (ui_theme, ui_mode), update (ui_theme, ui_mode) on tci.user_profiles to service_role;

do $$
begin
  if has_column_privilege('anon', 'tci.user_profiles', 'ui_theme', 'select')
     or has_column_privilege('anon', 'tci.user_profiles', 'ui_mode', 'select') then
    raise exception '0082: anon may read ui_theme / ui_mode';
  end if;
  if has_column_privilege('authenticated', 'tci.user_profiles', 'temp_password_hash', 'select')
     or has_column_privilege('authenticated', 'tci.user_profiles', 'must_change_password', 'update') then
    raise exception '0082: the 0048 column closure was widened';
  end if;
end;
$$;
