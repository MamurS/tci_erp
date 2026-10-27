-- canonical-apply-0085.sql — the owner's step for migration 0085 on the
-- canonical project (tci_erp, ref reunqrpeumokqgarknge). Run it ONCE in the
-- Supabase SQL Editor of that project, as is.
--
-- What it does: section 14 of 0085 — five triggers that refuse removing any
-- row of the sector, country-risk and sanctions history (the MCP tooling
-- holds any statement naming that keyword, so this part is yours, as for
-- 0057) — then checks them and records 0085 in the migration ledger.
--
-- Sections 1–13 of 0085 are already applied (2026-10-27): every function,
-- policy and view identical to a local replay of the committed file, the
-- eight-case smoke run with a forced rollback, nothing left behind.
--
-- One transaction: if any check fails, nothing is changed. Delete this file
-- once it has been run and verified.

begin;

create trigger sector_reviews_kept before delete on tci.sector_reviews
  for each row execute function tci.guard_sector_review();
create trigger country_risk_overrides_kept before delete on tci.country_risk_overrides
  for each row execute function tci.guard_country_override();
create trigger country_risk_imports_kept before delete on tci.country_risk_imports
  for each row execute function tci.guard_country_import();
create trigger country_risk_classifications_kept before delete on tci.country_risk_classifications
  for each row execute function tci.guard_country_import();
create trigger sanction_flags_kept before delete on tci.sanction_flags
  for each row execute function tci.guard_sanction_flag();

do $$
begin
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tci' and not t.tgisinternal
        and t.tgname in ('sector_reviews_kept', 'country_risk_overrides_kept', 'country_risk_imports_kept',
                         'country_risk_classifications_kept', 'sanction_flags_kept')) <> 5 then
    raise exception '0085 owner step: the five removal guards are not all there';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261027080000') then
    raise exception '0085 owner step: 0084 is not in the ledger — stop and ask';
  end if;
end $$;

insert into supabase_migrations.schema_migrations (version, name, statements) values
  ('20261027090000', '0085_sector_country_risk',
   array['-- sections 1–13 applied through execute_sql (section 10 rebuilt from the functions'' own bodies), section 14 by the owner; the committed file is the authoritative text (md5 390521a8def3cd28eea3a23b25ff6884)']);

commit;
