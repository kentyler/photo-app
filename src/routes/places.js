const express = require('express');

module.exports = function({ pool }) {
  const router = express.Router();

  // --- Places ---
  router.get('/api/places', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM catalog.places ORDER BY name');
    res.json(rows);
  });

  router.post('/api/places', async (req, res) => {
    const { name, notes } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO catalog.places (name, notes) VALUES ($1,$2) RETURNING *',
      [name, notes || null]
    );
    res.json(rows[0]);
  });

  router.delete('/api/places/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.places WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });

  router.get('/api/photo/:id/places', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT pp.*, p.name, p.notes FROM catalog.photo_places pp
       JOIN catalog.places p ON p.id = pp.place_id
       WHERE pp.photo_id = $1 ORDER BY p.name`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/photo/:id/places', async (req, res) => {
    const { place_id } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO catalog.photo_places (photo_id, place_id) VALUES ($1,$2) RETURNING *',
      [req.params.id, place_id]
    );
    res.json(rows[0]);
  });

  router.delete('/api/photo-places/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.photo_places WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });

  return router;
};
