const { Pool } = require('pg');

function bufferToDescriptor(buf) {
  // Descriptor stored as Float64Array buffer (128 doubles = 1024 bytes)
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; i++) view[i] = buf[i];
  return new Float64Array(ab);
}

function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Simple greedy clustering:
 * 1. Load all unassigned face descriptors
 * 2. Pick first unassigned face as centroid
 * 3. Find all faces within threshold distance
 * 4. Form cluster, create person, assign faces
 * 5. Repeat until no unassigned faces remain
 *
 * For ~20 recurring people in family photos this is sufficient.
 * A future improvement could use DBSCAN or agglomerative clustering.
 */
async function clusterFaces(pool, threshold = 0.6) {
  // Load all faces without a person_id
  const { rows } = await pool.query(
    'SELECT id, descriptor FROM catalog.faces WHERE person_id IS NULL ORDER BY id'
  );

  if (rows.length === 0) {
    process.stderr.write('  no unassigned faces to cluster\n');
    return { personsCreated: 0, facesAssigned: 0 };
  }

  // Parse descriptors
  const faces = rows.map(r => ({
    id: r.id,
    descriptor: bufferToDescriptor(r.descriptor),
  }));

  const assigned = new Set();
  const clusters = []; // each cluster: { centroid: Float64Array, faces: [] }

  for (let i = 0; i < faces.length; i++) {
    if (assigned.has(faces[i].id)) continue;

    // Find best matching existing cluster by centroid distance
    let bestCluster = -1, bestDist = Infinity;
    for (let c = 0; c < clusters.length; c++) {
      const dist = euclidean(faces[i].descriptor, clusters[c].centroid);
      if (dist < bestDist) { bestDist = dist; bestCluster = c; }
    }

    if (bestCluster >= 0 && bestDist < threshold) {
      // Add to existing cluster, update centroid (running average)
      const cl = clusters[bestCluster];
      cl.faces.push(faces[i]);
      assigned.add(faces[i].id);
      const n = cl.faces.length;
      for (let d = 0; d < 128; d++) {
        cl.centroid[d] = cl.centroid[d] * (n - 1) / n + faces[i].descriptor[d] / n;
      }
    } else {
      // Start new cluster
      clusters.push({
        centroid: new Float64Array(faces[i].descriptor),
        faces: [faces[i]],
      });
      assigned.add(faces[i].id);
    }
  }

  // Filter: only keep clusters with 2+ faces
  const validClusters = clusters.filter(c => c.faces.length >= 2);

  // Write clusters to DB
  let personsCreated = 0, facesAssigned = 0;

  for (let c = 0; c < validClusters.length; c++) {
    const label = `Person ${c + 1}`;
    const { rows: personRows } = await pool.query(
      'INSERT INTO catalog.persons (name) VALUES ($1) RETURNING id',
      [label]
    );
    const personId = personRows[0].id;
    personsCreated++;

    for (const face of validClusters[c].faces) {
      await pool.query('UPDATE catalog.faces SET person_id = $1 WHERE id = $2', [personId, face.id]);
      facesAssigned++;
    }
  }

  const singletons = faces.length - facesAssigned;
  process.stderr.write(
    `  clustered: ${personsCreated} persons, ${facesAssigned} faces assigned, ${singletons} singletons\n`
  );

  return { personsCreated, facesAssigned, singletons };
}

module.exports = { clusterFaces, euclidean, bufferToDescriptor };

// CLI entry point
if (require.main === module) {
  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });
  const threshold = parseFloat(process.argv[2]) || 0.6;
  clusterFaces(pool, threshold).then(r => {
    console.log(JSON.stringify(r));
    pool.end();
  }).catch(err => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
}
