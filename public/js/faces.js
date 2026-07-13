// --- Face Region Drawing & Click-to-Highlight ---
const faceCanvas = document.getElementById('face-canvas');
const faceCtx = faceCanvas.getContext('2d');
const tagFaceBtn = document.getElementById('tag-face-btn');
const facePicker = document.getElementById('face-picker');
const facePickerInput = document.getElementById('face-picker-input');
const fpMatches = document.getElementById('fp-matches');
const fpIdentifyBtn = document.getElementById('fp-identify-btn');
const fpIdentifyResults = document.getElementById('fp-identify-results');
const fpIdMatches = document.getElementById('fp-id-matches');
const fpBackLink = document.getElementById('fp-back-link');
const detailImgWrap = document.getElementById('detail-img-wrap');

let faceDrawForPpId = null; // if drawing for a specific existing person-row (locate mode)
let faceDrawRect = null; // {x,y,w,h} in canvas pixels during draw
let faceDrawing = false;
let faceStartX = 0, faceStartY = 0;

function resizeFaceCanvas() {
  // Match canvas to the rendered image size
  const img = detailImg;
  faceCanvas.width = img.clientWidth;
  faceCanvas.height = img.clientHeight;
  // Position canvas exactly over the image
  faceCanvas.style.width = img.clientWidth + 'px';
  faceCanvas.style.height = img.clientHeight + 'px';
  faceCanvas.style.top = img.offsetTop + 'px';
  faceCanvas.style.left = img.offsetLeft + 'px';
}

function drawFaceRects() {
  const cw = faceCanvas.width, ch = faceCanvas.height;
  faceCtx.clearRect(0, 0, cw, ch);
  if (!currentPhotoPeople || cw === 0 || ch === 0) return;

  // We need to map fractional coords to canvas coords.
  // The image might be letterboxed via object-fit:contain.
  // Since the canvas matches img.clientWidth/Height and the wrapper
  // uses inline-block + display:flex justify center, the canvas
  // and the image rendered area are the same.
  // But object-fit:contain may leave bars. We need the actual
  // drawn area within the img element.
  const nat = { w: detailImg.naturalWidth, h: detailImg.naturalHeight };
  if (!nat.w || !nat.h) return;
  const scale = Math.min(cw / nat.w, ch / nat.h);
  const drawW = nat.w * scale, drawH = nat.h * scale;
  const offX = (cw - drawW) / 2, offY = (ch - drawH) / 2;

  currentPhotoPeople.forEach((pp, i) => {
    if (pp.x == null || pp.y == null || pp.w == null || pp.h == null) return;
    const color = FACE_COLORS[i % FACE_COLORS.length];
    const rx = offX + pp.x * drawW;
    const ry = offY + pp.y * drawH;
    const rw = pp.w * drawW;
    const rh = pp.h * drawH;

    faceCtx.strokeStyle = color;
    faceCtx.lineWidth = 2;
    faceCtx.strokeRect(rx, ry, rw, rh);
    faceCtx.fillStyle = hexToRgba(color, 0.15);
    faceCtx.fillRect(rx, ry, rw, rh);

    // Label
    const label = pp.name || '';
    if (label) {
      faceCtx.font = '12px -apple-system, sans-serif';
      const tw = faceCtx.measureText(label).width;
      faceCtx.fillStyle = 'rgba(0,0,0,0.7)';
      faceCtx.fillRect(rx, ry - 18, tw + 8, 18);
      faceCtx.fillStyle = color;
      faceCtx.fillText(label, rx + 4, ry - 5);
    }
  });

  // Draw in-progress rectangle
  if (faceDrawRect) {
    faceCtx.strokeStyle = '#fff';
    faceCtx.lineWidth = 2;
    faceCtx.setLineDash([5, 3]);
    faceCtx.strokeRect(faceDrawRect.x, faceDrawRect.y, faceDrawRect.w, faceDrawRect.h);
    faceCtx.setLineDash([]);
  }
}

function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Convert canvas pixel coords to fractional image coords (0-1)
function canvasToFrac(cx, cy) {
  const cw = faceCanvas.width, ch = faceCanvas.height;
  const nat = { w: detailImg.naturalWidth, h: detailImg.naturalHeight };
  const scale = Math.min(cw / nat.w, ch / nat.h);
  const drawW = nat.w * scale, drawH = nat.h * scale;
  const offX = (cw - drawW) / 2, offY = (ch - drawH) / 2;
  return { x: (cx - offX) / drawW, y: (cy - offY) / drawH };
}

// --- Faces toggle button ---
tagFaceBtn.addEventListener('click', () => {
  if (faceDrawMode) {
    // If actively drawing, just cancel the draw
    exitDrawMode();
    return;
  }
  toggleFacesMode();
});

function toggleFacesMode(forceOn) {
  facesMode = forceOn != null ? forceOn : !facesMode;
  tagFaceBtn.classList.toggle('active', facesMode);
  faceCanvas.classList.toggle('faces-on', facesMode);
  if (facesMode) {
    resizeFaceCanvas();
    drawFaceRects();
  } else {
    exitDrawMode();
  }
  loadPhotoPeople(); // re-render sidebar with/without dots & locate
}

function enterDrawMode(ppId) {
  if (!currentPhoto || !currentPhoto.id) return;
  if (!facesMode) toggleFacesMode(true);
  faceDrawMode = true;
  faceDrawForPpId = ppId || null;
  faceCanvas.classList.add('draw-mode');
  faceDrawRect = null;
  closeFacePicker();
}

function exitDrawMode() {
  faceDrawMode = false;
  faceDrawForPpId = null;
  faceDrawRect = null;
  faceDrawing = false;
  faceCanvas.classList.remove('draw-mode');
  closeFacePicker();
  drawFaceRects();
}

// Canvas mouse events -- in faces mode, drag to draw
faceCanvas.addEventListener('mousedown', (e) => {
  if (!facesMode) return;
  closeFacePicker();
  const rect = faceCanvas.getBoundingClientRect();
  faceStartX = e.clientX - rect.left;
  faceStartY = e.clientY - rect.top;
  faceDrawing = true;
  faceDrawRect = { x: faceStartX, y: faceStartY, w: 0, h: 0 };
});

faceCanvas.addEventListener('mousemove', (e) => {
  if (!faceDrawing) return;
  const rect = faceCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  faceDrawRect = {
    x: Math.min(faceStartX, mx),
    y: Math.min(faceStartY, my),
    w: Math.abs(mx - faceStartX),
    h: Math.abs(my - faceStartY)
  };
  drawFaceRects();
});

faceCanvas.addEventListener('mouseup', (e) => {
  if (!faceDrawing) return;
  faceDrawing = false;
  if (!faceDrawRect || faceDrawRect.w < 5 || faceDrawRect.h < 5) {
    // Too small -- treat as a click (check for existing rect)
    faceDrawRect = null;
    handleFaceClick(e);
    drawFaceRects();
    return;
  }
  // Convert to fractional coords
  const tl = canvasToFrac(faceDrawRect.x, faceDrawRect.y);
  const br = canvasToFrac(faceDrawRect.x + faceDrawRect.w, faceDrawRect.y + faceDrawRect.h);
  const fracRect = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };

  if (faceDrawForPpId) {
    // Locate mode: update existing photo_people record
    saveFaceCoords(faceDrawForPpId, fracRect);
  } else {
    // Show person picker near the drawn rect
    showFacePicker(faceDrawRect, fracRect);
  }
});

// Click on canvas in faces mode: check face rects (click-to-highlight)
// Note: drag-to-draw is handled by mousedown/up, click only fires for non-drag
faceCanvas.addEventListener('click', (e) => {
  if (!facesMode || !currentPhoto) return;
  // mouseup already handled large drags; clicks land here
  // checkFaceClickAndHighlight is called from handleFaceClick in mouseup for small drags
});

function checkFaceClickAndHighlight(e) {
  const rect = faceCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const cw = faceCanvas.width, ch = faceCanvas.height;
  const nat = { w: detailImg.naturalWidth, h: detailImg.naturalHeight };
  if (!nat.w || !nat.h) return false;
  const scale = Math.min(cw / nat.w, ch / nat.h);
  const drawW = nat.w * scale, drawH = nat.h * scale;
  const offX = (cw - drawW) / 2, offY = (ch - drawH) / 2;
  for (const pp of currentPhotoPeople) {
    if (pp.x == null) continue;
    const rx = offX + pp.x * drawW, ry = offY + pp.y * drawH;
    const rw = pp.w * drawW, rh = pp.h * drawH;
    if (cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh) {
      highlightPersonRow(pp.id);
      return true;
    }
  }
  return false;
}

function handleFaceClick(e) {
  checkFaceClickAndHighlight(e);
}

function highlightPersonRow(ppId) {
  const rows = peopleList.querySelectorAll('.person-row');
  rows.forEach(row => {
    if (row.dataset.ppId == ppId) {
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      row.classList.remove('flash');
      void row.offsetWidth; // force reflow
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 1500);
    }
  });
}

// --- Face person picker ---
function showFacePicker(canvasRect, fracRect) {
  facePicker.classList.add('open');
  currentFracRect = fracRect;
  // Position near the drawn rectangle
  facePicker.style.left = Math.min(canvasRect.x + canvasRect.w + 5, faceCanvas.width - 210) + 'px';
  facePicker.style.top = canvasRect.y + 'px';
  facePickerInput.value = '';
  facePickerInput.focus();
  // Reset identify state
  fpIdentifyResults.classList.remove('open');
  fpIdMatches.innerHTML = '';
  facePickerInput.style.display = '';
  fpMatches.style.display = '';
  renderFacePickerMatches(fracRect);

  facePickerInput.oninput = () => renderFacePickerMatches(fracRect);
}

let facePickerBusy = false;

function renderFacePickerMatches(fracRect) {
  const q = facePickerInput.value.trim().toLowerCase();
  fpMatches.innerHTML = '';
  if (!q) return;
  const hits = allPeople.filter(p => p.name.toLowerCase().includes(q)).slice(0, 10);
  hits.forEach(person => {
    const div = document.createElement('div');
    div.className = 'fp-match';
    div.textContent = person.name;
    div.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      if (facePickerBusy) return;
      facePickerBusy = true;
      await assignFacePerson(person.id, fracRect);
    });
    fpMatches.appendChild(div);
  });
  // Create option
  if (q && !hits.some(p => p.name.toLowerCase() === q)) {
    const div = document.createElement('div');
    div.className = 'fp-create';
    div.textContent = `+ Create "${facePickerInput.value.trim()}"`;
    div.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      if (facePickerBusy) return;
      facePickerBusy = true;
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: facePickerInput.value.trim() })
      });
      const created = await res.json();
      await loadAllPeople();
      await assignFacePerson(created.id, fracRect);
    });
    fpMatches.appendChild(div);
  }
}

async function assignFacePerson(personId, fracRect) {
  if (!currentPhoto || !currentPhoto.id) return;
  await fetch(`/api/photo/${currentPhoto.id}/people`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person_id: personId, x: fracRect.x, y: fracRect.y, w: fracRect.w, h: fracRect.h })
  });
  closeFacePicker();
  exitDrawMode();
  facePickerBusy = false;
  await loadPhotoPeople();
}

async function saveFaceCoords(ppId, fracRect) {
  await fetch(`/api/photo-people/${ppId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: fracRect.x, y: fracRect.y, w: fracRect.w, h: fracRect.h })
  });
  exitDrawMode();
  await loadPhotoPeople();
}

function closeFacePicker() {
  facePicker.classList.remove('open');
  facePickerInput.value = '';
  fpMatches.innerHTML = '';
  fpIdentifyResults.classList.remove('open');
  fpIdMatches.innerHTML = '';
  facePickerInput.style.display = '';
  fpMatches.style.display = '';
  faceDrawRect = null;
  facePickerBusy = false;
}

// --- Face identification ---
let currentFracRect = null;

fpIdentifyBtn.addEventListener('click', async () => {
  if (!currentPhoto || !currentFracRect) return;
  fpIdentifyBtn.disabled = true;
  fpIdentifyBtn.textContent = 'Scanning...';
  try {
    const res = await fetch(`/api/photo/${currentPhoto.id}/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentFracRect)
    });
    const data = await res.json();
    showIdentifyResults(data);
  } catch (err) {
    console.error('identify error:', err);
  } finally {
    fpIdentifyBtn.disabled = false;
    fpIdentifyBtn.textContent = 'Identify';
  }
});

function showIdentifyResults(data) {
  fpIdMatches.innerHTML = '';
  if (!data.descriptor_found) {
    fpIdMatches.innerHTML = '<div style="font-size:0.8rem;color:var(--text-dim);padding:0.3rem;">No face detected in selection</div>';
  } else if (data.matches.length === 0) {
    fpIdMatches.innerHTML = '<div style="font-size:0.8rem;color:var(--text-dim);padding:0.3rem;">No reference faces to compare</div>';
  } else {
    const filtered = data.matches.filter(m => m.distance < 0.8);
    if (filtered.length === 0) {
      fpIdMatches.innerHTML = '<div style="font-size:0.8rem;color:var(--text-dim);padding:0.3rem;">No close matches found</div>';
    } else {
      filtered.forEach(m => {
        const div = document.createElement('div');
        div.className = 'fp-id-match';
        const color = m.distance < 0.5 ? '#27ae60' : m.distance < 0.6 ? '#f39c12' : '#888';
        const pct = Math.max(0, Math.round((1 - m.distance) * 100));
        div.innerHTML = `
          <span style="flex:1">${m.name}</span>
          <div class="fp-conf-bar"><div class="fp-conf-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="fp-dist">${m.distance.toFixed(2)}</span>
        `;
        div.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          if (facePickerBusy) return;
          facePickerBusy = true;
          await assignFacePerson(m.person_id, currentFracRect);
        });
        fpIdMatches.appendChild(div);
      });
    }
  }
  // Show results, hide search
  fpIdentifyResults.classList.add('open');
  facePickerInput.style.display = 'none';
  fpMatches.style.display = 'none';
}

fpBackLink.addEventListener('click', () => {
  fpIdentifyResults.classList.remove('open');
  fpIdMatches.innerHTML = '';
  facePickerInput.style.display = '';
  fpMatches.style.display = '';
  facePickerInput.focus();
});
