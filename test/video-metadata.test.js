const { test } = require('node:test');
const assert = require('node:assert');
const { extractVideoMeta } = require('../src/video-metadata');

const VIDEO_FILE = 'D:/Bridget_Geoff_Toni/20191128_150821.mp4'; // ~5MB, short
const PHOTO_FILE = 'D:/Bridget_Geoff_Toni/20181122_085010_001.jpg';

test('extracts width and height from MP4', async () => {
  const meta = await extractVideoMeta(VIDEO_FILE);
  assert.ok(meta.width > 0, `Expected positive width, got ${meta.width}`);
  assert.ok(meta.height > 0, `Expected positive height, got ${meta.height}`);
});

test('extracts duration from MP4', async () => {
  const meta = await extractVideoMeta(VIDEO_FILE);
  assert.ok(meta.duration_secs > 0, `Expected positive duration, got ${meta.duration_secs}`);
});

test('returns all nulls for a photo file', async () => {
  const meta = await extractVideoMeta(PHOTO_FILE);
  assert.strictEqual(meta.width, null);
  assert.strictEqual(meta.height, null);
  assert.strictEqual(meta.duration_secs, null);
});
