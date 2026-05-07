const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { insertRecord } = require('../src/insert-record');

const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });

before(async () => {
  await pool.query('DELETE FROM catalog.file_tags');
  await pool.query('DELETE FROM catalog.files');
});

after(async () => {
  await pool.end();
});

test('inserts a record with correct fields', async () => {
  const record = {
    original_path: 'D:/Bridget_Geoff_Toni/20181122_085010_001.jpg',
    source_folder: 'Bridget_Geoff_Toni',
    filename: '20181122_085010_001.jpg',
    extension: 'jpg',
    size_bytes: 2842144,
    file_hash: 'abc123def456',
    media_type: 'photo',
    taken_at: new Date(2018, 10, 22, 8, 50, 10),
  };

  const id = await insertRecord(pool, record);
  assert.ok(id, 'Should return an id');

  const { rows } = await pool.query('SELECT * FROM catalog.files WHERE id = $1', [id]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].original_path, record.original_path);
  assert.strictEqual(Number(rows[0].size_bytes), record.size_bytes);
  assert.strictEqual(rows[0].media_type, 'photo');
  assert.strictEqual(rows[0].file_hash, 'abc123def456');
  assert.ok(rows[0].taken_at, 'taken_at should be set');
});

test('skips duplicate by file_hash', async () => {
  const record = {
    original_path: 'D:/Bridget_Geoff_Toni/duplicate.jpg',
    source_folder: 'Bridget_Geoff_Toni',
    filename: 'duplicate.jpg',
    extension: 'jpg',
    size_bytes: 2842144,
    file_hash: 'abc123def456', // same hash as above
    media_type: 'photo',
    taken_at: null,
  };

  const id = await insertRecord(pool, record);
  assert.strictEqual(id, null, 'Should return null for duplicate');

  const { rows } = await pool.query("SELECT COUNT(*)::int as cnt FROM catalog.files WHERE file_hash = 'abc123def456'");
  assert.strictEqual(rows[0].cnt, 1, 'Should still be only 1 row with that hash');
});
