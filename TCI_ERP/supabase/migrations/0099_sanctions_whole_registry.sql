-- What: sanctions screening covers the WHOLE company registry.
--         1. A company is screened the moment it is added to the registry
--            (when a list is in use) — new screening reason 'entity_created'.
--         2. After a new list takes effect EVERY company is screened again,
--            not only those with live business (open limit request, limit in
--            force, live policy or submission): tci.sanctions_population()
--            now answers the whole registry, so rescreen_sanctions_due (the
--            import screen, refresh_agenda, the daily feed) works through all
--            of it, ten or a batch at a time as before.
-- Why:  owner request 2026-11-03. Until now a company in the registry with
--       no rating and no limit request was never screened, and one whose
--       business had ended was not screened again after a list update.
--       Everything else stays as 0091 has it: the rating / limit request /
--       owners / name triggers, the matches and their review, the blocks.

-- 1. The new reason.
alter table tci.sanctions_screenings
  drop constraint sanctions_screenings_reason_check,
  add constraint sanctions_screenings_reason_check
    check (reason in ('rating', 'limit_request', 'list_import', 'owners_changed', 'manual', 'entity_created'));

-- 2. The companies kept screened: all of them.
create or replace function tci.sanctions_population() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select e.id from tci.legal_entities e
$$;
comment on function tci.sanctions_population() is
  '0099: the companies kept screened against the sanctions lists — the whole registry (0091 kept only those with live business). Internal: no API role executes it.';

-- 3. A company added to the registry is screened at once. Nothing to do
--    while no list is in use: the first import screens everyone.
create function tci.handle_sanctions_new_entity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from tci.sanctions_list_imports i where i.status = 'active') then
    return null;
  end if;
  perform tci.begin_trusted_call();
  perform tci.screen_entity_internal(new.id, 'entity_created');
  return null;
end $$;
create trigger legal_entities_sanctions_new after insert on tci.legal_entities
  for each row execute function tci.handle_sanctions_new_entity();
revoke all on function tci.handle_sanctions_new_entity() from public, anon, authenticated;

-- 4. Closing checks.
do $$
begin
  if (select count(*) from tci.sanctions_population()) <> (select count(*) from tci.legal_entities) then
    raise exception '0099: the screening population is not the whole registry';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'tci.legal_entities'::regclass and t.tgname = 'legal_entities_sanctions_new'
                    and not t.tgisinternal) then
    raise exception '0099: the new-company screening trigger is missing';
  end if;
  if has_function_privilege('authenticated', 'tci.handle_sanctions_new_entity()', 'execute')
     or has_function_privilege('anon', 'tci.handle_sanctions_new_entity()', 'execute') then
    raise exception '0099: the trigger function is executable by an API role';
  end if;
end $$;
