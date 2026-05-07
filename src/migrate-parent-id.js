const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({ host: 'localhost', user: 'postgres', password: '7297', database: 'photoapp' });

  try {
    // Add parent_id column to catalog.files
    await pool.query(`
      ALTER TABLE catalog.files ADD COLUMN IF NOT EXISTS parent_id INTEGER
        REFERENCES catalog.files(id) ON DELETE CASCADE
    `);
    console.log('Added parent_id column');

    // Create index on parent_id
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_files_parent_id ON catalog.files(parent_id)
    `);
    console.log('Created idx_files_parent_id index');

    // Drop catalog.variants table (empty, never used)
    await pool.query(`DROP TABLE IF EXISTS catalog.variants`);
    console.log('Dropped catalog.variants table');

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
