const fs = require('fs');
const path = require('path');
const { fileHash } = require('./file-hash');
const { extractExif } = require('./exif-extract');
const { insertRecord } = require('./insert-record');

const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'heic']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi']);
const ALL_EXTS = new Set([...PHOTO_EXTS, ...VIDEO_EXTS]);

const debounceTimers = new Map();

async function processFile(pool, filePath, accountId, rootDir) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  if (!ALL_EXTS.has(ext)) return;

  // Wait a moment for the file to finish writing
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch { return; }

  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) return;

  const filename = path.basename(filePath);
  if (filename.startsWith('x_')) return;

  const hash = await fileHash(filePath);
  const mediaType = PHOTO_EXTS.has(ext) ? 'photo' : 'video';
  const exif = await extractExif(filePath);

  const sourceFolder = path.dirname(filePath).replace(/\\/g, '/');
  const relativePath = filePath.replace(/\\/g, '/');

  const id = await insertRecord(pool, {
    original_path: relativePath,
    source_folder: sourceFolder,
    filename,
    extension: ext,
    size_bytes: stat.size,
    file_hash: hash,
    media_type: mediaType,
    taken_at: exif.taken_at || null,
    width: exif.width || null,
    height: exif.height || null,
    duration_secs: null,
    camera_make: exif.camera_make || null,
    camera_model: exif.camera_model || null,
    account_id: accountId,
  });

  if (id) {
    console.log(`[watcher] cataloged: ${filename} (id=${id})`);
  }
}

function startWatcher(pool) {
  return new Promise(async (resolve) => {
    // Read settings
    let localAccount, localDir;
    try {
      const { rows } = await pool.query(
        "SELECT key, value FROM catalog.settings WHERE key IN ('local_account', 'local_photos_dir')"
      );
      const settings = {};
      rows.forEach(r => { settings[r.key] = r.value; });
      localAccount = settings.local_account;
      localDir = settings.local_photos_dir;
    } catch {
      resolve(null);
      return;
    }

    if (!localAccount || !localDir) {
      console.log('[watcher] local_account or local_photos_dir not set, skipping file watcher.');
      resolve(null);
      return;
    }

    // Look up (or create) the account
    let accountId;
    const { rows: acctRows } = await pool.query(
      'SELECT id FROM catalog.accounts WHERE name = $1', [localAccount]
    );
    if (acctRows.length > 0) {
      accountId = acctRows[0].id;
    } else {
      const { rows: newRows } = await pool.query(
        'INSERT INTO catalog.accounts (name, root_path) VALUES ($1, $2) RETURNING id',
        [localAccount, localDir]
      );
      accountId = newRows[0].id;
    }

    // Verify directory exists
    if (!fs.existsSync(localDir)) {
      console.log(`[watcher] directory does not exist: ${localDir}`);
      resolve(null);
      return;
    }

    console.log(`[watcher] watching ${localDir} for account "${localAccount}" (id=${accountId})`);

    const watcher = fs.watch(localDir, { recursive: true }, (eventType, relName) => {
      if (!relName) return;
      const fullPath = path.join(localDir, relName).replace(/\\/g, '/');

      // Debounce: wait 500ms after last event for this file
      if (debounceTimers.has(fullPath)) {
        clearTimeout(debounceTimers.get(fullPath));
      }
      debounceTimers.set(fullPath, setTimeout(async () => {
        debounceTimers.delete(fullPath);
        try {
          await processFile(pool, fullPath, accountId, localDir);
        } catch (err) {
          console.error(`[watcher] error processing ${relName}: ${err.message}`);
        }
      }, 500));
    });

    resolve(watcher);
  });
}

module.exports = { startWatcher };
