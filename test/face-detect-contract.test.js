const { test } = require('node:test');
const assert = require('node:assert');
const { createDetector, validateResult } = require('../src/face-detect-contract');

test('mock backend can be passed to factory', () => {
  const mockBackend = {
    async detectFaces(_path) {
      return [{
        box: { x: 10, y: 20, w: 100, h: 120 },
        descriptor: new Float64Array(128).fill(0.5),
      }];
    }
  };
  const detector = createDetector(mockBackend);
  assert.ok(typeof detector.detectFaces === 'function');
});

test('factory result returns correct shape from mock', async () => {
  const mockBackend = {
    async detectFaces(_path) {
      return [{
        box: { x: 10, y: 20, w: 100, h: 120 },
        descriptor: new Float64Array(128).fill(0.5),
      }];
    }
  };
  const detector = createDetector(mockBackend);
  const faces = await detector.detectFaces('fake/path.jpg');
  assert.strictEqual(faces.length, 1);
  assert.strictEqual(faces[0].box.x, 10);
  assert.strictEqual(faces[0].descriptor.length, 128);
});

test('validateResult rejects bad shape — missing box', () => {
  const bad = [{ descriptor: new Float64Array(128) }];
  assert.throws(() => validateResult(bad));
});

test('validateResult rejects bad shape — wrong descriptor length', () => {
  const bad = [{ box: { x: 0, y: 0, w: 10, h: 10 }, descriptor: new Float64Array(64) }];
  assert.throws(() => validateResult(bad));
});

test('validateResult accepts empty array', () => {
  assert.doesNotThrow(() => validateResult([]));
});

test('validateResult accepts correct shape', () => {
  const good = [{
    box: { x: 1, y: 2, w: 50, h: 60 },
    descriptor: new Float64Array(128).fill(0.1),
  }];
  assert.doesNotThrow(() => validateResult(good));
});
