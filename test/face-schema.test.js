const { test, after } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');

const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });

after(async () => {
  // Clean up test data
  await pool.query("DELETE FROM catalog.faces WHERE descriptor = '\\xDEAD'");
  await pool.query("DELETE FROM catalog.persons WHERE name = '__test_person__'");
  await pool.end();
});

test('catalog.persons table exists with correct columns', async () => {
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'persons'
    ORDER BY ordinal_position
  `);
  const cols = rows.map(r => r.column_name);
  assert.ok(cols.includes('id'));
  assert.ok(cols.includes('name'));
});

test('catalog.faces table exists with correct columns', async () => {
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'faces'
    ORDER BY ordinal_position
  `);
  const cols = rows.map(r => r.column_name);
  assert.ok(cols.includes('id'));
  assert.ok(cols.includes('file_id'));
  assert.ok(cols.includes('person_id'));
  assert.ok(cols.includes('box_x'));
  assert.ok(cols.includes('box_y'));
  assert.ok(cols.includes('box_w'));
  assert.ok(cols.includes('box_h'));
  assert.ok(cols.includes('descriptor'));
});

test('can insert a face referencing a file and optionally a person', async () => {
  // Get a real file_id
  const { rows: files } = await pool.query('SELECT id FROM catalog.files LIMIT 1');
  assert.ok(files.length > 0, 'Need at least one file in catalog');

  // Insert without person
  const { rows: inserted } = await pool.query(
    `INSERT INTO catalog.faces (file_id, box_x, box_y, box_w, box_h, descriptor)
     VALUES ($1, 10, 20, 100, 120, $2) RETURNING id`,
    [files[0].id, Buffer.from([0xDE, 0xAD])]
  );
  assert.ok(inserted[0].id);

  // Insert with person
  const { rows: persons } = await pool.query(
    "INSERT INTO catalog.persons (name) VALUES ('__test_person__') RETURNING id"
  );
  const { rows: inserted2 } = await pool.query(
    `INSERT INTO catalog.faces (file_id, person_id, box_x, box_y, box_w, box_h, descriptor)
     VALUES ($1, $2, 30, 40, 80, 90, $3) RETURNING id`,
    [files[0].id, persons[0].id, Buffer.from([0xDE, 0xAD])]
  );
  assert.ok(inserted2[0].id);
});
