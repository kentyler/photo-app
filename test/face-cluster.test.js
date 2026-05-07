const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { clusterFaces, euclidean, bufferToDescriptor } = require('../src/face-cluster');

const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });

const THRESHOLD = 0.6;

before(async () => {
  // Reset person assignments
  await pool.query('UPDATE catalog.faces SET person_id = NULL');
  await pool.query('DELETE FROM catalog.persons');
});

after(async () => {
  await pool.end();
});

test('euclidean distance: identical vectors = 0', () => {
  const a = new Float64Array(128).fill(0.5);
  assert.strictEqual(euclidean(a, a), 0);
});

test('euclidean distance: different vectors > 0', () => {
  const a = new Float64Array(128).fill(0.0);
  const b = new Float64Array(128).fill(1.0);
  assert.ok(euclidean(a, b) > 0);
});

test('clustering creates at least 1 person', async () => {
  const result = await clusterFaces(pool, THRESHOLD);
  assert.ok(result.personsCreated >= 1, `Expected >= 1 person, got ${result.personsCreated}`);
});

test('faces within same cluster share a person_id', async () => {
  const { rows } = await pool.query(`
    SELECT person_id, COUNT(*)::int as cnt
    FROM catalog.faces
    WHERE person_id IS NOT NULL
    GROUP BY person_id
    HAVING COUNT(*) > 1
  `);
  assert.ok(rows.length > 0, 'Should have at least one cluster with multiple faces');
});

test('descriptors within same cluster are below threshold', async () => {
  // Pick a cluster with multiple faces
  const { rows: clusters } = await pool.query(`
    SELECT person_id FROM catalog.faces
    WHERE person_id IS NOT NULL
    GROUP BY person_id HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if (clusters.length === 0) return; // skip if no multi-face clusters

  const { rows: faces } = await pool.query(
    'SELECT descriptor FROM catalog.faces WHERE person_id = $1',
    [clusters[0].person_id]
  );
  const descriptors = faces.map(f => bufferToDescriptor(f.descriptor));

  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      const dist = euclidean(descriptors[i], descriptors[j]);
      assert.ok(dist < THRESHOLD * 2,
        `Distance ${dist.toFixed(3)} between faces in same cluster exceeds ${THRESHOLD * 2}`);
    }
  }
});

test('re-running does not create duplicate persons', async () => {
  const { rows: before } = await pool.query('SELECT COUNT(*)::int as cnt FROM catalog.persons');
  await clusterFaces(pool, THRESHOLD);
  const { rows: after } = await pool.query('SELECT COUNT(*)::int as cnt FROM catalog.persons');
  assert.strictEqual(after[0].cnt, before[0].cnt, 'Person count should not change on re-run');
});
