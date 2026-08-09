# NBA Send — Omnichannel Communications Engine

Self-hosted broadcast system for the NBA Ado-Ekiti Branch: a branch
executive composes one message in a simple web form, and it goes out over
Email, WhatsApp, and/or SMS to a chosen audience segment, personalized and
signed per-sender — no SaaS subscription, no vendor lock-in, full data
ownership. Built to scale from one 300-member branch to NBA National
(150,000+ members) without a rearchitecture. See `docs/ARCHITECTURE.md` for
the full design and the reasoning behind it.

## Stack

- **n8n** (Community Edition, self-hosted) — owns all routing/personalization logic
- **Postgres** — member roster, sender profiles, broadcast + delivery audit trail (multi-tenant via Row-Level Security)
- **admin-gui** — small self-hosted Express + vanilla JS broadcast composer
- **Brevo** — Email + WhatsApp delivery (free tier: 300 emails/day, no card required)
- **Multitexter** — Nigerian bulk SMS delivery, with DND-bypass for urgent legal/emergency notices

## Quickstart (local)

Requires Docker and Docker Compose.

```bash
cp .env.example .env
# edit .env — the defaults work for local testing as-is except BREVO_API_KEY /
# MULTITEXTER_EMAIL+PASSWORD, which can stay blank until you have real
# credentials (see docs/PROVIDERS_SETUP.md)

docker compose up
```

This starts Postgres, runs all `db/migrations/*.sql` (including local seed
data), and starts n8n and the admin GUI.

1. Wait for `db-migrate` to exit successfully (`docker compose logs db-migrate`).
2. Open n8n at **http://localhost:5678** (basic auth: `N8N_BASIC_AUTH_USER`/`N8N_BASIC_AUTH_PASSWORD` from `.env`; n8n's own owner-account setup screen appears on first visit — this is separate from the basic auth gate).
3. Import each file in `n8n/workflows/` (**Workflows → Import from File**), in the order listed in `n8n/README.md`.
4. Create the credentials listed in `n8n/credentials/README.md` and link them to the nodes that need them, then publish each workflow so its production webhook goes live (n8n's terminology and exact toggle/button varies by version — n8n 2.x uses an explicit **Publish** button distinct from Save; older 1.x releases use an **Active** toggle). Confirm the webhook actually responds with a test `curl` before wiring up the admin GUI — see `n8n/README.md`'s note on this.
5. Open the admin GUI at **http://localhost:3000**, sign in with `ADMIN_GUI_USER`/`ADMIN_GUI_PASSWORD` from `.env`, and compose a test broadcast against the seeded `ado-ekiti` branch data.
6. Watch the execution in n8n's **Executions** tab — with no real `BREVO_API_KEY`/`MULTITEXTER_EMAIL`+`PASSWORD` set, the workflow runs through validation, personalization, and DND-route selection and gets as far as building the Brevo/Multitexter request (which will fail at the actual HTTP call) — that's expected in local dev. See "What's tested vs. not" below.

## Repository layout

```
db/           SQL migrations + seed data + migration runner
n8n/          Hand-authored n8n workflow JSON + credential/setup docs
admin-gui/    Self-hosted broadcast composer (Express + vanilla JS)
docker/nginx/ Reverse proxy + TLS config, VPS deployment only
docs/         Architecture, deployment, provider setup, Sheets→Postgres migration
scripts/      One-off operational procedures (documented, not automated)
```

## What's tested vs. not

Tested locally via `docker compose up` in this repo: the full schema and
seed data apply cleanly; RLS branch-scoping works exactly as designed
(verified directly against Postgres with a non-owner role); all four n8n
workflows import cleanly into a real n8n instance and render correctly in
its editor; the Code nodes' business logic (input validation, audience-
segment filtering across both Postgres and Sheets field casing, placeholder
substitution + signature injection, DND-route selection) was extracted and
unit-tested directly and behaves correctly; and the admin GUI's login
gate, session handling, and webhook-proxy mechanics (auth required, secret
attached server-side, upstream response relayed) all work as designed.

**Not confirmed in this session**: an actual HTTP call reaching an n8n
webhook end-to-end. The n8n Docker image pulled during testing
(`n8n:latest`, resolving to 2.33.7 on 2026-08-08) has a webhook-registration
issue where published/active workflows still return 404 on their production
webhook URL — reproduced through both the CLI and the full browser UI
publish flow, including after a container restart. This is very likely a
bug or environment quirk in that specific n8n build, not a defect in the
workflow JSON (which independently validates and imports correctly) — see
`n8n/README.md` for the full account and what to try if you hit it too.

**Not verifiable without live third-party accounts** (documented as
follow-up steps in the relevant doc): WhatsApp template approval, Google
Sheets OAuth. See `docs/PROVIDERS_SETUP.md` and `docs/DEPLOYMENT.md`.

admin-gui's sender-profile management (define/redefine/deactivate the
PRO, Branch Chairman, and Secretariat profiles) and CSV contact import
(`docs/MIGRATION.md`) were both verified end-to-end this pass — real
Postgres, real RLS, and a real browser driving the actual UI (login →
edit a profile → save → toggle it inactive; upload the sample roster →
preview with validation errors surfaced per row → confirm → rows
land correctly in `members`).

## Further reading

- `docs/ARCHITECTURE.md` — system diagram and the reasoning behind the RLS multi-tenancy and custom-GUI decisions
- `docs/DEPLOYMENT.md` — Option A (free tier: Render/Railway + Supabase) and Option B (VPS + Docker + Nginx + Let's Encrypt)
- `docs/PROVIDERS_SETUP.md` — Brevo (email + WhatsApp) and Multitexter (SMS) credential acquisition and where each value plugs in
- `docs/MIGRATION.md` — Sheets→Postgres cutover and adding new branches for National rollout
