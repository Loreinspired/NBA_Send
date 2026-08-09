# Database

Plain, ordered SQL migration files applied by `migrate.sh` — no external
migration framework, to keep the dependency surface minimal (only the stock
`postgres` image is needed, already present for the `postgres` service).

- `migrations/001_extensions.sql` – `pgcrypto` (UUIDs), `citext` (case-insensitive email)
- `migrations/002_branches.sql` – one row per NBA branch (multi-tenant key)
- `migrations/003_members.sql` – member roster, columns mirror the Phase-1 Google Sheets headers
- `migrations/004_sender_profiles.sql` – PRO / Branch Chairman / Secretariat branding blocks
- `migrations/005_broadcasts.sql` – one row per admin-GUI broadcast submission
- `migrations/006_message_log.sql` – per-member, per-channel delivery audit trail
- `migrations/007_row_level_security.sql` – branch-scoped Row-Level Security policies
- `migrations/008_seed_dev_data.sql` – local-dev-only seed data (skip in production)
- `migrations/009_whatsapp_replies.sql` – `message_log.reply_payload`/`replied_at` for RSVP/payment reply capture
- `migrations/010_nba_app_runtime_role.sql` – the least-privilege runtime role n8n and admin-gui actually connect as (its password is set separately by `migrate.sh`, not in this file)
- `migrations/011_broadcasts_updated_at.sql` – `broadcasts.updated_at`, used by `n8n/workflows/broadcast-reaper.workflow.json` to detect broadcasts stuck mid-pipeline
- `migrations/012_rls_helper_functions.sql` – PL/pgSQL functions that every RLS-scoped query in n8n and admin-gui now goes through (see "RLS and connection pooling" below) — **required**, not optional
- `migrations/013_sender_profile_and_member_management_functions.sql` – RLS-safe functions backing admin-gui's "define a sender profile" and "import contacts from a CSV" features (`upsert_sender_profile`, `set_sender_profile_active`, `list_sender_profiles_for_management`, `bulk_upsert_members`)
- `migrations/014_member_biodata_fields.sql` – extends `members` with the fields NBA's actual "Bio Data" Google Form roster collects beyond the Phase-1 broadcast-only template (title, SCN, year of call, NBA Section/Forum membership, emergency contact, employer/designation/sector)
- `migrations/015_bulk_upsert_members_biodata.sql` – replaces `bulk_upsert_members()` from 013 to also write the fields added in 014
- `migrations/016_custom_contact_groups.sql` – `members.custom_groups TEXT[]` (reusable free-form tags), `broadcasts.target_groups`/`target_member_ids`, and a new `'custom'` `audience_segment_enum` value, backing admin-gui's custom broadcast targeting
- `migrations/017_custom_targeting_functions.sql` – extends `claim_next_pending_broadcast()`, `fetch_members_by_branch()`, and `create_broadcast()` to carry the fields added in 016 through the broadcast pipeline
- `migrations/018_contact_management_functions.sql` – RLS-safe functions backing admin-gui's Contacts tab (`list_members`, `create_member`, `update_member`, `set_member_active`, `list_distinct_custom_groups`)

## Running migrations

In Docker Compose this happens automatically via the `db-migrate` service on
every `docker compose up`. To run manually against a database:

```bash
PGHOST=localhost PGUSER=nba_admin PGPASSWORD=... PGDATABASE=nba_send \
  NBA_APP_RUNTIME_PASSWORD=... ./migrate.sh
```

`migrate.sh` is idempotent: it tracks applied files in a `schema_migrations`
table and only runs new ones.

## RLS and connection pooling

`007_row_level_security.sql` scopes every tenant table to a
`app.current_branch_id` session variable. The obvious way to set that from a
pooled connection — `WITH _ctx AS (SELECT set_config('app.current_branch_id',
'ALL', false)) SELECT ...` — **does not work**, confirmed by direct testing:
an unreferenced CTE never executes at all, and even referenced (e.g. via a
`CROSS JOIN`), Postgres's planner is free to evaluate the RLS policy's
`USING` clause before it, since both are just quals ANDed together with no
ordering guarantee. RLS fails closed, so both failure modes silently look
like "no rows" or "insert rejected," not an error — this went unnoticed
through an earlier pass of this codebase.

`012_rls_helper_functions.sql` fixes this properly: every query that needs
branch context goes through a small PL/pgSQL function
(`claim_next_pending_broadcast()`, `fetch_sender_profile()`,
`list_sender_profiles()`, etc.) where `PERFORM set_config(...)` runs first
and the real query runs second, as two sequential statements inside one
function body — the only statement ordering Postgres actually guarantees.
Callers (n8n's Postgres node, admin-gui) just call
`SELECT * FROM fn($1, ...)` like any other single parameterized statement;
no multi-statement connection affinity or manual SQL-escaping is needed.
These functions are deliberately `SECURITY INVOKER` (the default — do not
add `SECURITY DEFINER`), so RLS applies as whichever role actually calls
them (`nba_app_runtime`), not as the migration-owner role that defines them.

## Production note on seed data

`008_seed_dev_data.sql` is meant for local development only. For a real
branch or National deployment, either delete that file from the branch you
deploy, or manually delete the seeded `ado-ekiti` branch/members/profiles
after confirming the real roster has been imported (see
`../docs/MIGRATION.md`).
