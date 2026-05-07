const { test } = require('node:test');
const assert = require('node:assert');
const { createDetector } = require('../src/face-detect-contract');
const faceapiBackend = require('../src/face-detect-faceapi');

// Photo likely containing people (burst photo from family gathering)
const PEOPLE_PHOTO = 'D:/Bridget_Geoff_Toni/20181122_085010_001.jpg';
// Small old photo that may or may not have faces
const SMALL_PHOTO = 'D:/Bridget_Geoff_Toni/IMG_9280.jpeg';

test('detects at least one face in a people photo', async () => {
  const detector = createDetector(faceapiBackend);
  const faces = await detector.detectFaces(PEOPLE_PHOTO);
  assert.ok(faces.length >= 1, `Expected at least 1 face, got ${faces.length}`);
});

test('each face has numeric box coordinates', async () => {
  const detector = createDetector(faceapiBackend);
  const faces = await detector.detectFaces(PEOPLE_PHOTO);
  for (const face of faces) {
    assert.strictEqual(typeof face.box.x, 'number');
    assert.strictEqual(typeof face.box.y, 'number');
    assert.strictEqual(typeof face.box.w, 'number');
    assert.strictEqual(typeof face.box.h, 'number');
  }
});

test('each face has 128-dim descriptor', async () => {
  const detector = createDetector(faceapiBackend);
  const faces = await detector.detectFaces(PEOPLE_PHOTO);
  for (const face of faces) {
    assert.strictEqual(face.descriptor.length, 128);
    assert.ok(face.descriptor[0] !== 0 || face.descriptor[1] !== 0, 'Descriptor should not be all zeros');
  }
});

test('returns array for photo with uncertain face content', async () => {
  const detector = createDetector(faceapiBackend);
  const faces = await detector.detectFaces(SMALL_PHOTO);
  assert.ok(Array.isArray(faces), 'Should return an array');
});
