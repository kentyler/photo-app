/**
 * Migration: adds photo_texts table for text entries per photo.
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
      CREATE TABLE IF NOT EXISTS catalog.photo_texts (
        id SERIAL PRIMARY KEY,
        file_id INTEGER NOT NULL REFERENCES catalog.files(id) ON DELETE CASCADE,
        body TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_photo_texts_file
      ON catalog.photo_texts(file_id, sort_order)
    `);

    console.log('Migration complete: photo_texts');
  } finally {
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
