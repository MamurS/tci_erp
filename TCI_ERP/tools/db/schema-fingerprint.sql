-- tools/db/schema-fingerprint.sql — a diffable fingerprint of what the TCI
-- migrations create, for ledger reconciliation (audit Phase B.2; the
-- procedure is tools/db/ledger-check.md).
--
-- One row per object, in a stable order (byte order, not the server's
-- collation), four columns:
--
--   kind      function | table | column_set … see below
--   name      schema-qualified object name
--   detail    what is cheap to read in a diff (args, flags, roles, privileges)
--   md5       md5 of the object's definition as the server deparses it
--
-- kinds:
--   schema       tci                                      md5 of nothing ('')
--   function     tci.f, identity args                     md5(pg_get_functiondef)
--   table        tci.t, relkind + RLS flags + reloptions  md5 of the column list
--                (name, type, not null, default, identity, generated,
--                collation — in column order)
--   constraint   tci.t.conname, contype                   md5(pg_get_constraintdef)
--   index        tci.idx, on table                        md5(pg_get_indexdef)
--   trigger      tci.t.tgname, enabled flag               md5(pg_get_triggerdef)
--   view         tci.v, relkind + reloptions              md5(pg_get_viewdef)
--   type         tci.enum / domain / composite            md5 of labels / def
--   sequence     tci.seq                                  md5 of its parameters
--   policy       schema.table.policy (tci + storage),     md5(qual | with_check)
--                cmd, permissive, roles
--   grant        object + grantee, privileges (* = WITH GRANT OPTION); one row
--                per (object, grantee). Covers the tci schema, its relations,
--                columns, functions and sequences. The object's owner is
--                written OWNER and NULL acls are expanded to the built-in
--                default, so ownership and "never granted" vs "granted the
--                default" do not show up as drift.
--   default_acl  ALTER DEFAULT PRIVILEGES in tci or global — what the NEXT
--                migration's objects will get
--
-- Read-only, plain SQL (no psql meta-commands) so it also runs through the
-- Supabase MCP `execute_sql`. Locally, for a TSV:
--
--   psql -X -At -F "$(printf '\t')" -d <db> -f tools/db/schema-fingerprint.sql > fp.tsv
--
-- Deparsed text can differ between Postgres MAJOR versions; compare a replay
-- on the same major as canonical (17).

with
fn as (
  select p.oid, n.nspname, p.proname, p.proowner, p.proacl, p.prokind,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci'
),
rel as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relacl,
         c.relrowsecurity, c.relforcerowsecurity, c.reloptions
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'tci'
     and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
),
-- privileges, one row per (object, grantee)
acl as (
  select 'schema' as on_kind, n.nspname as obj, x.grantee, x.privilege_type, x.is_grantable, n.nspowner as owner
    from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x
   where n.nspname = 'tci'
  union all
  select case r.relkind when 'S' then 'sequence' else 'relation' end,
         r.nspname || '.' || r.relname, x.grantee, x.privilege_type, x.is_grantable, r.relowner
    from rel r, aclexplode(coalesce(r.relacl, acldefault((case r.relkind when 'S' then 's' else 'r' end)::"char", r.relowner))) x
  union all
  select 'column', r.nspname || '.' || r.relname || '.' || a.attname,
         x.grantee, x.privilege_type, x.is_grantable, r.relowner
    from rel r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null,
         aclexplode(a.attacl) x
  union all
  select 'function', f.nspname || '.' || f.proname || '(' || f.args || ')',
         x.grantee, x.privilege_type, x.is_grantable, f.proowner
    from fn f, aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) x
),
rows as (
  -- schema
  select 'schema' as kind, n.nspname::text as name, '' as detail, md5('') as md5
    from pg_namespace n where n.nspname = 'tci'

  -- functions and procedures (aggregates have no functiondef)
  union all
  select 'function', f.nspname || '.' || f.proname, f.args,
         md5(pg_get_functiondef(f.oid))
    from fn f where f.prokind in ('f', 'p')

  -- tables: flags in detail, column list in md5
  union all
  select 'table', r.nspname || '.' || r.relname,
         'relkind=' || r.relkind::text
           || ' rls=' || case when r.relrowsecurity then 'on' else 'off' end
           || ' force=' || case when r.relforcerowsecurity then 'on' else 'off' end
           || coalesce(' options=' || array_to_string(r.reloptions, ','), ''),
         md5(coalesce((
           select string_agg(
                    a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                    || case when a.attnotnull then ' not null' else '' end
                    || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
                    || case a.attidentity when 'a' then ' identity always' when 'd' then ' identity by default' else '' end
                    || case a.attgenerated when 's' then ' generated stored' else '' end
                    || case when a.attcollation <> 0 and a.attcollation <> t.typcollation
                            then ' collate ' || a.attcollation::regcollation::text else '' end,
                    E'\n' order by a.attnum)
             from pg_attribute a
             join pg_type t on t.oid = a.atttypid
             left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped), ''))
    from rel r where r.relkind in ('r', 'p', 'f')

  -- constraints (table and domain)
  union all
  select 'constraint', r.nspname || '.' || r.relname || '.' || c.conname, c.contype::text,
         md5(pg_get_constraintdef(c.oid))
    from pg_constraint c join rel r on r.oid = c.conrelid

  -- indexes
  union all
  select 'index', r.nspname || '.' || i.relname, 'on ' || r.relname,
         md5(pg_get_indexdef(i.oid))
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join rel r on r.oid = x.indrelid

  -- triggers (user-defined only; FK triggers are covered by the constraints)
  union all
  select 'trigger', r.nspname || '.' || r.relname || '.' || t.tgname, 'enabled=' || t.tgenabled::text,
         md5(pg_get_triggerdef(t.oid))
    from pg_trigger t join rel r on r.oid = t.tgrelid
   where not t.tgisinternal

  -- views and materialized views
  union all
  select 'view', r.nspname || '.' || r.relname,
         'relkind=' || r.relkind::text || coalesce(' options=' || array_to_string(r.reloptions, ','), ''),
         md5(pg_get_viewdef(r.oid, true))
    from rel r where r.relkind in ('v', 'm')

  -- sequences
  union all
  select 'sequence', r.nspname || '.' || r.relname, '',
         md5(concat_ws(' ', format_type(s.seqtypid, null), s.seqstart, s.seqincrement,
                       s.seqmax, s.seqmin, s.seqcache, s.seqcycle))
    from rel r join pg_sequence s on s.seqrelid = r.oid

  -- types: enums (labels in sort order), domains, composites (not row types)
  union all
  select 'type', n.nspname || '.' || t.typname,
         case t.typtype when 'e' then 'enum' when 'd' then 'domain' when 'c' then 'composite' else t.typtype::text end,
         md5(case t.typtype
               when 'e' then (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
                                from pg_enum e where e.enumtypid = t.oid)
               when 'd' then format_type(t.typbasetype, t.typtypmod)
                             || case when t.typnotnull then ' not null' else '' end
                             || coalesce(' default ' || t.typdefault, '')
                             || coalesce((select ' ' || string_agg(pg_get_constraintdef(c.oid), ' ' order by c.conname)
                                            from pg_constraint c where c.contypid = t.oid), '')
               when 'c' then (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
                                from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped)
             end)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'tci'
     and (t.typtype in ('e', 'd')
          or (t.typtype = 'c' and (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c'))

  -- RLS policies on tci tables and on storage (the claim-documents and
  -- wording buckets' policies live on storage.objects)
  union all
  select 'policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
         'cmd=' || p.cmd || ' ' || lower(p.permissive)
           || ' roles=' || array_to_string(array(select x::text from unnest(p.roles) x order by x::text collate "C"), ','),
         md5(coalesce(p.qual, '') || ' | ' || coalesce(p.with_check, ''))
    from pg_policies p
   where p.schemaname in ('tci', 'storage')

  -- grants, one row per (object, grantee)
  union all
  select 'grant', a.on_kind || ' ' || a.obj || ' to '
           || case when a.grantee = 0 then 'PUBLIC'
                   when a.grantee = a.owner then 'OWNER'
                   else pg_get_userbyid(a.grantee) end,
         string_agg(a.privilege_type || case when a.is_grantable then '*' else '' end, ','
                    order by a.privilege_type collate "C"),
         ''
    from acl a
   group by a.on_kind, a.obj, a.grantee, a.owner

  -- default privileges: in tci, or global (defaclnamespace = 0)
  union all
  select 'default_acl',
         pg_get_userbyid(d.defaclrole) || ' in ' || coalesce(n.nspname, '<all schemas>')
           || ' on ' || case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
                         when 'f' then 'functions' when 'T' then 'types' when 'n' then 'schemas' end
           || ' to ' || case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
         string_agg(x.privilege_type || case when x.is_grantable then '*' else '' end, ','
                    order by x.privilege_type collate "C"),
         ''
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace,
         aclexplode(d.defaclacl) x
   where d.defaclnamespace = 0 or n.nspname = 'tci'
   group by d.defaclrole, n.nspname, d.defaclobjtype, x.grantee
)
select kind, name, detail, md5
  from rows
 order by kind collate "C", name collate "C", detail collate "C";
