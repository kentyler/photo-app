const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileHash } = require('../src/file-hash');

const TEST_FILE = path.join(__dirname, '_test_hashfile.tmp');

test('setup: create test file', () => {
  fs.writeFileSync(TEST_FILE, 'hello photo-app');
});

test('produces correct SHA-256 for known content', async () => {
  const expected = crypto.createHash('sha256').update('hello photo-app').digest('hex');
  const result = await fileHash(TEST_FILE);
  assert.strictEqual(result, expected);
});

test('produces consistent results on repeated calls', async () => {
  const a = await fileHash(TEST_FILE);
  const b = await fileHash(TEST_FILE);
  assert.strictEqual(a, b);
});

test('hashes a real media file without error', async () => {
  const realFile = 'D:/Bridget_Geoff_Toni/IMG_9280.jpeg'; // 32KB, small
  const hash = await fileHash(realFile);
  assert.ok(hash && hash.length === 64, 'SHA-256 should be 64 hex chars');
});

test('cleanup', () => {
  fs.unlinkSync(TEST_FILE);
});
