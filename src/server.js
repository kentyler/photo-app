require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');
const sharp = require('sharp');
const multer = require('multer');
const { fileHash } = require('./file-hash');
const { cropRegion, descriptorFromCrop, findMatches, descriptorToBuffer } = require('./face-identify');
const { resolvePath } = require('./resolve-path');
const { startWatcher } = require('./file-watcher');

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

const DOCS_ROOT = process.env.DOCS_ROOT || 'D:/photo-app-documents';
const upload = multer({ dest: path.join(DOCS_ROOT, '_tmp') });

// --- Helper: resolve account IDs for filtering ---
async function getAccountFilter(pool, accountParam) {
  // Returns array of account IDs to include, or null for no filter (show all)
  if (!accountParam || accountParam === 'all') return null;
  if (accountParam === 'master') {
    const { rows } = await pool.query("SELECT id FROM catalog.accounts WHERE name = 'master'");
    return rows.length > 0 ? [rows[0].id] : [1];
  }
  // Specific account name: show master + that account
  const { rows: masterRows } = await pool.query("SELECT id FROM catalog.accounts WHERE name = 'master'");
  const { rows: acctRows } = await pool.query('SELECT id FROM catalog.accounts WHERE name = $1', [accountParam]);
  const ids = masterRows.map(r => r.id);
  acctRows.forEach(r => { if (!ids.includes(r.id)) ids.push(r.id); });
  return ids;
}

// --- API: list photos by folder or group ---
app.get('/api/photos', async (req, res) => {
  const folder = req.query.folder;
  const groupId = req.query.group;
  const accountIds = await getAccountFilter(pool, req.query.account);
  const acctClause = accountIds ? `AND f.account_id = ANY($ACCT$)` : '';

  if (groupId) {
    let q = `SELECT f.id, f.filename, f.original_path, f.extension, f.media_type, f.taken_at,
              f.width, f.height, f.caption, f.rating, f.source_folder, f.variant_type
       FROM catalog.files f
       JOIN catalog.group_files gf ON gf.file_id = f.id
       WHERE gf.group_id = $1 AND f.media_type = 'photo' AND f.filename NOT LIKE 'x\\_%'`;
    const params = [groupId];
    if (accountIds) {
      q += ` AND f.account_id = ANY($2)`;
      params.push(accountIds);
    }
    q += ` ORDER BY f.taken_at ASC NULLS LAST, f.filename ASC`;
    const { rows } = await pool.query(q, params);
    return res.json(rows);
  }

  if (!folder) return res.status(400).json({ error: 'folder or group param required' });

  if (folder === '__all__') {
    let q = `SELECT id, filename, original_path, extension, media_type, taken_at, width, height,
              caption, rating, source_folder, variant_type
       FROM catalog.files f
       WHERE media_type = 'photo' AND filename NOT LIKE 'x\\_%'`;
    const params = [];
    if (accountIds) {
      q += ` AND f.account_id = ANY($1)`;
      params.push(accountIds);
    }
    q += ` ORDER BY taken_at ASC NULLS LAST, filename ASC`;
    const { rows } = await pool.query(q, params);
    return res.json(rows);
  }

  let q = `SELECT id, filename, original_path, extension, media_type, taken_at, width, height,
            caption, rating, source_folder, variant_type
     FROM catalog.files f
     WHERE regexp_replace(original_path, '/[^/]+$', '') = $1 AND media_type = 'photo' AND filename NOT LIKE 'x\\_%'`;
  const params = [folder];
  if (accountIds) {
    q += ` AND f.account_id = ANY($2)`;
    params.push(accountIds);
  }
  q += ` ORDER BY taken_at ASC NULLS LAST, filename ASC`;
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// --- API: stream photo by id ---
app.get('/api/photo/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT f.original_path, f.extension, a.root_path
     FROM catalog.files f JOIN catalog.accounts a ON a.id = f.account_id
     WHERE f.id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  const filePath = resolvePath(rows[0].original_path, rows[0].root_path);
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
  const accountIds = await getAccountFilter(pool, req.query.account);
  let q = `SELECT source_folder, COUNT(*) as count
     FROM catalog.files f WHERE media_type = 'photo' AND filename NOT LIKE 'x\\_%'`;
  const params = [];
  if (accountIds) {
    q += ` AND f.account_id = ANY($1)`;
    params.push(accountIds);
  }
  q += ` GROUP BY source_folder ORDER BY source_folder`;
  const { rows } = await pool.query(q, params);
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

// --- API: rotate photo ---
app.post('/api/rotate', async (req, res) => {
  const { id, path: diskPath, angle } = req.body;
  if (![90, 270].includes(angle)) return res.status(400).json({ error: 'angle must be 90 or 270' });

  let filePath;
  if (id) {
    const { rows } = await pool.query(
      `SELECT f.original_path, a.root_path
       FROM catalog.files f JOIN catalog.accounts a ON a.id = f.account_id
       WHERE f.id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    filePath = resolvePath(rows[0].original_path, rows[0].root_path);
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
    const { rows } = await pool.query(
      `SELECT f.original_path, f.filename, a.root_path
       FROM catalog.files f JOIN catalog.accounts a ON a.id = f.account_id
       WHERE f.id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    dbRow = rows[0];
    filePath = resolvePath(dbRow.original_path, dbRow.root_path);
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
    const { rows } = await pool.query(
      `SELECT f.original_path, a.root_path
       FROM catalog.files f JOIN catalog.accounts a ON a.id = f.account_id
       WHERE f.id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    filePath = resolvePath(rows[0].original_path, rows[0].root_path);
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
  const { rows } = await pool.query(
    `SELECT p.id, pa.alias AS name, p.birth_date, p.death_date, p.gender, p.notes
     FROM catalog.people p
     JOIN catalog.person_aliases pa ON pa.person_id = p.id AND pa.is_primary = true
     ORDER BY pa.alias`
  );
  res.json(rows);
});

app.post('/api/people', async (req, res) => {
  const { name, birth_date, death_date, gender, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO catalog.people (birth_date, death_date, gender, notes) VALUES ($1,$2,$3,$4) RETURNING *',
      [birth_date || null, death_date || null, gender || null, notes || null]
    );
    const person = rows[0];
    await client.query(
      'INSERT INTO catalog.person_aliases (person_id, alias, is_primary) VALUES ($1, $2, true)',
      [person.id, name]
    );
    await client.query('COMMIT');
    res.json({ ...person, name });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

app.put('/api/people/:id', async (req, res) => {
  const { name, birth_date, death_date, gender, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE catalog.people SET birth_date=$1, death_date=$2, gender=$3, notes=$4 WHERE id=$5',
      [birth_date || null, death_date || null, gender || null, notes || null, req.params.id]
    );
    if (name) {
      await client.query(
        `UPDATE catalog.person_aliases SET alias = $1 WHERE person_id = $2 AND is_primary = true`,
        [name, req.params.id]
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

app.delete('/api/people/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.people WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// --- Person Aliases ---
app.get('/api/people/:id/aliases', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, alias, is_primary FROM catalog.person_aliases WHERE person_id = $1 ORDER BY is_primary DESC, alias',
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/people/:id/aliases', async (req, res) => {
  const alias = (req.body.alias || '').trim();
  if (!alias) return res.status(400).json({ error: 'alias required' });
  const { rows } = await pool.query(
    'INSERT INTO catalog.person_aliases (person_id, alias) VALUES ($1, $2) ON CONFLICT (person_id, alias) DO NOTHING RETURNING *',
    [req.params.id, alias]
  );
  if (rows.length === 0) return res.json({ ok: true, already: true });
  res.json(rows[0]);
});

app.put('/api/aliases/:id/primary', async (req, res) => {
  const { rows } = await pool.query('SELECT person_id FROM catalog.person_aliases WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const personId = rows[0].person_id;
  await pool.query('UPDATE catalog.person_aliases SET is_primary = false WHERE person_id = $1', [personId]);
  await pool.query('UPDATE catalog.person_aliases SET is_primary = true WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/aliases/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT is_primary FROM catalog.person_aliases WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  if (rows[0].is_primary) return res.status(400).json({ error: 'cannot delete primary alias' });
  await pool.query('DELETE FROM catalog.person_aliases WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// --- Relationships (bidirectional storage) ---
const INVERSE_TYPE = { parent: 'child', child: 'parent', spouse: 'spouse', sibling: 'sibling', friend: 'friend', employer: 'employee', employee: 'employer', teacher: 'student', student: 'teacher', classmate: 'classmate' };

app.get('/api/people/:id/relationships', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, pa.alias AS related_name
     FROM catalog.relationships r
     JOIN catalog.person_aliases pa ON pa.person_id = r.related_id AND pa.is_primary = true
     WHERE r.person_id = $1
     ORDER BY r.type, pa.alias`,
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
    `SELECT pp.*, pa.alias AS name FROM catalog.photo_people pp
     JOIN catalog.person_aliases pa ON pa.person_id = pp.person_id AND pa.is_primary = true
     WHERE pp.photo_id = $1 ORDER BY pa.alias`,
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
        `SELECT f.original_path, f.width, f.height, a.root_path
         FROM catalog.files f JOIN catalog.accounts a ON a.id = f.account_id
         WHERE f.id = $1`, [req.params.id]
      );
      if (fileRows.length > 0) {
        const diskPath = resolvePath(fileRows[0].original_path, fileRows[0].root_path);
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
        `SELECT f.original_path, f.width, f.height, a.root_path
         FROM catalog.files f JOIN catalog.accounts a ON a.id = f.account_id
         WHERE f.id = $1`, [pp.photo_id]
      );
      if (fileRows.length > 0) {
        const diskPath = resolvePath(fileRows[0].original_path, fileRows[0].root_path);
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

// --- Documents CRUD ---
app.get('/api/documents', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, title, created_at, updated_at FROM catalog.documents ORDER BY updated_at DESC'
  );
  res.json(rows);
});

app.post('/api/documents', async (req, res) => {
  const title = (req.body.title || req.body.name || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  const body = req.body.body || '';
  const { rows } = await pool.query(
    'INSERT INTO catalog.documents (title, body) VALUES ($1, $2) RETURNING *',
    [title, body]
  );
  res.json(rows[0]);
});

app.get('/api/documents/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM catalog.documents WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const doc = rows[0];
  const { rows: files } = await pool.query(
    'SELECT id, filename, original_name, mime_type, file_size, sort_order FROM catalog.document_files WHERE document_id = $1 ORDER BY sort_order',
    [doc.id]
  );
  const counts = {};
  for (const t of ['photos', 'people', 'places', 'things']) {
    const { rows: c } = await pool.query(`SELECT COUNT(*)::int AS n FROM catalog.document_${t} WHERE document_id = $1`, [doc.id]);
    counts[t] = c[0].n;
  }
  res.json({ ...doc, files, counts });
});

app.put('/api/documents/:id', async (req, res) => {
  const title = (req.body.title || '').trim();
  const body = req.body.body ?? '';
  const { rowCount } = await pool.query(
    'UPDATE catalog.documents SET title = $1, body = $2, updated_at = now() WHERE id = $3',
    [title, body, req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.delete('/api/documents/:id', async (req, res) => {
  // Delete files on disk first
  const { rows: files } = await pool.query(
    'SELECT file_path FROM catalog.document_files WHERE document_id = $1', [req.params.id]
  );
  for (const f of files) {
    try { fs.unlinkSync(f.file_path); } catch (_) {}
  }
  const docDir = path.join(DOCS_ROOT, String(req.params.id));
  try { fs.rmSync(docDir, { recursive: true, force: true }); } catch (_) {}
  await pool.query('DELETE FROM catalog.documents WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// --- Document file attachments ---
app.get('/api/documents/:id/files', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, filename, original_name, mime_type, file_size, sort_order FROM catalog.document_files WHERE document_id = $1 ORDER BY sort_order',
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/documents/:id/files', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const docId = req.params.id;
  const docDir = path.join(DOCS_ROOT, String(docId));
  fs.mkdirSync(docDir, { recursive: true });
  const dest = path.join(docDir, req.file.originalname);
  fs.renameSync(req.file.path, dest);
  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM catalog.document_files WHERE document_id = $1', [docId]
  );
  const { rows } = await pool.query(
    `INSERT INTO catalog.document_files (document_id, filename, original_name, file_path, mime_type, file_size, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [docId, req.file.originalname, req.file.originalname, dest, req.file.mimetype, req.file.size, maxRows[0].next]
  );
  res.json(rows[0]);
});

app.delete('/api/document-files/:fileId', async (req, res) => {
  const { rows } = await pool.query('SELECT file_path FROM catalog.document_files WHERE id = $1', [req.params.fileId]);
  if (rows.length > 0) {
    try { fs.unlinkSync(rows[0].file_path); } catch (_) {}
  }
  await pool.query('DELETE FROM catalog.document_files WHERE id = $1', [req.params.fileId]);
  res.json({ ok: true });
});

app.get('/api/document-file/:fileId', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT file_path, original_name, mime_type FROM catalog.document_files WHERE id = $1', [req.params.fileId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const filePath = rows[0].file_path;
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });
  res.setHeader('Content-Type', rows[0].mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${rows[0].original_name}"`);
  fs.createReadStream(filePath).pipe(res);
});

// --- Document junction endpoints ---
app.get('/api/documents/:id/photos', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dp.id, dp.photo_id, f.filename, f.original_path FROM catalog.document_photos dp
     JOIN catalog.files f ON f.id = dp.photo_id WHERE dp.document_id = $1 ORDER BY f.filename`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/documents/:id/photos', async (req, res) => {
  const { photo_id } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.document_photos (document_id, photo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
    [req.params.id, photo_id]
  );
  res.json(rows[0] || { ok: true });
});

app.delete('/api/document-photos/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.document_photos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/documents/:id/people', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dp.id, dp.person_id, pa.alias AS name FROM catalog.document_people dp
     JOIN catalog.person_aliases pa ON pa.person_id = dp.person_id AND pa.is_primary = true
     WHERE dp.document_id = $1 ORDER BY pa.alias`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/documents/:id/people', async (req, res) => {
  const { person_id } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.document_people (document_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
    [req.params.id, person_id]
  );
  res.json(rows[0] || { ok: true });
});

app.delete('/api/document-people/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.document_people WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/documents/:id/places', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dp.id, dp.place_id, p.name FROM catalog.document_places dp
     JOIN catalog.places p ON p.id = dp.place_id WHERE dp.document_id = $1 ORDER BY p.name`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/documents/:id/places', async (req, res) => {
  const { place_id } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.document_places (document_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
    [req.params.id, place_id]
  );
  res.json(rows[0] || { ok: true });
});

app.delete('/api/document-places/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.document_places WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/documents/:id/things', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dt.id, dt.thing_id, t.name FROM catalog.document_things dt
     JOIN catalog.things t ON t.id = dt.thing_id WHERE dt.document_id = $1 ORDER BY t.name`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/documents/:id/things', async (req, res) => {
  const { thing_id } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.document_things (document_id, thing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
    [req.params.id, thing_id]
  );
  res.json(rows[0] || { ok: true });
});

app.delete('/api/document-things/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.document_things WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// --- Reverse: documents for a photo ---
app.get('/api/photo/:id/documents', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dp.id, dp.document_id, d.title FROM catalog.document_photos dp
     JOIN catalog.documents d ON d.id = dp.document_id WHERE dp.photo_id = $1 ORDER BY d.title`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/photo/:id/documents', async (req, res) => {
  const { document_id } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalog.document_photos (document_id, photo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
    [document_id, req.params.id]
  );
  res.json(rows[0] || { ok: true });
});

app.delete('/api/photo-documents/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog.document_photos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// --- Face identification ---
app.post('/api/photo/:id/identify', async (req, res) => {
  const { x, y, w, h } = req.body;
  if (x == null || y == null || w == null || h == null) {
    return res.status(400).json({ error: 'x, y, w, h are required' });
  }
  const { rows } = await pool.query(
    `SELECT f.original_path, f.width, f.height, a.root_path
     FROM catalog.files f JOIN catalog.accounts a ON a.id = f.account_id
     WHERE f.id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const { width, height } = rows[0];
  const diskPath = resolvePath(rows[0].original_path, rows[0].root_path);

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

// --- Accounts ---
app.get('/api/accounts', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, root_path, created_at FROM catalog.accounts ORDER BY id');
  res.json(rows);
});

app.post('/api/accounts', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const rootPath = req.body.root_path || null;
  const { rows } = await pool.query(
    'INSERT INTO catalog.accounts (name, root_path) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET root_path = COALESCE($2, catalog.accounts.root_path) RETURNING *',
    [name, rootPath]
  );
  res.json(rows[0]);
});

app.get('/api/account/current', async (req, res) => {
  try {
    const { rows: settingsRows } = await pool.query(
      "SELECT key, value FROM catalog.settings WHERE key IN ('local_account', 'local_photos_dir')"
    );
    const settings = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    if (!settings.local_account) return res.json({ configured: false });

    const { rows: acctRows } = await pool.query(
      'SELECT id, name, root_path FROM catalog.accounts WHERE name = $1', [settings.local_account]
    );
    const account = acctRows[0] || null;
    res.json({
      configured: true,
      name: settings.local_account,
      photos_dir: settings.local_photos_dir || '',
      account
    });
  } catch (err) {
    res.json({ configured: false });
  }
});

// --- Settings ---
app.get('/api/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM catalog.settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) {
    res.json({ theme: 'dark', photo_base_path: '' });
  }
});

app.put('/api/settings', async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO catalog.settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, String(value)]
    );
  }
  res.json({ ok: true });
});

// --- History & Bookmarks (local JSON files) ---
const HISTORY_FILE = path.join(__dirname, '..', '.history.json');
const BOOKMARKS_FILE = path.join(__dirname, '..', '.bookmarks.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

app.get('/api/history', (req, res) => {
  res.json(readJSON(HISTORY_FILE, []));
});

app.post('/api/history', (req, res) => {
  const { source, folder, groupId, label } = req.body;
  const history = readJSON(HISTORY_FILE, []);
  const entry = { source, folder, groupId, label, ts: new Date().toISOString() };
  // Dedupe: if top entry matches, just update ts
  if (history.length > 0) {
    const top = history[0];
    if (top.source === source && top.folder === folder && top.groupId === groupId) {
      history[0].ts = entry.ts;
      writeJSON(HISTORY_FILE, history);
      return res.json({ ok: true });
    }
  }
  history.unshift(entry);
  if (history.length > 100) history.length = 100;
  writeJSON(HISTORY_FILE, history);
  res.json({ ok: true });
});

app.get('/api/bookmarks', (req, res) => {
  res.json(readJSON(BOOKMARKS_FILE, []));
});

app.post('/api/bookmarks', (req, res) => {
  const { name, source, folder, groupId, photoId, photoFilename } = req.body;
  const bookmarks = readJSON(BOOKMARKS_FILE, []);
  const maxId = bookmarks.reduce((m, b) => Math.max(m, b.id || 0), 0);
  bookmarks.push({ id: maxId + 1, name, source, folder, groupId, photoId: photoId || null, photoFilename: photoFilename || null, ts: new Date().toISOString() });
  writeJSON(BOOKMARKS_FILE, bookmarks);
  res.json({ ok: true });
});

app.delete('/api/bookmarks/:id', (req, res) => {
  const bookmarks = readJSON(BOOKMARKS_FILE, []);
  const filtered = bookmarks.filter(b => b.id !== parseInt(req.params.id));
  writeJSON(BOOKMARKS_FILE, filtered);
  res.json({ ok: true });
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
  startWatcher(pool).catch(err => console.error('[watcher] failed to start:', err.message));
});

module.exports = app;
