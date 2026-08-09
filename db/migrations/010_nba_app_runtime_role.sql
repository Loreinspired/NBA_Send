-- Actually creates the least-privilege runtime role that
-- n8n/credentials/README.md has documented since the first pass but never
-- implemented. Both n8n's Postgres credential and admin-gui's direct
-- Postgres connection use this role, not the migration-owner role, so
-- Row-Level Security (007) is genuinely enforced rather than silently
-- bypassed. No password is set here — see db/migrate.sh, which sets it
-- from the NBA_APP_RUNTIME_PASSWORD env var so the secret never lands in
-- a committed file. Roles have no CREATE ROLE IF NOT EXISTS, hence the
-- guard block.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nba_app_runtime') THEN
        CREATE ROLE nba_app_runtime LOGIN;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE :"app_db_name" TO nba_app_runtime;
GRANT USAGE ON SCHEMA public TO nba_app_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO nba_app_runtime;
-- Deliberately no DELETE, no DDL, no sequence/schema-alteration rights —
-- matches the least-privilege intent already documented in
-- n8n/credentials/README.md.

-- broadcasts.failure_reason: lets the Schedule-Trigger-based broadcast
-- workflow (see n8n/workflows/broadcast-main.workflow.json) record *why*
-- a broadcast failed, not just that it did — a bare 'failed' status with
-- no detail is undiagnosable once a poll execution has moved on.
ALTER TABLE broadcasts ADD COLUMN failure_reason TEXT;
