const exifr = require('exifr');

const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff']);

const NULL_RESULT = { width: null, height: null, taken_at: null, camera_make: null, camera_model: null };

async function extractExif(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  if (!PHOTO_EXTS.has(ext)) return { ...NULL_RESULT };

  try {
    const data = await exifr.parse(filePath, {
      pick: ['ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight',
             'DateTimeOriginal', 'CreateDate', 'Make', 'Model'],
    });

    if (!data) return { ...NULL_RESULT };

    const width = data.ExifImageWidth || data.ImageWidth || null;
    const height = data.ExifImageHeight || data.ImageHeight || null;
    const taken_at = data.DateTimeOriginal || data.CreateDate || null;
    const camera_make = data.Make || null;
    const camera_model = data.Model || null;

    return {
      width: typeof width === 'number' ? width : null,
      height: typeof height === 'number' ? height : null,
      taken_at: taken_at instanceof Date ? taken_at : null,
      camera_make,
      camera_model,
    };
  } catch {
    return { ...NULL_RESULT };
  }
}

module.exports = { extractExif };
