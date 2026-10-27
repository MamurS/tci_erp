-- 0081_ui_text_scale.sql
--
-- What: each person's TEXT size, tci.user_profiles.ui_text_scale — 100,
--       110, 125, 140 or 150 per cent, NULL meaning the application default
--       (100 %, src/lib/uiScale.ts). It multiplies the type only; the zoom
--       of 0076 (ui_scale) still scales everything. A person reads and
--       writes their own value through the existing "user_profiles: read
--       own / update own" policies; the column grants below are the only
--       change to who may touch the table.
-- Why:  the owner found the text at 100 % too small to read while the rest
--       of the layout was right (2026-10-27): growing the whole interface
--       to get larger type spends room the screen does not have.

alter table tci.user_profiles
  add column ui_text_scale smallint
    constraint user_profiles_ui_text_scale_check check (ui_text_scale in (100, 110, 125, 140, 150));

comment on column tci.user_profiles.ui_text_scale is
  'The person''s text size in per cent (100, 110, 125, 140, 150), multiplying the type only; NULL = the application default (0081).';

-- Column grants, as 0076: a table-level grant would reopen the columns no
-- API role may see (temp_password_hash, sign_in_ack_at).
grant select (ui_text_scale), update (ui_text_scale) on tci.user_profiles to authenticated;
grant select (ui_text_scale), insert (ui_text_scale), update (ui_text_scale) on tci.user_profiles to service_role;

do $$
begin
  if has_column_privilege('anon', 'tci.user_profiles', 'ui_text_scale', 'select') then
    raise exception '0081: anon may read ui_text_scale';
  end if;
  if has_column_privilege('authenticated', 'tci.user_profiles', 'temp_password_hash', 'select')
     or has_column_privilege('authenticated', 'tci.user_profiles', 'must_change_password', 'update') then
    raise exception '0081: the 0048 column closure was widened';
  end if;
end;
$$;
