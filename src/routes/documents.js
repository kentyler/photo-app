const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = function({ pool, upload, DOCS_ROOT }) {
  const router = express.Router();

  // --- Documents CRUD ---
  router.get('/api/documents', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, title, created_at, updated_at FROM catalog.documents ORDER BY updated_at DESC'
    );
    res.json(rows);
  });

  router.post('/api/documents', async (req, res) => {
    const title = (req.body.title || req.body.name || '').trim();
    if (!title) return res.status(400).json({ error: 'title required' });
    const body = req.body.body || '';
    const { rows } = await pool.query(
      'INSERT INTO catalog.documents (title, body) VALUES ($1, $2) RETURNING *',
      [title, body]
    );
    res.json(rows[0]);
  });

  router.get('/api/documents/:id', async (req, res) => {
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

  router.put('/api/documents/:id', async (req, res) => {
    const title = (req.body.title || '').trim();
    const body = req.body.body ?? '';
    const { rowCount } = await pool.query(
      'UPDATE catalog.documents SET title = $1, body = $2, updated_at = now() WHERE id = $3',
      [title, body, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  router.delete('/api/documents/:id', async (req, res) => {
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
  router.get('/api/documents/:id/files', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, filename, original_name, mime_type, file_size, sort_order FROM catalog.document_files WHERE document_id = $1 ORDER BY sort_order',
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/documents/:id/files', upload.single('file'), async (req, res) => {
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

  router.delete('/api/document-files/:fileId', async (req, res) => {
    const { rows } = await pool.query('SELECT file_path FROM catalog.document_files WHERE id = $1', [req.params.fileId]);
    if (rows.length > 0) {
      try { fs.unlinkSync(rows[0].file_path); } catch (_) {}
    }
    await pool.query('DELETE FROM catalog.document_files WHERE id = $1', [req.params.fileId]);
    res.json({ ok: true });
  });

  router.get('/api/document-file/:fileId', async (req, res) => {
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
  router.get('/api/documents/:id/photos', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT dp.id, dp.photo_id, f.filename, f.original_path FROM catalog.document_photos dp
       JOIN catalog.files f ON f.id = dp.photo_id WHERE dp.document_id = $1 ORDER BY f.filename`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/documents/:id/photos', async (req, res) => {
    const { photo_id } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO catalog.document_photos (document_id, photo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [req.params.id, photo_id]
    );
    res.json(rows[0] || { ok: true });
  });

  router.delete('/api/document-photos/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.document_photos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  router.get('/api/documents/:id/people', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT dp.id, dp.person_id, pa.alias AS name FROM catalog.document_people dp
       JOIN catalog.person_aliases pa ON pa.person_id = dp.person_id AND pa.is_primary = true
       WHERE dp.document_id = $1 ORDER BY pa.alias`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/documents/:id/people', async (req, res) => {
    const { person_id } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO catalog.document_people (document_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [req.params.id, person_id]
    );
    res.json(rows[0] || { ok: true });
  });

  router.delete('/api/document-people/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.document_people WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  router.get('/api/documents/:id/places', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT dp.id, dp.place_id, p.name FROM catalog.document_places dp
       JOIN catalog.places p ON p.id = dp.place_id WHERE dp.document_id = $1 ORDER BY p.name`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/documents/:id/places', async (req, res) => {
    const { place_id } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO catalog.document_places (document_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [req.params.id, place_id]
    );
    res.json(rows[0] || { ok: true });
  });

  router.delete('/api/document-places/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.document_places WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  router.get('/api/documents/:id/things', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT dt.id, dt.thing_id, t.name FROM catalog.document_things dt
       JOIN catalog.things t ON t.id = dt.thing_id WHERE dt.document_id = $1 ORDER BY t.name`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/documents/:id/things', async (req, res) => {
    const { thing_id } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO catalog.document_things (document_id, thing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [req.params.id, thing_id]
    );
    res.json(rows[0] || { ok: true });
  });

  router.delete('/api/document-things/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.document_things WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  // --- Reverse: documents for a photo ---
  router.get('/api/photo/:id/documents', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT dp.id, dp.document_id, d.title FROM catalog.document_photos dp
       JOIN catalog.documents d ON d.id = dp.document_id WHERE dp.photo_id = $1 ORDER BY d.title`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/photo/:id/documents', async (req, res) => {
    const { document_id } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO catalog.document_photos (document_id, photo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [document_id, req.params.id]
    );
    res.json(rows[0] || { ok: true });
  });

  router.delete('/api/photo-documents/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.document_photos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  return router;
};
