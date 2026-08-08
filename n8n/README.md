# n8n workflows

These JSON files are hand-authored (not exported from a live n8n instance —
no browser-connected n8n was available to build them visually in this
session) but are written to n8n's real workflow JSON schema and validated as
well-formed JSON. Import each one and check for any red "unrecognized node
version" banners — n8n auto-upgrades minor version mismatches, but flag
anything it can't resolve.

## Import order

1. `sender-profiles-lookup.workflow.json`
2. `broadcast-main.workflow.json`
3. `delivery-status-callback.workflow.json`
4. `whatsapp-interactive-reply.workflow.json`

In the n8n UI: **Workflows → Import from File** for each, then link
credentials (see `credentials/README.md`) and publish the workflow so its
production webhook goes live. n8n's own terminology for this step has
changed across versions — n8n 1.x uses a single **Active** toggle; n8n 2.x
splits **Save** (keeps edits as a draft, does not affect production) from an
explicit **Publish** action (pushes the current version live and is what
actually registers the production webhook). Use whichever your instance
shows.

**Verify the webhook actually responds** before wiring up the admin GUI —
don't assume publishing succeeded silently:
```bash
curl -i "http://localhost:5678/webhook/sender-profiles?branch_slug=ado-ekiti" \
  -H "X-Webhook-Secret: <your N8N_WEBHOOK_SECRET>"
```
A `404 ... is not registered` response means the workflow isn't actually
live yet, regardless of what the UI's status badge shows — during this
repo's own testing (against n8n 2.33.7, self-hosted Docker, pulled
2026-08-08), publishing through the full UI flow — version-name
confirmation dialog, "Workflow published" success notice, the works — still
left the production webhook returning 404. Restarting the `n8n`
container did not fix it either. The database confirms the workflow is
active and a `webhook_entity` row exists for it, so this looks like an
in-memory webhook-registration gap in this specific n8n point release rather
than anything wrong with the imported workflow JSON or this repo's setup.
If you hit the same thing: try a different `N8N_VERSION` (this repo's
`.env.example` defaults to `latest`, which is exactly what surfaced this —
pinning to an earlier stable tag is worth trying first), and check n8n's own
GitHub issues for your exact version before assuming the workflow itself is
broken. Every other claim in this repo's docs about what was verified in
this session (schema, RLS, JSON validity, clean import, the Code nodes'
business logic, and the admin GUI's proxy behavior) was independently
confirmed and does not depend on this working.

## broadcast-main.workflow.json — what it does

Webhook receives the admin GUI's broadcast job → validates input → looks up
the chosen sender profile's branding/signature → creates a `broadcasts`
audit row → fetches the branch's member roster (Postgres by default, or
Google Sheets if `DATA_SOURCE=sheets`) → filters by audience segment →
batches members (`BROADCAST_BATCH_SIZE`, default 50) → for each member,
substitutes `{First_Name}`/`{Amount_Due}`/`{Sender_Profile}` and appends the
sender's signature block → selects the DND-bypass SMS route when the
broadcast is marked urgent → sends via Sendchamp on each selected channel →
logs one `message_log` row per (member, channel) → paces batches with a
short `Wait` → marks the broadcast `completed` and responds to the admin GUI.

**Design note on `$('Node Name')` references**: several nodes (e.g.
`Personalize Message`) reference earlier nodes' output directly via
`$('Fetch Sender Profile').first().json` rather than merging that data into
the main item stream. This only works because `Fetch Sender Profile` and
`Create Broadcast Record` sit strictly upstream of the member-fetch branch in
one linear chain (not a parallel branch) — n8n guarantees a referenced
node's data is available once it's upstream in the executed path. Do not
reorder those two nodes to run in parallel with the member fetch without
re-wiring this.

## Scaling note (National rollout)

`Broadcast Trigger` uses `responseMode: responseNode`, meaning the admin
GUI's HTTP request stays open until the entire batch loop finishes — fine
for a 300-member branch, but not appropriate once broadcasts approach
national scale (150,000+ members). Before that scale, switch to
`responseMode: onReceived` (immediate ack with a `broadcast_id`) and have the
admin GUI poll `broadcasts.status` or `message_log` counts for progress,
rather than holding one long-lived HTTP connection.

## Known unverified pieces (flagged inline via node `notes` too)

- **Google Sheets node fields** (`Fetch Members (Sheets)`) — no live Google
  account was available to confirm the exact resource/operation parameters.
- **Sendchamp HTTP request bodies** (`Send via Sendchamp *`) and **response
  shapes** (`Normalize Delivery Response *`) — built from Sendchamp's public
  API docs, not a live key. Re-verify before the first real send; see
  `../docs/SENDCHAMP_SETUP.md`.
- **DND-bypass `route` field** (`Select SMS Route`) — confirm the exact
  field/value your Sendchamp account uses; that route typically needs
  separate approval.
- **Delivery-status callback payload** (`delivery-status-callback.workflow.json`)
  and **WhatsApp inbound reply payload** (`whatsapp-interactive-reply.workflow.json`)
  — both are best-effort scaffolding pending a real webhook delivery to
  inspect. The latter also needs an approved WhatsApp template before any
  interactive buttons exist to reply to.
