# Deployment

Two independent paths, per the brief. Neither was actually provisioned in
this repo (no live Render/Railway/Supabase/Hetzner accounts available) — both
sections below are checklists to execute manually. Local testing via
`docker compose up` (see the root `README.md`) is what was actually run and
verified.

## Option A — 100% free tier (Render or Railway + Supabase)

No `docker-compose.yml` is used here — these platforms run one container per
service, not a compose stack.

1. **Supabase**: create a free project. Note the connection string — this
   single Postgres instance hosts both n8n's execution DB and the app schema
   (same split as local dev: two databases, one instance). Run
   `db/migrate.sh` once against it (locally, pointing `PGHOST`/etc at the
   Supabase host) to apply `db/migrations/*.sql`, or run the SQL files
   manually via Supabase's SQL editor in order.
2. **n8n service**: create a new Web Service on Render/Railway from the
   official `docker.n8n.io/n8nio/n8n` image (or point at this repo — no
   custom Dockerfile is needed for n8n itself). Set the same `DB_*`,
   `N8N_*`, `DATA_SOURCE`, `SENDCHAMP_*`, `WHATSAPP_*` env vars as in
   `.env.example`, pointing `DB_POSTGRESDB_HOST` etc at the Supabase
   connection details. Render/Railway supply `N8N_HOST`/TLS automatically —
   set `N8N_PROTOCOL=https` and `WEBHOOK_URL` to the platform-assigned
   HTTPS URL.
3. **admin-gui service**: create a second Web Service built from
   `admin-gui/Dockerfile`. Set `N8N_WEBHOOK_BASE` to the n8n service's public
   HTTPS URL + `/webhook`, plus the same `ADMIN_GUI_*`/`SESSION_SECRET`/
   `N8N_WEBHOOK_SECRET` values as the n8n service.
4. Import the workflows and create credentials exactly as in the local
   quickstart (`n8n/README.md`), just against the hosted n8n instance.
5. Cost note: both platforms' free tiers sleep/spin down idle services and
   cap monthly hours — fine for a 300-member branch's occasional broadcasts,
   worth monitoring as usage grows.

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
