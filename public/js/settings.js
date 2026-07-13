// --- Settings ---
const settingsOverlay = document.getElementById('settings-overlay');
const settingsTheme = document.getElementById('settings-theme');
const settingsLocalAccount = document.getElementById('settings-local-account');
const settingsLocalPhotosDir = document.getElementById('settings-local-photos-dir');
let savedTheme = 'dark';
let savedLocalAccount = '';
let savedLocalPhotosDir = '';
let flRoots = []; // multi-root sources

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    savedTheme = s.theme || 'dark';
    applyTheme(savedTheme);
    savedLocalAccount = s.local_account || '';
    savedLocalPhotosDir = s.local_photos_dir || '';
    // Populate account filter dropdown with local account option
    if (savedLocalAccount) {
      const existing = accountFilter.querySelector('option[data-local]');
      if (existing) existing.remove();
      const opt = document.createElement('option');
      opt.value = savedLocalAccount;
      opt.textContent = savedLocalAccount;
      opt.setAttribute('data-local', '1');
      accountFilter.appendChild(opt);
    }
  } catch (_) {}
  // Load roots
  try {
    const rres = await fetch('/api/roots');
    flRoots = await rres.json();
  } catch (_) { flRoots = []; }
  if (flRoots.length > 0) {
    flBrowsePath = null; // show roots view
  } else {
    flBrowsePath = flBrowsePath || 'D:/';
  }
}

function renderSettingsRoots() {
  const list = document.getElementById('settings-roots-list');
  list.innerHTML = '';
  flRoots.forEach(r => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:0.4rem;padding:0.25rem 0;';
    row.innerHTML = `<span style="flex:1;font-size:0.85rem;"><b>${r.label}</b> &mdash; ${r.path}</span>`;
    const del = document.createElement('button');
    del.textContent = '\u00d7';
    del.title = 'Remove root';
    del.style.cssText = 'background:transparent;border:1px solid var(--border-accent);color:var(--text-muted);border-radius:4px;cursor:pointer;padding:0.1rem 0.4rem;font-size:0.9rem;';
    del.addEventListener('click', async () => {
      await fetch(`/api/roots/${r.id}`, { method: 'DELETE' });
      flRoots = flRoots.filter(x => x.id !== r.id);
      renderSettingsRoots();
    });
    row.appendChild(del);
    list.appendChild(row);
  });
  if (flRoots.length === 0) {
    list.innerHTML = '<div style="font-size:0.85rem;color:var(--text-muted);">No roots configured.</div>';
  }
}

document.getElementById('settings-root-add').addEventListener('click', async () => {
  const label = document.getElementById('settings-root-label').value.trim();
  const rootPath = document.getElementById('settings-root-path').value.trim();
  if (!label || !rootPath) return;
  const res = await fetch('/api/roots', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, path: rootPath })
  });
  if (res.ok) {
    const newRoot = await res.json();
    flRoots.push(newRoot);
    flRoots.sort((a, b) => a.label.localeCompare(b.label));
    renderSettingsRoots();
    document.getElementById('settings-root-label').value = '';
    document.getElementById('settings-root-path').value = '';
  }
});

document.getElementById('header-settings-btn').addEventListener('click', () => {
  settingsTheme.value = savedTheme;
  settingsLocalAccount.value = savedLocalAccount;
  settingsLocalPhotosDir.value = savedLocalPhotosDir;
  renderSettingsRoots();
  settingsOverlay.classList.add('active');
});

// Instant theme preview when changing dropdown
settingsTheme.addEventListener('change', () => {
  applyTheme(settingsTheme.value);
});

document.getElementById('settings-cancel').addEventListener('click', () => {
  applyTheme(savedTheme); // revert preview
  settingsOverlay.classList.remove('active');
});

document.getElementById('settings-save').addEventListener('click', async () => {
  const theme = settingsTheme.value;
  const localAccount = settingsLocalAccount.value.trim();
  const localPhotosDir = settingsLocalPhotosDir.value.trim();
  await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme, local_account: localAccount, local_photos_dir: localPhotosDir })
  });
  savedTheme = theme;
  applyTheme(theme);
  savedLocalAccount = localAccount;
  savedLocalPhotosDir = localPhotosDir;
  // Update account filter dropdown
  if (localAccount) {
    const existing = accountFilter.querySelector('option[data-local]');
    if (existing) existing.remove();
    const opt = document.createElement('option');
    opt.value = localAccount;
    opt.textContent = localAccount;
    opt.setAttribute('data-local', '1');
    accountFilter.appendChild(opt);
  }
  // Reset folder browser to roots view
  if (flRoots.length > 0) flBrowsePath = null;
  settingsOverlay.classList.remove('active');
});

settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) {
    applyTheme(savedTheme);
    settingsOverlay.classList.remove('active');
  }
});

// --- Init ---
// Init — load settings first (applies theme), then other data, then restore last location
loadSettings().then(async () => {
  await loadGroups();
  loadAllTags();
  // Restore last location from history
  try {
    const res = await fetch('/api/history');
    const history = await res.json();
    if (history.length > 0) {
      const last = history[0];
      if (last.source === 'disk' && last.folder) {
        selectFolder(last.folder, last.label || last.folder.split('/').pop());
      } else if (last.source === 'group' && last.groupId) {
        groupSelect.value = last.groupId;
        groupSelect.dispatchEvent(new Event('change'));
      }
    }
  } catch (e) { /* no history yet */ }
});
