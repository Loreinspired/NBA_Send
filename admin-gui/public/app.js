const loginSection = document.getElementById('loginSection');
const broadcastSection = document.getElementById('broadcastSection');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const broadcastForm = document.getElementById('broadcastForm');
const broadcastBtn = document.getElementById('broadcastBtn');
const broadcastResult = document.getElementById('broadcastResult');
const senderProfileSelect = document.getElementById('senderProfile');
const messageTemplate = document.getElementById('messageTemplate');
const previewOutput = document.getElementById('previewOutput');

const SAMPLE_PREVIEW_VALUES = {
  '{First_Name}': 'Chidinma',
  '{Amount_Due}': '5,000',
  '{Sender_Profile}': 'the Branch Chairman',
};

function showLoggedOut() {
  loginSection.classList.remove('hidden');
  broadcastSection.classList.add('hidden');
  logoutBtn.classList.add('hidden');
}

function showLoggedIn() {
  loginSection.classList.add('hidden');
  broadcastSection.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  loadSenderProfiles();
}

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (data.authenticated) showLoggedIn();
  else showLoggedOut();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) {
    loginForm.reset();
    showLoggedIn();
  } else {
    const data = await res.json().catch(() => ({}));
    loginError.textContent = data.error || 'Sign in failed';
    loginError.classList.remove('hidden');
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showLoggedOut();
});

async function loadSenderProfiles() {
  senderProfileSelect.innerHTML = '<option value="" disabled selected>Loading…</option>';
  try {
    const res = await fetch('/api/sender-profiles');
    const data = await res.json();
    const profiles = data.sender_profiles || [];
    if (profiles.length === 0) {
      senderProfileSelect.innerHTML = '<option value="" disabled selected>No sender profiles configured</option>';
      return;
    }
    senderProfileSelect.innerHTML = profiles
      .map((p) => `<option value="${p.role}">${p.display_name}</option>`)
      .join('');
  } catch (err) {
    senderProfileSelect.innerHTML = '<option value="" disabled selected>Could not load sender profiles</option>';
  }
}

document.querySelectorAll('.token-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const token = btn.dataset.token;
    const start = messageTemplate.selectionStart ?? messageTemplate.value.length;
    const end = messageTemplate.selectionEnd ?? messageTemplate.value.length;
    const value = messageTemplate.value;
    messageTemplate.value = value.slice(0, start) + token + value.slice(end);
    messageTemplate.focus();
    messageTemplate.selectionStart = messageTemplate.selectionEnd = start + token.length;
    updatePreview();
  });
});

function updatePreview() {
  let text = messageTemplate.value;
  for (const [token, sample] of Object.entries(SAMPLE_PREVIEW_VALUES)) {
    text = text.split(token).join(sample);
  }
  previewOutput.textContent = text;
}

messageTemplate.addEventListener('input', updatePreview);

broadcastForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  broadcastResult.classList.add('hidden');
  broadcastBtn.disabled = true;
  broadcastBtn.textContent = 'Sending…';

  const channels = Array.from(document.querySelectorAll('input[name="channel"]:checked')).map((c) => c.value);

  try {
    const res = await fetch('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_profile: senderProfileSelect.value,
        audience_segment: document.getElementById('audienceSegment').value,
        channels,
        message_template: messageTemplate.value,
        is_urgent: document.getElementById('isUrgent').checked,
      }),
    });
    const data = await res.json();
    broadcastResult.classList.remove('hidden');
    if (res.ok) {
      broadcastResult.className = 'success';
      broadcastResult.textContent = `Broadcast sent. Reference: ${data.broadcast_id || 'n/a'} (status: ${data.status || 'unknown'})`;
    } else {
      broadcastResult.className = 'error';
      broadcastResult.textContent = (data.messages && data.messages.join('; ')) || data.error || 'Broadcast failed';
    }
  } catch (err) {
    broadcastResult.classList.remove('hidden');
    broadcastResult.className = 'error';
    broadcastResult.textContent = 'Could not reach the server. Please try again.';
  } finally {
    broadcastBtn.disabled = false;
    broadcastBtn.textContent = 'Broadcast';
  }
});

updatePreview();
checkSession();
