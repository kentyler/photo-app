const { test } = require('node:test');
const assert = require('node:assert');
const { createDetector } = require('../src/face-detect-contract');
const hybridBackend = require('../src/face-detect-hybrid');
const { euclidean } = require('../src/face-cluster');

const PEOPLE_PHOTO = 'D:/Bridget_Geoff_Toni/20181122_085010_001.jpg';
const CONNIE_TONI = 'D:/Bridget_Geoff_Toni/connie_toni.jpg';

test('detects faces and produces valid contract output', async () => {
  const detector = createDetector(hybridBackend);
  const faces = await detector.detectFaces(PEOPLE_PHOTO);
  assert.ok(faces.length >= 1, `Expected at least 1 face, got ${faces.length}`);
  for (const face of faces) {
    assert.strictEqual(typeof face.box.x, 'number');
    assert.strictEqual(face.descriptor.length, 128);
  }
});

test('detects 2+ faces in connie_toni.jpg', async () => {
  const detector = createDetector(hybridBackend);
  const faces = await detector.detectFaces(CONNIE_TONI);
  assert.ok(faces.length >= 2, `Expected 2+ faces, got ${faces.length}`);
});

test('two people in connie_toni.jpg have distinct dlib descriptors', async () => {
  const detector = createDetector(hybridBackend);
  const faces = await detector.detectFaces(CONNIE_TONI);
  assert.ok(faces.length >= 2);

  const dist = euclidean(faces[0].descriptor, faces[1].descriptor);
  // dlib's recommended threshold is 0.6 but real-world can be slightly below.
  // Key: descriptors must be meaningfully different (not near-zero like face-api.js was producing)
  assert.ok(dist > 0.5,
    `Two different people should have distance > 0.5, got ${dist.toFixed(3)}`);
});
