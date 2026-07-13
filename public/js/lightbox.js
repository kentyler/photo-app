// --- Lightbox ---
const lightbox = document.getElementById('lightbox');
const lbImg = document.getElementById('lb-img');
const lbCounter = document.getElementById('lb-counter');
const lbFilesize = document.getElementById('lb-filesize');
let lbIndex = 0;
let lbList = []; // filtered photo list at time of open

function openLightbox(index) {
  // Use the currently rendered filtered list
  lbList = getCurrentFilteredList();
  lbIndex = index;
  showLbPhoto();
  lightbox.classList.add('active');
  overlay.classList.remove('active'); // close detail modal
}


function showLbPhoto() {
  if (lbList.length === 0) return;
  const p = lbList[lbIndex];
  lbImg.src = photoImgSrc(p);
  lbCounter.textContent = `${lbIndex + 1} / ${lbList.length}`;
  lbFilesize.textContent = '';
  const q = p.id ? `id=${p.id}` : `path=${encodeURIComponent(p.disk_path)}`;
  fetch(`/api/file-size?${q}`).then(r => r.json()).then(d => {
    if (lbList[lbIndex] === p && d.size) lbFilesize.textContent = formatFileSize(d.size);
  }).catch(() => {});
}

function lbNav(dir) {
  if (lbList.length === 0) return;
  lbIndex = (lbIndex + dir + lbList.length) % lbList.length;
  showLbPhoto();
}

function closeLightbox() {
  lightbox.classList.remove('active');
  if (currentPhoto) overlay.classList.add('active');
}

document.getElementById('lb-close').addEventListener('click', closeLightbox);
document.getElementById('lb-prev').addEventListener('click', () => lbNav(-1));
document.getElementById('lb-next').addEventListener('click', () => lbNav(1));

// Click detail image to open lightbox (canvas is on top, so this is fallback)
detailImg.style.cursor = 'pointer';
detailImg.addEventListener('click', () => {
  if (faceDrawMode) return;
  if (!currentPhoto) return;
  const list = getCurrentFilteredList();
  const idx = list.findIndex(p => p.id === currentPhoto.id);
  openLightbox(idx >= 0 ? idx : 0);
});

// --- Keyboard nav ---
// Keyboard nav
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && faceDrawMode) {
    exitDrawMode();
    return;
  }
  if (e.key === 'Escape' && facePicker.classList.contains('open')) {
    closeFacePicker();
    return;
  }
  if (!lightbox.classList.contains('active')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lbNav(-1);
  else if (e.key === 'ArrowRight') lbNav(1);
});

// Click lightbox image or background to close back to detail
lbImg.style.cursor = 'pointer';
lbImg.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
