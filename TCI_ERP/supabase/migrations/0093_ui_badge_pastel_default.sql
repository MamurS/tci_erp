-- 0093_ui_badge_pastel_default.sql
--
-- What: the application default for tci.user_profiles.ui_badge_ink (0089)
--       is now 'dark' — the PASTEL badge: the ramp's pale tint with its
--       darker ink and a light hairline (src/lib/uiTheme.ts,
--       DEFAULT_UI_BADGE_INK). 'white' (the darker shade behind white text)
--       stays a person's choice. NULL still means "the application
--       default"; no row is rewritten, so a person who picked white keeps
--       it. Only the column comment changes.
-- Why:  the owner asked for lighter, pastel rating and status badge colours
--       (2026-10-27).

comment on column tci.user_profiles.ui_badge_ink is
  'The person''s text on coloured badges (white, dark); NULL = the application default, dark — the pastel badge (0093; white until then, 0089).';
