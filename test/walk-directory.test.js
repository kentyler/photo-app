const { test } = require('node:test');
const assert = require('node:assert');
const { walkDirectory } = require('../src/walk-directory');

const TRAIL_FOLDER = 'D:/Bridget_Geoff_Toni';

test('returns 109+ media file entries from trail folder', async () => {
  const files = [];
  for await (const entry of walkDirectory(TRAIL_FOLDER)) {
    files.push(entry);
  }
  assert.ok(files.length >= 109, `Expected >= 109 files, got ${files.length}`);
});

test('each entry has path, size_bytes, and extension', async () => {
  const files = [];
  for await (const entry of walkDirectory(TRAIL_FOLDER)) {
    files.push(entry);
    if (files.length >= 3) break;
  }
  for (const f of files) {
    assert.ok(f.path, 'missing path');
    assert.ok(typeof f.size_bytes === 'number' && f.size_bytes > 0, 'missing or invalid size_bytes');
    assert.ok(f.extension, 'missing extension');
  }
});

test('includes files from subdirectories', async () => {
  const files = [];
  for await (const entry of walkDirectory(TRAIL_FOLDER)) {
    files.push(entry);
  }
  const subDirFiles = files.filter(f => f.path.includes('Toni_at_interplay') || f.path.includes('videos for toni'));
  assert.ok(subDirFiles.length > 0, 'No files found from subdirectories');
});

test('only includes known media extensions', async () => {
  const allowed = new Set(['jpg', 'jpeg', 'png', 'mp4', 'mov', 'avi']);
  for await (const entry of walkDirectory(TRAIL_FOLDER)) {
    assert.ok(allowed.has(entry.extension), `Unexpected extension: ${entry.extension} in ${entry.path}`);
  }
});
