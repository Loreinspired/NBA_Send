# Phase 1 Google Sheet column contract

Create a Google Sheet named e.g. "NBA Ado-Ekiti Members" with a single
worksheet ("Members") whose header row is **exactly**:

| First_Name | Last_Name | Email | Phone_Number | Financial_Status |
|---|---|---|---|---|

- **First_Name / Last_Name** — required, plain text.
- **Email** — optional (some members may only be reachable by phone); leave the cell blank, don't write "N/A".
- **Phone_Number** — required, full international format `+234XXXXXXXXXX` (no spaces, no leading 0). Example: `+2348011111101`.
- **Financial_Status** — one of `financial`, `non_financial`, or `unknown` (lowercase, matching `db/migrations/003_members.sql`'s enum).

This exact header naming is what lets a straight CSV export be imported into
Postgres with zero transformation — see `../MIGRATION.md`. See
`nba_members_template.csv` for a ready-to-import example with three rows.
