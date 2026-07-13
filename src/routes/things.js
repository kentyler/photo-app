const express = require('express');

module.exports = function({ pool }) {
  const router = express.Router();

  // --- Things ---
  router.get('/api/things', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM catalog.things ORDER BY name');
    res.json(rows);
  });

  router.post('/api/things', async (req, res) => {
    const { name, notes } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO catalog.things (name, notes) VALUES ($1,$2) RETURNING *',
      [name, notes || null]
    );
    res.json(rows[0]);
  });

  router.delete('/api/things/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.things WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });

  router.get('/api/photo/:id/things', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT pt.*, t.name, t.notes FROM catalog.photo_things pt
       JOIN catalog.things t ON t.id = pt.thing_id
       WHERE pt.photo_id = $1 ORDER BY t.name`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/photo/:id/things', async (req, res) => {
    const { thing_id } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO catalog.photo_things (photo_id, thing_id) VALUES ($1,$2) RETURNING *',
      [req.params.id, thing_id]
    );
    res.json(rows[0]);
  });

  router.delete('/api/photo-things/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.photo_things WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });

  return router;
};
