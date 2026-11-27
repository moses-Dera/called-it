#!/usr/bin/env bash
# Apply every migration to a throwaway local Postgres, then run an optional SQL test file against it.
#   scripts/test-migrations.sh                 # just check that all migrations apply
#   scripts/test-migrations.sh my-test.sql     # then run my-test.sql (psql, errors do not stop it)
# Needs PostgreSQL server binaries (Ubuntu: apt install postgresql). Nothing touches the real database.
# In tests, impersonate a user with: select set_config('test.uid', '<uuid>', false);  ('' = service role)
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
[ -x "$BIN/initdb" ] || { echo "PostgreSQL server binaries not found"; exit 1; }
WORK=$(mktemp -d); SOCK=$(mktemp -d /tmp/pgsk.XXXX); PORT=55432
cleanup() { "$BIN/pg_ctl" -D "$WORK/db" stop >/dev/null 2>&1 || true; rm -rf "$WORK" "$SOCK"; }
trap cleanup EXIT
"$BIN/initdb" -D "$WORK/db" -U postgres >/dev/null 2>&1
"$BIN/pg_ctl" -D "$WORK/db" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$WORK/log" start >/dev/null
sleep 2
P="psql -h $SOCK -p $PORT -U postgres -q"
# Minimal stand-ins for what Supabase provides.
$P -v ON_ERROR_STOP=1 <<'SQL'
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql as $$ select 'authenticated' $$;
create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;
SQL
for f in supabase/migrations/*.sql; do
  $P -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$WORK/err" || { echo "FAILED: $f"; head -5 "$WORK/err"; exit 1; }
done
echo "All $(ls supabase/migrations/*.sql | wc -l) migrations applied."
if [ "${1:-}" != "" ]; then $P -f "$1"; fi
