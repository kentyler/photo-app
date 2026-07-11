const sharp = require('sharp');
const { detectFaces } = require('./face-detect-faceapi');
const { euclidean, bufferToDescriptor } = require('./face-cluster');
const { descriptorToBuffer } = require('./face-scan');

/**
 * Crop a fractional rectangle from an image, with 20% padding for better face detection.
 * Returns a PNG Buffer.
 */
async function cropRegion(imagePath, imgWidth, imgHeight, fracRect) {
  const pad = 0.2;
  let left = Math.round((fracRect.x - pad * fracRect.w) * imgWidth);
  let top = Math.round((fracRect.y - pad * fracRect.h) * imgHeight);
  let width = Math.round(fracRect.w * (1 + 2 * pad) * imgWidth);
  let height = Math.round(fracRect.h * (1 + 2 * pad) * imgHeight);

  // Clamp to image bounds
  left = Math.max(0, left);
  top = Math.max(0, top);
  width = Math.min(width, imgWidth - left);
  height = Math.min(height, imgHeight - top);

  return sharp(imagePath)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
}

/**
 * Run face-api.js on a cropped image buffer, return the 128-dim descriptor or null.
 */
async function descriptorFromCrop(cropBuffer) {
  const faces = await detectFaces(cropBuffer);
  if (faces.length === 0) return null;
  // Return the largest detected face's descriptor
  let best = faces[0];
  for (let i = 1; i < faces.length; i++) {
    if (faces[i].box.w * faces[i].box.h > best.box.w * best.box.h) {
      best = faces[i];
    }
  }
  return best.descriptor;
}

/**
 * Compare a query descriptor against all reference descriptors in photo_people.
 * Groups by person, returns best distance per person sorted ascending.
 */
async function findMatches(pool, queryDescriptor) {
  const { rows } = await pool.query(
    `SELECT pp.person_id, pa.alias AS name, pp.descriptor
     FROM catalog.photo_people pp
     JOIN catalog.person_aliases pa ON pa.person_id = pp.person_id AND pa.is_primary = true
     WHERE pp.descriptor IS NOT NULL`
  );

  // Group by person, track best (min) distance and count
  const personMap = new Map();
  for (const row of rows) {
    const ref = bufferToDescriptor(row.descriptor);
    const dist = euclidean(queryDescriptor, ref);
    const pid = row.person_id;
    if (!personMap.has(pid)) {
      personMap.set(pid, { person_id: pid, name: row.name, distance: dist, photo_count: 0 });
    }
    const entry = personMap.get(pid);
    entry.photo_count++;
    if (dist < entry.distance) entry.distance = dist;
  }

  return Array.from(personMap.values())
    .sort((a, b) => a.distance - b.distance);
}

module.exports = { cropRegion, descriptorFromCrop, findMatches, descriptorToBuffer };
