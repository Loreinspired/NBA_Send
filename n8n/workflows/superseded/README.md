# Superseded workflows — do not import or activate

The three workflows in this directory relied on n8n Webhook-trigger nodes.
Real production testing found n8n's webhook registration to be broken in
this deployment: activation reports `active=true` with a correct
`webhook_entity` row, but the actual webhook URL always 404s — confirmed
across three n8n versions (2.33.7, 1.123.69, 1.70.0) and every activation
method (API, genuine UI clicks, full-body PATCH, container restart). This
matches open upstream n8n issues (#21614, #34038, #27976).

Their logic has been reimplemented directly in `admin-gui/server.js`, which
has no such bug:

- `sender-profiles-lookup.workflow.json` → `GET /api/sender-profiles`
  (direct Postgres query)
- `delivery-status-callback.workflow.json` → `POST
  /webhooks/brevo-delivery-status`
- `whatsapp-interactive-reply.workflow.json` → `POST
  /webhooks/sendchamp-whatsapp-reply`

These files are kept only as reference for their original request/response
shapes and query logic, in case n8n's webhook registration bug is fixed
upstream and moving this logic back into n8n becomes worthwhile again. Do
not import them into a running n8n instance — the equivalent, working
functionality already lives in admin-gui.
