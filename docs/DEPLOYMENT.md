# Deployment

Two independent paths, per the brief. Local testing via `docker compose up`
(see the root `README.md`) is what was verified first; Option A below (Render
+ Supabase) is what's actually running in production for the Ado-Ekiti
branch, on the free tier of both platforms.

## Option A — 100% free tier (Render + Supabase)

No `docker-compose.yml` is used here — Render runs one service per container,
not a compose stack. (Railway was evaluated first but its "free" tier is a
time/credit-limited trial, not genuinely free long-term, so this project uses
Render instead.)

1. **Supabase**: create a free project. Its Session Pooler connection string
   (port 5432, not the direct/IPv6-only connection) hosts both n8n's
   execution DB and the app schema — same split as local dev: two databases,
   one instance, except Supabase's free tier only allows the one default
   `postgres` database, so `APP_DB_NAME` and n8n's `DB_POSTGRESDB_DATABASE`
   both point at `postgres` rather than being separate. Run `db/migrate.sh`
   once against it (locally, pointing `PGHOST`/etc at the pooler host) to
   apply `db/migrations/*.sql` — this also creates the `nba_app_runtime` role
   both services below connect as.
2. **n8n service**: create a Web Service on Render from the official
   `docker.n8n.io/n8nio/n8n` image. Set the same `DB_*`, `N8N_*`,
   `DATA_SOURCE`, `BREVO_*` (email), `SENDCHAMP_*` (WhatsApp),
   `MULTITEXTER_*` env vars as in `.env.example`, pointing
   `DB_POSTGRESDB_HOST` etc at the Supabase pooler. Also add
   `N8N_LISTEN_ADDRESS=0.0.0.0` (see the comment in `docker-compose.yml` for
   why). Render supplies `N8N_HOST`/TLS automatically — set
   `N8N_PROTOCOL=https` and `WEBHOOK_URL` to the platform-assigned HTTPS URL.
   **Use Render's free `web_service` type, not `background_worker`** — the
   free tier only allows the former, and n8n's Schedule Trigger (see below)
   doesn't need an inbound HTTP listener to work, just to exist as a running
   process.
3. **admin-gui service**: create a second Web Service built from
   `admin-gui/Dockerfile`. Set `PGHOST`/`PGPORT`/`PGUSER=nba_app_runtime`/
   `PGPASSWORD`/`PGDATABASE`/`PGSSLMODE=require` pointing at the same
   Supabase pooler (TLS-encrypted; certificate-chain verification is off —
   `rejectUnauthorized: false` — confirmed necessary by a real failed
   connection against Supabase's pooler from Render, "self-signed
   certificate in certificate chain," matching what n8n's own Postgres
   credential against this same database already needed), plus
   `WEBHOOK_SHARED_SECRET` and the `ADMIN_GUI_*`/`SESSION_SECRET` values.
   admin-gui talks to Postgres directly; it no longer calls n8n at all.
4. **n8n's production webhook registration is broken** (confirmed on this
   deployment across three n8n versions and every activation method — see
   `n8n/workflows/superseded/README.md`), so this architecture doesn't use
   n8n Webhook triggers at all. `broadcast-main.workflow.json` uses a
   Schedule Trigger instead (polls for pending broadcasts every ~25s); import
   it and `broadcast-reaper.workflow.json` (a safety net that fails out any
   broadcast stuck mid-pipeline for over 10 minutes) and activate both. Do
   **not** import the three workflows under `n8n/workflows/superseded/` —
   their logic already lives in admin-gui (`server.js`'s `/api/*` and
   `/webhooks/*` routes).
5. **Keep n8n awake**: Render's free web services spin down after ~15
   minutes idle, which would silently stop the Schedule Trigger poll loop.
   Set up a free external ping instead of paying for an always-on plan —
   e.g. at [cron-job.org](https://cron-job.org), create a job that sends a
   `GET` request to the n8n service's root HTTPS URL every 10 minutes. A
   plain 200/404 response is enough to count as activity; no auth or payload
   needed. After setting this up, confirm the Schedule Trigger is still
   firing after 20+ idle minutes by checking n8n's Executions tab.
6. Create the credentials listed in `n8n/credentials/README.md` (including
   `NBA Postgres (App DB)` using the `nba_app_runtime` role, and `Sendchamp
   API`) against the hosted n8n instance.
7. Register `https://<admin-gui-host>/webhooks/brevo-delivery-status/<WEBHOOK_SHARED_SECRET>`
   as Brevo's transactional webhook URL, and
   `https://<admin-gui-host>/webhooks/sendchamp-whatsapp-reply/<WEBHOOK_SHARED_SECRET>`
   as Sendchamp's WhatsApp inbound webhook URL, once a WhatsApp sender is
   connected (see `docs/PROVIDERS_SETUP.md`).
8. Cost note: Supabase's free tier and Render's free web services both have
   usage caps — fine for a 300-member branch's occasional broadcasts, worth
   monitoring as usage grows.

## Option B — production grade (<$5/mo VPS)

Uses `docker-compose.yml` + `docker-compose.prod.yml` together.

1. Provision a small VPS (Hetzner CX22 or DigitalOcean's cheapest droplet
   both fit comfortably under $5/mo). Point two DNS A records at it — one
   for n8n (e.g. `n8n.nba-adoekiti.org`), one for the admin GUI (e.g.
   `broadcast.nba-adoekiti.org`).
2. Install Docker + Docker Compose plugin on the VPS (see Docker's official
   install docs for your distro).
3. Clone this repo onto the VPS, `cp .env.example .env` and fill in real
   values, including `N8N_HOST` and a new `ADMIN_GUI_HOST` var for the
   second domain (add it to `.env`; referenced by
   `docker/nginx/nginx.conf.template`).
4. Bootstrap TLS and start the stack — see `docker/nginx/README.md` for the
   first-time certificate chicken-and-egg sequence, then:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```
5. Import workflows and set up credentials as in the local quickstart, using
   `https://n8n.nba-adoekiti.org` in place of `localhost:5678`.
6. Set up the Certbot renewal cron job described in
   `docker/nginx/README.md`.

## National rollout (either option)

Adding a branch is a database row, not a redeploy — see
`docs/MIGRATION.md`'s "National rollout" section. The same n8n instance and
admin GUI can serve multiple branches once the admin GUI's branch selection
is extended past the current single-branch `DEFAULT_BRANCH_SLUG` default
(tracked as follow-up work, not built in this pass — see the root
`README.md`'s "Not yet built" note).
