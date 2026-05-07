const { test } = require('node:test');
const assert = require('node:assert');
const { createDetector } = require('../src/face-detect-contract');
const dlibBackend = require('../src/face-detect-dlib');

const PEOPLE_PHOTO = 'D:/Bridget_Geoff_Toni/20181122_085010_001.jpg';

test('detects at least one face in a people photo', async () => {
  const detector = createDetector(dlibBackend);
  const faces = await detector.detectFaces(PEOPLE_PHOTO);
  assert.ok(faces.length >= 1, `Expected at least 1 face, got ${faces.length}`);
});

test('each face has numeric box and 128-dim descriptor', async () => {
  const detector = createDetector(dlibBackend);
  const faces = await detector.detectFaces(PEOPLE_PHOTO);
  assert.ok(faces.length >= 1);
  for (const face of faces) {
    assert.strictEqual(typeof face.box.x, 'number');
    assert.strictEqual(typeof face.box.y, 'number');
    assert.strictEqual(typeof face.box.w, 'number');
    assert.strictEqual(typeof face.box.h, 'number');
    assert.strictEqual(face.descriptor.length, 128);
    assert.ok(face.descriptor[0] !== 0 || face.descriptor[1] !== 0, 'Descriptor should not be all zeros');
  }
});

test('conforms to contract — passes validation', async () => {
  const detector = createDetector(dlibBackend);
  // Should not throw — contract validation runs inside createDetector wrapper
  const faces = await detector.detectFaces(PEOPLE_PHOTO);
  assert.ok(Array.isArray(faces));
});
