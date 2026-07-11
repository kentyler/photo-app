const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Pool } = require('pg');
const sharp = require('sharp');
const { fileHash } = require('./file-hash');
const { drivePrefix } = require('./source-folder');

const DEFAULT_HIRES_ROOT = process.env.HIRES_ROOT || path.join(os.homedir(), 'photo-app', 'hires');
const HIRES_MAX_DIM = 3000;  // 300 DPI at 10 inches
const HIRES_MIN_DIM = 2400;  // 300 DPI at 8 inches — shortest edge must be at least this
const JPEG_QUALITY = 95;

const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'heic']);

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

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
}

async function generateHires(pool, driveRoot, folderFilter, opts = {}) {
  const HIRES_ROOT = opts.hiresRoot || DEFAULT_HIRES_ROOT;
  let root = driveRoot.replace(/\\/g, '/');
  if (!root.endsWith('/')) root += '/';

  // Query originals (not children)
  let whereClause = `WHERE original_path LIKE $1 AND parent_id IS NULL AND media_type = 'photo'`;
  const params = [root + '%'];

  if (folderFilter) {
    if (folderFilter.includes('/')) {
      whereClause += ` AND original_path LIKE $2`;
      params.push(root + folderFilter + '/%');
    } else {
      whereClause += ` AND source_folder = $2`;
      params.push(folderFilter);
    }
  }

  if (opts.exclude && opts.exclude.length > 0) {
    for (const ex of opts.exclude) {
      params.push(ex);
      whereClause += ` AND source_folder != $${params.length}`;
    }
  }

  const { rows: originals } = await pool.query(
    `SELECT id, original_path, source_folder, extension FROM catalog.files ${whereClause}`,
    params
  );

  console.log(`Found ${originals.length} photo originals to check`);

  let generated = 0;
  let skippedExists = 0;
  let skippedTooSmall = 0;
  let errorCount = 0;
  const tooSmallList = [];
  const errorList = [];

  for (let i = 0; i < originals.length; i++) {
    const row = originals[i];
    const ext = row.extension.toLowerCase();
    if (!PHOTO_EXTS.has(ext)) continue;

    const outputPath = buildOutputPath(row.original_path, root, HIRES_ROOT);

    // Skip if already exists on disk
    if (fs.existsSync(outputPath)) {
      skippedExists++;
      continue;
    }

    try {
      // Check original dimensions
      const meta = await sharp(row.original_path, { limitInputPixels: false, failOn: 'none' }).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      const longest = Math.max(w, h);
      const shortest = Math.min(w, h);

      // Need: longest edge >= HIRES_MIN_DIM to produce a useful print
      if (longest < HIRES_MIN_DIM) {
        skippedTooSmall++;
        tooSmallList.push({ path: row.original_path, width: w, height: h });
        process.stderr.write(`  [${i + 1}/${originals.length}] TOO SMALL: ${path.basename(row.original_path)} (${w}x${h})\n`);
        continue;
      }

      await ensureDir(outputPath);
      const result = await sharp(row.original_path, { limitInputPixels: false, failOn: 'none' })
        .resize({ width: HIRES_MAX_DIM, height: HIRES_MAX_DIM, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(outputPath);

      generated++;
      process.stderr.write(`  [${i + 1}/${originals.length}] ${path.basename(row.original_path)} -> ${result.width}x${result.height}\r`);
    } catch (err) {
      errorCount++;
      errorList.push({ path: row.original_path, error: err.message });
      process.stderr.write(`  [${i + 1}/${originals.length}] ERROR: ${path.basename(row.original_path)}: ${err.message}\n`);
    }
  }

  console.log(`\nGeneration complete: ${generated} hires created, ${skippedExists} already existed, ${skippedTooSmall} too small, ${errorCount} errors`);

  // --- Record hires files in DB ---
  console.log('\n=== Recording hires files in DB ===');
  let recorded = 0;

  for (const row of originals) {
    const ext = row.extension.toLowerCase();
    if (!PHOTO_EXTS.has(ext)) continue;

    const outputPath = buildOutputPath(row.original_path, root, HIRES_ROOT);
    if (!fs.existsSync(outputPath)) continue;

    // Check if already recorded (any child with this path)
    const already = await pool.query(
      `SELECT id FROM catalog.files WHERE original_path = $1 AND parent_id = $2`,
      [outputPath.replace(/\\/g, '/'), row.id]
    );
    if (already.rows.length > 0) continue;

    try {
      const hash = await fileHash(outputPath);
      const hashExists = await pool.query('SELECT id FROM catalog.files WHERE file_hash = $1', [hash]);
      if (hashExists.rows.length > 0) continue;

      const stat = await fs.promises.stat(outputPath);
      const outMeta = await sharp(outputPath).metadata();
      const sourcePrefix = `${drivePrefix(root)}_${row.source_folder}`;

      await pool.query(
        `INSERT INTO catalog.files
           (original_path, source_folder, filename, extension, size_bytes, file_hash, media_type, width, height, parent_id, variant_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'hires')`,
        [
          outputPath.replace(/\\/g, '/'),
          sourcePrefix,
          path.basename(outputPath),
          'jpg',
          stat.size,
          hash,
          'photo',
          outMeta.width,
          outMeta.height,
          row.id,
        ]
      );
      recorded++;
    } catch (err) {
      errorCount++;
      errorList.push({ path: outputPath, error: err.message });
    }
  }

  // --- Summary ---
  console.log(`\n=== Summary ===`);
  console.log(`  Originals checked: ${originals.length}`);
  console.log(`  Hires generated: ${generated}`);
  console.log(`  Skipped (already exist): ${skippedExists}`);
  console.log(`  Skipped (too small): ${skippedTooSmall}`);
  console.log(`  DB records inserted: ${recorded}`);
  console.log(`  Errors: ${errorCount}`);

  if (tooSmallList.length > 0) {
    console.log(`\nToo small for 8x10 print (${tooSmallList.length}):`);
    for (const t of tooSmallList) {
      console.log(`  ${t.path} (${t.width}x${t.height})`);
    }
  }

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

  const folderIdx = args.indexOf('--folder');
  if (folderIdx !== -1) {
    folderFilter = args[folderIdx + 1];
  }

  let hiresRoot = DEFAULT_HIRES_ROOT;
  const destIdx = args.indexOf('--dest');
  if (destIdx !== -1) {
    hiresRoot = args[destIdx + 1].replace(/\\/g, '/');
  }

  // Parse --exclude flag (comma-separated folder names)
  let exclude = [];
  const exIdx = args.indexOf('--exclude');
  if (exIdx !== -1) {
    exclude = args[exIdx + 1].split(',');
  }

  if (!driveRoot) {
    console.error('Usage: node src/generate-hires.js <drive-root> [--folder <name>] [--dest <hires-root>] [--exclude <f1,f2,...>]');
    console.error('  e.g.: node src/generate-hires.js H:/');
    console.error('  e.g.: node src/generate-hires.js H:/ --exclude Books,Desktop,Stories');
    process.exit(1);
  }

  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });

  generateHires(pool, driveRoot, folderFilter, { hiresRoot, exclude })
    .then(() => pool.end())
    .catch(err => {
      console.error('Fatal error:', err);
      pool.end();
      process.exit(1);
    });
}

module.exports = { generateHires };
