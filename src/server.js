require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');
const sharp = require('sharp');
const { fileHash } = require('./file-hash');
const { cropRegion, descriptorFromCrop, findMatches, descriptorToBuffer } = require('./face-identify');
const { resolvePath } = require('./resolve-path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '7297',
  database: process.env.DB_NAME || 'photoapp',
  ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false,
});

// --- API: list photos by folder or group ---
app.get('/api/photos', async (req, res) => {
  const folder = req.query.folder;
  const groupId = req.query.group;

  if (groupId) {
    const { rows } = await pool.query(
      `SELECT f.id, f.filename, f.original_path, f.extension, f.media_type, f.taken_at,
              f.width, f.height, f.caption, f.rating, f.source_folder, f.variant_type
       FROM catalog.files f
       JOIN catalog.group_files gf ON gf.file_id = f.id
       WHERE gf.group_id = $1 AND f.media_type = 'photo' AND f.filename NOT LIKE 'x\\_%'
       ORDER BY f.taken_at ASC NULLS LAST, f.filename ASC`,
      [groupId]
    );
    return res.json(rows);
  }

  if (!folder) return res.status(400).json({ error: 'folder or group param required' });

  if (folder === '__all__') {
    const { rows } = await pool.query(
      `SELECT id, filename, original_path, extension, media_type, taken_at, width, height,
              caption, rating, source_folder, variant_type
       FROM catalog.files
       WHERE media_type = 'photo' AND filename NOT LIKE 'x\\_%'
       ORDER BY taken_at ASC NULLS LAST, filename ASC`
    );
    return res.json(rows);
  }

  const { rows } = await pool.query(
    `SELECT id, filename, original_path, extension, media_type, taken_at, width, height,
            caption, rating, source_folder, variant_type
     FROM catalog.files
     WHERE regexp_replace(original_path, '/[^/]+$', '') = $1 AND media_type = 'photo' AND filename NOT LIKE 'x\\_%'
     ORDER BY taken_at ASC NULLS LAST, filename ASC`,
    [folder]
  );
  res.json(rows);
});

// --- API: stream photo by id ---
app.get('/api/photo/:id', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT original_path, extension, variant_type FROM catalog.files WHERE id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  const filePath = resolvePath(rows[0].original_path, rows[0].variant_type);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });

  const ext = rows[0].extension.toLowerCase();
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/jpeg', tiff: 'image/jpeg' };

  // Convert formats browsers can't render (TIFF, BMP) to JPEG on the fly
  if (ext === 'tif' || ext === 'tiff' || ext === 'bmp') {
    res.setHeader('Content-Type', 'image/jpeg');
    sharp(filePath).jpeg({ quality: 85 }).pipe(res);
  } else {
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  }
});

// --- API: get/set caption ---
app.get('/api/photo/:id/caption', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT caption FROM catalog.files WHERE id = $1', [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json({ caption: rows[0].caption });
});

app.put('/api/photo/:id/caption', async (req, res) => {
  const caption = req.body.caption ?? '';
  const { rowCount } = await pool.query(
    'UPDATE catalog.files SET caption = $1 WHERE id = $2', [caption, req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// --- API: rating (keep/duplicate/skip) ---
app.put('/api/photo/:id/rating', async (req, res) => {
  const rating = req.body.rating;
  const valid = ['keep', 'duplicate', 'skip', null];
  if (!valid.includes(rating)) return res.status(400).json({ error: 'invalid rating' });
  const { rowCount } = await pool.query(
    'UPDATE catalog.files SET rating = $1 WHERE id = $2', [rating, req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// --- API: tags ---
app.get('/api/tags', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name FROM catalog.tags ORDER BY name');
  res.json(rows);
});

app.post('/api/tags', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  // Unique constraint is on (name, category); CHECK allows person/event/location/other
  const { rows } = await pool.query(
    `INSERT INTO catalog.tags (name, category) VALUES ($1, 'other')
     ON CONFLICT (name, category) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name`,
    [name]
  );
  res.json(rows[0]);
});

app.get('/api/photo/:id/tags', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.name FROM catalog.tags t
     JOIN catalog.file_tags ft ON ft.tag_id = t.id
     WHERE ft.file_id = $1 ORDER BY t.name`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/photo/:id/tags', async (req, res) => {
  const tagId = req.body.tag_id;
  if (!tagId) return res.status(400).json({ error: 'tag_id required' });
  await pool.query(
    'INSERT INTO catalog.file_tags (file_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.params.id, tagId]
  );
  res.json({ ok: true });
});

app.delete('/api/photo/:id/tags/:tagId', async (req, res) => {
  await pool.query(
    'DELETE FROM catalog.file_tags WHERE file_id = $1 AND tag_id = $2',
    [req.params.id, req.params.tagId]
  );
  res.json({ ok: true });
});

// --- API: photo texts ---
app.get('/api/photo/:id/texts', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, file_id, body, sort_order, created_at
     FROM catalog.photo_texts WHERE file_id = $1 ORDER BY sort_order`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/photo/:id/texts', async (req, res) => {
  const body = req.body.body ?? '';
  // Auto-assign next sort_order
  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM catalog.photo_texts WHERE file_id = $1',
    [req.params.id]
  );
  const sortOrder = maxRows[0].next;
  const { rows } = await pool.query(
    `INSERT INTO catalog.photo_texts (file_id, body, sort_order)
     VALUES ($1, $2, $3) RETURNING id, file_id, body, sort_order, created_at`,
    [req.params.id, body, sortOrder]
  );
  res.json(rows[0]);
});

app.put('/api/text/:textId', async (req, res) => {
  const body = req.body.body ?? '';
  const { rowCount } = await pool.query(
    'UPDATE catalog.photo_texts SET body = $1 WHERE id = $2',
    [body, req.params.textId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.delete('/api/text/:textId', async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM catalog.photo_texts WHERE id = $1',
    [req.params.textId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// --- API: list folders ---
app.get('/api/folders', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT source_folder, COUNT(*) as count
     FROM catalog.files WHERE media_type = 'photo' AND filename NOT LIKE 'x\\_%'
     GROUP BY source_folder ORDER BY source_folder`
  );
  res.json(rows);
});

// --- API: folder tree (drive > parent > source_folder) ---
app.get('/api/folder-tree', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       regexp_replace(original_path, '/[^/]+$', '') AS folder_path,
       COUNT(*)::int AS count
     FROM catalog.files
     WHERE media_type = 'photo' AND filename NOT LIKE 'x\\_%'
     GROUP BY folder_path
     ORDER BY folder_path`
  );
  res.json(rows);
});

// --- API: rename photo ---
app.put('/api/photo/:id/rename', async (req, res) => {
  const newName = (req.body.newName || '').trim();
  if (!newName) return res.status(400).json({ error: 'newName required' });

  const { rows } = await pool.query(
    'SELECT original_path, filename, extension, variant_type FROM catalog.files WHERE id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  const oldDiskPath = resolvePath(rows[0].original_path, rows[0].variant_type);
  if (!fs.existsSync(oldDiskPath)) return res.status(404).json({ error: 'file missing on disk' });

  const dir = path.dirname(oldDiskPath);
  const ext = rows[0].extension;
  const newFilename = newName.includes('.') ? newName : `${newName}.${ext}`;
  const newDiskPath = path.join(dir, newFilename);

  if (fs.existsSync(newDiskPath) && newDiskPath !== oldDiskPath) {
    return res.status(409).json({ error: 'a file with that name already exists' });
  }

  fs.renameSync(oldDiskPath, newDiskPath);
  const newDbPath = path.join(path.dirname(rows[0].original_path), newFilename).replace(/\\/g, '/');
  await pool.query(
    'UPDATE catalog.files SET original_path = $1, filename = $2 WHERE id = $3',
    [newDbPath, newFilename, req.params.id]
  );
  res.json({ ok: true, filename: newFilename, original_path: newDbPath });
});

// --- API: convert to PNG ---
app.post('/api/photo/:id/convert-png', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT original_path, filename, extension, source_folder, variant_type FROM catalog.files WHERE id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  const filePath = resolvePath(rows[0].original_path, rows[0].variant_type);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });

  const stem = path.basename(rows[0].filename, path.extname(rows[0].filename));
  const sourceFolder = rows[0].source_folder || 'unknown';
  const folderName = path.basename(sourceFolder);
  const variantDir = path.join('D:\\photo-app-variants', folderName);
  fs.mkdirSync(variantDir, { recursive: true });

  const pngPath = path.join(variantDir, `${stem}.png`);
  const info = await sharp(filePath).png().toFile(pngPath);

  const { rows: inserted } = await pool.query(
    `INSERT INTO catalog.variants (source_file_id, variant_type, variant_path, width, height)
     VALUES ($1, 'png', $2, $3, $4) RETURNING id`,
    [req.params.id, pngPath, info.width, info.height]
  );
  res.json({ ok: true, variant_id: inserted[0].id, path: pngPath, width: info.width, height: info.height });
});

// --- API: resize photo ---
app.post('/api/photo/:id/resize', async (req, res) => {
  const mode = req.body.mode;
  if (!['print', 'screen', 'both'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be print, screen, or both' });
  }

  const { rows } = await pool.query(
    'SELECT original_path, filename, extension, width, height, source_folder, variant_type FROM catalog.files WHERE id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  const filePath = resolvePath(rows[0].original_path, rows[0].variant_type);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });

  const stem = path.basename(rows[0].filename, path.extname(rows[0].filename));
  const ext = rows[0].extension;
  const sourceFolder = rows[0].source_folder || 'unknown';
  const folderName = path.basename(sourceFolder);
  const variantDir = path.join('D:\\photo-app-variants', folderName);
  fs.mkdirSync(variantDir, { recursive: true });

  const meta = await sharp(filePath).metadata();
  const srcW = meta.width;
  const srcH = meta.height;
  const results = [];
  const skipped = [];

  const modes = mode === 'both' ? ['print', 'screen'] : [mode];

  for (const m of modes) {
    let targetW, targetH, suffix;
    if (m === 'print') {
      targetW = 2400; targetH = 3000; suffix = '_print';
      if (srcW < targetW && srcH < targetH) {
        skipped.push({ mode: m, reason: `source ${srcW}x${srcH} smaller than ${targetW}x${targetH}` });
        continue;
      }
    } else {
      // screen: 1920 on long edge
      suffix = '_screen';
      const longEdge = Math.max(srcW, srcH);
      if (longEdge <= 1920) {
        skipped.push({ mode: m, reason: `source long edge ${longEdge}px already <= 1920` });
        continue;
      }
      if (srcW >= srcH) {
        targetW = 1920; targetH = Math.round(srcH * (1920 / srcW));
      } else {
        targetH = 1920; targetW = Math.round(srcW * (1920 / srcH));
      }
    }

    const outPath = path.join(variantDir, `${stem}${suffix}.${ext}`);
    const resizeOpts = m === 'print'
      ? { width: targetW, height: targetH, fit: 'inside', withoutEnlargement: true }
      : { width: targetW, height: targetH, fit: 'inside', withoutEnlargement: true };

    const info = await sharp(filePath).resize(resizeOpts).toFile(outPath);

    const { rows: inserted } = await pool.query(
      `INSERT INTO catalog.variants (source_file_id, variant_type, variant_path, width, height)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.params.id, m, outPath, info.width, info.height]
    );
    results.push({ variant_id: inserted[0].id, mode: m, path: outPath, width: info.width, height: info.height });
  }

  res.json({ ok: true, results, skipped });
});

// --- API: rotate photo ---
app.post('/api/rotate', async (req, res) => {
  const { id, path: diskPath, angle } = req.body;
  if (![90, 270].includes(angle)) return res.status(400).json({ error: 'angle must be 90 or 270' });

  let filePath;
  if (id) {
    const { rows } = await pool.query('SELECT original_path, variant_type FROM catalog.files WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    filePath = resolvePath(rows[0].original_path, rows[0].variant_type);
  } else if (diskPath) {
    filePath = diskPath;
  } else {
    return res.status(400).json({ error: 'id or path required' });
  }

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });

  try {
    const buf = await sharp(filePath).rotate(angle).toBuffer();
    await fs.promises.writeFile(filePath, buf);

    if (id) {
      const meta = await sharp(filePath).metadata();
      const hash = await fileHash(filePath);
      await pool.query(
        'UPDATE catalog.files SET width = $1, height = $2, file_hash = $3 WHERE id = $4',
        [meta.width, meta.height, hash, id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: hide photo (x_ prefix) ---
app.post('/api/hide', async (req, res) => {
  const { id, path: diskPath } = req.body;

  let filePath, filename, dbRow;
  if (id) {
    const { rows } = await pool.query('SELECT original_path, filename, variant_type FROM catalog.files WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    dbRow = rows[0];
    filePath = resolvePath(dbRow.original_path, dbRow.variant_type);
    filename = dbRow.filename;
  } else if (diskPath) {
    filePath = diskPath;
    filename = path.basename(diskPath);
  } else {
    return res.status(400).json({ error: 'id or path required' });
  }

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });
  if (filename.startsWith('x_')) return res.json({ ok: true, already: true });

  const dir = path.dirname(filePath);
  const newFilename = 'x_' + filename;
  const newDiskPath = path.join(dir, newFilename);

  fs.renameSync(filePath, newDiskPath);
  if (id) {
    const newDbPath = path.join(path.dirname(dbRow.original_path), newFilename).replace(/\\/g, '/');
    await pool.query(
      'UPDATE catalog.files SET original_path = $1, filename = $2 WHERE id = $3',
      [newDbPath, newFilename, id]
    );
  }
  res.json({ ok: true });
});

// --- API: file size ---
app.get('/api/file-size', async (req, res) => {
  const { id, path: diskPath } = req.query;
  let filePath;
  if (id) {
    const { rows } = await pool.query('SELECT original_path, variant_type FROM catalog.files WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    filePath = resolvePath(rows[0].original_path, rows[0].variant_type);
  } else if (diskPath) {
    filePath = diskPath;
  } else {
    return res.status(400).json({ error: 'id or path required' });
  }
  try {
    const stat = await fs.promises.stat(filePath);
    res.json({ size: stat.size });
  } catch {
    res.status(404).json({ error: 'file not found' });
  }
});

// --- API: list variants for a photo ---
app.get('/api/photo/:id/variants', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, variant_type, variant_path, width, height, created_at
     FROM catalog.variants WHERE source_file_id = $1 ORDER BY created_at`,
    [req.params.id]
  );
  res.json(rows);
});

// --- API: move photos to folder ---
app.post('/api/photos/move', async (req, res) => {
  const { fileIds, targetFolder } = req.body;
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: 'fileIds array required' });
  }
  if (!targetFolder || typeof targetFolder !== 'string') {
    return res.status(400).json({ error: 'targetFolder required' });
  }

  // Ensure target folder exists
  fs.mkdirSync(targetFolder, { recursive: true });

  const moved = [];
  const errors = [];

  for (const id of fileIds) {
    const { rows } = await pool.query(
      'SELECT original_path, filename, variant_type FROM catalog.files WHERE id = $1',
      [id]
    );
    if (rows.length === 0) { errors.push({ id, error: 'not found' }); continue; }

    const oldDiskPath = resolvePath(rows[0].original_path, rows[0].variant_type);
    if (!fs.existsSync(oldDiskPath)) { errors.push({ id, error: 'file missing on disk' }); continue; }

    const newDiskPath = path.join(targetFolder, rows[0].filename);
    if (fs.existsSync(newDiskPath)) { errors.push({ id, error: 'file already exists at target' }); continue; }

    fs.renameSync(oldDiskPath, newDiskPath);
    await pool.query(
      'UPDATE catalog.files SET original_path = $1, source_folder = $2 WHERE id = $3',
      [newDiskPath, targetFolder, id]
    );
    moved.push({ id, newPath: newDiskPath });
  }

  res.json({ ok: true, moved, errors });
});

// --- API: groups CRUD ---
app.get('/api/groups', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.created_at, COUNT(gf.file_id)::int AS member_count
     FROM catalog.groups g
     LEFT JOIN catalog.group_files gf ON gf.group_id = g.id
     GROUP BY g.id ORDER BY g.name`
  );
  res.json(rows);
});

app.post('/api/groups', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rows } = await pool.query(
    'INSERT INTO catalog.groups (name) VALUES ($1) RETURNING id, name, created_at',
    [name]
  );
  res.json(rows[0]);
});

app.put('/api/groups/:id', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rowCount } = await pool.query(
    'UPDATE catalog.groups SET name = $1 WHERE id = $2',
    [name, req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.delete('/api/groups/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM catalog.groups WHERE id = $1',
    [req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// --- API: group membership ---
app.get('/api/groups/:id/photos', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT file_id FROM catalog.group_files WHERE group_id = $1',
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/groups/:id/photos', async (req, res) => {
  const fileId = req.body.file_id;
  const fileIds = req.body.file_ids;
  const ids = fileIds ? fileIds : (fileId ? [fileId] : []);
  if (ids.length === 0) return res.status(400).json({ error: 'file_id or file_ids required' });
  for (const fid of ids) {
    await pool.query(
      'INSERT INTO catalog.group_files (group_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, fid]
    );
  }
  res.json({ ok: true, added: ids.length });
});

app.delete('/api/groups/:id/photos/:fileId', async (req, res) => {
  await pool.query(
    'DELETE FROM catalog.group_files WHERE group_id = $1 AND file_id = $2',
    [req.params.id, req.params.fileId]
  );
  res.json({ ok: true });
});

// --- API: disk folder browsing ---
const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'heic']);

app.get('/api/disk-folders', async (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath) return res.status(400).json({ error: 'path param required' });
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const dirs = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dirPath, e.name).replace(/\\/g, '/');
      let hasSubdirs = false;
      try {
        const sub = await fs.promises.readdir(full, { withFileTypes: true });
        hasSubdirs = sub.some(s => s.isDirectory());
      } catch (_) {}
      dirs.push({ name: e.name, path: full, hasSubdirs });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    res.json(dirs);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/disk-photos', async (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath) return res.status(400).json({ error: 'path param required' });
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const photos = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name.startsWith('x_')) continue;
      const ext = path.extname(e.name).toLowerCase().replace('.', '');
      if (!PHOTO_EXTS.has(ext)) continue;
      const full = path.join(dirPath, e.name).replace(/\\/g, '/');
      photos.push({ filename: e.name, disk_path: full });
    }
    photos.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }));
    res.json(photos);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/disk-photos/match', async (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath) return res.status(400).json({ error: 'path param required' });
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const results = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name.startsWith('x_')) continue;
      const ext = path.extname(e.name).toLowerCase().replace('.', '');
      if (!PHOTO_EXTS.has(ext)) continue;
      const full = path.join(dirPath, e.name).replace(/\\/g, '/');
      try {
        const hash = await fileHash(full);
        const { rows } = await pool.query(
          'SELECT id, rating, caption FROM catalog.files WHERE file_hash = $1 LIMIT 1',
          [hash]
        );
        if (rows.length > 0) {
          results.push({
            filename: e.name,
            db_id: rows[0].id,
            rating: rows[0].rating,
            caption: rows[0].caption
          });
        }
      } catch (_) {}
    }
    res.json(results);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/disk-photo', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path param required' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });

  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/jpeg', tiff: 'image/jpeg', heic: 'image/jpeg' };

  if (ext === 'tif' || ext === 'tiff' || ext === 'bmp' || ext === 'heic') {
    res.setHeader('Content-Type', 'image/jpeg');
    sharp(filePath).jpeg({ quality: 85 }).pipe(res);
  } else {
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  }
});

// --- People / Genealogy ---
app.get('/api/people', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM catalog.people ORDER BY name');
  res.json(rows);
});

app.post('/api/people', async (req, res) => {
  const { name, birth_date, death_date, gender, notes } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.people (name, birth_date, death_date, gender, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [name, birth_date || null, death_date || null, gender || null, notes || null]
  );
  res.json(rows[0]);
});

app.put('/api/people/:id', async (req, res) => {
  const { name, birth_date, death_date, gender, notes } = req.body;
  const { rows } = await pool.query(
    'UPDATE catalog.people SET name=$1, birth_date=$2, death_date=$3, gender=$4, notes=$5 WHERE id=$6 RETURNING *',
    [name, birth_date || null, death_date || null, gender || null, notes || null, req.params.id]
  );
  res.json(rows[0]);
});

app.delete('/api/people/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.people WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// --- Relationships (bidirectional storage) ---
const INVERSE_TYPE = { parent: 'child', child: 'parent', spouse: 'spouse', sibling: 'sibling', friend: 'friend', employer: 'employee', employee: 'employer', teacher: 'student', student: 'teacher', classmate: 'classmate' };

app.get('/api/people/:id/relationships', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, p.name AS related_name
     FROM catalog.relationships r
     JOIN catalog.people p ON p.id = r.related_id
     WHERE r.person_id = $1
     ORDER BY r.type, p.name`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/relationships', async (req, res) => {
  const { person_id, related_id, type, start_date, end_date } = req.body;
  const inverse = INVERSE_TYPE[type];
  if (!inverse) return res.status(400).json({ error: 'invalid relationship type' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO catalog.relationships (person_id, related_id, type, start_date, end_date) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [person_id, related_id, type, start_date || null, end_date || null]
    );
    await client.query(
      'INSERT INTO catalog.relationships (person_id, related_id, type, start_date, end_date) VALUES ($1,$2,$3,$4,$5)',
      [related_id, person_id, inverse, start_date || null, end_date || null]
    );
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

app.delete('/api/relationships/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT person_id, related_id, type FROM catalog.relationships WHERE id=$1', [req.params.id]
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not found' }); }
    const r = rows[0];
    const inverse = INVERSE_TYPE[r.type];
    await client.query('DELETE FROM catalog.relationships WHERE id=$1', [req.params.id]);
    if (inverse) {
      await client.query(
        'DELETE FROM catalog.relationships WHERE person_id=$1 AND related_id=$2 AND type=$3',
        [r.related_id, r.person_id, inverse]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// --- Photo-People (tagging faces) ---
app.get('/api/photo/:id/people', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pp.*, p.name FROM catalog.photo_people pp
     JOIN catalog.people p ON p.id = pp.person_id
     WHERE pp.photo_id = $1 ORDER BY p.name`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/photo/:id/people', async (req, res) => {
  const { person_id, x, y, w, h } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.photo_people (photo_id, person_id, x, y, w, h) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.params.id, person_id, x ?? null, y ?? null, w ?? null, h ?? null]
  );
  const pp = rows[0];
  // Compute and store face descriptor if coordinates provided
  if (x != null && y != null && w != null && h != null) {
    try {
      const { rows: fileRows } = await pool.query(
        'SELECT original_path, width, height, variant_type FROM catalog.files WHERE id = $1', [req.params.id]
      );
      if (fileRows.length > 0) {
        const diskPath = resolvePath(fileRows[0].original_path, fileRows[0].variant_type);
        const cropBuf = await cropRegion(diskPath, fileRows[0].width, fileRows[0].height, { x, y, w, h });
        const descriptor = await descriptorFromCrop(cropBuf);
        if (descriptor) {
          await pool.query('UPDATE catalog.photo_people SET descriptor = $1 WHERE id = $2',
            [descriptorToBuffer(descriptor), pp.id]);
        }
      }
    } catch (err) {
      console.error('descriptor compute error (tag):', err.message);
    }
  }
  res.json(pp);
});

app.put('/api/photo-people/:id', async (req, res) => {
  const { x, y, w, h } = req.body;
  const { rows } = await pool.query(
    'UPDATE catalog.photo_people SET x=$1, y=$2, w=$3, h=$4 WHERE id=$5 RETURNING *',
    [x ?? null, y ?? null, w ?? null, h ?? null, req.params.id]
  );
  const pp = rows[0];
  // Recompute descriptor when coordinates change
  if (pp && x != null && y != null && w != null && h != null) {
    try {
      const { rows: fileRows } = await pool.query(
        'SELECT original_path, width, height, variant_type FROM catalog.files WHERE id = $1', [pp.photo_id]
      );
      if (fileRows.length > 0) {
        const diskPath = resolvePath(fileRows[0].original_path, fileRows[0].variant_type);
        const cropBuf = await cropRegion(diskPath, fileRows[0].width, fileRows[0].height, { x, y, w, h });
        const descriptor = await descriptorFromCrop(cropBuf);
        if (descriptor) {
          await pool.query('UPDATE catalog.photo_people SET descriptor = $1 WHERE id = $2',
            [descriptorToBuffer(descriptor), pp.id]);
        }
      }
    } catch (err) {
      console.error('descriptor compute error (locate):', err.message);
    }
  }
  res.json(pp);
});

app.delete('/api/photo-people/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.photo_people WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// --- Places ---
app.get('/api/places', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM catalog.places ORDER BY name');
  res.json(rows);
});

app.post('/api/places', async (req, res) => {
  const { name, notes } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.places (name, notes) VALUES ($1,$2) RETURNING *',
    [name, notes || null]
  );
  res.json(rows[0]);
});

app.delete('/api/places/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.places WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/photo/:id/places', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pp.*, p.name, p.notes FROM catalog.photo_places pp
     JOIN catalog.places p ON p.id = pp.place_id
     WHERE pp.photo_id = $1 ORDER BY p.name`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/photo/:id/places', async (req, res) => {
  const { place_id } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.photo_places (photo_id, place_id) VALUES ($1,$2) RETURNING *',
    [req.params.id, place_id]
  );
  res.json(rows[0]);
});

app.delete('/api/photo-places/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.photo_places WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// --- Things ---
app.get('/api/things', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM catalog.things ORDER BY name');
  res.json(rows);
});

app.post('/api/things', async (req, res) => {
  const { name, notes } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.things (name, notes) VALUES ($1,$2) RETURNING *',
    [name, notes || null]
  );
  res.json(rows[0]);
});

app.delete('/api/things/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.things WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/photo/:id/things', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pt.*, t.name, t.notes FROM catalog.photo_things pt
     JOIN catalog.things t ON t.id = pt.thing_id
     WHERE pt.photo_id = $1 ORDER BY t.name`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/photo/:id/things', async (req, res) => {
  const { thing_id } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.photo_things (photo_id, thing_id) VALUES ($1,$2) RETURNING *',
    [req.params.id, thing_id]
  );
  res.json(rows[0]);
});

app.delete('/api/photo-things/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.photo_things WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// --- Face identification ---
app.post('/api/photo/:id/identify', async (req, res) => {
  const { x, y, w, h } = req.body;
  if (x == null || y == null || w == null || h == null) {
    return res.status(400).json({ error: 'x, y, w, h are required' });
  }
  const { rows } = await pool.query(
    'SELECT original_path, width, height, variant_type FROM catalog.files WHERE id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const { width, height } = rows[0];
  const diskPath = resolvePath(rows[0].original_path, rows[0].variant_type);

  try {
    const cropBuf = await cropRegion(diskPath, width, height, { x, y, w, h });
    const descriptor = await descriptorFromCrop(cropBuf);
    if (!descriptor) {
      return res.json({ descriptor_found: false, matches: [] });
    }
    const matches = await findMatches(pool, descriptor);
    res.json({ descriptor_found: true, matches });
  } catch (err) {
    console.error('identify error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Global error handler (return JSON, not HTML) ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal server error' });
});

// --- Fallback: serve index.html for SPA ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`Photo triage UI running at http://localhost:${PORT}`);
});

module.exports = app;
