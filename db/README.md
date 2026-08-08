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

## Running migrations

In Docker Compose this happens automatically via the `db-migrate` service on
every `docker compose up`. To run manually against a database:

```bash
PGHOST=localhost PGUSER=nba_admin PGPASSWORD=... PGDATABASE=nba_send ./migrate.sh
```

`migrate.sh` is idempotent: it tracks applied files in a `schema_migrations`
table and only runs new ones.

## Production note on seed data

`008_seed_dev_data.sql` is meant for local development only. For a real
branch or National deployment, either delete that file from the branch you
deploy, or manually delete the seeded `ado-ekiti` branch/members/profiles
after confirming the real roster has been imported (see
`../docs/MIGRATION.md`).
