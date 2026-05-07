const path = require('node:path');
const { execFile } = require('node:child_process');

const PYTHON_SCRIPT = path.join(__dirname, 'face-detect-dlib.py');

function detectFaces(imagePath) {
  return new Promise((resolve, reject) => {
    execFile('C:/Python312/python.exe', [PYTHON_SCRIPT, imagePath], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) return reject(err);

      try {
        const raw = JSON.parse(stdout);
        const faces = raw.map(f => ({
          box: f.box,
          descriptor: new Float64Array(f.descriptor),
        }));
        resolve(faces);
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${e.message}`));
      }
    });
  });
}

module.exports = { detectFaces };
