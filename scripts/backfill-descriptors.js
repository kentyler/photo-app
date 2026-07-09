/**
 * Backfill face descriptors for existing tagged faces in photo_people.
 * Computes a 128-dim face-api.js descriptor from each tagged region.
 */
const { Pool } = require('pg');
const { cropRegion, descriptorFromCrop } = require('../src/face-identify');
const { descriptorToBuffer } = require('../src/face-scan');

const pool = new Pool({
  host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp'
});

async function backfill() {
  const { rows } = await pool.query(`
    SELECT pp.id, pp.photo_id, pp.x, pp.y, pp.w, pp.h,
           f.original_path, f.width, f.height
    FROM catalog.photo_people pp
    JOIN catalog.files f ON f.id = pp.photo_id
    WHERE pp.descriptor IS NULL
      AND pp.x IS NOT NULL AND pp.y IS NOT NULL
      AND pp.w IS NOT NULL AND pp.h IS NOT NULL
  `);

  console.log(`Found ${rows.length} tagged faces without descriptors`);
  let computed = 0, failed = 0;

  for (const row of rows) {
    try {
      const cropBuf = await cropRegion(
        row.original_path, row.width, row.height,
        { x: row.x, y: row.y, w: row.w, h: row.h }
      );
      const descriptor = await descriptorFromCrop(cropBuf);
      if (descriptor) {
        await pool.query('UPDATE catalog.photo_people SET descriptor = $1 WHERE id = $2',
          [descriptorToBuffer(descriptor), row.id]);
        computed++;
        console.log(`  [${computed}/${rows.length}] pp.id=${row.id} - OK`);
      } else {
        failed++;
        console.log(`  pp.id=${row.id} - no face detected in crop`);
      }
    } catch (err) {
      failed++;
      console.error(`  pp.id=${row.id} - error: ${err.message}`);
    }
  }

  console.log(`\nDone: ${computed} descriptors computed, ${failed} failed`);
  await pool.end();
}

backfill().catch(err => {
  console.error(err);
  pool.end();
  process.exit(1);
});
