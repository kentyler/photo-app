/**
 * Migration: adds columns and tables needed for the triage UI.
 * Idempotent — safe to run multiple times.
 */
const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: '7297',
    database: 'photoapp'
  });

  try {
    // Add caption column
    await pool.query(`
      ALTER TABLE catalog.files ADD COLUMN IF NOT EXISTS caption TEXT DEFAULT NULL
    `);

    // Add rating column
    await pool.query(`
      ALTER TABLE catalog.files ADD COLUMN IF NOT EXISTS rating TEXT DEFAULT NULL
    `);

    // Create tags table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog.tags (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      )
    `);

    // Create file_tags junction table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog.file_tags (
        file_id INTEGER NOT NULL REFERENCES catalog.files(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES catalog.tags(id) ON DELETE CASCADE,
        PRIMARY KEY (file_id, tag_id)
      )
    `);

    console.log('Migration complete: caption, rating, tags, file_tags');
  } finally {
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
