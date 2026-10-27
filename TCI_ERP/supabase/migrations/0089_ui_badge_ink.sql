-- 0089_ui_badge_ink.sql
--
-- What: each person's choice of TEXT ON COLOURED BADGES —
--       tci.user_profiles.ui_badge_ink ('white' | 'dark'), NULL meaning the
--       application default, white (src/lib/uiTheme.ts). White fills a
--       status, grade or tone badge with its ramp's 700 shade (the grade's
--       ink) behind white text; dark keeps the pale tint with the 700 ink.
--       Both clear 4.5 : 1 (src/design/contrast.test.ts). Dark mode and
--       paper are not affected: dark mode already draws light text on dark
--       tints, and print routes keep the house look. A person reads and
--       writes their own value through the existing "user_profiles: read
--       own / update own" policies; the column grants below are the only
--       change to who may touch the table.
-- Why:  the owner found dark text on the coloured badges hard to read and
--       asked for white, or a switch between the two (2026-10-27).

alter table tci.user_profiles
  add column ui_badge_ink text
    constraint user_profiles_ui_badge_ink_check check (ui_badge_ink in ('white', 'dark'));

comment on column tci.user_profiles.ui_badge_ink is
  'The person''s text on coloured badges (white, dark); NULL = the application default, white (0089).';

-- Column grants, as 0076, 0081 and 0082: a table-level grant would reopen
-- the columns no API role may see (temp_password_hash, sign_in_ack_at).
grant select (ui_badge_ink), update (ui_badge_ink) on tci.user_profiles to authenticated;
grant select (ui_badge_ink), insert (ui_badge_ink), update (ui_badge_ink) on tci.user_profiles to service_role;

do $$
begin
  if has_column_privilege('anon', 'tci.user_profiles', 'ui_badge_ink', 'select') then
    raise exception '0089: anon may read ui_badge_ink';
  end if;
  if has_column_privilege('authenticated', 'tci.user_profiles', 'temp_password_hash', 'select')
     or has_column_privilege('authenticated', 'tci.user_profiles', 'must_change_password', 'update') then
    raise exception '0089: the 0048 column closure was widened';
  end if;
end;
$$;
