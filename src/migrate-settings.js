require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '7297',
  database: process.env.DB_NAME || 'photoapp',
  ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  console.log('Creating catalog.settings table...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog.settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Seed defaults (skip if already present)
  await pool.query(`
    INSERT INTO catalog.settings (key, value)
    VALUES ('theme', 'dark'), ('photo_base_path', '')
    ON CONFLICT (key) DO NOTHING
  `);

  console.log('Done. Settings table ready with defaults.');
  await pool.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
