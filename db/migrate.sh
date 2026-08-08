#!/usr/bin/env bash
# Idempotent migration runner: creates the app database if missing, tracks
# applied migrations in a schema_migrations table, and applies any new
# db/migrations/*.sql files in filename order. Safe to run on every
# `docker compose up`.
set -euo pipefail

: "${PGHOST:?PGHOST must be set}"
: "${PGUSER:?PGUSER must be set}"
: "${PGPASSWORD:?PGPASSWORD must be set}"
: "${PGDATABASE:?PGDATABASE must be set (target app database name)}"

MIGRATIONS_DIR="$(dirname "$0")/migrations"
export PGPASSWORD

echo "Waiting for Postgres at ${PGHOST}..."
until psql -h "$PGHOST" -U "$PGUSER" -d postgres -c '\q' 2>/dev/null; do
    sleep 1
done

echo "Ensuring database '${PGDATABASE}' exists..."
DB_EXISTS=$(psql -h "$PGHOST" -U "$PGUSER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${PGDATABASE}'")
if [ "$DB_EXISTS" != "1" ]; then
    psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "CREATE DATABASE \"${PGDATABASE}\";"
fi

psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c \
    "CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );"

for migration in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
    name="$(basename "$migration")"
    ALREADY_APPLIED=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc \
        "SELECT 1 FROM schema_migrations WHERE filename = '${name}'")
    if [ "$ALREADY_APPLIED" == "1" ]; then
        echo "Skipping already-applied migration: ${name}"
        continue
    fi
    echo "Applying migration: ${name}"
    psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -f "$migration"
    psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c \
        "INSERT INTO schema_migrations (filename) VALUES ('${name}');"
done

echo "All migrations applied."
