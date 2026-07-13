// --- Folder tree dropdown ---
folderBtn.addEventListener('click', () => {
  if (folderList.classList.contains('open')) {
    folderList.classList.remove('open');
  } else {
    folderList.classList.add('open');
    renderFolderTree();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#folder-dropdown')) folderList.classList.remove('open');
});

function findRootForPath(p) {
  return flRoots.find(r => p === r.path || p.startsWith(r.path.replace(/\/?$/, '/')));
}

function renderFlBreadcrumb() {
  flBreadcrumb.innerHTML = '';
  if (flBrowsePath === null) {
    const crumb = document.createElement('span');
    crumb.className = 'fl-crumb';
    crumb.textContent = 'Roots';
    flBreadcrumb.appendChild(crumb);
    return;
  }
  // "Roots" link
  const home = document.createElement('span');
  home.className = 'fl-crumb';
  home.textContent = 'Roots';
  home.addEventListener('click', (e) => {
    e.stopPropagation();
    flBrowsePath = null;
    renderFolderTree();
  });
  flBreadcrumb.appendChild(home);

  const root = findRootForPath(flBrowsePath);
  const rootPath = root ? root.path : flBrowsePath;
  const rootLabel = root ? root.label : rootPath;
  const relative = flBrowsePath.slice(rootPath.replace(/\/?$/, '/').length);
  const segments = relative ? relative.split('/').filter(Boolean) : [];

  // Root crumb
  const sep0 = document.createElement('span');
  sep0.className = 'fl-sep'; sep0.textContent = '/';
  flBreadcrumb.appendChild(sep0);
  const rc = document.createElement('span');
  rc.className = 'fl-crumb';
  rc.textContent = rootLabel;
  rc.addEventListener('click', (e) => {
    e.stopPropagation();
    flBrowsePath = rootPath;
    renderFolderTree();
  });
  flBreadcrumb.appendChild(rc);

  // Subfolder crumbs
  let acc = rootPath.replace(/\/?$/, '');
  segments.forEach(seg => {
    acc += '/' + seg;
    const sep = document.createElement('span');
    sep.className = 'fl-sep'; sep.textContent = '/';
    flBreadcrumb.appendChild(sep);
    const crumb = document.createElement('span');
    crumb.className = 'fl-crumb';
    crumb.textContent = seg;
    const target = acc;
    crumb.addEventListener('click', (e) => {
      e.stopPropagation();
      flBrowsePath = target;
      renderFolderTree();
    });
    flBreadcrumb.appendChild(crumb);
  });
}

async function renderFolderTree() {
  renderFlBreadcrumb();
  flItems.innerHTML = '';

  // Roots view
  if (flBrowsePath === null) {
    if (flRoots.length === 0) {
      flItems.innerHTML = '<div style="padding:0.5rem 0.75rem;color:var(--text-muted);font-size:0.85rem;">No roots configured. Add them in Settings.</div>';
      return;
    }
    flRoots.forEach(r => {
      const row = document.createElement('div');
      row.className = 'fl-item';
      const name = document.createElement('span');
      name.className = 'fl-name';
      name.textContent = r.label;
      name.title = r.path;
      name.addEventListener('click', (e) => {
        e.stopPropagation();
        flBrowsePath = r.path;
        renderFolderTree();
      });
      row.appendChild(name);
      const drill = document.createElement('span');
      drill.className = 'fl-drill';
      drill.innerHTML = '&#9654;';
      drill.title = 'Browse subfolders';
      drill.addEventListener('click', (e) => {
        e.stopPropagation();
        flBrowsePath = r.path;
        renderFolderTree();
      });
      row.appendChild(drill);
      flItems.appendChild(row);
    });
    return;
  }

  // Subfolder view
  flItems.innerHTML = '<div style="padding:0.5rem 0.75rem;color:var(--text-muted);font-size:0.85rem;">Loading...</div>';
  try {
    const res = await fetch(`/api/disk-folders?path=${encodeURIComponent(flBrowsePath)}`);
    const dirs = await res.json();
    flItems.innerHTML = '';
    if (dirs.length === 0) {
      flItems.innerHTML = '<div style="padding:0.5rem 0.75rem;color:var(--text-muted);font-size:0.85rem;">(no subdirectories)</div>';
      return;
    }
    dirs.forEach(d => {
      const row = document.createElement('div');
      row.className = 'fl-item';
      const name = document.createElement('span');
      name.className = 'fl-name' + (d.path === selectedFolder ? ' active' : '');
      name.textContent = d.name;
      name.addEventListener('click', (e) => {
        e.stopPropagation();
        selectFolder(d.path, d.name);
      });
      row.appendChild(name);
      if (d.hasSubdirs) {
        const drill = document.createElement('span');
        drill.className = 'fl-drill';
        drill.innerHTML = '&#9654;';
        drill.title = 'Browse subfolders';
        drill.addEventListener('click', (e) => {
          e.stopPropagation();
          flBrowsePath = d.path;
          renderFolderTree();
        });
        row.appendChild(drill);
      }
      flItems.appendChild(row);
    });
  } catch (err) {
    flItems.innerHTML = `<div style="padding:0.5rem 0.75rem;font-size:0.85rem;" class="status-error">Error: ${err.message}</div>`;
  }
}

function selectFolder(diskPath, label) {
  selectedFolder = diskPath;
  folderBtn.textContent = label;
  folderList.classList.remove('open');
  activeSource = 'disk';
  groupSelect.value = '';
  loadPhotos();
  fetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'disk', folder: diskPath, label }) });
}

// Account filter change
accountFilter.addEventListener('change', () => {
  currentAccountFilter = accountFilter.value;
  loadPhotos();
});
