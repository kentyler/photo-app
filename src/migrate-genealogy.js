const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  user: 'postgres',
  password: '7297',
  database: 'photoapp'
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog.people (
      id SERIAL PRIMARY KEY,
      birth_date TEXT,
      death_date TEXT,
      gender TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS catalog.person_aliases (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES catalog.people(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      is_primary BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_person_alias ON catalog.person_aliases (person_id, alias);

    CREATE TABLE IF NOT EXISTS catalog.relationships (
      id SERIAL PRIMARY KEY,
      person_id INT REFERENCES catalog.people(id) ON DELETE CASCADE,
      related_id INT REFERENCES catalog.people(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      UNIQUE (person_id, related_id, type)
    );

    CREATE TABLE IF NOT EXISTS catalog.photo_people (
      id SERIAL PRIMARY KEY,
      photo_id INT REFERENCES catalog.files(id) ON DELETE CASCADE,
      person_id INT REFERENCES catalog.people(id) ON DELETE CASCADE,
      x REAL,
      y REAL,
      w REAL,
      h REAL,
      UNIQUE (photo_id, person_id)
    );

    CREATE INDEX IF NOT EXISTS idx_relationships_person ON catalog.relationships(person_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_related ON catalog.relationships(related_id);
    CREATE INDEX IF NOT EXISTS idx_photo_people_photo ON catalog.photo_people(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_people_person ON catalog.photo_people(person_id);
  `);

  console.log('Genealogy tables created.');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
