const path = require('node:path');
const { execFile } = require('node:child_process');
const faceapiBackend = require('./face-detect-faceapi');

const PYTHON = 'C:/Python312/python.exe';
const ENCODE_SCRIPT = path.join(__dirname, 'face-encode-dlib.py');

function getDlibDescriptors(imagePath, boxes) {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({
      image_path: imagePath.replace(/\\/g, '/'),
      faces: boxes,
    });

    const child = execFile(PYTHON, [ENCODE_SCRIPT], {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Failed to parse dlib output: ${e.message}`));
      }
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

async function detectFaces(imagePath) {
  // Step 1: face-api.js detects faces (high recall)
  const detections = await faceapiBackend.detectFaces(imagePath);
  if (detections.length === 0) return [];

  // Step 2: pass bounding boxes to dlib for descriptor computation
  const boxes = detections.map(d => d.box);
  const dlibDescriptors = await getDlibDescriptors(imagePath, boxes);

  // Step 3: combine face-api.js boxes with dlib descriptors
  const results = [];
  for (let i = 0; i < detections.length; i++) {
    const desc = dlibDescriptors[i];
    if (desc) {
      results.push({
        box: detections[i].box,
        descriptor: new Float64Array(desc),
      });
    }
  }
  return results;
}

module.exports = { detectFaces };
