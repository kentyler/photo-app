/**
 * convert-tifs-to-png.js
 *
 * Converts TIF files in a given folder to PNG at optimal 8x10 print size (3000px max).
 * Updates DB records and removes the original TIFs.
 *
 * Usage: node src/convert-tifs-to-png.js <folder-path> [--dry-run]
 */

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const sharp = require('sharp');
const { fileHash } = require('./file-hash');

const args = process.argv.slice(2);
const TARGET_DIR = args.find(a => !a.startsWith('--'));
if (!TARGET_DIR) {
  console.error('Usage: node src/convert-tifs-to-png.js <folder-path> [--dry-run]');
  process.exit(1);
}
const MAX_DIM = 3000; // 300 DPI at 10 inches
const PNG_COMPRESSION = 6; // 0-9, 6 is default balance of speed/size

async function walkDir(dir) {
  const results = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      results.push(...await walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

async function main() {
  const dryRun = args.includes('--dry-run');

  console.log(`Converting TIFs to PNG in: ${TARGET_DIR}`);
  console.log(`Max dimension: ${MAX_DIM}px (8x10 at 300 DPI)`);
  console.log(`Dry run: ${dryRun}`);
  console.log();

  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });

  try {
    const allFiles = await walkDir(TARGET_DIR);
    const tifFiles = allFiles.filter(f => /\.tiff?$/i.test(f));

    console.log(`Found ${tifFiles.length} TIF files`);

    let converted = 0;
    let errors = 0;
    let savedBytes = 0;
    const errorList = [];

    for (let i = 0; i < tifFiles.length; i++) {
      const tifPath = tifFiles[i];
      const pngPath = tifPath.replace(/\.tiff?$/i, '.png');

      try {
        const tifStat = await fs.promises.stat(tifPath);

        if (!dryRun) {
          // Convert to PNG, resize to print size
          const result = await sharp(tifPath, { limitInputPixels: false, failOn: 'none' })
            .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
            .png({ compressionLevel: PNG_COMPRESSION })
            .toFile(pngPath);

          const pngStat = await fs.promises.stat(pngPath);
          const hash = await fileHash(pngPath);

          // Update DB record
          const normalizedTif = tifPath.replace(/\\/g, '/');
          const normalizedPng = pngPath.replace(/\\/g, '/');

          const { rowCount } = await pool.query(
            `UPDATE catalog.files
             SET original_path = $1,
                 filename = $2,
                 extension = 'png',
                 size_bytes = $3,
                 file_hash = $4,
                 width = $5,
                 height = $6
             WHERE original_path = $7`,
            [
              normalizedPng,
              path.basename(pngPath),
              pngStat.size,
              hash,
              result.width,
              result.height,
              normalizedTif,
            ]
          );

          // Remove original TIF
          await fs.promises.unlink(tifPath);

          const saved = tifStat.size - pngStat.size;
          savedBytes += saved;

          if ((i + 1) % 10 === 0 || i === 0) {
            process.stderr.write(`  [${i + 1}/${tifFiles.length}] ${path.basename(tifPath)} -> PNG ${result.width}x${result.height} (${(tifStat.size/1024/1024).toFixed(1)}MB -> ${(pngStat.size/1024/1024).toFixed(1)}MB, DB rows: ${rowCount})\n`);
          }
        } else {
          process.stderr.write(`  [${i + 1}/${tifFiles.length}] WOULD CONVERT: ${path.basename(tifPath)} (${(tifStat.size/1024/1024).toFixed(1)}MB)\n`);
        }

        converted++;
      } catch (err) {
        errors++;
        errorList.push({ path: tifPath, error: err.message });
        process.stderr.write(`  [${i + 1}/${tifFiles.length}] ERROR: ${path.basename(tifPath)}: ${err.message}\n`);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`  TIF files found: ${tifFiles.length}`);
    console.log(`  Converted: ${converted}`);
    console.log(`  Errors: ${errors}`);
    if (!dryRun) {
      console.log(`  Space saved: ${(savedBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
    }

    if (errorList.length > 0) {
      console.log('\nErrors:');
      for (const e of errorList) {
        console.log(`  ${e.path}: ${e.error}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
