# Backup and restore

Audit Phase B.1. The canonical database (`tci_erp`, ref
`reunqrpeumokqgarknge`, Postgres 17) is dumped every night by
`.github/workflows/backup.yml`, encrypted with [age](https://age-encryption.org)
before it touches disk, and kept for **30 days** as a workflow artifact.

| | |
|---|---|
| What | `pg_dump --format=custom --no-owner` of schemas `tci`, `auth`, `storage`, `public`, `supabase_migrations` |
| Not included | **Storage file contents** (claim documents, wording templates and generated contracts: only their `storage.objects` rows are in the dump); Supabase's internal schemas (vault, realtime, graphql, …), which the platform recreates |
| When | 21:17 UTC (02:17 Tashkent) nightly, and on demand (Actions → Nightly backup → Run workflow) |
| Where | Actions → *Nightly backup* → a run → **Artifacts**: `tci-<UTC stamp>` = `tci-<stamp>.dump.age` + `tci-<stamp>.manifest.txt` |
| Who can read it | only the holder of the age **private** key. GitHub, anyone with access to the repository, and the runner see ciphertext only |

The dump contains real policyholder and buyer data and `auth.users` password
hashes. Treat a decrypted dump like the production database.

## 1. One-time setup (owner)

Until both secrets exist the workflow runs, prints a *Backup skipped* notice
and stays green. Nothing is backed up in that state.

### 1.1 Create the age key pair — on your own machine, not a server

```sh
# Ubuntu/Debian: sudo apt install age      macOS: brew install age
age-keygen -o tci-backup.key
# prints:  Public key: age1…   (the public key is also inside the file)
age-keygen -y tci-backup.key   # prints the public key again at any time
```

* `tci-backup.key` is the **private key**. Keep it **offline**: on an
  encrypted USB stick in the safe, plus a second copy in a password manager
  or on paper (it is one line). Never commit it, never put it in a GitHub
  secret, never upload it anywhere. **Without it no backup can be restored;
  if it is lost, every existing backup is lost with it.**
* The `age1…` line is the **public key**. It is not secret.

### 1.2 Get the session-pooler connection string

Supabase dashboard → project **tci_erp** → **Connect** (top bar) →
**Session pooler** → copy the URI. It looks like

```
postgresql://postgres.reunqrpeumokqgarknge:[YOUR-PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
```

Replace `[YOUR-PASSWORD]` with the database password (Project Settings →
Database → *Reset database password* if nobody has it; resetting breaks
anything else that uses it) and append `?sslmode=require`.

### 1.3 Add both repository secrets

GitHub → the repository → **Settings** → **Secrets and variables** →
**Actions** → tab **Secrets** → **New repository secret**, twice:

| Name | Secret |
|---|---|
| `SUPABASE_DB_URL` | the connection string from 1.2 |
| `BACKUP_AGE_RECIPIENT` | the public key `age1…` from 1.1 |

### 1.4 Check it

**Actions** → **Nightly backup** → **Run workflow** (branch `main`). The
*pg_dump → age → artifact* job must be green and the run must show an
artifact `tci-…`. Open the job log: the manifest lists size, sha256 and the
server version. Then do the restore drill (§3) once, so the key is proven
before it is needed.

Scheduled workflows run from the **default branch** only, so the nightly
schedule starts once `backup.yml` is merged to `main`.

## 2. Restore

Restore into a **local Postgres 17** (the procedure below), not into
canonical. If canonical itself must be rolled back, Supabase's own daily
backups / PITR (dashboard → Database → Backups) are the first resort; these
dumps are the copy that does not depend on the Supabase account.

### 2.1 Get and decrypt the dump

```sh
gh run list --workflow backup.yml --limit 5             # pick a run id
gh run download <run-id> --name tci-<stamp> --dir restore   # or the zip from the Actions UI
cd restore
grep sha256 tci-<stamp>.manifest.txt
sha256sum tci-<stamp>.dump.age                          # must match the manifest
age --decrypt --identity /path/to/tci-backup.key \
    --output tci.dump tci-<stamp>.dump.age
```

### 2.2 Restore into a fresh database

Postgres **17** client and server (`sudo apt install postgresql-17` from
apt.postgresql.org, or `brew install postgresql@17`), connecting as a
superuser.

```sh
createdb tci_restore

psql -X -v ON_ERROR_STOP=1 -d tci_restore <<'SQL'
-- roles the dump's grants and policies name (cluster-wide; skipped if present)
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator',
                           'supabase_auth_admin', 'supabase_storage_admin',
                           'supabase_admin', 'dashboard_user'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
-- Supabase keeps extensions in schema `extensions`; the dump does not create them
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
do $$ begin
  execute format('alter database %I set search_path = public, extensions', current_database());
end $$;
SQL

pg_restore --no-owner --dbname=tci_restore tci.dump
```

`pg_restore` continues past errors and reports their count at the end.
Expected: `schema "public" already exists` (every new database has one), and
possibly grants or objects in `auth` / `storage` that name a Supabase role or
extension the prelude does not create. **Any error on a `tci` object is a
failed restore** — investigate before trusting the backup.

### 2.3 Check it

```sh
cd /path/to/tci_erp/TCI_ERP
tools/db/replay.sh --tests-only tci_restore             # all tests/db/*.sql
psql -d tci_restore -c "select count(*) from tci.legal_entities"
psql -d tci_restore -c "select count(*) from tci.policies"
psql -d tci_restore -c "select count(*) from tci.credit_limit_decisions"
psql -d tci_restore -c "select max(created_at) from tci.workflow_events"  # ≈ the backup time
```

### 2.4 Clean up

```sh
dropdb tci_restore
shred -u tci.dump        # macOS: rm -P tci.dump
```

## 3. Quarterly restore drill

First working week of January, April, July and October — and once right
after the setup in §1. It proves three things: the artifact exists, the
offline key still decrypts it, and the restored database passes the
database tests.

1. Download the **latest** nightly artifact and check its sha256 (§2.1).
   Confirm in the Actions list that the last 7 nights all produced one.
2. Decrypt it with the offline private key (§2.1).
3. Restore into a fresh local Postgres 17 database (§2.2). Note the error
   count; none may concern a `tci` object.
4. Run `tools/db/replay.sh --tests-only tci_restore` (§2.3). All ten (or
   however many `tests/db/*.sql` there are by then) must print `OK`. Every
   test runs in a transaction it rolls back, so the restored data is not
   changed.
5. Spot-check the counts in §2.3 against the live screens.
6. Optional, for schema drift: fingerprint the restored database and compare
   it with a fresh replay (`tools/db/ledger-check.md`). A view can differ
   cosmetically after a dump round trip (`'x'::text` becomes
   `'x'::text AS text` in a UNION branch); anything else is real.
7. Drop the database and shred the plaintext dump (§2.4).
8. Add a line to the log below and commit it.

The tests need a **superuser** (two of them assume GoTrue's role with
`SET SESSION AUTHORIZATION`), which is why the drill restores locally and
not into a Supabase branch, where `postgres` is not one.

### Drill log

| Date | Artifact | Errors in pg_restore (non-tci) | Tests | By |
|---|---|---|---|---|
| | | | | |

## 4. Known gaps

* **Storage files are not backed up.** Claim documents and contract
  templates live in Supabase Storage; the dump holds only their metadata.
  A mirror of the buckets (and of these dumps) to storage the owner controls
  outside Supabase and GitHub is the remaining part of roadmap item B.1.
* **Artifacts last 30 days** and live in the same GitHub account as the
  code. A longer, off-GitHub copy is part of the same mirror.
* **The secret holds the `postgres` password**, which can write. A dedicated
  read-only backup role would be better; it needs read access to `auth` and
  `storage` as well as `tci`, which has to be checked on Supabase first.
