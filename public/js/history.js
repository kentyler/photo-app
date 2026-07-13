// --- History & Bookmarks ---
const hbOverlay = document.getElementById('hb-overlay');
const hbContent = document.getElementById('hb-content');
const hbClose = document.getElementById('hb-close');
const headerHistoryBtn = document.getElementById('header-history-btn');
let hbActiveTab = 'bookmarks';

function relativeTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' hr ago';
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

async function renderHBContent() {
  if (hbActiveTab === 'bookmarks') {
    const res = await fetch('/api/bookmarks');
    const bookmarks = await res.json();
    if (!bookmarks.length) { hbContent.innerHTML = '<div class="hb-empty">No bookmarks yet. Open a photo and click Bookmark.</div>'; return; }
    hbContent.innerHTML = bookmarks.map(b => `
      <div class="hb-entry">
        <span class="hb-icon">&#9733;</span>
        <div class="hb-info">
          <div class="hb-name">${b.name}</div>
          <div class="hb-sub">${b.source === 'disk' ? (b.folder || '').split('/').pop() : 'Group'}${b.photoFilename ? ' > ' + b.photoFilename : ''}</div>
        </div>
        <span class="hb-time">${relativeTime(b.ts)}</span>
        <button class="hb-go" data-source="${b.source}" data-folder="${b.folder || ''}" data-group-id="${b.groupId || ''}" data-photo-id="${b.photoId || ''}">Go</button>
        <button class="hb-del" data-id="${b.id}" title="Delete bookmark">&times;</button>
      </div>
    `).join('');
  } else {
    const res = await fetch('/api/history');
    const history = await res.json();
    if (!history.length) { hbContent.innerHTML = '<div class="hb-empty">No history yet. Browse some folders or groups.</div>'; return; }
    hbContent.innerHTML = history.map(h => `
      <div class="hb-entry" style="cursor:pointer;" data-source="${h.source}" data-folder="${h.folder || ''}" data-group-id="${h.groupId || ''}">
        <div class="hb-info">
          <div class="hb-name">${h.label || h.folder || 'Group ' + h.groupId}</div>
          <div class="hb-sub">${h.source === 'disk' ? 'Folder' : 'Group'}</div>
        </div>
        <span class="hb-time">${relativeTime(h.ts)}</span>
      </div>
    `).join('');
  }
}

function hbNavigate(source, folder, groupId, photoId) {
  hbOverlay.classList.remove('active');
  if (source === 'disk' && folder) {
    const label = folder.split('/').pop();
    selectFolder(folder, label);
  } else if (source === 'group' && groupId) {
    groupSelect.value = groupId;
    groupSelect.dispatchEvent(new Event('change'));
  }
  if (photoId) {
    // Wait for grid to load then open the photo
    setTimeout(() => {
      const photo = photos.find(p => p.id === parseInt(photoId));
      if (photo) openDetail(photo);
    }, 500);
  }
}

hbContent.addEventListener('click', (e) => {
  const goBtn = e.target.closest('.hb-go');
  if (goBtn) {
    hbNavigate(goBtn.dataset.source, goBtn.dataset.folder, goBtn.dataset.groupId, goBtn.dataset.photoId);
    return;
  }
  const delBtn = e.target.closest('.hb-del');
  if (delBtn) {
    fetch('/api/bookmarks/' + delBtn.dataset.id, { method: 'DELETE' }).then(() => renderHBContent());
    return;
  }
  const entry = e.target.closest('.hb-entry[data-source]');
  if (entry && hbActiveTab === 'history') {
    hbNavigate(entry.dataset.source, entry.dataset.folder, entry.dataset.groupId);
  }
});

document.querySelectorAll('.hb-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.hb-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    hbActiveTab = tab.dataset.tab;
    renderHBContent();
  });
});

headerHistoryBtn.addEventListener('click', () => {
  hbOverlay.classList.add('active');
  renderHBContent();
});
hbClose.addEventListener('click', () => hbOverlay.classList.remove('active'));
document.getElementById('hb-home').addEventListener('click', (e) => {
  e.preventDefault();
  hbOverlay.classList.remove('active');
});
hbOverlay.addEventListener('click', (e) => { if (e.target === hbOverlay) hbOverlay.classList.remove('active'); });

// Bookmark photo button
document.getElementById('btn-bookmark-photo').addEventListener('click', () => {
  if (!currentPhoto) return;
  const defaultName = currentPhoto.filename || 'Untitled';
  const name = prompt('Bookmark name:', defaultName);
  if (!name) return;
  const body = { name, source: activeSource || 'disk', photoId: currentPhoto.id, photoFilename: currentPhoto.filename };
  if (activeSource === 'disk') body.folder = selectedFolder;
  else if (activeSource === 'group') body.groupId = parseInt(groupSelect.value);
  fetch('/api/bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
});
