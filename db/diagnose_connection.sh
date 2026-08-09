#!/usr/bin/env bash
# One-off connectivity/credential check for nba_app_runtime, run the same
# way as migrate.sh (see db/Dockerfile) — useful when a "password
# authentication failed" error for the runtime role shows up somewhere
# that can't reach Postgres directly (this repo's own sandboxed dev
# environment included; see docs/DEPLOYMENT.md).
set -uo pipefail

: "${PGHOST:?PGHOST must be set}"
: "${PGUSER:?PGUSER must be set (owner role, e.g. postgres.<project-ref> on Supabase)}"
: "${PGPASSWORD:?PGPASSWORD must be set (owner role's password)}"
: "${NBA_APP_RUNTIME_PASSWORD:?NBA_APP_RUNTIME_PASSWORD must be set}"
: "${RUNTIME_PGUSER:?RUNTIME_PGUSER must be set (the exact value the failing service's PGUSER env var uses)}"

echo "=== Test 1: connect as \$RUNTIME_PGUSER with the current NBA_APP_RUNTIME_PASSWORD ==="
PGPASSWORD="$NBA_APP_RUNTIME_PASSWORD" psql -h "$PGHOST" -p 5432 -U "$RUNTIME_PGUSER" -d postgres -c "SELECT current_user, now();"
echo "exit code: $?"

echo ""
echo "=== Test 2: reset the password as owner, then retest immediately ==="
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5432 -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
  -v pw="$NBA_APP_RUNTIME_PASSWORD" -c "ALTER ROLE nba_app_runtime PASSWORD :'pw';"
echo "reset exit code: $?"

echo ""
echo "=== Test 3: retest connection right after reset ==="
PGPASSWORD="$NBA_APP_RUNTIME_PASSWORD" psql -h "$PGHOST" -p 5432 -U "$RUNTIME_PGUSER" -d postgres -c "SELECT current_user, now();"
echo "exit code: $?"
