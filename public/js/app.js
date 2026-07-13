const grid = document.getElementById('photo-grid');
const folderBtn = document.getElementById('folder-btn');
const folderList = document.getElementById('folder-list');
const flBreadcrumb = document.getElementById('fl-breadcrumb');
const flItems = document.getElementById('fl-items');
let selectedFolder = ''; // disk path of chosen folder
let flBrowsePath = null; // null = show roots view, string = browsing inside a root
const groupSelect = document.getElementById('group-select');
const filterRating = document.getElementById('filter-rating');
const filterTag = document.getElementById('filter-tag');
const photoCount = document.getElementById('photo-count');
const overlay = document.getElementById('detail-overlay');
const detailImg = document.getElementById('detail-img');
const detailFilename = document.getElementById('detail-filename');
const captionInput = document.getElementById('caption-input');
const detailTags = document.getElementById('detail-tags');
const tagInput = document.getElementById('tag-input');
const tagSuggestions = document.getElementById('tag-suggestions');

let photos = [];
let allTags = [];
let currentPhoto = null;
let activeSource = null; // 'folder', 'group', or 'disk'
const accountFilter = document.getElementById('account-filter');
let currentAccountFilter = 'all';

// --- Shared utility functions ---
function photoImgSrc(p) {
  if (p._src === 'disk') return `/api/disk-photo?path=${encodeURIComponent(p.disk_path)}`;
  return `/api/photo/${p.id}`;
}

function getCurrentFilteredList() {
  // Re-derive from current photos + filters (sync path only)
  const ratingFilter = filterRating.value;
  let filtered = photos;
  if (ratingFilter === 'unrated') filtered = filtered.filter(p => !p.rating);
  else if (ratingFilter) filtered = filtered.filter(p => p.rating === ratingFilter);
  return filtered;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function isSamePhoto(a, b) {
  if (a.id && b.id) return a.id === b.id;
  return a.disk_path && b.disk_path && a.disk_path === b.disk_path;
}

function cacheBustPhoto(photo) {
  const t = '_t=' + Date.now();
  const expected = photoImgSrc(photo);
  const expectedBase = expected.split('?')[0];
  document.querySelectorAll('.photo-card img, #detail-img, #lb-img').forEach(img => {
    const curBase = img.getAttribute('src').replace(/[?&]_t=\d+/, '').split('?')[0];
    if (curBase === expectedBase) {
      img.src = expected + (expected.includes('?') ? '&' : '?') + t;
    }
  });
}

// --- Multi-select ---
// --- Multi-select ---
const selectedIds = new Set();
const selectionToolbar = document.getElementById('selection-toolbar');
const selCount = document.getElementById('sel-count');
const selectAllCb = document.getElementById('select-all-cb');

function updateSelectionUI() {
  const n = selectedIds.size;
  selCount.textContent = `${n} selected`;
  selectionToolbar.classList.toggle('active', n > 0);
  if (n === 0) selectionToolbar.style.display = 'none';
  else selectionToolbar.style.display = 'flex';
  // sync select-all checkbox
  const cards = grid.querySelectorAll('.photo-card');
  selectAllCb.checked = cards.length > 0 && selectedIds.size === cards.length;
}

function toggleSelect(id, card, cb) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    card.classList.remove('selected');
    cb.checked = false;
  } else {
    selectedIds.add(id);
    card.classList.add('selected');
    cb.checked = true;
  }
  updateSelectionUI();
}

selectAllCb.addEventListener('change', () => {
  const cards = grid.querySelectorAll('.photo-card');
  cards.forEach(card => {
    const id = Number(card.dataset.photoId);
    const cb = card.querySelector('.select-cb');
    if (selectAllCb.checked) {
      selectedIds.add(id);
      card.classList.add('selected');
      if (cb) cb.checked = true;
    } else {
      selectedIds.delete(id);
      card.classList.remove('selected');
      if (cb) cb.checked = false;
    }
  });
  updateSelectionUI();
});

document.getElementById('btn-deselect-all').addEventListener('click', () => {
  selectedIds.clear();
  grid.querySelectorAll('.photo-card').forEach(c => {
    c.classList.remove('selected');
    const cb = c.querySelector('.select-cb');
    if (cb) cb.checked = false;
  });
  selectAllCb.checked = false;
  updateSelectionUI();
});
