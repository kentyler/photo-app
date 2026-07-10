/**
 * Tests for file operations: variants table, convert-png, resize.
 * Runs against live DB + disk. Uses a test image created with sharp.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const pool = new Pool({
  host: 'localhost',
  user: 'postgres',
  password: '7297',
  database: 'photoapp'
});

const API = 'http://localhost:3100/api';
let testFileId = null;
let testDir = null;
let testFilePath = null;
const variantsRoot = 'D:\\photo-app-variants';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

async function setup() {
  // Create a temp dir with a test JPEG
  testDir = path.join('D:\\photo-app-variants', '_test_ops');
  fs.mkdirSync(testDir, { recursive: true });

  testFilePath = path.join(testDir, 'test_photo.jpg');
  // Create a 3000x4000 test JPEG
  await sharp({ create: { width: 3000, height: 4000, channels: 3, background: { r: 100, g: 150, b: 200 } } })
    .jpeg()
    .toFile(testFilePath);

  // Insert into DB
  const stat = fs.statSync(testFilePath);
  const { rows } = await pool.query(
    `INSERT INTO catalog.files (filename, original_path, extension, media_type, source_folder, width, height, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    ['test_photo.jpg', testFilePath, 'jpg', 'photo', testDir, 3000, 4000, stat.size]
  );
  testFileId = rows[0].id;
  console.log(`Setup: created test file id=${testFileId} at ${testFilePath}`);
}

async function teardown() {
  // Clean up DB
  if (testFileId) {
    await pool.query('DELETE FROM catalog.variants WHERE source_file_id = $1', [testFileId]);
    await pool.query('DELETE FROM catalog.files WHERE id = $1', [testFileId]);
  }
  // Clean up disk
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  // Clean up variants test output
  const vtestDir = path.join(variantsRoot, '_test_ops');
  if (fs.existsSync(vtestDir)) fs.rmSync(vtestDir, { recursive: true, force: true });

  await pool.end();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

async function testVariantsTable() {
  console.log('\n--- Test: catalog.variants table ---');
  const { rows } = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'variants'
    ORDER BY ordinal_position
  `);
  const cols = rows.map(r => r.column_name);
  assert(cols.includes('id'), 'has id column');
  assert(cols.includes('source_file_id'), 'has source_file_id column');
  assert(cols.includes('variant_type'), 'has variant_type column');
  assert(cols.includes('variant_path'), 'has variant_path column');
  assert(cols.includes('width'), 'has width column');
  assert(cols.includes('height'), 'has height column');
  assert(cols.includes('created_at'), 'has created_at column');

  // Check FK constraint
  const { rows: fks } = await pool.query(`
    SELECT tc.constraint_type FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_schema = 'catalog' AND tc.table_name = 'variants'
      AND ccu.column_name = 'source_file_id' AND tc.constraint_type = 'FOREIGN KEY'
  `);
  assert(fks.length > 0, 'source_file_id has foreign key constraint');
}

async function testConvertPng() {
  console.log('\n--- Test: convert to PNG ---');
  const data = await fetchJSON(`${API}/photo/${testFileId}/convert-png`, { method: 'POST' });
  assert(data.ok === true, 'convert returns ok');
  assert(data.path.endsWith('.png'), 'variant path ends with .png');
  assert(data.width === 3000, 'PNG width matches source');
  assert(data.height === 4000, 'PNG height matches source');

  // Verify file on disk
  assert(fs.existsSync(data.path), 'PNG file exists on disk');

  // Verify DB variant row
  const { rows } = await pool.query(
    "SELECT * FROM catalog.variants WHERE source_file_id = $1 AND variant_type = 'png'",
    [testFileId]
  );
  assert(rows.length === 1, 'variant row inserted in DB');
  assert(rows[0].variant_path === data.path, 'variant_path matches');

  // Verify original unchanged
  assert(fs.existsSync(testFilePath), 'original file still exists');
}

async function testResize() {
  console.log('\n--- Test: resize (print) ---');
  const printData = await fetchJSON(`${API}/photo/${testFileId}/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'print' })
  });
  assert(printData.ok === true, 'resize print returns ok');
  assert(printData.results.length === 1, 'one print result');
  assert(printData.skipped.length === 0, 'nothing skipped for large image');
  const pr = printData.results[0];
  assert(pr.width <= 2400, 'print width <= 2400');
  assert(pr.height <= 3000, 'print height <= 3000');
  assert(fs.existsSync(pr.path), 'print variant exists on disk');

  console.log('\n--- Test: resize (screen) ---');
  const screenData = await fetchJSON(`${API}/photo/${testFileId}/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'screen' })
  });
  assert(screenData.ok === true, 'resize screen returns ok');
  assert(screenData.results.length === 1, 'one screen result');
  const sr = screenData.results[0];
  const longEdge = Math.max(sr.width, sr.height);
  assert(longEdge === 1920, 'screen long edge is 1920');
  assert(fs.existsSync(sr.path), 'screen variant exists on disk');

  console.log('\n--- Test: resize skip (small image) ---');
  // Create a small test image and file row
  const smallDir = path.join(testDir, 'small');
  fs.mkdirSync(smallDir, { recursive: true });
  const smallPath = path.join(smallDir, 'tiny.jpg');
  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 50, g: 50, b: 50 } } })
    .jpeg().toFile(smallPath);
  const smallStat = fs.statSync(smallPath);
  const { rows: sr2 } = await pool.query(
    `INSERT INTO catalog.files (filename, original_path, extension, media_type, source_folder, width, height, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    ['tiny.jpg', smallPath, 'jpg', 'photo', smallDir, 800, 600, smallStat.size]
  );
  const smallId = sr2[0].id;

  const skipData = await fetchJSON(`${API}/photo/${smallId}/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'both' })
  });
  assert(skipData.ok === true, 'resize both on small image returns ok');
  assert(skipData.skipped.length === 2, 'both print and screen skipped for small image');
  assert(skipData.results.length === 0, 'no variants created for small image');

  // Clean up small test file
  await pool.query('DELETE FROM catalog.files WHERE id = $1', [smallId]);
  fs.rmSync(smallDir, { recursive: true, force: true });
}

async function run() {
  try {
    await setup();
    await testVariantsTable();
    await testConvertPng();
    await testResize();
  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    await teardown();
  }
}

run();
