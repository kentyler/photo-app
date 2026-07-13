const express = require('express');

module.exports = function({ pool }) {
  const router = express.Router();

  // --- API: tags ---
  router.get('/api/tags', async (req, res) => {
    const { rows } = await pool.query('SELECT id, name FROM catalog.tags ORDER BY name');
    res.json(rows);
  });

  router.post('/api/tags', async (req, res) => {
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

  router.get('/api/photo/:id/tags', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.name FROM catalog.tags t
       JOIN catalog.file_tags ft ON ft.tag_id = t.id
       WHERE ft.file_id = $1 ORDER BY t.name`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/photo/:id/tags', async (req, res) => {
    const tagId = req.body.tag_id;
    if (!tagId) return res.status(400).json({ error: 'tag_id required' });
    await pool.query(
      'INSERT INTO catalog.file_tags (file_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, tagId]
    );
    res.json({ ok: true });
  });

  router.delete('/api/photo/:id/tags/:tagId', async (req, res) => {
    await pool.query(
      'DELETE FROM catalog.file_tags WHERE file_id = $1 AND tag_id = $2',
      [req.params.id, req.params.tagId]
    );
    res.json({ ok: true });
  });

  return router;
};
