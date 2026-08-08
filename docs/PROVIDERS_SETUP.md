# Delivery provider setup — Brevo (email + WhatsApp) + Multitexter (SMS)

This repo originally targeted Sendchamp as a single provider for all three
channels. It now uses **Brevo** (free tier) for email and WhatsApp, and
**Multitexter** for SMS — set up separately below. Every payload shape in
`n8n/workflows/broadcast-main.workflow.json` was built against each
provider's publicly documented API; the response-shape parsing in the
`Normalize Delivery Response *` nodes is flagged `UNVERIFIED` where the
public docs didn't show a real example, and should be corrected against a
real send before relying on delivery-status accuracy.

## 1. Brevo — email

1. Sign up at brevo.com (free tier: 300 transactional emails/day, no card
   required).
2. Go to **Settings → SMTP & API → API Keys** and generate an API key.
3. Set in `.env`:
   - `BREVO_API_KEY` — your key
   - `BREVO_SENDER_EMAIL` — a domain-verified sender address (Brevo requires
     SPF/DKIM domain verification under **Senders, Domains & Dedicated
     IPs** before allowing sends from it)
4. In n8n, create the `Brevo API` Header Auth credential (see
   `n8n/credentials/README.md`) with header name `api-key` (not
   `Authorization: Bearer ...` — Brevo's own header name).

## 2. Brevo — WhatsApp

**Meta's WhatsApp Business Platform requires an approved message template
before any company-initiated message can be sent — this is a Meta-wide
rule that applies no matter which BSP (Sendchamp, Brevo, Twilio, ...) you
use.** Switching to Brevo does not skip this step.

1. Connect a WhatsApp Business number to Brevo (**Campaigns → WhatsApp →
   Settings**).
2. Create a template with the quick-reply buttons you need (e.g. "RSVP
   Yes" / "RSVP No", or "I've Paid") under **WhatsApp Templates**, and
   submit it for Meta's review (usually minutes, sometimes up to 24h for
   manual review).
3. Once approved, note its numeric **Template ID** and set:
   - `BREVO_WHATSAPP_SENDER_NUMBER` — the connected WhatsApp number
   - `BREVO_WHATSAPP_TEMPLATE_ID` — the approved template's numeric ID
4. Brevo's public API reference doesn't document how per-message template
   parameters (e.g. substituting `{First_Name}`) are passed on the send
   endpoint — the `Send via Brevo WhatsApp` node's `params` field is a best
   guess. Send one real test message and check Brevo's dashboard/response
   to confirm parameters actually substitute; adjust the node if not.
5. Register the inbound webhook URL (`.../webhook/whatsapp-reply`) with
   Brevo so button taps reach
   `n8n/workflows/whatsapp-interactive-reply.workflow.json`. That
   workflow's payload parsing is unverified pending a real inbound
   message — capture one and correct the `Parse Interactive Reply` node.

## 3. Multitexter — SMS

1. Register an account at multitexter.com.
2. Register the branch's alphanumeric Sender ID (e.g. `NBA-ADO`) — subject
   to their approval process — then set it on the branch row:
   ```sql
   UPDATE branches SET sms_sender_id = 'NBA-ADO' WHERE slug = 'ado-ekiti';
   ```
   (`db/migrations/008_seed_dev_data.sql` already seeds this for local dev.)
3. Set in `.env`:
   - `MULTITEXTER_EMAIL` / `MULTITEXTER_PASSWORD` — your account login.
     **Note the auth model**: unlike Brevo/Sendchamp, Multitexter
     authenticates with your account email+password *inside every request
     body*, not a bearer token or header. The `Send via Multitexter SMS`
     node has no n8n credential attached — it reads these two env vars
     directly. Treat them as sensitive as any API key.
4. The DND-bypass mechanism (`forcednd: 1` for urgent legal/emergency
   notices, `0` otherwise) is confirmed against Multitexter's public
   developer docs — no separate approval step was mentioned there, unlike
   Sendchamp's DND route, but confirm with Multitexter support if you rely
   on it for genuinely time-sensitive notices.
5. **Multitexter's response shape for `/v2/app/sms` isn't documented
   anywhere on their public developer page** — no example success or
   error body is shown. The `Normalize Delivery Response (SMS)` node's
   success/failure heuristic is a placeholder. Send one real SMS, inspect
   the actual response n8n receives (via the execution log), and correct
   that node's parsing — don't trust `message_log.status` for SMS until
   you've done this.

## 4. Delivery-status callbacks (email only, optional)

Register `.../webhook/delivery-status` as Brevo's transactional webhook URL
(**Transactional → Settings → Webhooks**, subscribed to at least
`delivered` and the bounce events) so `message_log.status` updates from
`sent` to `delivered`/`failed` for email. Brevo's webhook event shape
(`event`, `email`, `message-id`) is confirmed against their public docs,
but whether the `message-id` value there matches the `messageId` returned
by the send API is unverified — check on a real send.

Multitexter's public docs don't mention a delivery-status webhook at all;
SMS `message_log.status` will likely stay at `sent` indefinitely unless
Multitexter support confirms one exists.
