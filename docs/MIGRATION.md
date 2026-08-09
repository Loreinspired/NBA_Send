# Migration

## Phase 1 → Phase 2: Google Sheets to Postgres

`db/migrations/003_members.sql`'s columns are named to mirror the Phase-1
Sheet's headers 1:1 (`docs/samples/nba_members_template.md`), so the cutover
is a direct import, not a rewrite.

### Recommended: import via admin-gui

Log into admin-gui → **Import Contacts** tab:

1. In Google Sheets: **File → Download → Comma-separated values (.csv)**.
2. Upload the CSV as-is — header capitalization/spacing doesn't matter
   (`First_Name`, `first_name`, and `First Name` all match), so the manual
   lowercase-and-edit step the old CLI procedure needed isn't necessary
   anymore.
3. Click **Preview** — every row is validated against the same rules the
   database enforces (required Phone_Number in `+234XXXXXXXXXX` format,
   valid Financial_Status, no duplicate phone numbers within the file) and
   shown with a per-row OK/error status before anything is written.
4. Click **Confirm Import** — matches existing contacts by phone number and
   updates them (without touching `committee_role`/`amount_due`, which
   aren't part of the Sheet and may have been set by hand elsewhere in the
   app); new phone numbers are added. Reports how many were added vs.
   updated.

No `branch_id` lookup, no `psql`/CLI access, and no separate flip of
`DATA_SOURCE` needed — postgres has been the default and tested data
source since this repo's Schedule Trigger rewrite (see `n8n/README.md`).

### Fallback: manual `\copy` (no admin-gui deployment yet, or CLI preferred)

1. Follow steps 1–2 above, except do lowercase the header row to match the
   SQL column names first (a text editor find/replace): `First_Name` →
   `first_name`, `Last_Name` → `last_name`, `Email` → `email`,
   `Phone_Number` → `phone_number`, `Financial_Status` → `financial_status`.
2. Add a `branch_id` column to the CSV (same UUID value for every row —
   look it up: `SELECT id FROM branches WHERE slug = 'ado-ekiti';`).
3. Import:
   ```bash
   psql -h <host> -U <user> -d nba_send -c \
     "\copy members(branch_id, first_name, last_name, email, phone_number, financial_status) FROM 'export.csv' WITH CSV HEADER"
   ```
4. Verify counts match: `SELECT count(*) FROM members WHERE branch_id = '<id>';` against the Sheet's row count.

See `scripts/import_sheet_to_postgres.md` for the same procedure with more
detail on handling edge cases (duplicate phone numbers, blank emails) —
useful background even when using the admin-gui path, since it validates
against the same constraints.

## National rollout: adding a branch

Because multi-tenancy is row-level (`branch_id` + RLS, not schema-per-branch
— see `docs/ARCHITECTURE.md`), onboarding a new branch (Ikeja, Abuja, ...)
is a data operation, not a deployment:

1. Insert the branch:
   ```sql
   INSERT INTO branches (slug, name, sms_sender_id)
   VALUES ('ikeja', 'NBA Ikeja Branch', 'NBA-IKJ');
   ```
2. Define its three sender profiles (PRO/Chairman/Secretariat) via
   admin-gui's **Sender Profiles** tab — same shape as
   `db/migrations/008_seed_dev_data.sql`'s seed rows, entered through the
   form instead of SQL now. (Requires `DEFAULT_BRANCH_SLUG` on that
   deployment to be set to the new branch first — see the multi-branch
   caveat below.)
3. Import its member roster via the same Sheets→Postgres procedure above
   (admin-gui's **Import Contacts** tab, or the manual fallback), using the
   new branch's `branch_id`.
4. Register the branch's own Multitexter Sender ID (see
   `docs/PROVIDERS_SETUP.md`).

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
