/**
 * Migration: adds groups and group_files tables for named photo groups.
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
      CREATE TABLE IF NOT EXISTS catalog.groups (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog.group_files (
        group_id INTEGER NOT NULL REFERENCES catalog.groups(id) ON DELETE CASCADE,
        file_id  INTEGER NOT NULL REFERENCES catalog.files(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, file_id)
      )
    `);

    console.log('Migration complete: groups, group_files');
  } finally {
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
