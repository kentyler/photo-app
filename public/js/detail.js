// Detail view
async function openDetail(photo) {
  // Reset face draw state when switching photos (preserve facesMode toggle)
  faceDrawMode = false;
  currentPhotoPeople = [];
  currentPhoto = photo;
  detailImg.src = photoImgSrc(photo);
  detailFilename.textContent = photo.filename;
  const detailFilesize = document.getElementById('detail-filesize');
  detailFilesize.textContent = '';
  const fsq = photo.id ? `id=${photo.id}` : `path=${encodeURIComponent(photo.disk_path)}`;
  fetch(`/api/file-size?${fsq}`).then(r => r.json()).then(d => {
    if (currentPhoto === photo && d.size) detailFilesize.textContent = formatFileSize(d.size);
  }).catch(() => {});
  overlay.classList.add('active');

  if (photo.id) {
    // Load caption
    const capRes = await fetch(`/api/photo/${photo.id}/caption`);
    const capData = await capRes.json();
    captionInput.value = capData.caption || '';
    // Load tags
    await loadPhotoTags();
    // Load text entries
    await loadPhotoTexts();
    // Load sidebar
    await loadAllSidebar();
    loadPhotoPeople(); loadPhotoPlaces(); loadPhotoThings(); loadPhotoDocs();
  } else {
    captionInput.value = photo.caption || '';
    detailTags.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem;">Not in database (no hash match yet)</span>';
    photoTexts = []; txtIndex = 0; showCurrentText();
    peopleList.innerHTML = ''; placesList.innerHTML = ''; thingsList.innerHTML = '';
    document.getElementById('photo-docs-list').innerHTML = '';
  }

  // Set active rating button
  document.querySelectorAll('.rating-section button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rating === (photo.rating || ''));
  });
}

async function loadPhotoTags() {
  if (!currentPhoto || !currentPhoto.id) { detailTags.innerHTML = ''; return; }
  const res = await fetch(`/api/photo/${currentPhoto.id}/tags`);
  const tags = await res.json();
  detailTags.innerHTML = '';
  tags.forEach(t => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${t.name} <span class="remove-tag" data-tag-id="${t.id}">&times;</span>`;
    pill.querySelector('.remove-tag').addEventListener('click', async () => {
      await fetch(`/api/photo/${currentPhoto.id}/tags/${t.id}`, { method: 'DELETE' });
      loadPhotoTags();
    });
    detailTags.appendChild(pill);
  });
}

// Close detail
async function closeDetail() {
  await saveCurrentText();
  overlay.classList.remove('active');
  // Don't reload disk photos on close (avoid re-hashing), just re-render
  renderGrid();
}
document.getElementById('close-detail').addEventListener('click', closeDetail);
document.getElementById('close-detail-bottom').addEventListener('click', closeDetail);

// Prev/next in detail view
async function detailNav(dir) {
  await saveCurrentText();
  const list = getCurrentFilteredList();
  const idx = list.findIndex(p => p === currentPhoto || (p.id && p.id === currentPhoto.id));
  if (idx < 0) return;
  const next = idx + dir;
  if (next < 0 || next >= list.length) return;
  openDetail(list[next]);
}
document.getElementById('detail-prev').addEventListener('click', () => detailNav(-1));
document.getElementById('detail-next').addEventListener('click', () => detailNav(1));
document.getElementById('detail-prev-bottom').addEventListener('click', () => detailNav(-1));
document.getElementById('detail-next-bottom').addEventListener('click', () => detailNav(1));
overlay.addEventListener('click', async (e) => {
  if (e.target === overlay) {
    await saveCurrentText();
    overlay.classList.remove('active');
    renderGrid();
  }
});

// Save caption
document.getElementById('save-caption').addEventListener('click', async () => {
  if (!currentPhoto || !currentPhoto.id) return;
  await fetch(`/api/photo/${currentPhoto.id}/caption`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption: captionInput.value })
  });
});

// Rating buttons
document.querySelectorAll('.rating-section button').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!currentPhoto || !currentPhoto.id) return;
    const rating = btn.dataset.rating || null;
    await fetch(`/api/photo/${currentPhoto.id}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating })
    });
    currentPhoto.rating = rating;
    document.querySelectorAll('.rating-section button').forEach(b => {
      b.classList.toggle('active', b.dataset.rating === (rating || ''));
    });
  });
});

// Add tag
document.getElementById('add-tag-btn').addEventListener('click', async () => {
  const name = tagInput.value.trim();
  if (!name || !currentPhoto || !currentPhoto.id) return;
  // Create or find tag
  const res = await fetch('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const tag = await res.json();
  // Assign to photo
  await fetch(`/api/photo/${currentPhoto.id}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_id: tag.id })
  });
  tagInput.value = '';
  loadPhotoTags();
  loadAllTags();
});

// --- Text entries ---
const txtBody = document.getElementById('txt-body');
const txtCounter = document.getElementById('txt-counter');
let photoTexts = [];
let txtIndex = 0;

async function loadPhotoTexts() {
  if (!currentPhoto) { photoTexts = []; txtIndex = 0; showCurrentText(); return; }
  const res = await fetch(`/api/photo/${currentPhoto.id}/texts`);
  photoTexts = await res.json();
  txtIndex = photoTexts.length > 0 ? 0 : 0;
  showCurrentText();
}

function showCurrentText() {
  if (photoTexts.length === 0) {
    txtCounter.textContent = '0 / 0';
    txtBody.value = '';
    return;
  }
  if (txtIndex < 0) txtIndex = 0;
  if (txtIndex >= photoTexts.length) txtIndex = photoTexts.length - 1;
  txtCounter.textContent = `${txtIndex + 1} / ${photoTexts.length}`;
  txtBody.value = photoTexts[txtIndex].body || '';
}

async function saveCurrentText() {
  if (!currentPhoto) return;
  const text = txtBody.value;
  // Auto-create entry if user typed something but no entry exists yet
  if (photoTexts.length === 0) {
    if (!text) return; // nothing to save
    const res = await fetch(`/api/photo/${currentPhoto.id}/texts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text })
    });
    const entry = await res.json();
    photoTexts.push(entry);
    txtIndex = 0;
    showCurrentText();
    return;
  }
  const entry = photoTexts[txtIndex];
  if (text === (entry.body || '')) return; // no change
  await fetch(`/api/text/${entry.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: text })
  });
  entry.body = text;
}

document.getElementById('txt-first').addEventListener('click', async () => { await saveCurrentText(); txtIndex = 0; showCurrentText(); });
document.getElementById('txt-back5').addEventListener('click', async () => { await saveCurrentText(); txtIndex = Math.max(0, txtIndex - 5); showCurrentText(); });
document.getElementById('txt-prev').addEventListener('click', async () => { await saveCurrentText(); txtIndex = Math.max(0, txtIndex - 1); showCurrentText(); });
document.getElementById('txt-next').addEventListener('click', async () => { await saveCurrentText(); txtIndex = Math.min(photoTexts.length - 1, txtIndex + 1); showCurrentText(); });
document.getElementById('txt-fwd5').addEventListener('click', async () => { await saveCurrentText(); txtIndex = Math.min(photoTexts.length - 1, txtIndex + 5); showCurrentText(); });
document.getElementById('txt-last').addEventListener('click', async () => { await saveCurrentText(); txtIndex = photoTexts.length - 1; showCurrentText(); });

document.getElementById('txt-new').addEventListener('click', async () => {
  if (!currentPhoto) return;
  await saveCurrentText();
  const res = await fetch(`/api/photo/${currentPhoto.id}/texts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: '' })
  });
  const entry = await res.json();
  photoTexts.push(entry);
  txtIndex = photoTexts.length - 1;
  showCurrentText();
  txtBody.focus();
});

document.getElementById('txt-save').addEventListener('click', saveCurrentText);

document.getElementById('txt-delete').addEventListener('click', async () => {
  if (photoTexts.length === 0 || !currentPhoto) return;
  const entry = photoTexts[txtIndex];
  await fetch(`/api/text/${entry.id}`, { method: 'DELETE' });
  photoTexts.splice(txtIndex, 1);
  if (txtIndex > 0 && txtIndex >= photoTexts.length) txtIndex = photoTexts.length - 1;
  showCurrentText();
});

// --- Voice transcription (Web Speech API) ---
const micBtn = document.getElementById('txt-mic');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  let insertPos = 0;

  micBtn.addEventListener('click', () => {
    if (micBtn.classList.contains('recording')) {
      recognition.stop();
      return;
    }
    insertPos = txtBody.selectionStart ?? txtBody.value.length;
    micBtn.classList.add('recording');
    micBtn.title = 'Recording... click to stop';
    recognition.start();
  });

  recognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        const chunk = e.results[i][0].transcript;
        const val = txtBody.value;
        txtBody.value = val.slice(0, insertPos) + chunk + val.slice(insertPos);
        insertPos += chunk.length;
      }
    }
  };

  recognition.onend = () => {
    micBtn.classList.remove('recording');
    micBtn.title = 'Voice transcription';
  };

  recognition.onerror = (e) => {
    console.warn('Speech recognition error:', e.error);
    micBtn.classList.remove('recording');
    micBtn.title = 'Voice transcription';
  };
} else {
  micBtn.style.display = 'none';
}

// --- Zoom ---
// --- Zoom ---
const viewport = document.getElementById('detail-img-viewport');
const zoomLevelEl = document.getElementById('zoom-level');
let zoomScale = 0; // 0 = fit mode
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function getFitScale() {
  const img = detailImg;
  if (!img.naturalWidth) return 1;
  const maxW = viewport.clientWidth || 868;
  const maxH = 512;
  return Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
}

function applyZoom(centerOnMouse) {
  const wrap = document.getElementById('detail-img-wrap');
  const img = detailImg;
  if (!img.naturalWidth) return;
  const effectiveScale = zoomScale || getFitScale();
  const w = img.naturalWidth * effectiveScale;
  const h = img.naturalHeight * effectiveScale;
  img.style.width = w + 'px';
  img.style.height = h + 'px';
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';
  zoomLevelEl.textContent = zoomScale ? Math.round(effectiveScale * 100) + '%' : 'Fit';
  resizeFaceCanvas();
  drawFaceRects();
}

function zoomIn() {
  const cur = zoomScale || getFitScale();
  const next = ZOOM_STEPS.find(s => s > cur + 0.01);
  if (next) { zoomScale = next; applyZoom(); }
}

function zoomOut() {
  const cur = zoomScale || getFitScale();
  const prev = [...ZOOM_STEPS].reverse().find(s => s < cur - 0.01);
  if (prev) { zoomScale = prev; applyZoom(); }
}

function zoomReset() {
  zoomScale = 0;
  applyZoom();
  viewport.scrollTop = 0;
  viewport.scrollLeft = 0;
}

document.getElementById('zoom-in').addEventListener('click', zoomIn);
document.getElementById('zoom-out').addEventListener('click', zoomOut);
document.getElementById('zoom-reset').addEventListener('click', zoomReset);

// Mouse wheel zoom (Ctrl+wheel or just wheel on viewport)
viewport.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  // Zoom toward cursor position
  const rect = viewport.getBoundingClientRect();
  const mx = e.clientX - rect.left + viewport.scrollLeft;
  const my = e.clientY - rect.top + viewport.scrollTop;
  const oldScale = zoomScale || getFitScale();

  if (e.deltaY < 0) zoomIn(); else zoomOut();

  const newScale = zoomScale || getFitScale();
  if (newScale !== oldScale) {
    const ratio = newScale / oldScale;
    viewport.scrollLeft = mx * ratio - (e.clientX - rect.left);
    viewport.scrollTop = my * ratio - (e.clientY - rect.top);
  }
}, { passive: false });

// Pan with middle-click drag or grab cursor
let isPanning = false, panStartX = 0, panStartY = 0, panScrollX = 0, panScrollY = 0;
viewport.addEventListener('mousedown', (e) => {
  // Don't pan if clicking on canvas in faces mode (drawing) or on picker
  if (e.target.closest('#face-picker')) return;
  if (e.button === 1 || (e.button === 0 && !facesMode && zoomScale)) {
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panScrollX = viewport.scrollLeft; panScrollY = viewport.scrollTop;
    e.preventDefault();
  }
});
document.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  viewport.scrollLeft = panScrollX - (e.clientX - panStartX);
  viewport.scrollTop = panScrollY - (e.clientY - panStartY);
});
document.addEventListener('mouseup', () => { isPanning = false; });

// Reset zoom when switching photos
detailImg.addEventListener('load', () => {
  zoomScale = 0;
  setTimeout(() => {
    applyZoom();
  }, 50);
});
