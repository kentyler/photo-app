const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  user: 'postgres',
  password: '7297',
  database: 'photoapp'
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog.places (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS catalog.things (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS catalog.photo_places (
      id SERIAL PRIMARY KEY,
      photo_id INT REFERENCES catalog.files(id) ON DELETE CASCADE,
      place_id INT REFERENCES catalog.places(id) ON DELETE CASCADE,
      UNIQUE (photo_id, place_id)
    );

    CREATE TABLE IF NOT EXISTS catalog.photo_things (
      id SERIAL PRIMARY KEY,
      photo_id INT REFERENCES catalog.files(id) ON DELETE CASCADE,
      thing_id INT REFERENCES catalog.things(id) ON DELETE CASCADE,
      UNIQUE (photo_id, thing_id)
    );

    CREATE INDEX IF NOT EXISTS idx_photo_places_photo ON catalog.photo_places(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_places_place ON catalog.photo_places(place_id);
    CREATE INDEX IF NOT EXISTS idx_photo_things_photo ON catalog.photo_things(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_things_thing ON catalog.photo_things(thing_id);
  `);

  console.log('Places and things tables created.');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
