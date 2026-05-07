const path = require('node:path');
const canvas = require('canvas');

// Use the WASM build — no native tfjs-node bindings needed
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
const tf = require('@tensorflow/tfjs');
const wasm = require('@tensorflow/tfjs-backend-wasm');

const MODEL_PATH = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'face-api', 'model');

let initialized = false;

// Patch face-api to use node-canvas
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

async function init() {
  if (initialized) return;
  // Point WASM to the correct binary location
  const wasmDir = path.join(__dirname, '..', 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist');
  wasm.setWasmPaths(wasmDir + '/');
  await tf.setBackend('wasm');
  await tf.ready();
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
  initialized = true;
}

async function detectFaces(imagePath) {
  await init();

  const img = await canvas.loadImage(imagePath);
  const c = canvas.createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const detections = await faceapi
    .detectAllFaces(c)
    .withFaceLandmarks()
    .withFaceDescriptors();

  return detections.map(d => ({
    box: {
      x: d.detection.box.x,
      y: d.detection.box.y,
      w: d.detection.box.width,
      h: d.detection.box.height,
    },
    descriptor: new Float64Array(d.descriptor),
  }));
}

module.exports = { detectFaces };
