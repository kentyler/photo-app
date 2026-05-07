const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { scanFolder } = require('../src/scan-orchestrator');

const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });
const TRAIL_FOLDER = 'D:/Bridget_Geoff_Toni';

before(async () => {
  await pool.query('DELETE FROM catalog.file_tags');
  await pool.query('DELETE FROM catalog.files');
});

after(async () => {
  await pool.end();
});

test('inserts 109+ rows from trail folder', async () => {
  const result = await scanFolder(pool, TRAIL_FOLDER, 'D:/');
  assert.ok(result.inserted >= 109, `Expected >= 109 inserted, got ${result.inserted}`);
  assert.ok(result.skipped >= 0);
  assert.ok(result.errors >= 0);
});

test('every row has required non-null fields', async () => {
  const { rows } = await pool.query(
    'SELECT * FROM catalog.files WHERE original_path LIKE $1',
    ['D:/Bridget_Geoff_Toni%']
  );
  for (const row of rows) {
    assert.ok(row.original_path, `missing original_path on id ${row.id}`);
    assert.ok(row.filename, `missing filename on id ${row.id}`);
    assert.ok(row.extension, `missing extension on id ${row.id}`);
    assert.ok(Number(row.size_bytes) > 0, `invalid size_bytes on id ${row.id}`);
    assert.ok(row.media_type, `missing media_type on id ${row.id}`);
    assert.ok(row.file_hash, `missing file_hash on id ${row.id}`);
  }
});

test('parseable filenames have non-null taken_at', async () => {
  const { rows } = await pool.query(
    "SELECT * FROM catalog.files WHERE filename ~ '^[0-9]{8}_[0-9]{6}'"
  );
  assert.ok(rows.length > 0, 'Should have date-named files');
  for (const row of rows) {
    assert.ok(row.taken_at, `taken_at null for parseable filename: ${row.filename}`);
  }
});
