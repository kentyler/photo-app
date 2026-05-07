const { test } = require('node:test');
const assert = require('node:assert');
const { parseFilenameDate } = require('../src/parse-filename-date');

test('parses Android YYYYMMDD_HHMMSS format', () => {
  const d = parseFilenameDate('20181122_085010_001.jpg');
  assert.strictEqual(d.getFullYear(), 2018);
  assert.strictEqual(d.getMonth(), 10); // November = 10
  assert.strictEqual(d.getDate(), 22);
  assert.strictEqual(d.getHours(), 8);
  assert.strictEqual(d.getMinutes(), 50);
  assert.strictEqual(d.getSeconds(), 10);
});

test('parses filename without suffix', () => {
  const d = parseFilenameDate('20191128_111349.jpg');
  assert.strictEqual(d.getFullYear(), 2019);
  assert.strictEqual(d.getMonth(), 10);
  assert.strictEqual(d.getDate(), 28);
});

test('parses filename with (0) duplicate marker', () => {
  const d = parseFilenameDate('20191128_111405(0).jpg');
  assert.ok(d !== null, 'Should parse despite (0) suffix');
  assert.strictEqual(d.getFullYear(), 2019);
});

test('returns null for non-date filenames', () => {
  assert.strictEqual(parseFilenameDate('connie_toni.jpg'), null);
  assert.strictEqual(parseFilenameDate('IMG_9280.jpeg'), null);
});
