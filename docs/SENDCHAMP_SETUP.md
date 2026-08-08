# Sendchamp setup

This repo has no live Sendchamp credentials — every payload shape in
`n8n/workflows/broadcast-main.workflow.json` was built against Sendchamp's
publicly documented API and is flagged `UNVERIFIED` in the relevant node's
`notes` field until checked against a real account. Do this before any real
send.

## 1. Get an account and API key

1. Sign up at Sendchamp and complete KYC/business verification (required for
   Nigerian SMS/WhatsApp sending).
2. From the dashboard, generate an API key (sandbox key first for testing).
3. Set in `.env`:
   - `SENDCHAMP_API_KEY` — your key
   - `SENDCHAMP_API_BASE_URL` — `https://sandbox-api.sendchamp.com/api/v1` while testing, `https://api.sendchamp.com/api/v1` once live
4. In n8n, create the `Sendchamp API` Header Auth credential (see
   `n8n/credentials/README.md`) with header `Authorization: Bearer <key>`.

## 2. Register the branch's SMS Sender ID

The brief requires the branch's registered alphanumeric Sender ID (e.g.
`NBA-ADO`) on outbound SMS. Register this in the Sendchamp dashboard's Sender
ID section (subject to their approval process), then set it on the branch
row:

```sql
UPDATE branches SET sms_sender_id = 'NBA-ADO' WHERE slug = 'ado-ekiti';
```

(`db/migrations/008_seed_dev_data.sql` already seeds this for local dev.)

## 3. Confirm the DND-bypass SMS route

`n8n/workflows/broadcast-main.workflow.json`'s `Select SMS Route` node sets
`route: "dnd"` for broadcasts marked urgent (legal/emergency notices) and
`route: "non_dnd"` otherwise, sent as a field on the `/sms/send` request body.
**Confirm this is genuinely the mechanism and field name your Sendchamp
account uses** — DND-bypass routing typically requires separate approval and
carries different pricing on Sendchamp's side. Adjust the node if your
account's actual API differs.

## 4. Set up email sending

Set `SENDCHAMP_FROM_EMAIL` in `.env` to a domain-verified sender address
(Sendchamp will require domain verification — SPF/DKIM records — before
allowing sends from it).

## 5. Set up WhatsApp (interactive RSVP/payment buttons)

This is the least verifiable part of the whole system without a live
account, because it depends on external approval steps this repo cannot
perform:

1. Connect a WhatsApp Business number to Sendchamp.
2. Design and submit a message template with quick-reply buttons (e.g.
   "RSVP Yes" / "RSVP No", or "I've Paid") through Meta's template review
   process (via Sendchamp's dashboard).
3. Once approved, set `WHATSAPP_SENDER_NUMBER` and `WHATSAPP_TEMPLATE_CODE`
   in `.env` to the approved values.
4. Register the inbound webhook URL (`.../webhook/whatsapp-reply`) with
   Sendchamp so button taps reach
   `n8n/workflows/whatsapp-interactive-reply.workflow.json`. Capture one real
   inbound payload and correct that workflow's `Parse Interactive Reply` node
   — its field mapping is a best-guess placeholder (see `n8n/README.md`).

## 6. Delivery status callbacks (optional but recommended)

Register `.../webhook/sendchamp-dlr` as your delivery-status callback URL so
`message_log.status` gets updated from `sent` to `delivered`/`failed`. Same
caveat as above: `delivery-status-callback.workflow.json`'s payload parsing
is unverified pending a real callback.
