const express = require('express');
const fs = require('fs');
const sharp = require('sharp');
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

  // --- API: list photos by folder or group ---
  router.get('/api/photos', async (req, res) => {
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
  router.get('/api/photo/:id', async (req, res) => {
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
  router.get('/api/photo/:id/caption', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT caption FROM catalog.files WHERE id = $1', [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json({ caption: rows[0].caption });
  });

  router.put('/api/photo/:id/caption', async (req, res) => {
    const caption = req.body.caption ?? '';
    const { rowCount } = await pool.query(
      'UPDATE catalog.files SET caption = $1 WHERE id = $2', [caption, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  // --- API: rating (keep/duplicate/skip) ---
  router.put('/api/photo/:id/rating', async (req, res) => {
    const rating = req.body.rating;
    const valid = ['keep', 'duplicate', 'skip', null];
    if (!valid.includes(rating)) return res.status(400).json({ error: 'invalid rating' });
    const { rowCount } = await pool.query(
      'UPDATE catalog.files SET rating = $1 WHERE id = $2', [rating, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  return router;
};

module.exports.getAccountFilter = getAccountFilter;
