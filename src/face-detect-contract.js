/**
 * Face detection contract.
 *
 * Any backend must implement:
 *   async detectFaces(imagePath) → Array<{ box: {x,y,w,h}, descriptor: Float64Array(128) }>
 *
 * Swapping backends: createDetector(newBackend) — callers never change.
 */

function validateResult(faces) {
  if (!Array.isArray(faces)) throw new Error('detectFaces must return an array');
  for (const face of faces) {
    if (!face.box || typeof face.box.x !== 'number' || typeof face.box.y !== 'number' ||
        typeof face.box.w !== 'number' || typeof face.box.h !== 'number') {
      throw new Error('Each face must have box: {x, y, w, h} as numbers');
    }
    if (!(face.descriptor instanceof Float64Array) && !(face.descriptor instanceof Float32Array)) {
      throw new Error('Each face must have descriptor as Float64Array or Float32Array');
    }
    if (face.descriptor.length !== 128) {
      throw new Error(`Descriptor must be 128-dimensional, got ${face.descriptor.length}`);
    }
  }
}

function createDetector(backend) {
  return {
    async detectFaces(imagePath) {
      const result = await backend.detectFaces(imagePath);
      validateResult(result);
      return result;
    }
  };
}

module.exports = { createDetector, validateResult };
