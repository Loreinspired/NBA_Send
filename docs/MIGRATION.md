# Migration

## Phase 1 → Phase 2: Google Sheets to Postgres

`db/migrations/003_members.sql`'s columns are named to mirror the Phase-1
Sheet's headers 1:1 (`docs/samples/nba_members_template.md`), so the cutover
is a direct import, not a rewrite:

1. In Google Sheets: **File → Download → Comma-separated values (.csv)**.
2. Lowercase the header row to match the SQL column names (a text editor
   find/replace, or open in a spreadsheet tool and re-save): `First_Name` →
   `first_name`, `Last_Name` → `last_name`, `Email` → `email`,
   `Phone_Number` → `phone_number`, `Financial_Status` → `financial_status`.
3. Add a `branch_id` column to the CSV (same UUID value for every row —
   look it up: `SELECT id FROM branches WHERE slug = 'ado-ekiti';`).
4. Import:
   ```bash
   psql -h <host> -U <user> -d nba_send -c \
     "\copy members(branch_id, first_name, last_name, email, phone_number, financial_status) FROM 'export.csv' WITH CSV HEADER"
   ```
5. Verify counts match: `SELECT count(*) FROM members WHERE branch_id = '<id>';` against the Sheet's row count.
6. Flip `DATA_SOURCE=postgres` in `.env` (already the default in this repo)
   and restart the `n8n` service so `Fetch Members (Postgres)` is the active
   branch of `Data Source Router` in `broadcast-main.workflow.json`.

See `scripts/import_sheet_to_postgres.md` for the same procedure with more
detail on handling edge cases (duplicate phone numbers, blank emails).

## National rollout: adding a branch

Because multi-tenancy is row-level (`branch_id` + RLS, not schema-per-branch
— see `docs/ARCHITECTURE.md`), onboarding a new branch (Ikeja, Abuja, ...)
is a data operation, not a deployment:

1. Insert the branch:
   ```sql
   INSERT INTO branches (slug, name, sms_sender_id)
   VALUES ('ikeja', 'NBA Ikeja Branch', 'NBA-IKJ');
   ```
2. Insert its three sender profiles (PRO/Chairman/Secretariat), same shape
   as `db/migrations/008_seed_dev_data.sql`.
3. Import its member roster via the same Sheets→Postgres procedure above,
   using the new branch's `branch_id`.
4. Register the branch's own Sendchamp Sender ID (see
   `docs/SENDCHAMP_SETUP.md`).

**Known follow-up work, not built in this pass**: the admin GUI currently
composes broadcasts for a single `DEFAULT_BRANCH_SLUG` (env-configured).
Supporting multiple branches from one admin GUI deployment needs a branch
selector added to `admin-gui/public/index.html` (populated from
`SELECT slug, name FROM branches`) plus a per-user branch-to-secretary
mapping so a branch secretary can't select another branch's slug — i.e. a
real authentication/authorization layer beyond the current shared
username/password gate. Until then, run one admin-gui deployment per branch
(cheap — it's a single small container) or extend the GUI before rolling
out nationally.

## National Executive cross-branch overview

With `app.current_branch_id` set to `'ALL'` in a session, any of the
existing tables are queryable across all branches — e.g.
`SELECT b.name, count(*) FROM members m JOIN branches b ON b.id = m.branch_id GROUP BY b.name;`
No new workflow or schema is needed for this; it's a direct consequence of
the row-level multi-tenancy design.
