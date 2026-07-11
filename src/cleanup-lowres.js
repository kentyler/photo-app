/**
 * cleanup-lowres.js
 *
 * Processes files that were manually added to the lowres folder:
 * 1. Finds image files not yet in the database
 * 2. For oversized images (>MAX_DIM): resize to lowres, move original to hires
 * 3. For TIF/BMP/etc: convert to JPG in-place
 * 4. Inserts DB records for all new image files
 *
 * Non-image files (PDFs, DOCs, ZIPs, etc.) are reported but not processed.
 *
 * Usage: node src/cleanup-lowres.js [--since YYYY-MM-DD] [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Pool } = require('pg');
const sharp = require('sharp');
const { fileHash } = require('./file-hash');

const LOWRES_ROOT = process.env.LOWRES_ROOT || path.join(os.homedir(), 'photo-app', 'lowres');
const HIRES_ROOT = process.env.HIRES_ROOT || path.join(os.homedir(), 'photo-app', 'hires');
const MAX_DIM = 3840;
const JPEG_QUALITY = 95;

const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'heic', 'gif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi']);
const SKIP_EXTS = new Set(['pdf', 'doc', 'docx', 'rtf', 'acsm', 'zip', 'rar', 'lnk', 'htm', 'html', 'ini', 'xls', 'cdr', 'txt']);

// Recursively walk a directory
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

// Get the source_folder from a lowres path
// e.g. D:/B_Copies/lowres/Edwin_Tyler_and_Family/J_wartimephotos_active/beach/file.jpg
//   -> source_folder = "J_wartimephotos_active"
//   -> top-level family = "Edwin_Tyler_and_Family"
function parseSourceFolder(filePath) {
  const rel = filePath.replace(/\\/g, '/').slice(LOWRES_ROOT.length + 1); // strip root + /
  const parts = rel.split('/');
  // parts[0] = family folder (Edwin_Tyler_and_Family, etc.)
  // parts[1] = source folder (J_wartimephotos_active, helmut, etc.)
  return {
    familyFolder: parts[0] || '',
    sourceFolder: parts.length > 2 ? parts[1] : parts[0],
    relativePath: rel,
  };
}

// Build the hires path mirroring the lowres structure
function buildHiresPath(lowresPath) {
  const rel = lowresPath.replace(/\\/g, '/').slice(LOWRES_ROOT.length + 1);
  return `${HIRES_ROOT}/${rel}`;
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sinceIdx = args.indexOf('--since');
  const sinceDate = sinceIdx !== -1 ? new Date(args[sinceIdx + 1]) : new Date('2026-05-11');

  console.log(`Cleanup lowres folder: ${LOWRES_ROOT}`);
  console.log(`Since: ${sinceDate.toISOString().slice(0, 10)}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Max dimension for lowres: ${MAX_DIM}px`);
  console.log();

  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });

  try {
    // Step 1: Find all files
    console.log('=== Step 1: Scanning files ===');
    const allFiles = await walkDir(LOWRES_ROOT);

    // Filter to recently created files
    const recentFiles = [];
    for (const f of allFiles) {
      const stat = await fs.promises.stat(f);
      if (stat.birthtime >= sinceDate || stat.mtime >= sinceDate) {
        recentFiles.push({ path: f, stat });
      }
    }
    console.log(`Found ${recentFiles.length} files created/modified since ${sinceDate.toISOString().slice(0, 10)}`);

    // Categorize
    const imageFiles = [];
    const videoFiles = [];
    const skippedFiles = [];
    const unknownFiles = [];

    for (const f of recentFiles) {
      const basename = path.basename(f.path);
      // Skip macOS resource fork files (._prefix) and .DS_Store, Thumbs.db
      if (basename.startsWith('._') || basename === '.DS_Store' || basename === 'Thumbs.db' || basename === 'Picasa.ini') {
        skippedFiles.push(f);
        continue;
      }
      const ext = path.extname(f.path).replace('.', '').toLowerCase();
      if (PHOTO_EXTS.has(ext)) {
        imageFiles.push(f);
      } else if (VIDEO_EXTS.has(ext)) {
        videoFiles.push(f);
      } else if (SKIP_EXTS.has(ext)) {
        skippedFiles.push(f);
      } else {
        unknownFiles.push(f);
      }
    }

    console.log(`  Images: ${imageFiles.length}`);
    console.log(`  Videos: ${videoFiles.length}`);
    console.log(`  Non-image (skipped): ${skippedFiles.length}`);
    if (unknownFiles.length > 0) {
      console.log(`  Unknown extensions: ${unknownFiles.length}`);
      for (const f of unknownFiles) {
        console.log(`    ${f.path}`);
      }
    }

    // Step 2: Filter out files already in DB
    console.log('\n=== Step 2: Checking database for existing records ===');
    const newImages = [];
    const newVideos = [];

    for (const f of imageFiles) {
      const normalized = f.path.replace(/\\/g, '/');
      // Check by original_path match (exact path or with .jpg extension swap for TIFs)
      const { rows } = await pool.query(
        'SELECT id FROM catalog.files WHERE original_path = $1',
        [normalized]
      );
      if (rows.length === 0) {
        newImages.push(f);
      }
    }

    for (const f of videoFiles) {
      const normalized = f.path.replace(/\\/g, '/');
      const { rows } = await pool.query(
        'SELECT id FROM catalog.files WHERE original_path = $1',
        [normalized]
      );
      if (rows.length === 0) {
        newVideos.push(f);
      }
    }

    console.log(`  New images (not in DB): ${newImages.length}`);
    console.log(`  New videos (not in DB): ${newVideos.length}`);

    if (dryRun) {
      console.log('\n=== DRY RUN - no changes will be made ===');
    }

    // Step 3: Process images
    console.log('\n=== Step 3: Processing images ===');
    let converted = 0;    // TIF/BMP/PNG -> JPG
    let downsized = 0;    // oversized -> resized + moved to hires
    let alreadyOk = 0;    // already lowres JPG
    let inserted = 0;
    let errors = 0;
    const errorList = [];

    for (let i = 0; i < newImages.length; i++) {
      const f = newImages[i];
      const ext = path.extname(f.path).replace('.', '').toLowerCase();
      const { familyFolder, sourceFolder } = parseSourceFolder(f.path);

      try {
        // Get dimensions
        const meta = await sharp(f.path, { limitInputPixels: false, failOn: 'none' }).metadata();
        const maxEdge = Math.max(meta.width || 0, meta.height || 0);
        const needsConvert = ext !== 'jpg' && ext !== 'jpeg';
        const needsResize = maxEdge > MAX_DIM;

        let finalPath = f.path;
        let finalWidth = meta.width;
        let finalHeight = meta.height;

        if (needsResize) {
          // Oversized: move original to hires, create resized lowres
          const hiresPath = buildHiresPath(f.path);

          if (!dryRun) {
            await ensureDir(hiresPath);
            await fs.promises.rename(f.path, hiresPath);

            // Create lowres version (always JPG)
            const lowresJpgPath = f.path.replace(/\.[^.]+$/, '.jpg');
            await ensureDir(lowresJpgPath);
            const result = await sharp(hiresPath, { limitInputPixels: false, failOn: 'none' })
              .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: JPEG_QUALITY })
              .toFile(lowresJpgPath);

            finalPath = lowresJpgPath;
            finalWidth = result.width;
            finalHeight = result.height;

            // Also insert a DB record for the hires version as "original"
            const hiresStat = await fs.promises.stat(hiresPath);
            const hiresHash = await fileHash(hiresPath);
            const { rows: [hiresRow] } = await pool.query(
              `INSERT INTO catalog.files
                 (original_path, source_folder, filename, extension, size_bytes, file_hash,
                  media_type, width, height, parent_id, variant_type)
               VALUES ($1, $2, $3, $4, $5, $6, 'photo', $7, $8, NULL, NULL)
               RETURNING id`,
              [
                hiresPath.replace(/\\/g, '/'),
                sourceFolder,
                path.basename(hiresPath),
                ext,
                hiresStat.size,
                hiresHash,
                meta.width,
                meta.height,
              ]
            );

            // Insert lowres as child of hires original (store relative path)
            const lowresStat = await fs.promises.stat(finalPath);
            const lowresHash = await fileHash(finalPath);
            const lowresRelPath = finalPath.replace(/\\/g, '/').replace(LOWRES_ROOT.replace(/\\/g, '/') + '/', '');
            await pool.query(
              `INSERT INTO catalog.files
                 (original_path, source_folder, filename, extension, size_bytes, file_hash,
                  media_type, width, height, parent_id, variant_type)
               VALUES ($1, $2, $3, 'jpg', $4, $5, 'photo', $6, $7, $8, 'lowres')`,
              [
                lowresRelPath,
                sourceFolder,
                path.basename(finalPath),
                lowresStat.size,
                lowresHash,
                finalWidth,
                finalHeight,
                hiresRow.id,
              ]
            );
            inserted += 2;
          }

          downsized++;
          process.stderr.write(`  [${i + 1}/${newImages.length}] RESIZE ${maxEdge}px -> ${MAX_DIM}px: ${path.basename(f.path)}\n`);

        } else if (needsConvert) {
          // TIF/BMP/PNG: convert to JPG in-place
          const jpgPath = f.path.replace(/\.[^.]+$/, '.jpg');

          if (!dryRun) {
            const result = await sharp(f.path, { limitInputPixels: false, failOn: 'none' })
              .jpeg({ quality: JPEG_QUALITY })
              .toFile(jpgPath);

            // Remove original TIF/BMP
            await fs.promises.unlink(f.path);

            finalPath = jpgPath;
            finalWidth = result.width;
            finalHeight = result.height;

            // Insert DB record
            const stat = await fs.promises.stat(finalPath);
            const hash = await fileHash(finalPath);
            await pool.query(
              `INSERT INTO catalog.files
                 (original_path, source_folder, filename, extension, size_bytes, file_hash,
                  media_type, width, height, parent_id, variant_type)
               VALUES ($1, $2, $3, 'jpg', $4, $5, 'photo', $6, $7, NULL, NULL)`,
              [
                finalPath.replace(/\\/g, '/'),
                sourceFolder,
                path.basename(finalPath),
                stat.size,
                hash,
                finalWidth,
                finalHeight,
              ]
            );
            inserted++;
          }

          converted++;
          process.stderr.write(`  [${i + 1}/${newImages.length}] CONVERT ${ext.toUpperCase()} -> JPG: ${path.basename(f.path)}\n`);

        } else {
          // Already a lowres-sized JPG, just register
          if (!dryRun) {
            const hash = await fileHash(f.path);
            // Check for duplicate hash
            const { rows: hashRows } = await pool.query(
              'SELECT id FROM catalog.files WHERE file_hash = $1', [hash]
            );
            if (hashRows.length > 0) {
              process.stderr.write(`  [${i + 1}/${newImages.length}] SKIP (duplicate hash): ${path.basename(f.path)}\n`);
              alreadyOk++;
              continue;
            }

            const stat = await fs.promises.stat(f.path);
            await pool.query(
              `INSERT INTO catalog.files
                 (original_path, source_folder, filename, extension, size_bytes, file_hash,
                  media_type, width, height, parent_id, variant_type)
               VALUES ($1, $2, $3, $4, $5, $6, 'photo', $7, $8, NULL, NULL)`,
              [
                f.path.replace(/\\/g, '/'),
                sourceFolder,
                path.basename(f.path),
                ext,
                f.stat.size,
                hash,
                finalWidth,
                finalHeight,
              ]
            );
            inserted++;
          }

          alreadyOk++;
          if ((i + 1) % 50 === 0) {
            process.stderr.write(`  [${i + 1}/${newImages.length}] OK: ${path.basename(f.path)}\r`);
          }
        }
      } catch (err) {
        errors++;
        errorList.push({ path: f.path, error: err.message });
        process.stderr.write(`  [${i + 1}/${newImages.length}] ERROR: ${path.basename(f.path)}: ${err.message}\n`);
      }
    }

    // Step 4: Process videos (just register, no conversion)
    console.log('\n=== Step 4: Processing videos ===');
    for (const f of newVideos) {
      const { sourceFolder } = parseSourceFolder(f.path);
      const ext = path.extname(f.path).replace('.', '').toLowerCase();
      try {
        if (!dryRun) {
          const hash = await fileHash(f.path);
          const { rows: hashRows } = await pool.query(
            'SELECT id FROM catalog.files WHERE file_hash = $1', [hash]
          );
          if (hashRows.length > 0) {
            console.log(`  SKIP (duplicate): ${path.basename(f.path)}`);
            continue;
          }
          await pool.query(
            `INSERT INTO catalog.files
               (original_path, source_folder, filename, extension, size_bytes, file_hash,
                media_type, parent_id, variant_type)
             VALUES ($1, $2, $3, $4, $5, $6, 'video', NULL, NULL)`,
            [
              f.path.replace(/\\/g, '/'),
              sourceFolder,
              path.basename(f.path),
              ext,
              f.stat.size,
              hash,
            ]
          );
          inserted++;
        }
        console.log(`  Registered video: ${path.basename(f.path)}`);
      } catch (err) {
        errors++;
        errorList.push({ path: f.path, error: err.message });
      }
    }

    // Summary
    console.log('\n=== Summary ===');
    console.log(`  Total recent files: ${recentFiles.length}`);
    console.log(`  New images processed: ${newImages.length}`);
    console.log(`    Already lowres-sized JPGs: ${alreadyOk}`);
    console.log(`    Converted (TIF/BMP/PNG -> JPG): ${converted}`);
    console.log(`    Downsized + moved to hires: ${downsized}`);
    console.log(`  New videos registered: ${newVideos.length}`);
    console.log(`  Non-image files skipped: ${skippedFiles.length}`);
    console.log(`  DB records inserted: ${inserted}`);
    console.log(`  Errors: ${errors}`);

    if (skippedFiles.length > 0) {
      console.log('\nSkipped non-image files:');
      for (const f of skippedFiles) {
        console.log(`  ${f.path}`);
      }
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
