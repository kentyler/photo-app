const express = require('express');

module.exports = function({ pool }) {
  const router = express.Router();

  // --- Accounts ---
  router.get('/api/accounts', async (req, res) => {
    const { rows } = await pool.query('SELECT id, name, root_path, created_at FROM catalog.accounts ORDER BY id');
    res.json(rows);
  });

  router.post('/api/accounts', async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const rootPath = req.body.root_path || null;
    const { rows } = await pool.query(
      'INSERT INTO catalog.accounts (name, root_path) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET root_path = COALESCE($2, catalog.accounts.root_path) RETURNING *',
      [name, rootPath]
    );
    res.json(rows[0]);
  });

  router.get('/api/account/current', async (req, res) => {
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
  router.get('/api/settings', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT key, value FROM catalog.settings');
      const settings = {};
      rows.forEach(r => { settings[r.key] = r.value; });
      res.json(settings);
    } catch (err) {
      res.json({ theme: 'dark', photo_base_path: '' });
    }
  });

  router.put('/api/settings', async (req, res) => {
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

  // --- Roots (multi-root folder sources) ---
  router.get('/api/roots', async (req, res) => {
    const { rows } = await pool.query('SELECT id, label, path FROM catalog.roots ORDER BY label');
    res.json(rows);
  });

  router.post('/api/roots', async (req, res) => {
    const { label, path: rootPath } = req.body;
    if (!label || !rootPath) return res.status(400).json({ error: 'label and path required' });
    const { rows } = await pool.query(
      'INSERT INTO catalog.roots (label, path) VALUES ($1, $2) RETURNING id, label, path',
      [label, rootPath]
    );
    res.json(rows[0]);
  });

  router.delete('/api/roots/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.roots WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  return router;
};
