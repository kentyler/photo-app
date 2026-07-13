// --- Sidebar combo helper ---
// Reusable: builds a type-ahead combo for people/places/things
function setupSidebarCombo({ inputId, matchesId, listId, allItemsFn, loadPhotoItemsFn,
                              fetchAllUrl, createUrl, photoLinkUrl, idKey }) {
  const input = document.getElementById(inputId);
  const matchesEl = document.getElementById(matchesId);
  const listEl = document.getElementById(listId);
  let comboBusy = false;

  function renderMatches() {
    const q = input.value.trim().toLowerCase();
    matchesEl.innerHTML = '';
    if (!q) { matchesEl.classList.remove('open'); return; }
    const hits = allItemsFn().filter(item => item.name.toLowerCase().includes(q));
    hits.forEach(item => {
      const div = document.createElement('div');
      div.className = 'combo-match';
      div.textContent = item.name;
      div.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        if (comboBusy || !currentPhoto || !currentPhoto.id) return;
        comboBusy = true;
        await fetch(photoLinkUrl(currentPhoto.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [idKey]: item.id })
        });
        input.value = '';
        matchesEl.classList.remove('open');
        comboBusy = false;
        loadPhotoItemsFn();
      });
      matchesEl.appendChild(div);
    });
    // "Create" option if no exact match
    const exact = hits.some(item => item.name.toLowerCase() === q);
    if (!exact) {
      const div = document.createElement('div');
      div.className = 'combo-create';
      div.textContent = `+ Create "${input.value.trim()}"`;
      div.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        if (comboBusy || !currentPhoto || !currentPhoto.id) return;
        comboBusy = true;
        const res = await fetch(createUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.value.trim() })
        });
        const created = await res.json();
        await fetch(photoLinkUrl(currentPhoto.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [idKey]: created.id })
        });
        input.value = '';
        matchesEl.classList.remove('open');
        comboBusy = false;
        await loadAllSidebar();
        loadPhotoItemsFn();
      });
      matchesEl.appendChild(div);
    }
    matchesEl.classList.add('open');
  }

  input.addEventListener('input', renderMatches);
  input.addEventListener('focus', renderMatches);
  input.addEventListener('blur', () => { matchesEl.classList.remove('open'); });

  return { listEl };
}

// --- Face region state (declared early for use in loadPhotoPeople) ---
const FACE_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
let facesMode = false;  // toggled by Faces button -- show rects, allow drawing
let faceDrawMode = false;
let currentPhotoPeople = [];

// --- People ---
const peopleList = document.getElementById('people-list');
let allPeople = [];
async function loadAllPeople() { allPeople = await (await fetch('/api/people')).json(); }
async function loadPhotoPeople() {
  peopleList.innerHTML = '';
  if (!currentPhoto || !currentPhoto.id) { currentPhotoPeople = []; drawFaceRects(); return; }
  const people = await (await fetch(`/api/photo/${currentPhoto.id}/people`)).json();
  currentPhotoPeople = people;
  people.forEach((pp, i) => {
    const row = document.createElement('div');
    row.className = 'person-row';
    row.dataset.ppId = pp.id;
    const color = FACE_COLORS[i % FACE_COLORS.length];
    const hasCoords = pp.x != null && pp.y != null && pp.w != null && pp.h != null;
    let inner = '';
    if (facesMode && hasCoords) {
      inner += `<span class="face-dot" style="background:${color};"></span>`;
    }
    inner += `<span class="person-name-link" style="flex:1;cursor:pointer;" data-person-id="${pp.person_id}">${pp.name}</span>`;
    if (facesMode && !hasCoords) {
      inner += `<button class="locate-btn" title="Locate in photo">&#x1F4CD;</button>`;
    }
    inner += `<button class="remove-person" title="Remove">&times;</button>`;
    row.innerHTML = inner;
    row.querySelector('.remove-person').addEventListener('click', (e) => {
      e.stopPropagation();
      showPersonRemovePopup(pp, e.target);
    });
    // Locate button
    const locateBtn = row.querySelector('.locate-btn');
    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        enterDrawMode(pp.id);
      });
    }
    // Click person name to open detail popup
    const nameLink = row.querySelector('.person-name-link');
    if (nameLink) {
      nameLink.addEventListener('click', (e) => {
        e.stopPropagation();
        openPersonForm(pp.person_id);
      });
    }
    // Click row to highlight rect on canvas (only in faces mode)
    if (facesMode) {
      row.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        if (hasCoords) highlightFaceRect(i);
      });
    }
    peopleList.appendChild(row);
  });
  if (facesMode) drawFaceRects();
}

function highlightFaceRect(index) {
  // Briefly make the rect more visible
  drawFaceRects();
  const pp = currentPhotoPeople[index];
  if (!pp || pp.x == null) return;
  const cw = faceCanvas.width, ch = faceCanvas.height;
  const nat = { w: detailImg.naturalWidth, h: detailImg.naturalHeight };
  if (!nat.w || !nat.h) return;
  const scale = Math.min(cw / nat.w, ch / nat.h);
  const drawW = nat.w * scale, drawH = nat.h * scale;
  const offX = (cw - drawW) / 2, offY = (ch - drawH) / 2;
  const color = FACE_COLORS[index % FACE_COLORS.length];
  const rx = offX + pp.x * drawW, ry = offY + pp.y * drawH;
  const rw = pp.w * drawW, rh = pp.h * drawH;
  faceCtx.strokeStyle = '#fff';
  faceCtx.lineWidth = 3;
  faceCtx.strokeRect(rx - 1, ry - 1, rw + 2, rh + 2);
  setTimeout(() => drawFaceRects(), 800);
}

// --- Person remove popup ---
const personRemovePopup = document.getElementById('person-remove-popup');
const prpName = document.getElementById('prp-name');
let prpData = null; // { ppId, personId, name }

function showPersonRemovePopup(pp, anchorEl) {
  prpData = { ppId: pp.id, personId: pp.person_id, name: pp.name };
  prpName.textContent = pp.name;
  // Position near the button
  const rect = anchorEl.getBoundingClientRect();
  personRemovePopup.style.left = Math.min(rect.left, window.innerWidth - 230) + 'px';
  personRemovePopup.style.top = (rect.bottom + 4) + 'px';
  personRemovePopup.classList.add('open');
}

function closePersonRemovePopup() {
  personRemovePopup.classList.remove('open');
  prpData = null;
}

document.getElementById('prp-cancel').addEventListener('click', closePersonRemovePopup);

document.getElementById('prp-unlink').addEventListener('click', async () => {
  if (!prpData) return;
  await fetch(`/api/photo-people/${prpData.ppId}`, { method: 'DELETE' });
  closePersonRemovePopup();
  loadPhotoPeople();
});

document.getElementById('prp-delete').addEventListener('click', async () => {
  if (!prpData) return;
  await fetch(`/api/people/${prpData.personId}`, { method: 'DELETE' });
  closePersonRemovePopup();
  await loadAllPeople();
  loadPhotoPeople();
});

// Close popup on outside click
document.addEventListener('click', (e) => {
  if (personRemovePopup.classList.contains('open') && !personRemovePopup.contains(e.target) && !e.target.classList.contains('remove-person')) {
    closePersonRemovePopup();
  }
});

// --- Person form overlay ---
const pfOverlay = document.getElementById('pf-overlay');
const pfDialog = document.getElementById('pf-dialog');
const pfTitle = document.getElementById('pf-title');
const pfName = document.getElementById('pf-name');
const pfAliases = document.getElementById('pf-aliases');
const pfAliasInput = document.getElementById('pf-alias-input');
const pfBirth = document.getElementById('pf-birth');
const pfDeath = document.getElementById('pf-death');
const pfGender = document.getElementById('pf-gender');
const pfNotes = document.getElementById('pf-notes');
const pfRels = document.getElementById('pf-rels');
const pfRelType = document.getElementById('pf-rel-type');
const pfRelInput = document.getElementById('pf-rel-input');
const pfRelMatches = document.getElementById('pf-rel-matches');
let pfPersonId = null;
let pfRelatedIds = new Set();

async function openPersonForm(personId) {
  pfPersonId = personId;
  pfRelatedIds = new Set();
  // Load person scalar data
  const person = allPeople.find(p => p.id === personId);
  pfTitle.textContent = person ? person.name : 'Edit Person';
  pfName.value = person ? person.name : '';
  pfBirth.value = person && person.birth_date ? person.birth_date.slice(0, 10) : '';
  pfDeath.value = person && person.death_date ? person.death_date.slice(0, 10) : '';
  pfGender.value = (person && person.gender) || '';
  pfNotes.value = (person && person.notes) || '';
  pfAliasInput.value = '';
  pfRelInput.value = '';
  pfRelMatches.classList.remove('open');
  // Load aliases and relationships in parallel
  await Promise.all([loadPfAliases(), loadPfRels()]);
  pfOverlay.classList.add('active');
}

function closePersonForm() {
  pfOverlay.classList.remove('active');
  pfPersonId = null;
}

async function loadPfAliases() {
  const aliases = await (await fetch(`/api/people/${pfPersonId}/aliases`)).json();
  pfAliases.innerHTML = '';
  aliases.forEach(a => {
    const row = document.createElement('div');
    row.className = 'pf-alias-row';
    row.innerHTML = `<input type="radio" name="pf-primary" ${a.is_primary ? 'checked' : ''} data-alias-id="${a.id}"><span class="pf-alias-name">${a.alias}</span>${a.is_primary ? '' : '<button class="pf-alias-del" title="Delete">&times;</button>'}`;
    row.querySelector('input[type=radio]').addEventListener('change', async () => {
      await fetch(`/api/aliases/${a.id}/primary`, { method: 'PUT' });
      await loadPfAliases();
      // Update name input to new primary
      const updated = await (await fetch(`/api/people/${pfPersonId}/aliases`)).json();
      const primary = updated.find(u => u.is_primary);
      if (primary) { pfName.value = primary.alias; pfTitle.textContent = primary.alias; }
      await loadAllPeople();
      loadPhotoPeople();
    });
    const delBtn = row.querySelector('.pf-alias-del');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        await fetch(`/api/aliases/${a.id}`, { method: 'DELETE' });
        await loadPfAliases();
      });
    }
    pfAliases.appendChild(row);
  });
}

async function loadPfRels() {
  const rels = await (await fetch(`/api/people/${pfPersonId}/relationships`)).json();
  pfRelatedIds = new Set(rels.map(r => r.related_id));
  pfRels.innerHTML = '';
  rels.forEach(r => {
    const row = document.createElement('div');
    row.className = 'pf-rel-row';
    const basisTag = r.basis ? ` (${r.basis})` : '';
    row.innerHTML = `<span><span class="pf-rel-label">${r.type}${basisTag}</span> ${r.related_name}</span><button class="pf-rel-del" title="Remove">&times;</button>`;
    row.querySelector('.pf-rel-del').addEventListener('click', async () => {
      await fetch(`/api/relationships/${r.id}`, { method: 'DELETE' });
      await loadPfRels();
    });
    pfRels.appendChild(row);
  });
}

// Add alias
document.getElementById('pf-alias-add').addEventListener('click', async () => {
  const alias = pfAliasInput.value.trim();
  if (!alias || !pfPersonId) return;
  await fetch(`/api/people/${pfPersonId}/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias })
  });
  pfAliasInput.value = '';
  await loadPfAliases();
});

pfAliasInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('pf-alias-add').click();
});

// Relationship type-ahead
let pfRelHits = []; // current matches for + Add / Enter
pfRelInput.addEventListener('input', () => {
  const q = pfRelInput.value.trim().toLowerCase();
  pfRelMatches.innerHTML = '';
  if (!q) { pfRelHits = []; pfRelMatches.classList.remove('open'); return; }
  pfRelHits = allPeople.filter(p =>
    p.id !== pfPersonId &&
    p.name.toLowerCase().includes(q) &&
    !pfRelatedIds.has(p.id)
  ).slice(0, 10);
  pfRelHits.forEach(p => {
    const div = document.createElement('div');
    div.textContent = p.name;
    div.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      await addRelationship(p.id);
    });
    pfRelMatches.appendChild(div);
  });
  pfRelMatches.classList.toggle('open', pfRelHits.length > 0);
});

async function addRelationship(relatedId) {
  await fetch('/api/relationships', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person_id: pfPersonId, related_id: relatedId, type: pfRelType.value, basis: document.getElementById('pf-rel-basis').value || null })
  });
  pfRelInput.value = '';
  pfRelHits = [];
  pfRelMatches.classList.remove('open');
  await loadPfRels();
}

document.getElementById('pf-rel-add').addEventListener('click', async () => {
  if (pfRelHits.length > 0) await addRelationship(pfRelHits[0].id);
});

pfRelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && pfRelHits.length > 0) {
    e.preventDefault();
    addRelationship(pfRelHits[0].id);
  }
});

pfRelInput.addEventListener('focus', () => {
  if (pfRelInput.value.trim()) pfRelInput.dispatchEvent(new Event('input'));
});

pfRelInput.addEventListener('blur', () => {
  pfRelMatches.classList.remove('open');
});

// Save scalar fields
document.getElementById('pf-save').addEventListener('click', async () => {
  if (!pfPersonId) return;
  await fetch(`/api/people/${pfPersonId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: pfName.value.trim(),
      birth_date: pfBirth.value || null,
      death_date: pfDeath.value || null,
      gender: pfGender.value || null,
      notes: pfNotes.value.trim() || null
    })
  });
  await loadAllPeople();
  loadPhotoPeople();
  closePersonForm();
});

// Close handlers
document.getElementById('pf-close').addEventListener('click', closePersonForm);
document.getElementById('pf-cancel').addEventListener('click', closePersonForm);
pfOverlay.addEventListener('click', (e) => {
  if (e.target === pfOverlay) closePersonForm();
});

setupSidebarCombo({
  inputId: 'people-input', matchesId: 'people-matches', listId: 'people-list',
  allItemsFn: () => allPeople, loadPhotoItemsFn: loadPhotoPeople,
  fetchAllUrl: '/api/people', createUrl: '/api/people',
  photoLinkUrl: id => `/api/photo/${id}/people`, idKey: 'person_id'
});

// --- Places ---
const placesList = document.getElementById('places-list');
let allPlaces = [];
async function loadAllPlaces() { allPlaces = await (await fetch('/api/places')).json(); }
async function loadPhotoPlaces() {
  placesList.innerHTML = '';
  if (!currentPhoto || !currentPhoto.id) return;
  const places = await (await fetch(`/api/photo/${currentPhoto.id}/places`)).json();
  places.forEach(pp => {
    const row = document.createElement('div');
    row.className = 'person-row';
    row.innerHTML = `<span>${pp.name}</span><button title="Remove">&times;</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await fetch(`/api/photo-places/${pp.id}`, { method: 'DELETE' });
      loadPhotoPlaces();
    });
    placesList.appendChild(row);
  });
}
setupSidebarCombo({
  inputId: 'places-input', matchesId: 'places-matches', listId: 'places-list',
  allItemsFn: () => allPlaces, loadPhotoItemsFn: loadPhotoPlaces,
  fetchAllUrl: '/api/places', createUrl: '/api/places',
  photoLinkUrl: id => `/api/photo/${id}/places`, idKey: 'place_id'
});

// --- Things ---
const thingsList = document.getElementById('things-list');
let allThings = [];
async function loadAllThings() { allThings = await (await fetch('/api/things')).json(); }
async function loadPhotoThings() {
  thingsList.innerHTML = '';
  if (!currentPhoto || !currentPhoto.id) return;
  const things = await (await fetch(`/api/photo/${currentPhoto.id}/things`)).json();
  things.forEach(pt => {
    const row = document.createElement('div');
    row.className = 'person-row';
    row.innerHTML = `<span>${pt.name}</span><button title="Remove">&times;</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await fetch(`/api/photo-things/${pt.id}`, { method: 'DELETE' });
      loadPhotoThings();
    });
    thingsList.appendChild(row);
  });
}
setupSidebarCombo({
  inputId: 'things-input', matchesId: 'things-matches', listId: 'things-list',
  allItemsFn: () => allThings, loadPhotoItemsFn: loadPhotoThings,
  fetchAllUrl: '/api/things', createUrl: '/api/things',
  photoLinkUrl: id => `/api/photo/${id}/things`, idKey: 'thing_id'
});

async function loadAllSidebar() {
  await Promise.all([loadAllPeople(), loadAllPlaces(), loadAllThings(), loadAllDocuments()]);
}

// --- Documents: sidebar section ---
// --- Documents: sidebar section ---
let allDocuments = [];
async function loadAllDocuments() {
  allDocuments = await (await fetch('/api/documents')).json();
}

const photoDocsList = document.getElementById('photo-docs-list');
async function loadPhotoDocs() {
  photoDocsList.innerHTML = '';
  if (!currentPhoto || !currentPhoto.id) return;
  const docs = await (await fetch(`/api/photo/${currentPhoto.id}/documents`)).json();
  docs.forEach(d => {
    const row = document.createElement('div');
    row.className = 'person-row';
    row.innerHTML = `<span>${d.title}</span><button title="Remove">&times;</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await fetch(`/api/photo-documents/${d.id}`, { method: 'DELETE' });
      loadPhotoDocs();
    });
    photoDocsList.appendChild(row);
  });
}

// Documents sidebar combo - uses setupSidebarCombo with title mapped to name
setupSidebarCombo({
  inputId: 'docs-input', matchesId: 'docs-matches', listId: 'photo-docs-list',
  allItemsFn: () => allDocuments.map(d => ({ id: d.id, name: d.title })),
  loadPhotoItemsFn: loadPhotoDocs,
  fetchAllUrl: '/api/documents', createUrl: '/api/documents',
  photoLinkUrl: id => `/api/photo/${id}/documents`, idKey: 'document_id'
});
