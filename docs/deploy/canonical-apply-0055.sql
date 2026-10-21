-- TCI ERP: the one remaining statement of migration 0055 for the canonical
-- project (reunqrpeumokqgarknge). Paste into Supabase -> SQL Editor -> Run.
-- It runs as ONE transaction: either all of it applies or none of it does.
-- What it deletes: no data. It removes one row-level policy,
-- "tasks: complete mine", which let a user UPDATE their own Agenda tasks.
-- 0055 already revoked the UPDATE grant it worked with, so the policy is
-- inert today; this removes it so the catalogue says what is true.
-- Source of truth: TCI_ERP/supabase/migrations/0055_agenda_redesign.sql.
--
-- Everything else in 0055 was applied on 2026-10-21 through the MCP tooling
-- (its ledger entry is 0055_agenda_redesign). The tooling cannot send a
-- statement containing DROP without an approval prompt this environment
-- never shows. Run this once; a second run does nothing (IF EXISTS).
-- Delete this file once it has been applied.
begin;

drop policy if exists "tasks: complete mine" on tci.tasks;

do $$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'tci' and tablename = 'tasks' and cmd = 'UPDATE') then
    raise exception '0055: an UPDATE policy is still defined on tci.tasks';
  end if;
  if has_any_column_privilege('authenticated', 'tci.tasks', 'UPDATE') then
    raise exception '0055: authenticated can still update tci.tasks';
  end if;
end;
$$;

commit;
