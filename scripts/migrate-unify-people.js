/**
 * Migration: Unify persons + people tables
 *
 * 1. Create catalog.aliases table
 * 2. Migrate catalog.persons rows into catalog.people
 * 3. Repoint catalog.faces.person_id FK from persons -> people
 * 4. Make descriptor nullable on faces (for manual bounding boxes)
 * 5. Drop catalog.photo_people and catalog.persons
 *
 * Run once:  node scripts/migrate-unify-people.js
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  user: 'postgres',
  password: '7297',
  database: 'photoapp'
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create aliases table
    await client.query(`
      CREATE TABLE IF NOT EXISTS catalog.aliases (
        id SERIAL PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES catalog.people(id) ON DELETE CASCADE,
        alias TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_aliases_person ON catalog.aliases(person_id)
    `);
    console.log('1. Created catalog.aliases table');

    // 2. Migrate persons -> people (preserving id mapping)
    const { rows: persons } = await client.query(
      'SELECT id, name FROM catalog.persons ORDER BY id'
    );

    const idMap = {}; // old persons.id -> new people.id
    for (const p of persons) {
      const { rows } = await client.query(
        'INSERT INTO catalog.people (name) VALUES ($1) RETURNING id',
        [p.name]
      );
      idMap[p.id] = rows[0].id;
    }
    console.log(`2. Migrated ${persons.length} persons into people:`, idMap);

    // 3. Repoint faces.person_id to people
    // Drop old FK
    await client.query(`
      ALTER TABLE catalog.faces DROP CONSTRAINT IF EXISTS faces_person_id_fkey
    `);

    // Update face rows using the id mapping
    for (const [oldId, newId] of Object.entries(idMap)) {
      await client.query(
        'UPDATE catalog.faces SET person_id = $1 WHERE person_id = $2',
        [newId, parseInt(oldId)]
      );
    }

    // Add new FK to people
    await client.query(`
      ALTER TABLE catalog.faces
      ADD CONSTRAINT faces_person_id_fkey
      FOREIGN KEY (person_id) REFERENCES catalog.people(id) ON DELETE SET NULL
    `);
    console.log('3. Repointed faces.person_id FK to catalog.people');

    // 4. Make descriptor nullable
    await client.query(`
      ALTER TABLE catalog.faces ALTER COLUMN descriptor DROP NOT NULL
    `);
    console.log('4. Made descriptor nullable on faces');

    // 5. Drop obsolete tables
    await client.query('DROP TABLE IF EXISTS catalog.photo_people CASCADE');
    await client.query('DROP TABLE IF EXISTS catalog.persons CASCADE');
    console.log('5. Dropped catalog.photo_people and catalog.persons');

    await client.query('COMMIT');
    console.log('\nMigration complete!');

    // Verify
    const { rows: peopleCount } = await client.query(
      'SELECT COUNT(*)::int as cnt FROM catalog.people'
    );
    const { rows: faceCheck } = await client.query(`
      SELECT p.name, COUNT(f.id)::int as face_count
      FROM catalog.people p
      LEFT JOIN catalog.faces f ON f.person_id = p.id
      GROUP BY p.id, p.name
      ORDER BY p.name
    `);
    console.log(`\nVerification: ${peopleCount[0].cnt} people in catalog.people`);
    console.log('Face counts:', faceCheck.filter(r => r.face_count > 0));

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
