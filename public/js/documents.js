// --- Documents: standalone overlay ---
const docsOverlay = document.getElementById('docs-overlay');
const docList = document.getElementById('doc-list');
const docSearch = document.getElementById('doc-search');
const docDetailEmpty = document.getElementById('doc-detail-empty');
const docDetailContent = document.getElementById('doc-detail-content');
const docTitleInput = document.getElementById('doc-title-input');
const docBodyInput = document.getElementById('doc-body-input');
const docFilesList = document.getElementById('doc-files-list');
const docPeopleList = document.getElementById('doc-people-list');
const docPlacesList = document.getElementById('doc-places-list');
const docThingsList = document.getElementById('doc-things-list');
const docPhotosList = document.getElementById('doc-photos-list');
let currentDocument = null;

document.getElementById('header-docs-btn').addEventListener('click', () => {
  docsOverlay.classList.add('active');
  refreshDocList();
});
document.getElementById('docs-close').addEventListener('click', () => {
  docsOverlay.classList.remove('active');
});
document.getElementById('docs-home').addEventListener('click', (e) => {
  e.preventDefault();
  docsOverlay.classList.remove('active');
});

async function refreshDocList() {
  await loadAllDocuments();
  renderDocList();
}

function renderDocList() {
  const q = docSearch.value.trim().toLowerCase();
  docList.innerHTML = '';
  const filtered = q ? allDocuments.filter(d => d.title.toLowerCase().includes(q)) : allDocuments;
  filtered.forEach(d => {
    const div = document.createElement('div');
    div.className = 'doc-list-item' + (currentDocument && currentDocument.id === d.id ? ' active' : '');
    div.innerHTML = `<div class="doc-title">${d.title}</div><div class="doc-date">${new Date(d.updated_at).toLocaleDateString()}</div>`;
    div.addEventListener('click', () => openDocument(d.id));
    docList.appendChild(div);
  });
}
docSearch.addEventListener('input', renderDocList);

document.getElementById('docs-new-btn').addEventListener('click', async () => {
  const res = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Untitled Document' })
  });
  const doc = await res.json();
  await refreshDocList();
  openDocument(doc.id);
});

async function openDocument(id) {
  const res = await fetch(`/api/documents/${id}`);
  currentDocument = await res.json();
  docDetailEmpty.style.display = 'none';
  docDetailContent.style.display = 'block';
  docTitleInput.value = currentDocument.title;
  docBodyInput.value = currentDocument.body || '';
  renderDocList();
  loadDocFiles();
  loadDocPeople();
  loadDocPlaces();
  loadDocThings();
  loadDocPhotos();
}

document.getElementById('doc-save-btn').addEventListener('click', async () => {
  if (!currentDocument) return;
  await fetch(`/api/documents/${currentDocument.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: docTitleInput.value, body: docBodyInput.value })
  });
  await refreshDocList();
  await loadAllDocuments(); // refresh sidebar data too
});

document.getElementById('doc-delete-btn').addEventListener('click', async () => {
  if (!currentDocument || !confirm('Delete this document?')) return;
  await fetch(`/api/documents/${currentDocument.id}`, { method: 'DELETE' });
  currentDocument = null;
  docDetailContent.style.display = 'none';
  docDetailEmpty.style.display = 'block';
  await refreshDocList();
});

// --- Doc files ---
async function loadDocFiles() {
  docFilesList.innerHTML = '';
  if (!currentDocument) return;
  const files = await (await fetch(`/api/documents/${currentDocument.id}/files`)).json();
  files.forEach(f => {
    const row = document.createElement('div');
    row.className = 'doc-file-row';
    row.innerHTML = `<a href="/api/document-file/${f.id}" target="_blank">${f.original_name}</a><button title="Remove">&times;</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await fetch(`/api/document-files/${f.id}`, { method: 'DELETE' });
      loadDocFiles();
    });
    docFilesList.appendChild(row);
  });
}

document.getElementById('doc-upload-btn').addEventListener('click', async () => {
  if (!currentDocument) return;
  const fileInput = document.getElementById('doc-file-input');
  if (!fileInput.files.length) return;
  const form = new FormData();
  form.append('file', fileInput.files[0]);
  await fetch(`/api/documents/${currentDocument.id}/files`, { method: 'POST', body: form });
  fileInput.value = '';
  loadDocFiles();
});

// --- Doc entity linking (combo helper for document overlay) ---
function setupDocCombo({ inputId, matchesId, listEl, allItemsFn, loadFn, linkUrl, idKey, createUrl }) {
  const input = document.getElementById(inputId);
  const matchesEl = document.getElementById(matchesId);
  let busy = false;

  function render() {
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
        if (busy || !currentDocument) return;
        busy = true;
        await fetch(linkUrl(currentDocument.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [idKey]: item.id })
        });
        input.value = '';
        matchesEl.classList.remove('open');
        busy = false;
        loadFn();
      });
      matchesEl.appendChild(div);
    });
    const exact = hits.some(item => item.name.toLowerCase() === q);
    if (!exact && createUrl) {
      const div = document.createElement('div');
      div.className = 'combo-create';
      div.textContent = `+ Create "${input.value.trim()}"`;
      div.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        if (busy || !currentDocument) return;
        busy = true;
        const res = await fetch(createUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.value.trim() })
        });
        const created = await res.json();
        await fetch(linkUrl(currentDocument.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [idKey]: created.id })
        });
        input.value = '';
        matchesEl.classList.remove('open');
        busy = false;
        await loadAllSidebar();
        loadFn();
      });
      matchesEl.appendChild(div);
    }
    matchesEl.classList.add('open');
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => matchesEl.classList.remove('open'));
}

async function loadDocPeople() {
  docPeopleList.innerHTML = '';
  if (!currentDocument) return;
  const items = await (await fetch(`/api/documents/${currentDocument.id}/people`)).json();
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'doc-link-row';
    row.innerHTML = `<span>${item.name}</span><button>&times;</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await fetch(`/api/document-people/${item.id}`, { method: 'DELETE' });
      loadDocPeople();
    });
    docPeopleList.appendChild(row);
  });
}

async function loadDocPlaces() {
  docPlacesList.innerHTML = '';
  if (!currentDocument) return;
  const items = await (await fetch(`/api/documents/${currentDocument.id}/places`)).json();
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'doc-link-row';
    row.innerHTML = `<span>${item.name}</span><button>&times;</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await fetch(`/api/document-places/${item.id}`, { method: 'DELETE' });
      loadDocPlaces();
    });
    docPlacesList.appendChild(row);
  });
}

async function loadDocThings() {
  docThingsList.innerHTML = '';
  if (!currentDocument) return;
  const items = await (await fetch(`/api/documents/${currentDocument.id}/things`)).json();
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'doc-link-row';
    row.innerHTML = `<span>${item.name}</span><button>&times;</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await fetch(`/api/document-things/${item.id}`, { method: 'DELETE' });
      loadDocThings();
    });
    docThingsList.appendChild(row);
  });
}

async function loadDocPhotos() {
  docPhotosList.innerHTML = '';
  if (!currentDocument) return;
  const items = await (await fetch(`/api/documents/${currentDocument.id}/photos`)).json();
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'doc-link-row';
    row.innerHTML = `<span>${item.filename}</span><button>&times;</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      await fetch(`/api/document-photos/${item.id}`, { method: 'DELETE' });
      loadDocPhotos();
    });
    docPhotosList.appendChild(row);
  });
}

setupDocCombo({
  inputId: 'doc-people-input', matchesId: 'doc-people-matches',
  listEl: docPeopleList, allItemsFn: () => allPeople, loadFn: loadDocPeople,
  linkUrl: id => `/api/documents/${id}/people`, idKey: 'person_id', createUrl: '/api/people'
});
setupDocCombo({
  inputId: 'doc-places-input', matchesId: 'doc-places-matches',
  listEl: docPlacesList, allItemsFn: () => allPlaces, loadFn: loadDocPlaces,
  linkUrl: id => `/api/documents/${id}/places`, idKey: 'place_id', createUrl: '/api/places'
});
setupDocCombo({
  inputId: 'doc-things-input', matchesId: 'doc-things-matches',
  listEl: docThingsList, allItemsFn: () => allThings, loadFn: loadDocThings,
  linkUrl: id => `/api/documents/${id}/things`, idKey: 'thing_id', createUrl: '/api/things'
});
