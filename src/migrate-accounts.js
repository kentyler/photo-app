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
  console.log('Creating catalog.accounts table...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog.accounts (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      root_path TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Seed master account
  await pool.query(`
    INSERT INTO catalog.accounts (name)
    VALUES ('master')
    ON CONFLICT (name) DO NOTHING
  `);
  console.log('  master account seeded.');

  // Add account_id column to catalog.files (nullable first for backfill)
  const colCheck = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'files' AND column_name = 'account_id'
  `);

  if (colCheck.rows.length === 0) {
    console.log('Adding account_id column to catalog.files...');
    await pool.query(`ALTER TABLE catalog.files ADD COLUMN account_id INTEGER REFERENCES catalog.accounts(id)`);

    // Backfill all existing rows to master
    console.log('Backfilling existing files to master account...');
    const { rowCount } = await pool.query(`
      UPDATE catalog.files SET account_id = (SELECT id FROM catalog.accounts WHERE name = 'master')
      WHERE account_id IS NULL
    `);
    console.log(`  ${rowCount} files updated.`);

    // Now make it NOT NULL
    await pool.query(`ALTER TABLE catalog.files ALTER COLUMN account_id SET NOT NULL`);
    console.log('  account_id set to NOT NULL.');
  } else {
    console.log('  account_id column already exists, skipping.');
  }

  // Seed settings keys for local account
  await pool.query(`
    INSERT INTO catalog.settings (key, value)
    VALUES ('local_account', ''), ('local_photos_dir', '')
    ON CONFLICT (key) DO NOTHING
  `);
  console.log('  settings keys seeded.');

  console.log('Done. Accounts migration complete.');
  await pool.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
