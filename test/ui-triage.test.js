/**
 * GDD Tests for triage UI intents:
 *   ui-server, ui-photo-grid, ui-photo-caption, ui-photo-tag, ui-photo-rate
 */
const http = require('http');
const { Pool } = require('pg');

const BASE = 'http://localhost:3100';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function request(method, path, data) {
  const url = new URL(`${BASE}${path}`);
  const payload = JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runTests() {
  let passed = 0, failed = 0;

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  ✓ ${msg}`); }
    else { failed++; console.error(`  ✗ ${msg}`); }
  }

  // Intent 1: ui-server
  console.log('\n[ui-server]');
  const home = await get('/');
  assert(home.status === 200, 'GET / returns 200');
  assert(home.body.includes('<html'), 'GET / returns HTML');

  // Intent 2: ui-photo-grid
  console.log('\n[ui-photo-grid]');
  const folders = await get('/api/folders');
  assert(folders.status === 200, 'GET /api/folders returns 200');
  const folderList = JSON.parse(folders.body);
  assert(Array.isArray(folderList), '/api/folders returns array');

  const photos = await get('/api/photos?folder=Bridget_Geoff_Toni');
  assert(photos.status === 200, 'GET /api/photos returns 200');
  const photoList = JSON.parse(photos.body);
  assert(Array.isArray(photoList) && photoList.length > 0, 'Trail folder has photos');

  const firstPhoto = photoList[0];
  const img = await get(`/api/photo/${firstPhoto.id}`);
  assert(img.status === 200, 'GET /api/photo/:id streams image');
  assert(img.headers['content-type'].startsWith('image/'), 'Content-Type is image/*');

  // Intent 3: ui-photo-caption
  console.log('\n[ui-photo-caption]');
  const testCaption = 'Test caption ' + Date.now();
  const putCap = await request('PUT', `/api/photo/${firstPhoto.id}/caption`, { caption: testCaption });
  assert(putCap.status === 200 && putCap.body.ok, 'PUT caption succeeds');

  const getCap = await get(`/api/photo/${firstPhoto.id}/caption`);
  const capData = JSON.parse(getCap.body);
  assert(capData.caption === testCaption, 'GET caption returns saved value');

  // Intent 5: ui-photo-rate
  console.log('\n[ui-photo-rate]');
  const putRate = await request('PUT', `/api/photo/${firstPhoto.id}/rating`, { rating: 'keep' });
  assert(putRate.status === 200 && putRate.body.ok, 'PUT rating succeeds');

  const photosAfter = await get('/api/photos?folder=Bridget_Geoff_Toni');
  const afterList = JSON.parse(photosAfter.body);
  const rated = afterList.find(p => p.id === firstPhoto.id);
  assert(rated.rating === 'keep', 'Photo rating persisted');

  // Intent 4: ui-photo-tag
  console.log('\n[ui-photo-tag]');
  const createTag = await request('POST', '/api/tags', { name: 'test-tag-' + Date.now() });
  assert(createTag.status === 200 && createTag.body.id, 'POST /api/tags creates tag');

  const assignTag = await request('POST', `/api/photo/${firstPhoto.id}/tags`, { tag_id: createTag.body.id });
  assert(assignTag.status === 200, 'Assign tag to photo');

  const photoTags = await get(`/api/photo/${firstPhoto.id}/tags`);
  const tagList = JSON.parse(photoTags.body);
  assert(tagList.some(t => t.id === createTag.body.id), 'Photo has assigned tag');

  // Cleanup test tag
  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });
  await pool.query('DELETE FROM catalog.file_tags WHERE tag_id = $1', [createTag.body.id]);
  await pool.query('DELETE FROM catalog.tags WHERE id = $1', [createTag.body.id]);
  // Reset caption and rating
  await pool.query('UPDATE catalog.files SET caption = NULL, rating = NULL WHERE id = $1', [firstPhoto.id]);
  await pool.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
