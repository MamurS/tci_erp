#!/usr/bin/env bash
# tools/db/replay.sh — rebuild the TCI schema from the repository and run the
# database tests. Used locally and by .github/workflows/db.yml.
#
#   tools/db/replay.sh [--no-bootstrap] [--no-tests] [--tests-only] <database>
#
# <database> is anything `psql -d` accepts: a name (tci_phaseb) or a URL
# (postgresql://postgres:postgres@localhost:5432/tci_phaseb). The usual libpq
# variables (PGHOST, PGUSER, PGPASSWORD, …) apply.
#
# Default run, on a FRESH, EMPTY database:
#   1. tools/db/bootstrap.sql            (the Supabase stub)
#   2. supabase/migrations/*.sql          in file-name order, one transaction
#                                         per file (--single-transaction, as
#                                         apply_migration does: 0015 relies on
#                                         a temp table surviving between
#                                         statements)
#   3. tests/db/*.sql                     in file-name order; each rolls back
# and stops at the first error with the failing file and its last lines.
#
#   --no-bootstrap  the stub is already there (re-running into the same DB is
#                   NOT supported: the migrations are not idempotent)
#   --no-tests      replay only
#   --tests-only    run tests/db/*.sql against an existing database (a
#                   backup restored into local Postgres — see
#                   docs/BACKUP-RESTORE.md)
#
# The connecting role must be a superuser: the tests assume supabase_auth_admin
# with SET SESSION AUTHORIZATION, exactly as GoTrue calls the auth hooks.
set -euo pipefail

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2; }

do_bootstrap=1 do_migrations=1 do_tests=1 db=''
for arg in "$@"; do
  case "$arg" in
    --no-bootstrap) do_bootstrap=0 ;;
    --no-tests) do_tests=0 ;;
    --tests-only) do_bootstrap=0; do_migrations=0 ;;
    -h|--help) usage ;;
    -*) echo "replay.sh: unknown option $arg" >&2; usage ;;
    *) [ -z "$db" ] || { echo "replay.sh: one database only" >&2; usage; }; db="$arg" ;;
  esac
done
[ -n "$db" ] || usage

# File-name order regardless of the caller's locale; migrations carry ru/uz
# text, so the client encoding is pinned too.
LC_COLLATE=C
export PGCLIENTENCODING=UTF8

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$(cd "$here/../.." && pwd)"   # TCI_ERP/

# run <file> [psql options]: one psql session, stop on the first error.
# Output is kept and shown only on failure (NOTICE lines included: the tests
# report through RAISE NOTICE, and the last notice usually names the check).
run() {
  local file="$1" out
  shift
  if ! out=$(psql -X -q -d "$db" -v ON_ERROR_STOP=1 "$@" -f "$file" 2>&1); then
    echo "FAILED  ${file#"$app"/}" >&2
    printf '%s\n' "$out" | tail -20 >&2
    exit 1
  fi
  printf '%s\n' "$out"
}

if [ "$do_bootstrap" = 1 ]; then
  run "$here/bootstrap.sql" --single-transaction > /dev/null
  echo "bootstrap  ok"
fi

if [ "$do_migrations" = 1 ]; then
  n=0
  for f in "$app"/supabase/migrations/*.sql; do
    run "$f" --single-transaction > /dev/null
    n=$((n + 1))
  done
  echo "migrations ok  ($n files, last $(basename "$f"))"
fi

if [ "$do_tests" = 1 ]; then
  n=0
  for f in "$app"/tests/db/*.sql; do
    # Not --single-transaction: each test opens and rolls back its own.
    # On success each prints one "<name>: OK — …" notice.
    out=$(run "$f")
    ok=$(printf '%s\n' "$out" | grep -o '[a-z_]*: OK.*' | tail -1 || true)
    [ -n "$ok" ] || { echo "FAILED  ${f#"$app"/}: no OK notice" >&2; exit 1; }
    echo "test       $ok"
    n=$((n + 1))
  done
  echo "tests      ok  ($n files)"
fi
