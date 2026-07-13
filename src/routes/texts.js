const express = require('express');

module.exports = function({ pool }) {
  const router = express.Router();

  // --- API: photo texts ---
  router.get('/api/photo/:id/texts', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, file_id, body, sort_order, created_at
       FROM catalog.photo_texts WHERE file_id = $1 ORDER BY sort_order`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/photo/:id/texts', async (req, res) => {
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

  router.put('/api/text/:textId', async (req, res) => {
    const body = req.body.body ?? '';
    const { rowCount } = await pool.query(
      'UPDATE catalog.photo_texts SET body = $1 WHERE id = $2',
      [body, req.params.textId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  router.delete('/api/text/:textId', async (req, res) => {
    const { rowCount } = await pool.query(
      'DELETE FROM catalog.photo_texts WHERE id = $1',
      [req.params.textId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  return router;
};
