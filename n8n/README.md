# n8n workflows

These JSON files are hand-authored (not exported from a live n8n instance)
but are written to n8n's real workflow JSON schema and validated as
well-formed JSON. Import each one and check for any red "unrecognized node
version" banners — n8n auto-upgrades minor version mismatches, but flag
anything it can't resolve.

## The webhook-registration bug, and why this uses a Schedule Trigger

The original design routed every operator action and provider callback
through n8n Webhook-trigger nodes. Real production testing found n8n's
webhook registration to be broken in this deployment: activation reports
`active=true` with a correct `webhook_entity` row, but the actual webhook URL
always 404s — confirmed across three n8n versions (2.33.7, 1.123.69, 1.70.0)
and every activation method (API, genuine UI clicks, full-body PATCH,
container restart). This matches open upstream n8n issues (#21614, #34038,
#27976), not anything specific to this repo's workflow JSON.

`broadcast-main.workflow.json` now uses a **Schedule Trigger** (polls every
~25s) instead — a structurally different, far more battle-tested n8n code
path that isn't affected by this bug. The three workflows that used to be
Webhook triggers for inbound requests (sender profile lookup, provider
delivery-status callbacks, WhatsApp reply capture) have had their logic
reimplemented directly in `admin-gui/server.js`, which has no such bug — see
`workflows/superseded/README.md`. **Do not import the files under
`workflows/superseded/`** into a running instance.

## Import order

1. `broadcast-main.workflow.json`
2. `broadcast-reaper.workflow.json`

In the n8n UI: **Workflows → Import from File** for each, then link
credentials (see `credentials/README.md`) and activate both. n8n's own
terminology for this has changed across versions — n8n 1.x uses a single
**Active** toggle; n8n 2.x splits **Save** (draft, no effect) from
**Publish** (pushes the current version live). Either is fine here: unlike
the old Webhook-trigger design, a Schedule Trigger's registration doesn't
depend on the same in-memory webhook-registration path that was found to be
broken — confirm it's actually firing via n8n's **Executions** tab instead
of trusting the status badge alone.

## broadcast-main.workflow.json — what it does

Schedule Trigger fires every ~25s → atomically claims the oldest `pending`
row in `broadcasts` (`FOR UPDATE SKIP LOCKED`, so two overlapping poll
executions can never claim the same row and double-send) → looks up the
claimed `sender_profile_id`'s branding/signature → fetches the branch's
member roster (Postgres by default, or Google Sheets if
`DATA_SOURCE=sheets`) → filters by audience segment → batches members
(`BROADCAST_BATCH_SIZE`, default 50) → for each member, substitutes
`{First_Name}`/`{Amount_Due}`/`{Sender_Profile}` and appends the sender's
signature block → selects the DND-bypass SMS route when the broadcast is
marked urgent → sends via Brevo (email), Sendchamp (WhatsApp), or
Multitexter (SMS) on each selected channel → logs one `message_log` row per
(member, channel) → paces batches with a short `Wait` → marks the broadcast
`completed`.

admin-gui creates the `broadcasts` row directly (status `pending`) via
`POST /api/broadcast` — this workflow only ever claims rows that already
exist, it never creates one, and there is no inbound HTTP request to respond
to at the end.

Every Postgres node calls a PL/pgSQL function from
`../db/migrations/012_rls_helper_functions.sql`
(`SELECT * FROM claim_next_pending_broadcast()`, `SELECT * FROM
fetch_sender_profile($1::uuid)`, etc.) instead of a bare query, to satisfy
Row-Level Security (`../db/migrations/007_row_level_security.sql`). A `WITH
_ctx AS (SELECT set_config('app.current_branch_id', 'ALL', false)) SELECT
...` CTE was tried first and does **not** work: an unreferenced CTE never
executes at all, and even referenced, Postgres's planner is free to evaluate
RLS's `USING` clause before it, since both are just quals ANDed together
with no ordering guarantee — confirmed by direct testing against a real
database, not a hypothetical, and it fails closed (looks like "no rows,"
not an error), so it's easy to miss. Sequential statements inside one
PL/pgSQL function body are the only ordering Postgres actually guarantees,
which is why `PERFORM set_config(...)` runs first and the real query second,
both inside the function — see `../db/README.md`'s "RLS and connection
pooling" section for the full explanation. `'ALL'` is used unconditionally
for now since only one branch exists and admin-gui doesn't yet support
branch selection (see `../docs/MIGRATION.md`'s National rollout section for
when this needs to become per-branch).

**Design note on `$('Node Name')` references**: several nodes (e.g.
`Personalize Message`) reference earlier nodes' output directly via
`$('Claim Next Pending Broadcast').first().json` rather than merging that
data into the main item stream. This only works because `Claim Next Pending
Broadcast` and `Fetch Sender Profile` sit strictly upstream of the
member-fetch branch in one linear chain (not a parallel branch) — n8n
guarantees a referenced node's data is available once it's upstream in the
executed path. Do not reorder those nodes to run in parallel with the member
fetch without re-wiring this.

## Verified by real local testing

Unlike most of this repo's other claims (built against public API docs, not
a live n8n instance), the Schedule Trigger + RLS-function architecture in
`broadcast-main.workflow.json` was confirmed end-to-end against a real
local n8n container + real Postgres: the Schedule Trigger fires reliably on
its interval, `claim_next_pending_broadcast()` and `fetch_sender_profile()`
return correct, RLS-filtered data through n8n's actual Postgres node (not
just via `psql`), and the full pipeline runs from claim through
`Personalize Message` and into the provider `Send via *` HTTP node,
stopping only where expected (no real provider credentials configured for
that test run).

This testing also caught a real bug unrelated to RLS: the three `Channel:
X?` IF nodes' built-in "array contains" operator (with strict type
validation) throws `Wrong type: 'email' is a string but was expecting an
array` against `channels` when it has exactly one element — even though the
value is a genuine, correctly-typed array the whole way through (confirmed
independently via `node-postgres`: `dataTypeID` 1009, `Array.isArray()`
true). This is a pre-existing n8n node quirk, not something introduced by
the Schedule Trigger rewrite, and was never caught before because earlier
testing in this project only unit-tested Code nodes' JS logic in isolation,
never ran the real IF-node expression engine. Fixed by switching those three
conditions from the "array" operator to a plain boolean expression
(`.includes('email')` etc.) — see each node's `notes` field.

## broadcast-reaper.workflow.json — what it does

`broadcast-main.workflow.json` has no per-node error branches, so a node
failure mid-pipeline (a crashed HTTP call, a Postgres timeout) leaves the
claimed row stuck in `in_progress` forever with no visibility — the poll
loop never revisits rows it isn't currently holding. This workflow runs
every 5 minutes and marks any broadcast that's been `in_progress` for over
10 minutes as `failed` with a diagnosable `failure_reason`, so a crashed
pipeline shows up as a failure instead of silently vanishing.

## Scaling note (National rollout)

The Schedule Trigger interval (25s) and reaper interval (5 min) are fixed
values tuned for a single 300-member branch's occasional broadcasts. At
national scale (150,000+ members across ~125 branches), consider: shortening
the poll interval only if broadcast volume genuinely needs it (a busier poll
loop costs nothing extra on Render's free tier since it's already an
always-running process, not per-invocation billing); and whether multiple
broadcasts should process concurrently rather than one claim per tick, once
a single organization-wide poll loop becomes a throughput bottleneck.

## Known unverified pieces (flagged inline via node `notes` too)

- **Google Sheets node fields** (`Fetch Members (Sheets)`) — no live Google
  account was available to confirm the exact resource/operation parameters.
- **Brevo email** send body and response parsing (`messageId` presence =
  success) are confirmed against Brevo's public API reference and a real
  test send. **Sendchamp WhatsApp** request shape is confirmed reachable;
  the `custom_data` param mapping and response parsing are `UNVERIFIED`
  pending a connected sender number — see `../docs/PROVIDERS_SETUP.md`.
- **Multitexter SMS** (`Send via Multitexter SMS`) request and response
  shape are both confirmed against a real send — see
  `../docs/PROVIDERS_SETUP.md`.
- **DND-bypass `forcednd` field** (`Select SMS Route`) is confirmed against
  Multitexter's public docs (`forcednd: 1` bypasses DND, `0` doesn't) — see
  `../docs/PROVIDERS_SETUP.md`.
- **Delivery-status callback payload** and **WhatsApp inbound reply
  payload** — now handled by `admin-gui/server.js`'s `/webhooks/*` routes,
  ported from the parked workflows in `workflows/superseded/`. Both are
  still best-effort scaffolding pending a real webhook delivery to inspect.
  The WhatsApp one also needs an approved WhatsApp template before any
  interactive buttons exist to reply to.
