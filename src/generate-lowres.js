require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Pool } = require('pg');
const sharp = require('sharp');
const { scanFolder } = require('./scan-orchestrator');
const { fileHash } = require('./file-hash');
const { drivePrefix } = require('./source-folder');

const DEFAULT_LOWRES_ROOT = process.env.LOWRES_ROOT || path.join(os.homedir(), 'photo-app', 'lowres');
const DEFAULT_VIDEO_ROOT = process.env.VIDEO_ROOT || path.join(os.homedir(), 'photo-app', 'videos');
const MAX_DIM = 3840;
const JPEG_QUALITY = 95;

const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'heic']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi']);

function buildOutputPath(originalPath, driveRoot, outputRoot) {
  const normalized = originalPath.replace(/\\/g, '/');
  let root = driveRoot.replace(/\\/g, '/');
  if (!root.endsWith('/')) root += '/';

  const dp = drivePrefix(root);
  const relative = normalized.slice(root.length);
  const firstFolder = relative.split('/')[0];
  const rest = relative.split('/').slice(1).join('/');

  const prefix = `${dp}_${firstFolder}`;
  const baseName = rest.replace(/\.[^.]+$/, '') + '.jpg';
  return `${outputRoot}/${prefix}/${baseName}`;
}

function buildVideoOutputPath(originalPath, driveRoot, videoRoot) {
  const normalized = originalPath.replace(/\\/g, '/');
  let root = driveRoot.replace(/\\/g, '/');
  if (!root.endsWith('/')) root += '/';

  const dp = drivePrefix(root);
  const relative = normalized.slice(root.length);
  const firstFolder = relative.split('/')[0];
  const rest = relative.split('/').slice(1).join('/');

  const prefix = `${dp}_${firstFolder}`;
  return `${videoRoot}/${prefix}/${rest}`;
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
}

async function generateLowres(pool, driveRoot, folderFilter, opts = {}) {
  const LOWRES_ROOT = opts.lowresRoot || DEFAULT_LOWRES_ROOT;
  const VIDEO_ROOT = opts.videoRoot || DEFAULT_VIDEO_ROOT;
  let root = driveRoot.replace(/\\/g, '/');
  if (!root.endsWith('/')) root += '/';

  // --- Pass 1: Scan originals ---
  console.log('\n=== Pass 1: Scanning originals ===');
  if (folderFilter) {
    const folderPath = `${root}${folderFilter}`;
    console.log(`Scanning folder: ${folderPath}`);
    await scanFolder(pool, folderPath, root);
  } else {
    console.log(`Scanning drive: ${root}`);
    await scanFolder(pool, root, root);
  }

  // --- Pass 2: Generate lowres copies ---
  console.log('\n=== Pass 2: Generating lowres copies ===');

  let whereClause = `WHERE original_path LIKE $1 AND parent_id IS NULL`;
  const params = [root + '%'];

  if (folderFilter) {
    if (folderFilter.includes('/')) {
      // Nested folder: match by original_path prefix
      whereClause += ` AND original_path LIKE $2`;
      params.push(root + folderFilter + '/%');
    } else {
      whereClause += ` AND source_folder = $2`;
      params.push(folderFilter);
    }
  }

  const { rows: originals } = await pool.query(
    `SELECT id, original_path, source_folder, extension, media_type FROM catalog.files ${whereClause}`,
    params
  );

  console.log(`Found ${originals.length} originals to process`);

  const photoResults = [];
  const videoResults = [];
  let processed = 0;
  let skipped = 0;
  let errorCount = 0;
  const errorList = [];

  for (const row of originals) {
    processed++;
    const ext = row.extension.toLowerCase();

    if (PHOTO_EXTS.has(ext)) {
      const outputPath = buildOutputPath(row.original_path, root, LOWRES_ROOT);

      // Skip if already exists on disk (resumability)
      if (fs.existsSync(outputPath)) {
        skipped++;
        continue;
      }

      try {
        await ensureDir(outputPath);
        const result = await sharp(row.original_path, { limitInputPixels: false, failOn: 'none' })
          .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: JPEG_QUALITY })
          .toFile(outputPath);

        const stat = await fs.promises.stat(outputPath);
        photoResults.push({
          originalId: row.id,
          outputPath,
          width: result.width,
          height: result.height,
          sizeBytes: stat.size,
          sourceFolder: `${drivePrefix(root)}_${row.source_folder}`,
        });

        process.stderr.write(`  [${processed}/${originals.length}] ${path.basename(row.original_path)} -> ${result.width}x${result.height}\r`);
      } catch (err) {
        errorCount++;
        errorList.push({ path: row.original_path, error: err.message });
        process.stderr.write(`  [${processed}/${originals.length}] ERROR: ${path.basename(row.original_path)}: ${err.message}\n`);
      }
    } else if (VIDEO_EXTS.has(ext)) {
      const outputPath = buildVideoOutputPath(row.original_path, root, VIDEO_ROOT);

      if (fs.existsSync(outputPath)) {
        skipped++;
        continue;
      }

      try {
        await ensureDir(outputPath);
        await fs.promises.copyFile(row.original_path, outputPath);
        const stat = await fs.promises.stat(outputPath);
        videoResults.push({
          originalId: row.id,
          outputPath,
          sizeBytes: stat.size,
          sourceFolder: `${drivePrefix(root)}_${row.source_folder}`,
        });
        process.stderr.write(`  [${processed}/${originals.length}] copied video: ${path.basename(row.original_path)}\r`);
      } catch (err) {
        errorCount++;
        errorList.push({ path: row.original_path, error: err.message });
        process.stderr.write(`  [${processed}/${originals.length}] ERROR copying: ${path.basename(row.original_path)}: ${err.message}\n`);
      }
    }
  }

  console.log(`\nPass 2 complete: ${photoResults.length} photos generated, ${videoResults.length} videos copied, ${skipped} skipped, ${errorCount} errors`);

  // --- Pass 3: Record lowres files in DB (scans all expected outputs on disk) ---
  console.log('\n=== Pass 3: Recording lowres files in DB ===');

  let recorded = 0;

  for (const row of originals) {
    const ext = row.extension.toLowerCase();
    let outputPath;

    if (PHOTO_EXTS.has(ext)) {
      outputPath = buildOutputPath(row.original_path, root, LOWRES_ROOT);
    } else if (VIDEO_EXTS.has(ext)) {
      outputPath = buildVideoOutputPath(row.original_path, root, VIDEO_ROOT);
    } else {
      continue;
    }

    // Only record if file exists on disk but not yet in DB (by parent_id linkage)
    if (!fs.existsSync(outputPath)) continue;

    const alreadyRecorded = await pool.query(
      'SELECT id FROM catalog.files WHERE parent_id = $1', [row.id]
    );
    if (alreadyRecorded.rows.length > 0) continue;

    try {
      const hash = await fileHash(outputPath);
      const hashExists = await pool.query('SELECT id FROM catalog.files WHERE file_hash = $1', [hash]);
      if (hashExists.rows.length > 0) continue;

      const stat = await fs.promises.stat(outputPath);
      const sourcePrefix = `${drivePrefix(root)}_${row.source_folder}`;

      // Store path relative to LOWRES_ROOT
      const relPath = outputPath.replace(/\\/g, '/').replace(LOWRES_ROOT.replace(/\\/g, '/') + '/', '');

      if (PHOTO_EXTS.has(ext)) {
        const meta = await sharp(outputPath).metadata();
        await pool.query(
          `INSERT INTO catalog.files
             (original_path, source_folder, filename, extension, size_bytes, file_hash, media_type, width, height, parent_id, variant_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'lowres')`,
          [
            relPath,
            sourcePrefix,
            path.basename(outputPath),
            'jpg',
            stat.size,
            hash,
            'photo',
            meta.width,
            meta.height,
            row.id,
          ]
        );
      } else {
        const outExt = path.extname(outputPath).replace('.', '').toLowerCase();
        await pool.query(
          `INSERT INTO catalog.files
             (original_path, source_folder, filename, extension, size_bytes, file_hash, media_type, parent_id, variant_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'lowres')`,
          [
            relPath,
            sourcePrefix,
            path.basename(outputPath),
            outExt,
            stat.size,
            hash,
            'video',
            row.id,
          ]
        );
      }
      recorded++;
    } catch (err) {
      errorCount++;
      errorList.push({ path: outputPath, error: err.message });
    }
  }

  console.log(`Pass 3 complete: ${recorded} records inserted`);

  // --- Summary ---
  console.log('\n=== Summary ===');
  console.log(`  Originals found: ${originals.length}`);
  console.log(`  Photos generated: ${photoResults.length}`);
  console.log(`  Videos copied: ${videoResults.length}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  DB records inserted: ${recorded}`);
  console.log(`  Errors: ${errorCount}`);

  if (errorList.length > 0) {
    console.log('\nErrors:');
    for (const e of errorList) {
      console.log(`  ${e.path}: ${e.error}`);
    }
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  let driveRoot = args[0];
  let folderFilter = null;

  // Parse --folder flag
  const folderIdx = args.indexOf('--folder');
  if (folderIdx !== -1) {
    folderFilter = args[folderIdx + 1];
  }

  // Parse --dest flag (lowres destination folder)
  let lowresRoot = DEFAULT_LOWRES_ROOT;
  const destIdx = args.indexOf('--dest');
  if (destIdx !== -1) {
    lowresRoot = args[destIdx + 1].replace(/\\/g, '/');
  }

  if (!driveRoot) {
    console.error('Usage: node src/generate-lowres.js <drive-root> [--folder <name>] [--dest <lowres-root>]');
    console.error('  e.g.: node src/generate-lowres.js H:/');
    console.error('  e.g.: node src/generate-lowres.js F:/ --folder Bridget --dest D:/b_copies/lowres/KenAndConnie');
    process.exit(1);
  }

  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });

  generateLowres(pool, driveRoot, folderFilter, { lowresRoot })
    .then(() => pool.end())
    .catch(err => {
      console.error('Fatal error:', err);
      pool.end();
      process.exit(1);
    });
}

module.exports = { generateLowres };
