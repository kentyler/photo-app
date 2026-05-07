/**
 * Tests for photo text entry intents:
 *   photo-text-crud, photo-text-ordering
 */
const http = require('http');
const { Pool } = require('pg');

const BASE = 'http://localhost:3100';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
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
      path: url.pathname + url.search,
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

function del(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  let passed = 0, failed = 0;
  const createdTextIds = [];

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
    else { failed++; console.error(`  \u2717 ${msg}`); }
  }

  // Get a real photo ID to work with
  const photosRes = await get('/api/photos?folder=__all__');
  assert(Array.isArray(photosRes.body) && photosRes.body.length > 0, 'Have photos to test with');
  const photo = photosRes.body[0];

  // --- photo-text-crud ---
  console.log('\n[photo-text-crud]');

  // POST creates entry
  const create1 = await request('POST', `/api/photo/${photo.id}/texts`, { body: 'First note' });
  assert(create1.status === 200 && create1.body.id, 'POST creates text entry');
  assert(create1.body.body === 'First note', 'Created entry has correct body');
  assert(typeof create1.body.sort_order === 'number', 'Created entry has sort_order');
  createdTextIds.push(create1.body.id);

  // GET lists entries for photo
  const list1 = await get(`/api/photo/${photo.id}/texts`);
  assert(list1.status === 200 && Array.isArray(list1.body), 'GET returns array');
  assert(list1.body.some(t => t.id === create1.body.id), 'Created entry appears in list');

  // PUT updates body
  const update = await request('PUT', `/api/text/${create1.body.id}`, { body: 'Updated note' });
  assert(update.status === 200 && update.body.ok, 'PUT updates entry');

  // Verify update
  const list2 = await get(`/api/photo/${photo.id}/texts`);
  const updated = list2.body.find(t => t.id === create1.body.id);
  assert(updated && updated.body === 'Updated note', 'Updated body persists');

  // DELETE removes entry
  const create2 = await request('POST', `/api/photo/${photo.id}/texts`, { body: 'To delete' });
  createdTextIds.push(create2.body.id);
  const delRes = await del(`/api/text/${create2.body.id}`);
  assert(delRes.status === 200 && delRes.body.ok, 'DELETE removes entry');
  createdTextIds.pop(); // already deleted

  const list3 = await get(`/api/photo/${photo.id}/texts`);
  assert(!list3.body.some(t => t.id === create2.body.id), 'Deleted entry no longer in list');

  // --- photo-text-ordering ---
  console.log('\n[photo-text-ordering]');

  // Create multiple entries - sort_order should auto-increment
  const createA = await request('POST', `/api/photo/${photo.id}/texts`, { body: 'Entry A' });
  const createB = await request('POST', `/api/photo/${photo.id}/texts`, { body: 'Entry B' });
  const createC = await request('POST', `/api/photo/${photo.id}/texts`, { body: 'Entry C' });
  createdTextIds.push(createA.body.id, createB.body.id, createC.body.id);

  assert(createA.body.sort_order < createB.body.sort_order, 'A has lower sort_order than B');
  assert(createB.body.sort_order < createC.body.sort_order, 'B has lower sort_order than C');

  // GET returns in sort_order
  const ordered = await get(`/api/photo/${photo.id}/texts`);
  const ids = ordered.body.map(t => t.id);
  const idxA = ids.indexOf(createA.body.id);
  const idxB = ids.indexOf(createB.body.id);
  const idxC = ids.indexOf(createC.body.id);
  assert(idxA < idxB && idxB < idxC, 'Entries returned in sort_order');

  // --- Cleanup ---
  console.log('\n[cleanup]');
  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });
  for (const id of createdTextIds) {
    await pool.query('DELETE FROM catalog.photo_texts WHERE id = $1', [id]);
  }
  await pool.end();
  console.log('  Cleaned up test text entries');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
