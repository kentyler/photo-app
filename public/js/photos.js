// Load groups
async function loadGroups() {
  const res = await fetch('/api/groups');
  const groups = await res.json();
  while (groupSelect.options.length > 1) groupSelect.remove(1);
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.name} (${g.member_count})`;
    groupSelect.appendChild(opt);
  });
}

// Load all tags
async function loadAllTags() {
  const res = await fetch('/api/tags');
  allTags = await res.json();
  tagSuggestions.innerHTML = '';
  filterTag.innerHTML = '<option value="">All tags</option>';
  allTags.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.name;
    tagSuggestions.appendChild(opt);
    const fopt = document.createElement('option');
    fopt.value = t.id;
    fopt.textContent = t.name;
    filterTag.appendChild(fopt);
  });
}

// Load photos — disk mode uses /api/disk-photos, group mode uses /api/photos
async function loadPhotos() {
  const group = groupSelect.value;

  if (activeSource === 'group' && group) {
    const acctParam = currentAccountFilter !== 'all' ? `&account=${encodeURIComponent(currentAccountFilter)}` : '';
    const res = await fetch(`/api/photos?group=${encodeURIComponent(group)}${acctParam}`);
    photos = await res.json();
    // DB photos: mark source
    photos.forEach(p => { p._src = 'db'; });
    renderGrid();
    return;
  }

  if (activeSource === 'disk' && selectedFolder) {
    const res = await fetch(`/api/disk-photos?path=${encodeURIComponent(selectedFolder)}`);
    const diskFiles = await res.json();
    // Map to photo objects with _src='disk'
    photos = diskFiles.map(f => ({
      filename: f.filename,
      disk_path: f.disk_path,
      _src: 'disk',
      id: null, rating: null, caption: null
    }));
    renderGrid();
    // Async: hash-match to get DB metadata
    matchDiskPhotos(selectedFolder);
    return;
  }

  grid.innerHTML = '';
  photoCount.textContent = '';
}

async function matchDiskPhotos(folderPath) {
  try {
    const res = await fetch(`/api/disk-photos/match?path=${encodeURIComponent(folderPath)}`);
    const matches = await res.json();
    if (selectedFolder !== folderPath) return; // navigated away
    const matchMap = new Map(matches.map(m => [m.filename, m]));
    let changed = false;
    photos.forEach(p => {
      const m = matchMap.get(p.filename);
      if (m) {
        p.id = m.db_id;
        p.rating = m.rating;
        p.caption = m.caption;
        changed = true;
      }
    });
    if (changed) renderGrid();
  } catch (_) {}
}

function renderGrid() {
  const ratingFilter = filterRating.value;
  const tagFilter = filterTag.value;

  let filtered = photos;
  if (ratingFilter === 'unrated') {
    filtered = filtered.filter(p => !p.rating);
  } else if (ratingFilter) {
    filtered = filtered.filter(p => p.rating === ratingFilter);
  }

  if (tagFilter && activeSource !== 'disk') {
    loadTaggedFiles(tagFilter).then(taggedIds => {
      const set = new Set(taggedIds);
      const tagFiltered = filtered.filter(p => set.has(p.id));
      renderCards(tagFiltered);
    });
    return;
  }

  renderCards(filtered);
}

async function loadTaggedFiles(tagId) {
  const group = groupSelect.value;
  const url = activeSource === 'group' && group
    ? `/api/photos?group=${encodeURIComponent(group)}`
    : `/api/photos?folder=${encodeURIComponent(selectedFolder)}`;
  const res = await fetch(url);
  const all = await res.json();
  const ids = [];
  for (const p of all) {
    const tr = await fetch(`/api/photo/${p.id}/tags`);
    const tags = await tr.json();
    if (tags.some(t => t.id == tagId)) ids.push(p.id);
  }
  return ids;
}

function photoImgSrc(p) {
  if (p._src === 'disk') return `/api/disk-photo?path=${encodeURIComponent(p.disk_path)}`;
  return `/api/photo/${p.id}`;
}

function renderCards(list) {
  photoCount.textContent = `${list.length} photos`;
  grid.innerHTML = '';
  list.forEach((p, idx) => {
    const card = document.createElement('div');
    const cardKey = p.id || p.disk_path;
    card.className = 'photo-card' + (p.id && selectedIds.has(p.id) ? ' selected' : '');
    card.dataset.photoId = p.id || '';
    card.dataset.idx = idx;
    card.innerHTML = `
      <input type="checkbox" class="select-cb" ${p.id && selectedIds.has(p.id) ? 'checked' : ''}>
      <img src="${photoImgSrc(p)}" loading="lazy" alt="${p.filename}">
      ${p.rating ? `<span class="rating-badge rating-${p.rating}">${p.rating}</span>` : ''}
    `;
    const cb = card.querySelector('.select-cb');
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (p.id) toggleSelect(p.id, card, cb);
    });
    card.querySelector('img').addEventListener('contextmenu', (e) => showCtxMenu(e, p));
    card.addEventListener('click', (e) => {
      if (e.target === cb) return;
      openDetail(p);
    });
    grid.appendChild(card);
  });
  updateSelectionUI();
}

// Filters -- folder and group are mutually exclusive
groupSelect.addEventListener('change', () => {
  if (groupSelect.value) {
    activeSource = 'group';
    selectedFolder = '';
    folderBtn.textContent = '-- Folder --';
    const label = groupSelect.selectedOptions[0]?.textContent || '';
    fetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'group', groupId: parseInt(groupSelect.value), label }) });
  } else {
    activeSource = null;
  }
  loadPhotos();
});
filterRating.addEventListener('change', renderGrid);
filterTag.addEventListener('change', renderGrid);

// --- Add to group ---
// --- Add to group ---
const groupPickerOverlay = document.getElementById('group-picker-overlay');
const groupListEl = document.getElementById('group-list');
const newGroupInput = document.getElementById('new-group-input');
let selectedGroupId = null;

document.getElementById('btn-add-to-group').addEventListener('click', async () => {
  if (selectedIds.size === 0) return;
  selectedGroupId = null;
  newGroupInput.value = '';
  // Populate group list
  groupListEl.innerHTML = '';
  const res = await fetch('/api/groups');
  const groups = await res.json();
  groups.forEach(g => {
    const div = document.createElement('div');
    div.className = 'group-option';
    div.textContent = `${g.name} (${g.member_count})`;
    div.addEventListener('click', () => {
      groupListEl.querySelectorAll('.group-option').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedGroupId = g.id;
    });
    groupListEl.appendChild(div);
  });
  groupPickerOverlay.classList.add('active');
});

document.getElementById('btn-create-group-inline').addEventListener('click', async () => {
  const name = newGroupInput.value.trim();
  if (!name) return;
  const res = await fetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const created = await res.json();
  if (created.id) {
    selectedGroupId = created.id;
    // Add to list and select it
    const div = document.createElement('div');
    div.className = 'group-option selected';
    div.textContent = `${created.name} (0)`;
    groupListEl.querySelectorAll('.group-option').forEach(el => el.classList.remove('selected'));
    groupListEl.prepend(div);
    div.addEventListener('click', () => {
      groupListEl.querySelectorAll('.group-option').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedGroupId = created.id;
    });
    newGroupInput.value = '';
    loadGroups(); // refresh header dropdown
  }
});

document.getElementById('group-picker-cancel').addEventListener('click', () => {
  groupPickerOverlay.classList.remove('active');
});

document.getElementById('group-picker-confirm').addEventListener('click', async () => {
  if (!selectedGroupId) return;
  const ids = Array.from(selectedIds);
  await fetch(`/api/groups/${selectedGroupId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_ids: ids })
  });
  groupPickerOverlay.classList.remove('active');
  selectedIds.clear();
  updateSelectionUI();
  selectAllCb.checked = false;
  loadGroups(); // refresh counts
});

// --- Context menu ---
// --- Context menu (rotate) ---
const ctxMenu = document.getElementById('ctx-menu');
let ctxPhoto = null;

function showCtxMenu(e, photo) {
  e.preventDefault();
  ctxPhoto = photo;
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top = e.clientY + 'px';
  ctxMenu.style.display = 'block';
}

function hideCtxMenu() { ctxMenu.style.display = 'none'; ctxPhoto = null; }

document.addEventListener('click', hideCtxMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtxMenu(); });

async function rotatePhoto(photo, angle) {
  const body = photo.id ? { id: photo.id, angle } : { path: photo.disk_path, angle };
  try {
    const res = await fetch('/api/rotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { console.error('Rotate failed:', data.error); return; }
    cacheBustPhoto(photo);
  } catch (err) {
    console.error('Rotate failed:', err);
  }
}

document.getElementById('ctx-rotate-right').addEventListener('click', () => {
  if (ctxPhoto) rotatePhoto(ctxPhoto, 90);
});
document.getElementById('ctx-rotate-left').addEventListener('click', () => {
  if (ctxPhoto) rotatePhoto(ctxPhoto, 270);
});

document.getElementById('ctx-hide').addEventListener('click', async () => {
  if (!ctxPhoto) return;
  const body = ctxPhoto.id ? { id: ctxPhoto.id } : { path: ctxPhoto.disk_path };
  try {
    const res = await fetch('/api/hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { console.error('Hide failed:', data.error); return; }
    // Remove from photos array and re-render
    const hiddenPhoto = ctxPhoto;
    photos = photos.filter(p => !isSamePhoto(p, hiddenPhoto));
    // If in lightbox, navigate to next or close
    if (lightbox.classList.contains('active')) {
      lbList = lbList.filter(p => !isSamePhoto(p, hiddenPhoto));
      if (lbList.length === 0) { closeLightbox(); }
      else { lbIndex = Math.min(lbIndex, lbList.length - 1); showLbPhoto(); }
    }
    // Close detail if showing this photo
    if (currentPhoto && isSamePhoto(currentPhoto, hiddenPhoto)) {
      overlay.classList.remove('active');
    }
    renderGrid();
  } catch (err) {
    console.error('Hide failed:', err);
  }
});

// Wire context menu on detail and lightbox images
detailImg.addEventListener('contextmenu', (e) => { if (currentPhoto) showCtxMenu(e, currentPhoto); });
lbImg.addEventListener('contextmenu', (e) => { if (lbList[lbIndex]) showCtxMenu(e, lbList[lbIndex]); });
