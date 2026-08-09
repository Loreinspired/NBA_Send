# n8n credentials to create manually

Credentials are deliberately **not** stored in the workflow JSON files (n8n
never exports secret values, only credential references) and cannot be
created by this repo — n8n's credential store is encrypted per-instance.
After importing `broadcast-main.workflow.json` and
`broadcast-reaper.workflow.json` (see `../README.md` — those are the only
two that should be imported), create these in the n8n UI
(`Settings → Credentials → New`) and re-link each node that shows a missing
credential warning:

| Credential name (must match exactly) | Type | Used by | Where the value comes from |
|---|---|---|---|
| `NBA Postgres (App DB)` | Postgres | Every Postgres node | Host `postgres` (or your DB host), database = `.env`'s `APP_DB_NAME`, user/password = `nba_app_runtime`/`.env`'s `NBA_APP_RUNTIME_PASSWORD` — **not** `POSTGRES_USER`/`POSTGRES_PASSWORD`, which owns the tables and would silently bypass Row-Level Security |
| `Brevo API` | Header Auth | `Send via Brevo Email` HTTP Request node | Header name `api-key` (not `Authorization`), value = your `.env`'s `BREVO_API_KEY` — see `../../docs/PROVIDERS_SETUP.md` |
| `Sendchamp API` | Header Auth | `Send via Sendchamp WhatsApp` HTTP Request node | Header name `Authorization`, value `Bearer <your SENDCHAMP_API_KEY>` — see `../../docs/PROVIDERS_SETUP.md` |
| `NBA Google Sheets` | Google Sheets OAuth2 API | `Fetch Members (Sheets)` | A Google account with access to the branch's members spreadsheet. Not required if `DATA_SOURCE=postgres` (the default). |

**`Send via Multitexter SMS` needs no n8n credential** — Multitexter
authenticates with account email+password inside the request body, so that
node reads `MULTITEXTER_EMAIL`/`MULTITEXTER_PASSWORD` directly from
environment variables instead.

**`Admin GUI Webhook Secret`** was used by the now-parked
`workflows/superseded/` workflows (Webhook-trigger nodes, affected by the
n8n webhook-registration bug — see `../README.md`). It's not used by
anything that should actually be imported; documented here only in case
that bug is ever fixed upstream and it's worth reviving those workflows.

## Least-privilege Postgres role (required, not just recommended)

`db/migrations/010_nba_app_runtime_role.sql` creates the `nba_app_runtime`
role that the `NBA Postgres (App DB)` credential above must use — a role
that is **not** a table owner, so Row-Level Security in
`../../db/migrations/007_row_level_security.sql` actually applies to it
instead of being silently bypassed. Its password is set by `db/migrate.sh`
from the `NBA_APP_RUNTIME_PASSWORD` env var, never committed to a file. The
`postgres`/`db-migrate` services in `docker-compose.yml` still use a
superuser-ish owner role, but only for running migrations — never use that
role for the n8n Postgres credential or for admin-gui's database
connection.

`db/migrations/012_rls_helper_functions.sql` (also applied automatically by
`db/migrate.sh`) is equally required — every query every Postgres node runs
is a call to one of the functions it defines
(`claim_next_pending_broadcast()`, `fetch_sender_profile()`, ...), each
already `GRANT EXECUTE`'d to `nba_app_runtime` by that migration. See
`../README.md`'s "Verified by real local testing" section for why these
functions exist instead of a simpler inline query.
