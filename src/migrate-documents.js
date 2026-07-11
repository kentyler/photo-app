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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog.documents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS catalog.document_files (
      id SERIAL PRIMARY KEY,
      document_id INT REFERENCES catalog.documents(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      file_size BIGINT,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS catalog.document_photos (
      id SERIAL PRIMARY KEY,
      document_id INT REFERENCES catalog.documents(id) ON DELETE CASCADE,
      photo_id INT REFERENCES catalog.files(id) ON DELETE CASCADE,
      UNIQUE (document_id, photo_id)
    );

    CREATE TABLE IF NOT EXISTS catalog.document_people (
      id SERIAL PRIMARY KEY,
      document_id INT REFERENCES catalog.documents(id) ON DELETE CASCADE,
      person_id INT REFERENCES catalog.people(id) ON DELETE CASCADE,
      UNIQUE (document_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS catalog.document_places (
      id SERIAL PRIMARY KEY,
      document_id INT REFERENCES catalog.documents(id) ON DELETE CASCADE,
      place_id INT REFERENCES catalog.places(id) ON DELETE CASCADE,
      UNIQUE (document_id, place_id)
    );

    CREATE TABLE IF NOT EXISTS catalog.document_things (
      id SERIAL PRIMARY KEY,
      document_id INT REFERENCES catalog.documents(id) ON DELETE CASCADE,
      thing_id INT REFERENCES catalog.things(id) ON DELETE CASCADE,
      UNIQUE (document_id, thing_id)
    );

    CREATE INDEX IF NOT EXISTS idx_doc_files_doc ON catalog.document_files(document_id);
    CREATE INDEX IF NOT EXISTS idx_doc_photos_doc ON catalog.document_photos(document_id);
    CREATE INDEX IF NOT EXISTS idx_doc_photos_photo ON catalog.document_photos(photo_id);
    CREATE INDEX IF NOT EXISTS idx_doc_people_doc ON catalog.document_people(document_id);
    CREATE INDEX IF NOT EXISTS idx_doc_people_person ON catalog.document_people(person_id);
    CREATE INDEX IF NOT EXISTS idx_doc_places_doc ON catalog.document_places(document_id);
    CREATE INDEX IF NOT EXISTS idx_doc_places_place ON catalog.document_places(place_id);
    CREATE INDEX IF NOT EXISTS idx_doc_things_doc ON catalog.document_things(document_id);
    CREATE INDEX IF NOT EXISTS idx_doc_things_thing ON catalog.document_things(thing_id);
  `);

  console.log('Documents tables created.');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
