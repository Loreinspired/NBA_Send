const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const { parse: parseCsv } = require('csv-parse/sync');
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

const VALID_SENDER_ROLES = ['pro', 'branch_chairman', 'secretariat'];

// Includes inactive profiles (unlike GET /api/sender-profiles above, which
// only returns active ones for the broadcast composer's dropdown) so the
// management page can show every role's current state.
app.get('/api/sender-profiles/manage', requireAuth, async (req, res) => {
  const branchSlug = req.query.branch_slug || DEFAULT_BRANCH_SLUG;
  try {
    const { rows } = await pool.query('SELECT * FROM list_sender_profiles_for_management($1)', [branchSlug]);
    res.json({ sender_profiles: rows });
  } catch (err) {
    res.status(502).json({ error: 'Could not load sender profiles', detail: err.message });
  }
});

// Upsert: defines a role's profile if it doesn't exist yet, redefines it if
// it does (sender_profiles has a UNIQUE(branch_id, role) constraint — only
// one PRO/Chairman/Secretariat profile per branch, so "add" and "edit" are
// the same operation here).
app.post('/api/sender-profiles', requireAuth, async (req, res) => {
  const branchSlug = req.body.branch_slug || DEFAULT_BRANCH_SLUG;
  const { role, display_name, signature_block, contact_phone, contact_email } = req.body || {};

  const errors = [];
  if (!VALID_SENDER_ROLES.includes(role)) {
    errors.push(`role must be one of: ${VALID_SENDER_ROLES.join(', ')}`);
  }
  if (!display_name || typeof display_name !== 'string' || !display_name.trim()) {
    errors.push('display_name is required');
  }
  if (!signature_block || typeof signature_block !== 'string' || !signature_block.trim()) {
    errors.push('signature_block is required');
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', messages: errors });
  }

  try {
    const { rows: branchRows } = await pool.query(
      'SELECT id FROM branches WHERE slug = $1 AND is_active = true',
      [branchSlug]
    );
    const branch = branchRows[0];
    if (!branch) {
      return res.status(400).json({ error: `Unknown branch: ${branchSlug}` });
    }

    const { rows } = await pool.query('SELECT * FROM upsert_sender_profile($1, $2, $3, $4, $5, $6)', [
      branch.id,
      role,
      display_name,
      signature_block,
      contact_phone || null,
      contact_email || null,
    ]);
    // upsert_sender_profile()'s columns are out_-prefixed (works around a
    // Postgres ON CONFLICT/OUT-parameter name collision — see
    // db/migrations/013_.../.sql) — stripped back off here so that detail
    // doesn't leak into the HTTP response shape.
    const r = rows[0];
    res.status(200).json({
      sender_profile: {
        id: r.out_id,
        role: r.out_role,
        display_name: r.out_display_name,
        signature_block: r.out_signature_block,
        contact_phone: r.out_contact_phone,
        contact_email: r.out_contact_email,
        is_active: r.out_is_active,
      },
    });
  } catch (err) {
    res.status(502).json({ error: 'Could not save sender profile', detail: err.message });
  }
});

app.patch('/api/sender-profiles/:id/active', requireAuth, async (req, res) => {
  const { is_active } = req.body || {};
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be a boolean' });
  }
  try {
    await pool.query('SELECT set_sender_profile_active($1, $2)', [req.params.id, is_active]);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: 'Could not update sender profile', detail: err.message });
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

// Memory storage: CSV rosters are at most a few thousand rows, well under
// the 5MB cap — no need to touch disk for something this small and
// short-lived (parsed once, then discarded).
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PHONE_E164_NG = /^\+234[0-9]{10}$/;
const VALID_FINANCIAL_STATUSES = ['financial', 'non_financial', 'unknown'];

// Accepts the documented header spelling (First_Name, Last_Name, Email,
// Phone_Number, Financial_Status — docs/samples/nba_members_template.md)
// but normalizes case/spacing/punctuation first, so a Sheet exported
// without manually lowercasing headers first (the old manual \copy
// procedure's step 2 — docs/MIGRATION.md) still imports without edits.
function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const CANONICAL_HEADERS = ['first_name', 'last_name', 'email', 'phone_number', 'financial_status'];

// Validates one row against the same rules the database enforces
// (phone_e164_ng CHECK constraint, financial_status_enum), so bad rows are
// caught and explained here rather than surfacing as an opaque Postgres
// error that aborts the whole batch.
function validateRow(raw, rowNumber, seenPhones) {
  const errors = [];
  const first_name = (raw.first_name || '').trim();
  const last_name = (raw.last_name || '').trim();
  const email = (raw.email || '').trim();
  const phone_number = (raw.phone_number || '').trim();
  const financialStatusRaw = (raw.financial_status || '').trim().toLowerCase();
  const financial_status = financialStatusRaw || 'unknown';

  if (!first_name) errors.push('First_Name is required');
  if (!last_name) errors.push('Last_Name is required');
  if (!phone_number) {
    errors.push('Phone_Number is required');
  } else if (!PHONE_E164_NG.test(phone_number)) {
    errors.push('Phone_Number must be in the form +234XXXXXXXXXX (10 digits after +234, no spaces)');
  } else if (seenPhones.has(phone_number)) {
    errors.push(`Duplicate Phone_Number within this file (also on row ${seenPhones.get(phone_number)})`);
  }
  if (financialStatusRaw && !VALID_FINANCIAL_STATUSES.includes(financial_status)) {
    errors.push(`Financial_Status must be one of: ${VALID_FINANCIAL_STATUSES.join(', ')} (or left blank)`);
  }
  if (email && !email.includes('@')) {
    errors.push('Email does not look like a valid address (leave blank if unknown, don’t write "N/A")');
  }

  if (errors.length === 0 && phone_number) {
    seenPhones.set(phone_number, rowNumber);
  }

  return {
    row_number: rowNumber,
    first_name,
    last_name,
    email,
    phone_number,
    financial_status,
    valid: errors.length === 0,
    errors,
  };
}

app.post('/api/members/import/preview', requireAuth, csvUpload.single('csv_file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (expected field name csv_file)' });
  }

  let records;
  try {
    records = parseCsv(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse CSV', detail: err.message });
  }
  if (records.length === 0) {
    return res.status(400).json({ error: 'CSV has no data rows' });
  }

  // Re-key each record's columns to the canonical names via normalized
  // header matching (see normalizeHeader above) before validating.
  const sourceHeaders = Object.keys(records[0]);
  const headerMap = {}; // canonical -> original key in the parsed record
  for (const h of sourceHeaders) {
    const norm = normalizeHeader(h);
    if (CANONICAL_HEADERS.includes(norm) && !(norm in headerMap)) {
      headerMap[norm] = h;
    }
  }
  const missingHeaders = CANONICAL_HEADERS.filter((h) => h !== 'financial_status' && !(h in headerMap));
  if (missingHeaders.length > 0) {
    return res.status(400).json({
      error: 'CSV is missing required columns',
      detail: `Expected columns for: ${missingHeaders.join(', ')} (case/spacing-insensitive — see docs/samples/nba_members_template.md)`,
    });
  }

  const seenPhones = new Map();
  const rows = records.map((record, i) => {
    const raw = {};
    for (const canonical of CANONICAL_HEADERS) {
      raw[canonical] = headerMap[canonical] ? record[headerMap[canonical]] : '';
    }
    return validateRow(raw, i + 2, seenPhones); // +2: 1-indexed, plus the header row
  });

  const validCount = rows.filter((r) => r.valid).length;
  res.json({ rows, total: rows.length, valid_count: validCount, invalid_count: rows.length - validCount });
});

app.post('/api/members/import/confirm', requireAuth, async (req, res) => {
  const branchSlug = req.body.branch_slug || DEFAULT_BRANCH_SLUG;
  const rows = Array.isArray(req.body.rows) ? req.body.rows : null;
  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }

  // Re-validate server-side rather than trusting the client to only send
  // back what the preview marked valid — the preview step is a UX
  // convenience, not the security boundary.
  const seenPhones = new Map();
  const revalidated = rows.map((r, i) => validateRow(r, r.row_number || i + 2, seenPhones));
  const invalid = revalidated.filter((r) => !r.valid);
  if (invalid.length > 0) {
    return res.status(400).json({ error: 'Some rows failed validation', rows: invalid });
  }

  try {
    const { rows: branchRows } = await pool.query(
      'SELECT id FROM branches WHERE slug = $1 AND is_active = true',
      [branchSlug]
    );
    const branch = branchRows[0];
    if (!branch) {
      return res.status(400).json({ error: `Unknown branch: ${branchSlug}` });
    }

    const payload = revalidated.map((r) => ({
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      phone_number: r.phone_number,
      financial_status: r.financial_status,
    }));

    const { rows: results } = await pool.query('SELECT * FROM bulk_upsert_members($1, $2::jsonb, $3)', [
      branch.id,
      JSON.stringify(payload),
      req.session.username,
    ]);
    const added = results.filter((r) => r.out_was_new).length;
    const updated = results.length - added;
    res.json({ imported: results.length, added, updated });
  } catch (err) {
    res.status(502).json({ error: 'Could not import contacts', detail: err.message });
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
