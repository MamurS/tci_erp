# Ledger check — does canonical match the repository?

Audit Phase B.2. The committed migrations are the authoritative text, but
canonical was not always built from them file by file: 0043, 0046, 0049,
0051 and 0055 went over in chunks (`execute_sql` + a ledger entry carrying
the closing sections), and the owner ran parts of 0046–0048 and 0055 in the
SQL Editor. This procedure proves that what canonical ended up with is what a
clean replay of the repository produces — and finds where it is not.

It compares **schema, not data**, and only what the TCI migrations own: the
`tci` schema (functions, tables, columns, constraints, indexes, triggers,
views, sequences, types, grants, default privileges) and the RLS policies on
`tci` and `storage` tables.

## What you need

* A Postgres **17** (canonical's major — deparsed definitions and the
  privilege list differ between majors: PG17 adds `MAINTAIN`). Locally:
  `pg_lsclusters`; in CI the `DB replay` workflow already runs on 17.
* Read access to canonical: either `psql` with the session-pooler connection
  string (`SUPABASE_DB_URL`, see `docs/BACKUP-RESTORE.md`), or the Supabase
  MCP `execute_sql` tool. The fingerprint is one plain read-only `SELECT`, so
  both work.

## 1. Fingerprint a clean replay

```sh
cd TCI_ERP
createdb tci_ledger                                   # an EMPTY database on PG17
tools/db/replay.sh tci_ledger                         # stub + 0001…latest + tests
psql -X -At -F "$(printf '\t')" -d tci_ledger \
  -f tools/db/schema-fingerprint.sql > local.tsv
ls supabase/migrations > local-files.txt
```

The tests roll back, so running them first does not change the fingerprint.

## 2. Fingerprint canonical

With psql, in a read-only session:

```sh
PGOPTIONS='-c default_transaction_read_only=on' \
psql "$SUPABASE_DB_URL" -X -At -F "$(printf '\t')" \
  -f tools/db/schema-fingerprint.sql > canonical.tsv
```

Through MCP: pass the file's text to `execute_sql` on project
`reunqrpeumokqgarknge` (never another project) and write the rows out as
`kind<TAB>name<TAB>detail<TAB>md5`, in the order returned.

**Large result?** Compare per-kind digests first and fetch only the kinds
that differ. The digest query is the fingerprint with its last `select`
replaced:

```sh
{ sed '/^select kind, name, detail, md5$/,$d' tools/db/schema-fingerprint.sql
  echo "select kind, count(*) as n, md5(string_agg(concat_ws(E'\t', name, detail, md5), E'\n' order by name collate \"C\", detail collate \"C\")) as digest from rows group by kind order by kind collate \"C\";"
} > /tmp/fp-digest.sql
```

Equal digest ⇒ that kind is identical; a different one ⇒ fetch that kind's
rows (`… from rows where kind = 'grant' order by …`) and diff them.

## 3. Diff

```sh
diff local.tsv canonical.tsv
```

Ownership never shows up (an owner's own privileges are written `OWNER`), nor
does "never granted" vs "explicitly granted the default" (NULL acls are
expanded). Every remaining line is a real difference. Expected, harmless
ones, to note and move past:

* `default_acl … <all schemas>` rows on canonical only: Supabase's own global
  default privileges for `postgres` / `supabase_admin`. They do not change any
  existing object, but they DO decide what the next migration's objects get —
  read them; a default that grants `EXECUTE` to `anon` would matter.
* a `view` md5 difference where the definitions differ only by `AS`
  aliases in UNION branches (`'x'::text` vs `'x'::text AS text`): the view
  was re-created from deparsed text (a dump round trip does this). Compare
  `pg_get_viewdef('tci.<view>'::regclass, true)` on both sides to confirm,
  then note it.
* nothing else is expected. In particular a `function` md5 difference means
  the body differs, whitespace and comments included (`pg_get_functiondef`
  keeps the source text verbatim).

## 4. Resolve every difference — in the repository

For each line, decide which side is right:

* **Canonical has something the repository does not** (a dashboard edit, a
  hand-run fix): if it should stay, write a NEW numbered migration that makes
  the replay produce it; if it should not, write one that removes it. Never
  edit a migration that canonical already applied.
* **The repository has something canonical lacks** (a chunk that never
  arrived): apply the missing statements to canonical from the committed
  file, with a dry run first if anything is moved or destroyed, as the
  standard phase protocol says.
* Re-run steps 1–3 until `diff` is empty.

## 5. Ledger names (read-only for now)

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

Compare with `local-files.txt`. Canonical's entries do not line up one to
one with the files (chunked applies, entries carrying only closing sections).
Record the mapping; **do not rewrite the ledger yet**. Rewriting
`supabase_migrations.schema_migrations` to the file names is a separate,
controlled step of Phase B.2 (one migration, dry-run on a Supabase branch
first), after which migrations go to canonical only through
`supabase db push` from CI. It waits for the owner.

## Acceptance

* `diff local.tsv canonical.tsv` is empty, apart from the reviewed global
  `default_acl` rows.
* The ledger mapping is written down in the PR that closes the check.
