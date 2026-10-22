-- canonical-apply-0062.sql
--
-- Run ONCE in the Supabase SQL Editor of the canonical project
-- tci_erp (ref reunqrpeumokqgarknge). Nowhere else.
--
-- What: the last step of migration 0062 (sign-in notice + `client` held
-- alone). Everything else in 0062 is already applied through the MCP
-- tooling (2026-10-22). This step removes the `client` role from every
-- account that ALSO holds a staff role — today exactly one: the owner's
-- account, which has no policyholder mapping, so the role gave it nothing —
-- then asserts the result and records 0062 in the migration ledger.
--
-- Why by hand: the MCP tooling holds any statement containing that keyword
-- for an approval prompt this environment never shows (CLAUDE.md, «Sign-in
-- gate rules»).
--
-- Safe: one transaction. If any check fails, everything is rolled back and
-- nothing changes. Expected output at the end: one row, owner_roles without
-- `client`, mixed_accounts = 0, ledger_rows = 1.

begin;

do $$
declare v_before int; v_removed int;
begin
  select count(*) into v_before
    from (select user_id from tci.user_roles group by user_id
          having bool_or(role = 'client') and count(*) > 1) x;
  delete from tci.user_roles r
   where r.role = 'client'
     and exists (select 1 from tci.user_roles o where o.user_id = r.user_id and o.role <> 'client');
  get diagnostics v_removed = row_count;
  if v_removed <> v_before then
    raise exception '0062: % accounts held client with other roles, % client rows removed', v_before, v_removed;
  end if;
  if v_removed > 1 then
    raise exception '0062: expected to change at most one account, found %', v_removed;
  end if;
  if exists (select 1 from tci.user_roles group by user_id having bool_or(role = 'client') and count(*) > 1) then
    raise exception '0062: an account still holds client with other roles';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'user_roles_client_exclusive'
                    and tgrelid = 'tci.user_roles'::regclass) then
    raise exception '0062: the client-exclusive trigger is missing — the rest of 0062 is not applied';
  end if;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022190000', '0062_sign_in_notice',
        array['-- applied 2026-10-22: sections 1-6 and 8-9 through execute_sql (fingerprint-identical to a local replay), section 7''s role cleanup and the ledger row by the owner with docs/deploy/canonical-apply-0062.sql; the committed file TCI_ERP/supabase/migrations/0062_sign_in_notice.sql is authoritative']);

commit;

select (select array_agg(r.role::text order by r.role::text)
          from tci.user_roles r join auth.users u on u.id = r.user_id
         where u.id = 'a354112a-9477-4d6c-b0f5-568bd16c2025') as owner_roles,
       (select count(*) from (select user_id from tci.user_roles group by user_id
                               having bool_or(role = 'client') and count(*) > 1) x) as mixed_accounts,
       (select count(*) from supabase_migrations.schema_migrations where version = '20261022190000') as ledger_rows;
