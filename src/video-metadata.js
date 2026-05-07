const { execFile } = require('node:child_process');

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi']);
const NULL_RESULT = { width: null, height: null, duration_secs: null };

function extractVideoMeta(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  if (!VIDEO_EXTS.has(ext)) return Promise.resolve({ ...NULL_RESULT });

  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ], { timeout: 30000 }, (err, stdout) => {
      if (err) return resolve({ ...NULL_RESULT });

      try {
        const data = JSON.parse(stdout);
        const video = (data.streams || []).find(s => s.codec_type === 'video');
        const duration = data.format?.duration
          ? parseFloat(data.format.duration)
          : null;

        resolve({
          width: video ? parseInt(video.width) : null,
          height: video ? parseInt(video.height) : null,
          duration_secs: duration,
        });
      } catch {
        resolve({ ...NULL_RESULT });
      }
    });
  });
}

module.exports = { extractVideoMeta };
