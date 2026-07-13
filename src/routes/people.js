const express = require('express');
const { resolvePath } = require('../resolve-path');
const { cropRegion, descriptorFromCrop, findMatches, descriptorToBuffer } = require('../face-identify');

const INVERSE_TYPE = { parent: 'child', child: 'parent', father: 'child', mother: 'child', grandparent: 'grandchild', grandchild: 'grandparent', grandfather: 'grandchild', grandmother: 'grandchild', godparent: 'godchild', godfather: 'godchild', godmother: 'godchild', godchild: 'godparent', spouse: 'spouse', sibling: 'sibling', cousin: 'cousin', aunt: 'niece', uncle: 'nephew', niece: 'aunt', nephew: 'uncle', friend: 'friend', employer: 'employee', employee: 'employer', teacher: 'student', student: 'teacher', classmate: 'classmate' };

module.exports = function({ pool }) {
  const router = express.Router();

  // --- People / Genealogy ---
  router.get('/api/people', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.id, pa.alias AS name, p.birth_date, p.death_date, p.gender, p.notes
       FROM catalog.people p
       JOIN catalog.person_aliases pa ON pa.person_id = p.id AND pa.is_primary = true
       ORDER BY pa.alias`
    );
    res.json(rows);
  });

  router.post('/api/people', async (req, res) => {
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

  router.put('/api/people/:id', async (req, res) => {
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

  router.delete('/api/people/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.people WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });

  // --- Person Aliases ---
  router.get('/api/people/:id/aliases', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, alias, is_primary FROM catalog.person_aliases WHERE person_id = $1 ORDER BY is_primary DESC, alias',
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/people/:id/aliases', async (req, res) => {
    const alias = (req.body.alias || '').trim();
    if (!alias) return res.status(400).json({ error: 'alias required' });
    const { rows } = await pool.query(
      'INSERT INTO catalog.person_aliases (person_id, alias) VALUES ($1, $2) ON CONFLICT (person_id, alias) DO NOTHING RETURNING *',
      [req.params.id, alias]
    );
    if (rows.length === 0) return res.json({ ok: true, already: true });
    res.json(rows[0]);
  });

  router.put('/api/aliases/:id/primary', async (req, res) => {
    const { rows } = await pool.query('SELECT person_id FROM catalog.person_aliases WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    const personId = rows[0].person_id;
    await pool.query('UPDATE catalog.person_aliases SET is_primary = false WHERE person_id = $1', [personId]);
    await pool.query('UPDATE catalog.person_aliases SET is_primary = true WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  router.delete('/api/aliases/:id', async (req, res) => {
    const { rows } = await pool.query('SELECT is_primary FROM catalog.person_aliases WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    if (rows[0].is_primary) return res.status(400).json({ error: 'cannot delete primary alias' });
    await pool.query('DELETE FROM catalog.person_aliases WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  // --- Relationships (bidirectional storage) ---
  router.get('/api/people/:id/relationships', async (req, res) => {
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

  router.post('/api/relationships', async (req, res) => {
    const { person_id, related_id, type, start_date, end_date, basis } = req.body;
    const inverse = INVERSE_TYPE[type];
    if (!inverse) return res.status(400).json({ error: 'invalid relationship type' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO catalog.relationships (person_id, related_id, type, start_date, end_date, basis) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [person_id, related_id, type, start_date || null, end_date || null, basis || null]
      );
      await client.query(
        'INSERT INTO catalog.relationships (person_id, related_id, type, start_date, end_date, basis) VALUES ($1,$2,$3,$4,$5,$6)',
        [related_id, person_id, inverse, start_date || null, end_date || null, basis || null]
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

  router.delete('/api/relationships/:id', async (req, res) => {
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
  router.get('/api/photo/:id/people', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT pp.*, pa.alias AS name FROM catalog.photo_people pp
       JOIN catalog.person_aliases pa ON pa.person_id = pp.person_id AND pa.is_primary = true
       WHERE pp.photo_id = $1 ORDER BY pa.alias`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/api/photo/:id/people', async (req, res) => {
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

  router.put('/api/photo-people/:id', async (req, res) => {
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

  router.delete('/api/photo-people/:id', async (req, res) => {
    await pool.query('DELETE FROM catalog.photo_people WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });

  // --- Face identification ---
  router.post('/api/photo/:id/identify', async (req, res) => {
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

  return router;
};
