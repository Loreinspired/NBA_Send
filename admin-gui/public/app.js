const loginSection = document.getElementById('loginSection');
const mainNav = document.getElementById('mainNav');
const broadcastSection = document.getElementById('broadcastSection');
const senderProfilesSection = document.getElementById('senderProfilesSection');
const importContactsSection = document.getElementById('importContactsSection');
const contactsSection = document.getElementById('contactsSection');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const broadcastForm = document.getElementById('broadcastForm');
const broadcastBtn = document.getElementById('broadcastBtn');
const broadcastResult = document.getElementById('broadcastResult');
const senderProfileSelect = document.getElementById('senderProfile');
const messageTemplate = document.getElementById('messageTemplate');
const previewOutput = document.getElementById('previewOutput');

const NAV_SECTIONS = {
  broadcastSection,
  senderProfilesSection,
  importContactsSection,
  contactsSection,
};

const SAMPLE_PREVIEW_VALUES = {
  '{First_Name}': 'Chidinma',
  '{Amount_Due}': '5,000',
  '{Sender_Profile}': 'the Branch Chairman',
};

function showLoggedOut() {
  loginSection.classList.remove('hidden');
  mainNav.classList.add('hidden');
  broadcastSection.classList.add('hidden');
  senderProfilesSection.classList.add('hidden');
  importContactsSection.classList.add('hidden');
  contactsSection.classList.add('hidden');
  logoutBtn.classList.add('hidden');
}

function showLoggedIn() {
  loginSection.classList.add('hidden');
  mainNav.classList.remove('hidden');
  switchNavSection('broadcastSection');
  logoutBtn.classList.remove('hidden');
  loadSenderProfiles();
}

function switchNavSection(targetId) {
  for (const [id, el] of Object.entries(NAV_SECTIONS)) {
    el.classList.toggle('hidden', id !== targetId);
  }
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === targetId);
  });
  if (targetId === 'senderProfilesSection') loadSenderProfilesManage();
  if (targetId === 'contactsSection') loadContacts();
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchNavSection(btn.dataset.target));
});

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
      .map((p) => `<option value="${p.id}">${p.display_name}</option>`)
      .join('');
  } catch (err) {
    senderProfileSelect.innerHTML = '<option value="" disabled selected>Could not load sender profiles</option>';
  }
}

const SENDER_ROLES = [
  { role: 'pro', label: 'PRO (Public Relations Officer)' },
  { role: 'branch_chairman', label: 'Branch Chairman' },
  { role: 'secretariat', label: 'Secretariat' },
];

const senderProfilesList = document.getElementById('senderProfilesList');
const senderProfileForm = document.getElementById('senderProfileForm');
const senderProfileFormTitle = document.getElementById('senderProfileFormTitle');
const senderProfileResult = document.getElementById('senderProfileResult');
const spRole = document.getElementById('sp_role');
const spDisplayName = document.getElementById('sp_display_name');
const spSignatureBlock = document.getElementById('sp_signature_block');
const spContactPhone = document.getElementById('sp_contact_phone');
const spContactEmail = document.getElementById('sp_contact_email');

async function loadSenderProfilesManage() {
  senderProfilesList.textContent = 'Loading…';
  try {
    const res = await fetch('/api/sender-profiles/manage');
    const data = await res.json();
    const byRole = {};
    for (const p of data.sender_profiles || []) byRole[p.role] = p;

    senderProfilesList.innerHTML = SENDER_ROLES.map(({ role, label }) => {
      const p = byRole[role];
      if (!p) {
        return `
          <div class="sender-profile-row">
            <div>
              <div class="role-name">${label}</div>
              <div class="not-defined">Not yet defined</div>
            </div>
            <button type="button" class="secondary-btn define-btn" data-role="${role}">Define</button>
          </div>`;
      }
      return `
        <div class="sender-profile-row">
          <div>
            <div class="role-name">${label} <span class="badge ${p.is_active ? 'active' : 'inactive'}">${p.is_active ? 'Active' : 'Inactive'}</span></div>
            <div class="profile-summary">${escapeHtml(p.display_name)}\n${escapeHtml(p.signature_block || '')}</div>
          </div>
          <div>
            <button type="button" class="secondary-btn edit-btn" data-role="${role}">Edit</button>
            <button type="button" class="secondary-btn toggle-btn" data-id="${p.id}" data-active="${p.is_active}">${p.is_active ? 'Deactivate' : 'Activate'}</button>
          </div>
        </div>`;
    }).join('');

    senderProfilesList.querySelectorAll('.define-btn, .edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => openSenderProfileForm(byRole[btn.dataset.role], btn.dataset.role));
    });
    senderProfilesList.querySelectorAll('.toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => toggleSenderProfileActive(btn.dataset.id, btn.dataset.active !== 'true'));
    });
  } catch (err) {
    senderProfilesList.textContent = 'Could not load sender profiles.';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function openSenderProfileForm(existing, role) {
  senderProfileResult.classList.add('hidden');
  spRole.value = role;
  spDisplayName.value = existing?.display_name || '';
  spSignatureBlock.value = existing?.signature_block || '';
  spContactPhone.value = existing?.contact_phone || '';
  spContactEmail.value = existing?.contact_email || '';
  senderProfileFormTitle.textContent = existing
    ? `Redefine ${SENDER_ROLES.find((r) => r.role === role)?.label || role}`
    : `Define ${SENDER_ROLES.find((r) => r.role === role)?.label || role}`;
  senderProfileForm.classList.remove('hidden');
  senderProfileForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('senderProfileCancelBtn').addEventListener('click', () => {
  senderProfileForm.classList.add('hidden');
});

senderProfileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  senderProfileResult.classList.add('hidden');
  const saveBtn = document.getElementById('senderProfileSaveBtn');
  saveBtn.disabled = true;
  try {
    const res = await fetch('/api/sender-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: spRole.value,
        display_name: spDisplayName.value,
        signature_block: spSignatureBlock.value,
        contact_phone: spContactPhone.value,
        contact_email: spContactEmail.value,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      senderProfileForm.classList.add('hidden');
      loadSenderProfilesManage();
      loadSenderProfiles();
    } else {
      senderProfileResult.className = 'error';
      senderProfileResult.textContent = (data.messages && data.messages.join('; ')) || data.error || 'Could not save';
      senderProfileResult.classList.remove('hidden');
    }
  } catch (err) {
    senderProfileResult.className = 'error';
    senderProfileResult.textContent = 'Could not reach the server. Please try again.';
    senderProfileResult.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
  }
});

async function toggleSenderProfileActive(id, nextActive) {
  try {
    await fetch(`/api/sender-profiles/${encodeURIComponent(id)}/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: nextActive }),
    });
    loadSenderProfilesManage();
    loadSenderProfiles();
  } catch (err) {
    // loadSenderProfilesManage() re-fetching on next tab visit is enough
    // recovery here; no need for a dedicated error UI for a toggle click.
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
  broadcastBtn.textContent = 'Queuing…';

  const channels = Array.from(document.querySelectorAll('input[name="channel"]:checked')).map((c) => c.value);
  const audienceSegment = document.getElementById('audienceSegment').value;
  const requestBody = {
    sender_profile_id: senderProfileSelect.value,
    audience_segment: audienceSegment,
    channels,
    message_template: messageTemplate.value,
    is_urgent: document.getElementById('isUrgent').checked,
  };
  if (audienceSegment === 'custom') {
    requestBody.target_groups = Array.from(document.querySelectorAll('input[name="targetGroup"]:checked')).map((c) => c.value);
    requestBody.target_member_ids = Array.from(document.querySelectorAll('input[name="targetMember"]:checked')).map((c) => c.value);
  }

  try {
    const res = await fetch('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const data = await res.json();
    broadcastResult.classList.remove('hidden');
    if (res.ok) {
      broadcastResult.className = 'success';
      broadcastResult.textContent = `Broadcast queued (reference: ${data.broadcast_id || 'n/a'}). Sending will begin within about 30 seconds.`;
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

const csvFileInput = document.getElementById('csvFileInput');
const csvPreviewBtn = document.getElementById('csvPreviewBtn');
const csvPreviewError = document.getElementById('csvPreviewError');
const csvPreviewPanel = document.getElementById('csvPreviewPanel');
const csvPreviewSummary = document.getElementById('csvPreviewSummary');
const csvPreviewTableBody = document.querySelector('#csvPreviewTable tbody');
const csvConfirmBtn = document.getElementById('csvConfirmBtn');
const csvConfirmResult = document.getElementById('csvConfirmResult');

let pendingImportRows = [];

csvPreviewBtn.addEventListener('click', async () => {
  csvPreviewError.classList.add('hidden');
  csvPreviewPanel.classList.add('hidden');
  csvConfirmResult.classList.add('hidden');

  const file = csvFileInput.files[0];
  if (!file) {
    csvPreviewError.textContent = 'Choose a CSV file first.';
    csvPreviewError.classList.remove('hidden');
    return;
  }

  csvPreviewBtn.disabled = true;
  csvPreviewBtn.textContent = 'Parsing…';
  try {
    const formData = new FormData();
    formData.append('csv_file', file);
    const res = await fetch('/api/members/import/preview', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      csvPreviewError.textContent = data.detail || data.error || 'Could not parse CSV';
      csvPreviewError.classList.remove('hidden');
      return;
    }

    pendingImportRows = data.rows;
    csvPreviewSummary.textContent = `${data.total} row(s) found — ${data.valid_count} ready to import, ${data.invalid_count} with errors.`;
    csvPreviewTableBody.innerHTML = data.rows.map((r) => `
      <tr class="${r.valid ? '' : 'invalid-row'}">
        <td>${r.row_number}</td>
        <td>${escapeHtml(r.first_name)}</td>
        <td>${escapeHtml(r.last_name)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.phone_number)}</td>
        <td>${escapeHtml(r.financial_status)}</td>
        <td>${r.valid ? 'OK' : `<span class="row-errors">${escapeHtml(r.errors.join('; '))}</span>`}</td>
      </tr>`).join('');
    csvPreviewPanel.classList.remove('hidden');
    csvConfirmBtn.disabled = data.valid_count === 0;
  } catch (err) {
    csvPreviewError.textContent = 'Could not reach the server. Please try again.';
    csvPreviewError.classList.remove('hidden');
  } finally {
    csvPreviewBtn.disabled = false;
    csvPreviewBtn.textContent = 'Preview';
  }
});

csvConfirmBtn.addEventListener('click', async () => {
  csvConfirmResult.classList.add('hidden');
  const validRows = pendingImportRows.filter((r) => r.valid);
  if (validRows.length === 0) return;

  csvConfirmBtn.disabled = true;
  csvConfirmBtn.textContent = 'Importing…';
  try {
    const res = await fetch('/api/members/import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: validRows }),
    });
    const data = await res.json();
    csvConfirmResult.classList.remove('hidden');
    if (res.ok) {
      csvConfirmResult.className = 'success';
      csvConfirmResult.textContent = `Imported ${data.imported} contact(s): ${data.added} added, ${data.updated} updated.`;
    } else {
      csvConfirmResult.className = 'error';
      csvConfirmResult.textContent = data.detail || data.error || 'Import failed';
    }
  } catch (err) {
    csvConfirmResult.classList.remove('hidden');
    csvConfirmResult.className = 'error';
    csvConfirmResult.textContent = 'Could not reach the server. Please try again.';
  } finally {
    csvConfirmBtn.disabled = false;
    csvConfirmBtn.textContent = 'Confirm Import';
  }
});

// --- Broadcast composer: Custom Selection targeting ---

const audienceSegmentSelect = document.getElementById('audienceSegment');
const customTargetFieldset = document.getElementById('customTargetFieldset');
const customGroupsList = document.getElementById('customGroupsList');
const customMemberList = document.getElementById('customMemberList');
const customMemberSearch = document.getElementById('customMemberSearch');

let customTargetDataLoaded = false;
let allMembersForCustomTarget = [];

async function loadCustomTargetData() {
  if (customTargetDataLoaded) return;
  customTargetDataLoaded = true;
  try {
    const [groupsRes, membersRes] = await Promise.all([fetch('/api/custom-groups'), fetch('/api/members')]);
    const groupsData = await groupsRes.json();
    const membersData = await membersRes.json();
    const groups = groupsData.groups || [];
    customGroupsList.innerHTML = groups.length
      ? groups.map((g) => `<label class="checkbox-label"><input type="checkbox" name="targetGroup" value="${escapeHtml(g)}" /> ${escapeHtml(g)}</label>`).join('')
      : '<em>No custom groups defined yet — add groups to contacts in the Contacts tab.</em>';

    allMembersForCustomTarget = (membersData.members || []).filter((m) => m.is_active);
    renderCustomMemberList('');
  } catch (err) {
    customGroupsList.innerHTML = '<em>Could not load groups.</em>';
    customMemberList.innerHTML = '<em>Could not load contacts.</em>';
  }
}

function renderCustomMemberList(filterText) {
  const checkedIds = new Set(
    Array.from(customMemberList.querySelectorAll('input[name="targetMember"]:checked')).map((c) => c.value)
  );
  const filter = filterText.trim().toLowerCase();
  const filtered = allMembersForCustomTarget.filter((m) => {
    if (!filter) return true;
    const haystack = `${m.first_name} ${m.last_name} ${m.phone_number}`.toLowerCase();
    return haystack.includes(filter);
  });
  customMemberList.innerHTML = filtered.length
    ? filtered.map((m) => {
        const checked = checkedIds.has(m.member_id) ? 'checked' : '';
        return `<label class="checkbox-label"><input type="checkbox" name="targetMember" value="${m.member_id}" ${checked} /> ${escapeHtml(m.first_name)} ${escapeHtml(m.last_name)} (${escapeHtml(m.phone_number)})</label>`;
      }).join('')
    : '<em>No contacts match.</em>';
}

customMemberSearch.addEventListener('input', () => renderCustomMemberList(customMemberSearch.value));

audienceSegmentSelect.addEventListener('change', () => {
  const isCustom = audienceSegmentSelect.value === 'custom';
  customTargetFieldset.classList.toggle('hidden', !isCustom);
  if (isCustom) loadCustomTargetData();
});

// --- Contacts management ---

const contactsSearch = document.getElementById('contactsSearch');
const contactsTableBody = document.querySelector('#contactsTable tbody');
const contactForm = document.getElementById('contactForm');
const contactFormTitle = document.getElementById('contactFormTitle');
const contactFormResult = document.getElementById('contactFormResult');
const contactAddBtn = document.getElementById('contactAddBtn');
const contactCancelBtn = document.getElementById('contactCancelBtn');
const contactSaveBtn = document.getElementById('contactSaveBtn');
const customGroupsDatalist = document.getElementById('customGroupsDatalist');
const cId = document.getElementById('c_id');
const cFirstName = document.getElementById('c_first_name');
const cLastName = document.getElementById('c_last_name');
const cEmail = document.getElementById('c_email');
const cPhoneNumber = document.getElementById('c_phone_number');
const cFinancialStatus = document.getElementById('c_financial_status');
const cCommitteeRole = document.getElementById('c_committee_role');
const cAmountDue = document.getElementById('c_amount_due');
const cCustomGroups = document.getElementById('c_custom_groups');

let allContacts = [];

async function loadCustomGroupsDatalist() {
  try {
    const res = await fetch('/api/custom-groups');
    const data = await res.json();
    customGroupsDatalist.innerHTML = (data.groups || []).map((g) => `<option value="${escapeHtml(g)}"></option>`).join('');
  } catch (err) {
    // Non-critical: the input still works as free text without autocomplete.
  }
}

async function loadContacts() {
  contactsTableBody.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
  loadCustomGroupsDatalist();
  try {
    const res = await fetch('/api/members');
    const data = await res.json();
    allContacts = data.members || [];
    renderContactsTable(contactsSearch.value);
  } catch (err) {
    contactsTableBody.innerHTML = '<tr><td colspan="8">Could not load contacts.</td></tr>';
  }
}

function renderContactsTable(filterText) {
  const filter = filterText.trim().toLowerCase();
  const filtered = allContacts.filter((m) => {
    if (!filter) return true;
    const haystack = `${m.first_name} ${m.last_name} ${m.phone_number} ${(m.custom_groups || []).join(' ')}`.toLowerCase();
    return haystack.includes(filter);
  });
  if (filtered.length === 0) {
    contactsTableBody.innerHTML = '<tr><td colspan="8">No contacts match.</td></tr>';
    return;
  }
  contactsTableBody.innerHTML = filtered.map((m) => `
    <tr class="${m.is_active ? '' : 'inactive-row'}">
      <td>${escapeHtml(m.first_name)} ${escapeHtml(m.last_name)}</td>
      <td>${escapeHtml(m.phone_number)}</td>
      <td>${escapeHtml(m.email || '')}</td>
      <td>${escapeHtml(m.financial_status)}</td>
      <td>${escapeHtml(m.committee_role)}</td>
      <td>${escapeHtml((m.custom_groups || []).join(', '))}</td>
      <td><span class="badge ${m.is_active ? 'active' : 'inactive'}">${m.is_active ? 'Active' : 'Inactive'}</span></td>
      <td class="row-actions">
        <button type="button" class="edit-contact-btn" data-id="${m.member_id}">Edit</button>
        <button type="button" class="toggle-contact-btn" data-id="${m.member_id}" data-active="${m.is_active}">${m.is_active ? 'Deactivate' : 'Reactivate'}</button>
      </td>
    </tr>`).join('');

  contactsTableBody.querySelectorAll('.edit-contact-btn').forEach((btn) => {
    btn.addEventListener('click', () => openContactForm(allContacts.find((m) => m.member_id === btn.dataset.id)));
  });
  contactsTableBody.querySelectorAll('.toggle-contact-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleContactActive(btn.dataset.id, btn.dataset.active !== 'true'));
  });
}

contactsSearch.addEventListener('input', () => renderContactsTable(contactsSearch.value));

function openContactForm(existing) {
  contactFormResult.classList.add('hidden');
  cId.value = existing?.member_id || '';
  cFirstName.value = existing?.first_name || '';
  cLastName.value = existing?.last_name || '';
  cEmail.value = existing?.email || '';
  cPhoneNumber.value = existing?.phone_number || '';
  cFinancialStatus.value = existing?.financial_status || 'unknown';
  cCommitteeRole.value = existing?.committee_role || 'none';
  cAmountDue.value = existing?.amount_due || '';
  cCustomGroups.value = (existing?.custom_groups || []).join(', ');
  contactFormTitle.textContent = existing ? `Edit ${existing.first_name} ${existing.last_name}` : 'Add Contact';
  contactForm.classList.remove('hidden');
  contactForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

contactAddBtn.addEventListener('click', () => openContactForm(null));
contactCancelBtn.addEventListener('click', () => contactForm.classList.add('hidden'));

contactForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  contactFormResult.classList.add('hidden');
  contactSaveBtn.disabled = true;
  const payload = {
    first_name: cFirstName.value,
    last_name: cLastName.value,
    email: cEmail.value,
    phone_number: cPhoneNumber.value,
    financial_status: cFinancialStatus.value,
    committee_role: cCommitteeRole.value,
    amount_due: cAmountDue.value,
    custom_groups: cCustomGroups.value.split(',').map((g) => g.trim()).filter(Boolean),
  };
  try {
    const id = cId.value;
    const res = await fetch(id ? `/api/members/${encodeURIComponent(id)}` : '/api/members', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      contactForm.classList.add('hidden');
      loadContacts();
      customTargetDataLoaded = false; // refresh custom-target groups/members next time they're used
    } else {
      contactFormResult.className = 'error';
      contactFormResult.textContent = (data.messages && data.messages.join('; ')) || data.error || 'Could not save';
      contactFormResult.classList.remove('hidden');
    }
  } catch (err) {
    contactFormResult.className = 'error';
    contactFormResult.textContent = 'Could not reach the server. Please try again.';
    contactFormResult.classList.remove('hidden');
  } finally {
    contactSaveBtn.disabled = false;
  }
});

async function toggleContactActive(id, nextActive) {
  try {
    await fetch(`/api/members/${encodeURIComponent(id)}/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: nextActive }),
    });
    loadContacts();
    customTargetDataLoaded = false;
  } catch (err) {
    // loadContacts() re-fetching on next tab visit is enough recovery here.
  }
}

updatePreview();
checkSession();
