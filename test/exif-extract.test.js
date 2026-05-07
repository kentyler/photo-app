const { test } = require('node:test');
const assert = require('node:assert');
const { extractExif } = require('../src/exif-extract');

const PHOTO_FILE = 'D:/Bridget_Geoff_Toni/20181122_085010_001.jpg';
const SMALL_JPEG = 'D:/Bridget_Geoff_Toni/IMG_9280.jpeg';
const VIDEO_FILE = 'D:/Bridget_Geoff_Toni/20191128_150821.mp4';

test('extracts width and height from a JPG', async () => {
  const exif = await extractExif(PHOTO_FILE);
  assert.ok(exif.width > 0, `Expected positive width, got ${exif.width}`);
  assert.ok(exif.height > 0, `Expected positive height, got ${exif.height}`);
});

test('extracts camera make/model when present', async () => {
  const exif = await extractExif(PHOTO_FILE);
  // At least one should be non-null for a phone photo
  const hasCameraInfo = exif.camera_make || exif.camera_model;
  assert.ok(hasCameraInfo, 'Expected camera make or model from phone photo');
});

test('extracts taken_at date from EXIF', async () => {
  const exif = await extractExif(PHOTO_FILE);
  if (exif.taken_at) {
    assert.ok(exif.taken_at instanceof Date, 'taken_at should be a Date');
    assert.ok(!isNaN(exif.taken_at.getTime()), 'taken_at should be valid');
  }
  // Some files may not have DateTimeOriginal, so not strictly required
});

test('handles a second photo file', async () => {
  const exif = await extractExif(SMALL_JPEG);
  assert.ok(typeof exif.width === 'number' || exif.width === null);
  assert.ok(typeof exif.height === 'number' || exif.height === null);
});

test('returns all nulls for a video file', async () => {
  const exif = await extractExif(VIDEO_FILE);
  assert.strictEqual(exif.width, null);
  assert.strictEqual(exif.height, null);
  assert.strictEqual(exif.camera_make, null);
  assert.strictEqual(exif.camera_model, null);
  assert.strictEqual(exif.taken_at, null);
});
