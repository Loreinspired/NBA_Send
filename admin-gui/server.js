const path = require('path');
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');

const {
  PORT = 3000,
  ADMIN_GUI_USER,
  ADMIN_GUI_PASSWORD,
  SESSION_SECRET,
  WEBHOOK_SHARED_SECRET,
  DEFAULT_BRANCH_SLUG = 'ado-ekiti',
  PGHOST,
  PGPORT = 5432,
  PGUSER,
  PGPASSWORD,
  PGDATABASE,
  PGSSLMODE = 'disable',
} = process.env;

for (const [name, value] of Object.entries({
  ADMIN_GUI_USER,
  ADMIN_GUI_PASSWORD,
  SESSION_SECRET,
  WEBHOOK_SHARED_SECRET,
  PGHOST,
  PGUSER,
  PGPASSWORD,
  PGDATABASE,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// admin-gui talks to Postgres directly as the least-privilege nba_app_runtime
// role (see db/migrations/010_nba_app_runtime_role.sql) instead of proxying
// through n8n webhooks, which were found to be broken in production
// (n8n's webhook registration silently fails — see docs/DEPLOYMENT.md).
//
// rejectUnauthorized: false, not true: confirmed by a real failed connection
// attempt against Supabase's Session Pooler from Render ("self-signed
// certificate in certificate chain"), and matches what n8n's own Postgres
// credential against this same database already had to use ("ssl: allow",
// not strict verification) earlier in this project. The connection is
// still TLS-encrypted in transit; this only skips certificate-chain
// verification, a common tradeoff for managed poolers whose cert chain
// isn't in the default trust store.
const pool = new Pool({
  host: PGHOST,
  port: Number(PGPORT),
  user: PGUSER,
  password: PGPASSWORD,
  database: PGDATABASE,
  ssl: PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});
pool.on('error', (err) => console.error('Unexpected idle Postgres client error', err));

// Every tenant-table query goes through a PL/pgSQL function
// (db/migrations/012_rls_helper_functions.sql) that sets the RLS branch
// context via set_config and then runs the real query, both as sequential
// statements inside one function body. A `WITH _ctx AS (SELECT
// set_config(...)) SELECT ...` CTE was tried first and does NOT work: an
// unreferenced CTE never executes at all, and even referenced, the planner
// is free to evaluate RLS's USING clause before it (both are just ANDed
// quals with no ordering guarantee) — confirmed by direct testing, not a
// hypothetical. Sequential statements inside one PL/pgSQL function call are
// the only ordering Postgres actually guarantees, which is why these are
// plain `pool.query('SELECT * FROM fn($1, ...)', [...])` calls, no special
// connection handling needed. Only one branch exists today and admin-gui
// doesn't yet support branch selection, so every function hardcodes 'ALL'
// (see docs/MIGRATION.md's National rollout section for when this needs to
// become per-branch).

const app = express();
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// External providers can't log in via session auth, so these two inbound
// webhook routes are instead protected by a shared secret embedded in the
// URL path. A wrong/missing secret looks like a plain 404, not a 401/403,
// so it doesn't confirm to a prober that the route exists at all.
function requireWebhookSecret(req, res, next) {
  if (req.params.secret !== WEBHOOK_SHARED_SECRET) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

app.get('/api/session', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated, defaultBranchSlug: DEFAULT_BRANCH_SLUG });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_GUI_USER && password === ADMIN_GUI_PASSWORD) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid username or password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/sender-profiles', requireAuth, async (req, res) => {
  const branchSlug = req.query.branch_slug || DEFAULT_BRANCH_SLUG;
  try {
    const { rows } = await pool.query('SELECT * FROM list_sender_profiles($1)', [branchSlug]);
    res.json({ sender_profiles: rows });
  } catch (err) {
    res.status(502).json({ error: 'Could not load sender profiles', detail: err.message });
  }
});

const VALID_AUDIENCE_SEGMENTS = ['all_members', 'executive_committee', 'financial_members'];
const VALID_CHANNELS = ['email', 'whatsapp', 'sms'];

app.post('/api/broadcast', requireAuth, async (req, res) => {
  const branchSlug = req.body.branch_slug || DEFAULT_BRANCH_SLUG;
  const { sender_profile_id, audience_segment, channels, message_template, is_urgent } = req.body || {};

  const errors = [];
  if (!sender_profile_id) errors.push('sender_profile_id is required');
  if (!VALID_AUDIENCE_SEGMENTS.includes(audience_segment)) {
    errors.push(`audience_segment must be one of: ${VALID_AUDIENCE_SEGMENTS.join(', ')}`);
  }
  if (!Array.isArray(channels) || channels.length === 0 || !channels.every((c) => VALID_CHANNELS.includes(c))) {
    errors.push(`channels must be a non-empty array from: ${VALID_CHANNELS.join(', ')}`);
  }
  if (!message_template || typeof message_template !== 'string' || !message_template.trim()) {
    errors.push('message_template is required');
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', messages: errors });
  }

  try {
    // branches has no RLS (see db/migrations/007_row_level_security.sql),
    // so this is a plain query — no RLS-context function needed here.
    const { rows: branchRows } = await pool.query(
      'SELECT id FROM branches WHERE slug = $1 AND is_active = true',
      [branchSlug]
    );
    const branch = branchRows[0];
    if (!branch) {
      return res.status(400).json({ error: `Unknown branch: ${branchSlug}` });
    }

    // status defaults to 'pending' — n8n's Schedule Trigger poll loop
    // (n8n/workflows/broadcast-main.workflow.json) claims and processes it
    // within one ~25s poll interval; there is no synchronous send here.
    const { rows } = await pool.query(
      'SELECT * FROM create_broadcast($1, $2, $3, $4, $5, $6, $7)',
      [branch.id, sender_profile_id, audience_segment, channels, message_template, !!is_urgent, req.session.username]
    );
    res.status(201).json({ broadcast_id: rows[0].broadcast_id, status: rows[0].status });
  } catch (err) {
    res.status(502).json({ error: 'Could not create broadcast', detail: err.message });
  }
});

// Ported from the parked n8n/workflows/superseded/delivery-status-callback.workflow.json.
// Register this URL (with the WEBHOOK_SHARED_SECRET) as Brevo's transactional
// webhook (Transactional > Settings > Webhooks), subscribed to at least
// 'delivered' and the bounce/error events.
app.post('/webhooks/brevo-delivery-status/:secret', requireWebhookSecret, async (req, res) => {
  const body = req.body || {};
  const providerMessageId = body['message-id'] ?? body.message_id ?? null;
  const event = (body.event ?? '').toString().toLowerCase();

  let status = 'sent';
  if (event === 'delivered') status = 'delivered';
  if (['soft_bounce', 'hard_bounce', 'invalid_email', 'blocked', 'error'].includes(event)) status = 'failed';

  try {
    await pool.query('SELECT update_message_log_status($1, $2)', [providerMessageId, status]);
    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update message log', detail: err.message });
  }
});

// Ported from the parked n8n/workflows/superseded/whatsapp-interactive-reply.workflow.json.
// UNVERIFIED: field paths are inferred from Sendchamp/Meta docs, not a real
// payload — capture one real inbound reply and correct this before relying
// on it (see n8n/workflows/superseded/README.md).
app.post('/webhooks/sendchamp-whatsapp-reply/:secret', requireWebhookSecret, async (req, res) => {
  const body = req.body || {};
  const waMessage =
    body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? body?.data?.message ?? body;

  const fromPhoneRaw = waMessage?.from ?? body?.phone_number ?? body?.sender ?? null;
  const fromPhone = fromPhoneRaw
    ? (fromPhoneRaw.startsWith('+') ? fromPhoneRaw : `+${fromPhoneRaw.replace(/^0/, '234')}`)
    : null;

  const buttonReply = waMessage?.interactive?.button_reply ?? waMessage?.button ?? null;
  const buttonId = buttonReply?.id ?? buttonReply?.payload ?? null;
  const buttonText = buttonReply?.title ?? buttonReply?.text ?? null;
  const contextMessageId = waMessage?.context?.id ?? body?.context_id ?? null;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM find_whatsapp_message_log($1, $2)',
      [contextMessageId, fromPhone]
    );

    const match = rows[0];
    if (!match) {
      return res.json({ received: true, matched: false });
    }

    const id = (buttonId || '').toLowerCase();
    let interpretedReply = 'unrecognized';
    if (id.includes('rsvp_yes') || id.includes('accept')) interpretedReply = 'rsvp_yes';
    else if (id.includes('rsvp_no') || id.includes('decline')) interpretedReply = 'rsvp_no';
    else if (id.includes('payment') || id.includes('paid')) interpretedReply = 'payment_confirmed';

    const replyPayload = `${interpretedReply}: ${buttonText || buttonId || JSON.stringify(body)}`;
    await pool.query('SELECT update_message_log_reply($1, $2)', [match.message_log_id, replyPayload]);
    res.json({ received: true, matched: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not process WhatsApp reply', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`NBA Send admin GUI listening on port ${PORT}`);
});
