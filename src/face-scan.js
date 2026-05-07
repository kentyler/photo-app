const { Pool } = require('pg');
const { createDetector } = require('./face-detect-contract');
const faceapiBackend = require('./face-detect-faceapi');

function descriptorToBuffer(descriptor) {
  return Buffer.from(new Float64Array(descriptor).buffer);
}

async function faceScan(pool, detector) {
  // Get photos not yet scanned for faces
  const { rows: photos } = await pool.query(`
    SELECT f.id, f.original_path
    FROM catalog.files f
    WHERE f.media_type = 'photo'
      AND f.faces_scanned = FALSE
    ORDER BY f.id
  `);

  let processed = 0, facesFound = 0, errors = 0;

  for (const photo of photos) {
    processed++;
    try {
      const faces = await detector.detectFaces(photo.original_path);
      for (const face of faces) {
        await pool.query(
          `INSERT INTO catalog.faces (file_id, box_x, box_y, box_w, box_h, descriptor)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [photo.id, face.box.x, face.box.y, face.box.w, face.box.h, descriptorToBuffer(face.descriptor)]
        );
        facesFound++;
      }
      await pool.query('UPDATE catalog.files SET faces_scanned = TRUE WHERE id = $1', [photo.id]);
      if (processed % 5 === 0) {
        process.stderr.write(`  faces: ${processed}/${photos.length} photos, ${facesFound} faces found\r`);
      }
    } catch (err) {
      errors++;
      process.stderr.write(`  face error: ${photo.original_path}: ${err.message}\n`);
    }
  }

  process.stderr.write(`\n  face scan done: ${processed} photos, ${facesFound} faces, ${errors} errors\n`);
  return { processed, facesFound, errors, skipped: 0 };
}

module.exports = { faceScan, descriptorToBuffer };

// CLI entry point
if (require.main === module) {
  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });
  const detector = createDetector(faceapiBackend);
  faceScan(pool, detector).then(r => {
    console.log(JSON.stringify(r));
    pool.end();
  }).catch(err => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
}
