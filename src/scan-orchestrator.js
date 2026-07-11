const { walkDirectory } = require('./walk-directory');
const { parseFilenameDate } = require('./parse-filename-date');
const { fileHash } = require('./file-hash');
const { sourceFolder } = require('./source-folder');
const { insertRecord } = require('./insert-record');
const { extractExif } = require('./exif-extract');
const { extractVideoMeta } = require('./video-metadata');

const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'heic']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi']);

async function scanFolder(pool, folderPath, rootDir, accountId) {
  let inserted = 0, skipped = 0, errors = 0, total = 0;

  for await (const entry of walkDirectory(folderPath)) {
    total++;
    try {
      const hash = await fileHash(entry.path);
      const takenAt = parseFilenameDate(entry.filename);
      const folder = sourceFolder(entry.path, rootDir);
      const mediaType = PHOTO_EXTS.has(entry.extension) ? 'photo' : 'video';
      const exif = await extractExif(entry.path);
      const vidMeta = await extractVideoMeta(entry.path);

      const id = await insertRecord(pool, {
        original_path: entry.path,
        source_folder: folder,
        filename: entry.filename,
        extension: entry.extension,
        size_bytes: entry.size_bytes,
        file_hash: hash,
        media_type: mediaType,
        taken_at: exif.taken_at || takenAt,
        width: exif.width || vidMeta.width,
        height: exif.height || vidMeta.height,
        duration_secs: vidMeta.duration_secs,
        camera_make: exif.camera_make,
        camera_model: exif.camera_model,
        account_id: accountId,
      });

      if (id) {
        inserted++;
        if (total % 10 === 0) process.stderr.write(`  scanned ${total} files (${inserted} inserted)\r`);
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      process.stderr.write(`  error: ${entry.path}: ${err.message}\n`);
    }
  }
  process.stderr.write(`\n  done: ${total} files, ${inserted} inserted, ${skipped} skipped, ${errors} errors\n`);
  return { total, inserted, skipped, errors };
}

module.exports = { scanFolder };

// CLI entry point
if (require.main === module) {
  const { Pool } = require('pg');
  const folder = process.argv[2];
  const root = process.argv[3] || 'D:/';
  if (!folder) { console.error('Usage: node src/scan-orchestrator.js <folder> [root]'); process.exit(1); }

  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });
  pool.query("SELECT id FROM catalog.accounts WHERE name = 'master'").then(({ rows }) => {
    const accountId = rows[0]?.id || 1;
    return scanFolder(pool, folder, root, accountId);
  }).then(r => {
    console.log(JSON.stringify(r));
    pool.end();
  }).catch(err => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
}
