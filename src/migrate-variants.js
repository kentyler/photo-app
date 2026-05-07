/**
 * Migration: creates catalog.variants table for converted/resized file copies.
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog.variants (
        id SERIAL PRIMARY KEY,
        source_file_id INTEGER NOT NULL REFERENCES catalog.files(id) ON DELETE CASCADE,
        variant_type TEXT NOT NULL,
        variant_path TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    console.log('Migration complete: catalog.variants table created');
  } finally {
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
