/**
 * Tests for photo group intents:
 *   photo-group-crud, photo-group-membership, photo-group-browse
 */
const http = require('http');
const { Pool } = require('pg');

const BASE = 'http://localhost:3100';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
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
  const groupName = 'test-group-' + Date.now();
  const groupName2 = 'test-group2-' + Date.now();
  let groupId, groupId2;

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
    else { failed++; console.error(`  \u2717 ${msg}`); }
  }

  // Get a real photo ID to work with
  const photosRes = await get('/api/photos?folder=__all__');
  const allPhotos = JSON.parse(photosRes.body);
  assert(allPhotos.length > 0, 'Have photos to test with');
  const photoA = allPhotos[0];
  const photoB = allPhotos.length > 1 ? allPhotos[1] : allPhotos[0];

  // --- photo-group-crud ---
  console.log('\n[photo-group-crud]');

  const create = await request('POST', '/api/groups', { name: groupName });
  assert(create.status === 200 && create.body.id, 'POST /api/groups creates a group');
  groupId = create.body.id;

  const create2 = await request('POST', '/api/groups', { name: groupName2 });
  assert(create2.status === 200 && create2.body.id, 'POST /api/groups creates second group');
  groupId2 = create2.body.id;

  const list = await get('/api/groups');
  const groups = JSON.parse(list.body);
  assert(Array.isArray(groups), 'GET /api/groups returns array');
  assert(groups.some(g => g.id === groupId), 'Created group appears in list');
  // member_count should be present
  const ourGroup = groups.find(g => g.id === groupId);
  assert(ourGroup && 'member_count' in ourGroup, 'Group has member_count field');

  const rename = await request('PUT', `/api/groups/${groupId}`, { name: groupName + '-renamed' });
  assert(rename.status === 200 && rename.body.ok, 'PUT /api/groups/:id renames group');

  // Verify rename
  const listAfter = await get('/api/groups');
  const groupsAfter = JSON.parse(listAfter.body);
  assert(groupsAfter.some(g => g.name === groupName + '-renamed'), 'Renamed group appears in list');

  // --- photo-group-membership ---
  console.log('\n[photo-group-membership]');

  const addOne = await request('POST', `/api/groups/${groupId}/photos`, { file_id: photoA.id });
  assert(addOne.status === 200 && addOne.body.ok, 'POST adds single photo to group');

  const addBulk = await request('POST', `/api/groups/${groupId}/photos`, { file_ids: [photoA.id, photoB.id] });
  assert(addBulk.status === 200 && addBulk.body.ok, 'POST adds bulk photos (with dedup)');

  const members = await get(`/api/groups/${groupId}/photos`);
  const memberList = JSON.parse(members.body);
  assert(Array.isArray(memberList), 'GET /api/groups/:id/photos returns array');
  assert(memberList.some(m => m.file_id === photoA.id), 'Photo A is in group');

  // Same photo in multiple groups
  const addToG2 = await request('POST', `/api/groups/${groupId2}/photos`, { file_id: photoA.id });
  assert(addToG2.status === 200, 'Same photo can be added to second group');

  const members2 = await get(`/api/groups/${groupId2}/photos`);
  const memberList2 = JSON.parse(members2.body);
  assert(memberList2.some(m => m.file_id === photoA.id), 'Photo A is in second group too');

  // Remove photo from group
  const removeOne = await del(`/api/groups/${groupId}/photos/${photoB.id}`);
  assert(removeOne.status === 200 && removeOne.body.ok, 'DELETE removes photo from group');

  const membersAfterRemove = await get(`/api/groups/${groupId}/photos`);
  const afterRemoveList = JSON.parse(membersAfterRemove.body);
  assert(!afterRemoveList.some(m => m.file_id === photoB.id), 'Photo B no longer in group after remove');

  // --- photo-group-browse ---
  console.log('\n[photo-group-browse]');

  const browse = await get(`/api/photos?group=${groupId}`);
  assert(browse.status === 200, 'GET /api/photos?group=:id returns 200');
  const browseList = JSON.parse(browse.body);
  assert(Array.isArray(browseList), 'Browse returns array');
  assert(browseList.length > 0, 'Browse returns group members');
  // Should have same shape as folder query
  const first = browseList[0];
  assert('id' in first && 'filename' in first && 'source_folder' in first, 'Browse result has same columns as folder query');

  // --- Cleanup ---
  console.log('\n[cleanup]');
  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });
  await pool.query('DELETE FROM catalog.group_files WHERE group_id IN ($1, $2)', [groupId, groupId2]);
  await pool.query('DELETE FROM catalog.groups WHERE id IN ($1, $2)', [groupId, groupId2]);
  await pool.end();
  console.log('  Cleaned up test groups');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
