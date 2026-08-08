const path = require('path');
const express = require('express');
const session = require('express-session');

const {
  PORT = 3000,
  ADMIN_GUI_USER,
  ADMIN_GUI_PASSWORD,
  SESSION_SECRET,
  N8N_WEBHOOK_BASE,
  N8N_WEBHOOK_SECRET,
  DEFAULT_BRANCH_SLUG = 'ado-ekiti',
} = process.env;

for (const [name, value] of Object.entries({
  ADMIN_GUI_USER,
  ADMIN_GUI_PASSWORD,
  SESSION_SECRET,
  N8N_WEBHOOK_BASE,
  N8N_WEBHOOK_SECRET,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

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

// Proxies below attach the n8n webhook secret server-side so it never
// reaches the browser, per the anti-vendor-lock-in / no-code-visible-to-
// executives design in docs/ARCHITECTURE.md.

app.get('/api/sender-profiles', requireAuth, async (req, res) => {
  const branchSlug = req.query.branch_slug || DEFAULT_BRANCH_SLUG;
  try {
    const upstream = await fetch(
      `${N8N_WEBHOOK_BASE}/sender-profiles?branch_slug=${encodeURIComponent(branchSlug)}`,
      { headers: { 'X-Webhook-Secret': N8N_WEBHOOK_SECRET } }
    );
    const body = await upstream.json();
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach n8n', detail: err.message });
  }
});

app.post('/api/broadcast', requireAuth, async (req, res) => {
  const payload = {
    branch_slug: DEFAULT_BRANCH_SLUG,
    ...req.body,
    requested_by: req.session.username,
  };
  try {
    const upstream = await fetch(`${N8N_WEBHOOK_BASE}/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': N8N_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });
    const body = await upstream.json();
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach n8n', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`NBA Send admin GUI listening on port ${PORT}`);
});
