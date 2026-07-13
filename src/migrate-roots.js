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
  console.log('Creating catalog.roots table...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog.roots (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      path TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Seed from existing photo_base_path setting if it has a value
  const { rows } = await pool.query(
    "SELECT value FROM catalog.settings WHERE key = 'photo_base_path' AND value != ''"
  );
  if (rows.length > 0) {
    const basePath = rows[0].value;
    await pool.query(
      `INSERT INTO catalog.roots (label, path) VALUES ($1, $2) ON CONFLICT (path) DO NOTHING`,
      [basePath, basePath]
    );
    console.log(`Seeded root from photo_base_path: ${basePath}`);
  }

  console.log('Done. catalog.roots table ready.');
  await pool.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
