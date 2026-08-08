# n8n credentials to create manually

Credentials are deliberately **not** stored in the workflow JSON files (n8n
never exports secret values, only credential references) and cannot be
created by this repo — n8n's credential store is encrypted per-instance.
After importing the workflows, create these in the n8n UI
(`Settings → Credentials → New`) and re-link each node that shows a missing
credential warning:

| Credential name (must match exactly) | Type | Used by | Where the value comes from |
|---|---|---|---|
| `Admin GUI Webhook Secret` | Header Auth | `Broadcast Trigger`, `Lookup Trigger` webhook nodes | Header name `X-Webhook-Secret`, value = your `.env`'s `N8N_WEBHOOK_SECRET` |
| `NBA Postgres (App DB)` | Postgres | Every Postgres node | Host `postgres` (or your DB host), database = `.env`'s `APP_DB_NAME`, user/password = `.env`'s `POSTGRES_USER`/`POSTGRES_PASSWORD` (or a dedicated least-privilege app role — see note below) |
| `Brevo API` | Header Auth | `Send via Brevo Email`, `Send via Brevo WhatsApp` HTTP Request nodes | Header name `api-key` (not `Authorization`), value = your `.env`'s `BREVO_API_KEY` — see `../../docs/PROVIDERS_SETUP.md` |
| `NBA Google Sheets` | Google Sheets OAuth2 API | `Fetch Members (Sheets)` | A Google account with access to the branch's members spreadsheet. Not required if `DATA_SOURCE=postgres` (the default). |

**`Send via Multitexter SMS` needs no n8n credential** — Multitexter
authenticates with account email+password inside the request body, so that
node reads `MULTITEXTER_EMAIL`/`MULTITEXTER_PASSWORD` directly from
environment variables instead.

## Least-privilege Postgres role (recommended before any real deployment)

The `postgres`/`db-migrate` services in `docker-compose.yml` use a superuser-ish
owner role so migrations and RLS setup always work. For the `NBA Postgres (App DB)`
credential n8n actually uses at runtime, create a separate role that is
**not** a table owner (so Row-Level Security in
`../../db/migrations/007_row_level_security.sql` actually applies to it):

```sql
CREATE ROLE nba_app_runtime LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE nba_send TO nba_app_runtime;
GRANT USAGE ON SCHEMA public TO nba_app_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO nba_app_runtime;
```

Use `nba_app_runtime` (not `POSTGRES_USER`) for the n8n Postgres credential
once you move past local dev.
