# Architecture

## System diagram

```
 [ Branch Executive (PRO / Chairman / Secretariat) ]
                  │  logs in, composes broadcast
                  ▼
 [ Admin GUI — admin-gui/ (Express + vanilla JS) ]
                  │  POST /api/broadcast (session-authenticated)
                  │  attaches N8N_WEBHOOK_SECRET server-side
                  ▼
 [ n8n — n8n/workflows/broadcast-main.workflow.json ]
      │  validates input, resolves sender profile
      ├──► [ Google Sheets ] or [ Postgres members table ]   (DATA_SOURCE toggle)
      │        (Phase 1)            (Phase 2+, tested here)
      │  filters by audience segment, batches, personalizes
      ▼
 [ Brevo API ]              [ Multitexter API ]
      ├──► Email endpoint          └──► SMS endpoint (DND-bypass via forcednd)
      └──► WhatsApp endpoint            (urgent legal/emergency notices)
           (interactive RSVP / payment templates)
                  │
                  ▼
 [ Postgres message_log ]  ← per-member, per-channel delivery audit trail
```

Everything left of the Brevo/Multitexter boxes is self-hosted and
version-controlled in this repo. Those two are the external paid/free-tier
dependencies — Brevo (free tier, email + WhatsApp) and Multitexter
(Nigerian SMS with DND-bypass routing) — chosen over building that delivery
layer in-house, which was explicitly out of scope. (The original brief
specified Sendchamp as a single provider for all three channels; this repo
was later switched to Brevo + Multitexter — see `docs/PROVIDERS_SETUP.md`
for why and how.)

## Why row-level multi-tenancy, not schema-per-branch

`db/migrations/007_row_level_security.sql` enforces branch scoping with a
`branch_id` column plus Postgres Row-Level Security, rather than giving each
branch (Ado-Ekiti today, ~125 branches nationally) its own schema.

- **Migrations stay 1x, not 125x.** Every schema change (a new column, a new
  index) applies once, not once per branch schema.
- **The brief's required National Executive cross-branch overview becomes a
  single query** (`SET app.current_branch_id = 'ALL'`) instead of 125 unioned
  queries or a separate reporting pipeline.
- **Enforcement lives in the database**, not scattered across application
  code paths — a bug in one n8n workflow node can't leak another branch's
  member list, because the database itself refuses the row.
- Schema-per-branch's real advantage — hard physical/regulatory isolation —
  isn't a stated requirement here (one legal association, not unrelated
  customers). If a specific branch ever needs that, it's a viable fallback,
  but not the default.

`app.current_branch_id` must be set (to a branch UUID, or the literal string
`ALL`) before any query against a tenant-scoped table, or RLS policies
evaluate to false and return zero rows — a safe default. In the n8n
workflows this happens via an explicit `SET` in the same Postgres node
session (see `n8n/README.md`).

## Why a custom admin GUI, not NocoDB or Retool

The brief allows NocoDB, Retool, or a custom form. This repo builds a small
self-hosted Express + vanilla JS form (`admin-gui/`):

- **Retool is disqualified outright.** Even its self-hosted tier requires a
  paid license beyond a small free tier — directly contradicts the brief's
  own "self-hosted, open-source, no vendor lock-in" mandate. Don't use it.
- **NocoDB is legitimate open-source software**, but it auto-generates
  spreadsheet-style CRUD UI over database tables. That's an excellent fit
  for "branch secretary bulk-edits the member roster" (see the National
  Executive back-office note below) but a poor fit for the brief's exact
  requirement: one single-purpose 4-control form (sender dropdown, audience
  dropdown, channel checkboxes, message composer with placeholder tokens)
  ending in a single "Broadcast" action. Bending NocoDB's generated UI into
  that shape is more effort than the ~150 lines of HTML/JS this repo ships.
- A static HTML+JS page behind a minimal Express server has zero framework
  lock-in, no build step, and is trivially auditable — consistent with
  "cost-effective... no vendor lock-in," and it's what's actually tested in
  this repo (see the root README's quickstart).

**Recommended deploy-time companion (not built in this repo):** point a
NocoDB instance at the same `APP_DB_NAME` Postgres database for back-office
member-roster editing (bulk add/edit/deactivate members, browse the
`message_log` audit trail) — exactly NocoDB's strength, free/OSS, and it
doesn't touch the RLS-protected broadcast path.

## Data flow through a broadcast

See `n8n/README.md` for the full node-by-node breakdown of
`broadcast-main.workflow.json`. In short: the admin GUI never talks to
Brevo/Multitexter or the members table directly — it only composes a job description
(`{sender_profile, audience_segment, channels, message_template, is_urgent}`)
and hands it to n8n, which owns all personalization, routing, and delivery
logic in one place.
