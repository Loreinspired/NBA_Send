# Sheets → Postgres import procedure (detailed)

**For most imports, use admin-gui's Import Contacts tab instead** — it runs
the same validation described below (phone format, financial status,
duplicate detection) automatically and shows per-row errors before
committing, with no CLI/database access needed. See `docs/MIGRATION.md`.

This CLI procedure remains useful as: (a) reference for exactly what "valid"
means, since admin-gui enforces the same rules; (b) a fallback when no
admin-gui deployment exists yet (e.g. the very first import, before anyone
has logged in); or (c) if CLI access is simply preferred. It's a documented
manual procedure, not a script, because it runs rarely (once per branch
onboarding) and touches production member data — a human should review the
CSV before it's imported.

## 1. Export and clean the sheet

1. Download the sheet as CSV.
2. Open it in a text editor (not Excel/Sheets again, to avoid silent
   reformatting of the `+234...` phone numbers into numbers/scientific
   notation) and confirm:
   - Header row is exactly `First_Name,Last_Name,Email,Phone_Number,Financial_Status`.
   - Every `Phone_Number` cell matches `+234` followed by 10 digits — the
     `phone_e164_ng` CHECK constraint in `db/migrations/003_members.sql`
     rejects anything else, so fix these before importing rather than
     having the whole `\copy` fail partway through.
   - `Financial_Status` values are lowercase `financial` / `non_financial` /
     `unknown` (fix any `Financial`/`Yes`/blank values here first).
3. Lowercase the header row to `first_name,last_name,email,phone_number,financial_status`.
4. Insert a `branch_id` column (same value every row) as the first column.
   Look it up first: `SELECT id FROM branches WHERE slug = '<branch-slug>';`

## 2. Check for duplicate phone numbers

`uq_member_branch_phone` in `db/migrations/003_members.sql` rejects a second
member with the same phone number in the same branch. Before importing:

```bash
cut -d, -f5 export_cleaned.csv | sort | uniq -d
```

Any output here is a duplicate to resolve manually (data entry error, or a
genuine shared household number that needs a note in one member's row)
before the import.

## 3. Import

```bash
psql -h <host> -U <user> -d nba_send -c \
  "\copy members(branch_id, first_name, last_name, email, phone_number, financial_status) FROM 'export_cleaned.csv' WITH CSV HEADER"
```

If it fails partway through a CHECK constraint violation, `\copy` rolls back
the whole batch (it runs in one transaction) — fix the offending row and
re-run rather than needing to figure out what partially landed.

## 4. Verify

```sql
SELECT count(*) FROM members WHERE branch_id = '<branch-id>';
SELECT financial_status, count(*) FROM members WHERE branch_id = '<branch-id>' GROUP BY 1;
```

Compare against the sheet's row count and a manual spot-check of a few rows.
