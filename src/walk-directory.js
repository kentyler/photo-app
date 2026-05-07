const fs = require('node:fs');
const path = require('node:path');

const MEDIA_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'heic', 'mp4', 'mov', 'avi']);

async function* walkDirectory(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDirectory(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase().replace('.', '');
      if (MEDIA_EXTENSIONS.has(ext)) {
        const stat = await fs.promises.stat(fullPath);
        yield {
          path: fullPath.replace(/\\/g, '/'),
          filename: entry.name,
          extension: ext,
          size_bytes: stat.size,
          mtime: stat.mtime,
        };
      }
    }
  }
}

module.exports = { walkDirectory };
