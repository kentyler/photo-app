const express = require('express');

module.exports = function({ pool }) {
  const router = express.Router();

  router.get('/api/groups', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.created_at, COUNT(gf.file_id)::int AS member_count
       FROM catalog.groups g
       LEFT JOIN catalog.group_files gf ON gf.group_id = g.id
       GROUP BY g.id ORDER BY g.name`
    );
    res.json(rows);
  });

  router.post('/api/groups', async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await pool.query(
      'INSERT INTO catalog.groups (name) VALUES ($1) RETURNING id, name, created_at',
      [name]
    );
    res.json(rows[0]);
  });

  router.put('/api/groups/:id', async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rowCount } = await pool.query(
      'UPDATE catalog.groups SET name = $1 WHERE id = $2',
      [name, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  router.delete('/api/groups/:id', async (req, res) => {
    const { rowCount } = await pool.query(
      'DELETE FROM catalog.groups WHERE id = $1',
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  router.get('/api/groups/:id/photos', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT file_id FROM catalog.group_files WHERE group_id = $1',
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/groups/:id/photos', async (req, res) => {
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

  router.delete('/api/groups/:id/photos/:fileId', async (req, res) => {
    await pool.query(
      'DELETE FROM catalog.group_files WHERE group_id = $1 AND file_id = $2',
      [req.params.id, req.params.fileId]
    );
    res.json({ ok: true });
  });

  return router;
};
