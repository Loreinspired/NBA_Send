# Delivery provider setup — Brevo (email) + Sendchamp (WhatsApp) + Multitexter (SMS)

This repo originally targeted Sendchamp as a single provider for all three
channels, then briefly moved to Brevo for email + WhatsApp. **Brevo's
WhatsApp product isn't available on its free tier**, discovered only after
building against it — this repo now uses **Brevo** for email only,
**Sendchamp** for WhatsApp only (already has a tested API key from earlier
in this project), and **Multitexter** for SMS. Every payload shape in
`n8n/workflows/broadcast-main.workflow.json` was built against each
provider's publicly documented API; the response-shape parsing in the
`Normalize Delivery Response *` nodes is flagged `UNVERIFIED` where the
public docs didn't show a real example, and should be corrected against a
real send before relying on delivery-status accuracy.

## 0. Brevo IP allowlisting (do this before anything else works)

Brevo blocks API calls from IP addresses it hasn't seen on your account
before, returning `401 {"code":"unauthorized", "message":"...unrecognised
IP address..."}` — confirmed by real test calls on 2026-08-08 from two
different IPs, both blocked. This will block **both** ad-hoc testing (from
wherever you run curl/Postman) **and** your production n8n instance once
deployed, since a fresh Render/Railway/VPS deployment is also an
"unrecognised" IP the first time it calls Brevo.

Fix at **app.brevo.com/security/authorised_ips**: either add the specific
IP(s) that will call the API, or turn the restriction off entirely.
Because n8n's outbound IP can change across redeploys/restarts on
platforms like Render (no static IP on the free tier), turning the
restriction off is the more durable option unless you're running on
infrastructure with a fixed egress IP (e.g. a VPS, Option B).

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

**Confirmed working end-to-end by a real test send on 2026-08-09**: a real
email reached `loreadeogun@gmail.com` via `POST /v3/smtp/email`, returning
HTTP 201 with a real `messageId`. The request shape in `Send via Brevo
Email` is correct as written.

## 2. Sendchamp — WhatsApp

**Meta's WhatsApp Business Platform requires an approved message template
before any company-initiated message can be sent — this is a Meta-wide
rule that applies no matter which BSP (Sendchamp, Brevo, Twilio, ...) you
use.** Using Sendchamp does not skip this step.

Sendchamp's email/SMS products hit account-level billing issues earlier in
this project unrelated to code correctness; its WhatsApp API auth and
request shape were separately confirmed reachable, and its WhatsApp send
only failed on "unable to get sender number" — i.e. blocked on step 1 below,
not a plan/billing wall.

1. Connect a WhatsApp Business number to Sendchamp (dashboard → WhatsApp →
   Settings) — this is the step that was previously blocking WhatsApp
   entirely.
2. Create a template with the quick-reply buttons you need (e.g. "RSVP
   Yes" / "RSVP No", or "I've Paid") and submit it for Meta's review
   (usually minutes, sometimes up to 24h for manual review).
3. Once approved, note its **template code** and set:
   - `SENDCHAMP_WHATSAPP_SENDER_NUMBER` — the connected WhatsApp number
   - `SENDCHAMP_WHATSAPP_TEMPLATE_CODE` — the approved template's code
4. In n8n, create the `Sendchamp API` Header Auth credential (see
   `n8n/credentials/README.md`) and attach it to `Send via Sendchamp
   WhatsApp`.
5. The `custom_data` param mapping (substituting `{First_Name}`,
   `{Amount_Due}`) in the `Send via Sendchamp WhatsApp` node is
   `UNVERIFIED` — built from Sendchamp's public docs only. Send one real
   test message and check Sendchamp's dashboard/response to confirm
   parameters actually substitute; adjust the node if not.
6. Register `https://<admin-gui-host>/webhooks/sendchamp-whatsapp-reply/<WEBHOOK_SHARED_SECRET>`
   as Sendchamp's inbound WhatsApp webhook URL so button taps reach
   admin-gui's `/webhooks/sendchamp-whatsapp-reply/:secret` route (see
   `admin-gui/server.js`). That route's payload parsing is unverified
   pending a real inbound message — capture one and correct it (see
   `n8n/workflows/superseded/README.md` for the reference logic it was
   ported from).

## 3. Multitexter — SMS

1. Register an account at multitexter.com.
2. Register the branch's alphanumeric Sender ID (e.g. `NBA-ADO`) — then set
   it on the branch row:
   ```sql
   UPDATE branches SET sms_sender_id = 'NBA-ADO' WHERE slug = 'ado-ekiti';
   ```
   (`db/migrations/008_seed_dev_data.sql` already seeds this for local dev.)
   Confirmed by a real send on 2026-08-08: an unregistered-looking sender
   name (`NBA-ADO`) was accepted without a separate visible approval step
   — unlike Sendchamp, which rejected arbitrary sender names outright. This
   doesn't guarantee no approval process exists for production traffic
   volumes; it only confirms a single test send wasn't blocked.
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
5. **Multitexter's response shape is now confirmed** by a real send:
   ```json
   {"status": 1, "msgid": "msg_...", "units": 4, "balance": "413.00",
    "msg": "Message has been sent",
    "messages": {"<phone-without-plus>": "<per-recipient-message-id>"}}
   ```
   `status: 1` (a number) signals success; `messages` maps each recipient
   phone number (no leading `+`) to its own message ID, which is what
   `Normalize Delivery Response (SMS)` now uses as `provider_message_id`.
   A failure response wasn't captured (the test send succeeded), so the
   success check is `status === 1`; tighten the failure branch if you
   capture a real failed response.

## 4. Delivery-status callbacks (email only, optional)

Register `https://<admin-gui-host>/webhooks/brevo-delivery-status/<WEBHOOK_SHARED_SECRET>`
as Brevo's transactional webhook URL (**Transactional → Settings →
Webhooks**, subscribed to at least `delivered` and the bounce events) so
`message_log.status` updates from `sent` to `delivered`/`failed` for email.
Brevo's webhook event shape (`event`, `email`, `message-id`) is confirmed
against their public docs, but whether the `message-id` value there matches
the `messageId` returned by the send API is unverified — check on a real
send.

Multitexter's public docs don't mention a delivery-status webhook at all;
SMS `message_log.status` will likely stay at `sent` indefinitely unless
Multitexter support confirms one exists.
