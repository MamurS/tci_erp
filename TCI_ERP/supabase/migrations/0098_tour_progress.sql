-- 0098_tour_progress.sql
--
-- What: each person's GUIDED TOUR progress on tci.user_profiles —
--       ui_tour_state jsonb, one entry per tour id (a role's tour such as
--       'credit_underwriter', the portal's 'client', a «What's new» tour such
--       as 'release:2026.11'): {"status": "completed" | "skipped",
--       "last_step": <step index>, "at": <ISO timestamp>}. NULL means no tour
--       recorded yet. A check keeps the shape (an object of such entries,
--       ids of at most 64 characters, at most 16 KB), so a write from the
--       browser cannot park anything else in the column. A person reads and
--       writes their own value through the existing "user_profiles: read own /
--       update own" policies; the column grants below are the only change to
--       who may touch the table.
-- Why:  Prompt 32 (owner, 2026-11): the tour starts by itself on the first
--       sign-in and when a release tour is due, and a tour completed or
--       skipped must never start by itself again — on any device, so the
--       record cannot live in the browser. src/features/tour/state.ts reads
--       it (in its own query: a database without this column only shows the
--       tour once per browser session).

alter table tci.user_profiles
  add column ui_tour_state jsonb
    constraint user_profiles_ui_tour_state_check check (
      jsonb_typeof(ui_tour_state) = 'object'
      and octet_length(ui_tour_state::text) <= 16384
      -- every key a tour id
      and not jsonb_path_exists(
        ui_tour_state,
        '$.keyvalue() ? (!(@.key like_regex "^[a-z0-9][a-z0-9_.:-]{0,63}$"))'
      )
      -- every value an object (strict: lax mode would unwrap an array of them)
      and not jsonb_path_exists(ui_tour_state, 'strict $.* ? (@.type() != "object")')
      -- every value {status, last_step: a whole number >= 0, at}
      and not jsonb_path_exists(
        ui_tour_state,
        '$.* ? (!(@.type() == "object"
                  && (@.status == "completed" || @.status == "skipped")
                  && exists (@.last_step ? (@.type() == "number" && @ >= 0 && @ == @.floor()))
                  && exists (@.at ? (@.type() == "string"))))'
      )
    );

comment on column tci.user_profiles.ui_tour_state is
  'The person''s guided tour progress: tour id -> {status completed|skipped, last_step, at}; NULL = no tour recorded yet (0098, src/features/tour/state.ts).';

-- Column grants, as 0076, 0081 and 0082: a table-level grant would reopen the
-- columns no API role may see (temp_password_hash, sign_in_ack_at).
grant select (ui_tour_state), update (ui_tour_state) on tci.user_profiles to authenticated;
grant select (ui_tour_state), insert (ui_tour_state), update (ui_tour_state) on tci.user_profiles to service_role;

do $$
begin
  if has_column_privilege('anon', 'tci.user_profiles', 'ui_tour_state', 'select')
     or has_column_privilege('anon', 'tci.user_profiles', 'ui_tour_state', 'update') then
    raise exception '0098: anon may read or write ui_tour_state';
  end if;
  if has_column_privilege('authenticated', 'tci.user_profiles', 'temp_password_hash', 'select')
     or has_column_privilege('authenticated', 'tci.user_profiles', 'must_change_password', 'update')
     or has_column_privilege('authenticated', 'tci.user_profiles', 'sign_in_ack_at', 'update') then
    raise exception '0098: the 0048 / 0062 column closure was widened';
  end if;
  -- The id test is a regex inside a jsonpath string: make sure it bites.
  if jsonb_path_exists('{"Sales!": {"status": "completed", "last_step": 0, "at": "x"}}'::jsonb,
                       '$.keyvalue() ? (!(@.key like_regex "^[a-z0-9][a-z0-9_.:-]{0,63}$"))') is not true then
    raise exception '0098: the tour id check lets a bad id through';
  end if;
end;
$$;
