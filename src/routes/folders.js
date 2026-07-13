const express = require('express');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { fileHash } = require('../file-hash');
const { resolvePath } = require('../resolve-path');

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

module.exports = function({ pool }) {
  const router = express.Router();

  // --- API: list folders ---
  router.get('/api/folders', async (req, res) => {
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
  router.get('/api/folder-tree', async (req, res) => {
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
  router.post('/api/rotate', async (req, res) => {
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
  router.post('/api/hide', async (req, res) => {
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
  router.get('/api/file-size', async (req, res) => {
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

  const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'heic']);

  router.get('/api/disk-folders', async (req, res) => {
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

  router.get('/api/disk-photos', async (req, res) => {
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

  router.get('/api/disk-photos/match', async (req, res) => {
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

  router.get('/api/disk-photo', (req, res) => {
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

  return router;
};
