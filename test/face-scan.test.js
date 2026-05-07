const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { createDetector } = require('../src/face-detect-contract');
const faceapiBackend = require('../src/face-detect-faceapi');
const { faceScan } = require('../src/face-scan');

const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });

after(async () => {
  await pool.end();
});

test('catalog.faces has rows with valid file_id references', async () => {
  const { rows } = await pool.query(`
    SELECT fc.id, fc.file_id, f.filename
    FROM catalog.faces fc
    JOIN catalog.files f ON f.id = fc.file_id
    LIMIT 10
  `);
  assert.ok(rows.length > 0, 'Should have face rows with valid file refs');
  for (const row of rows) {
    assert.ok(row.filename, 'Joined filename should exist');
  }
});

test('face rows have non-null descriptors and bounding boxes', async () => {
  const { rows } = await pool.query('SELECT * FROM catalog.faces LIMIT 10');
  for (const row of rows) {
    assert.ok(row.descriptor, `Missing descriptor on face ${row.id}`);
    assert.ok(row.descriptor.length > 0, `Empty descriptor on face ${row.id}`);
    assert.ok(typeof row.box_x === 'number', `Invalid box_x on face ${row.id}`);
    assert.ok(typeof row.box_w === 'number' && row.box_w > 0, `Invalid box_w on face ${row.id}`);
  }
});

test('re-running skips already-processed files', async () => {
  const detector = createDetector(faceapiBackend);
  const result = await faceScan(pool, detector);
  assert.strictEqual(result.processed, 0, 'Should skip all files on re-run');
});
