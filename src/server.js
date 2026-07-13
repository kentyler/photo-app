require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const os = require('os');
const multer = require('multer');
const { startWatcher } = require('./file-watcher');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '7297',
  database: process.env.DB_NAME || 'photoapp',
  ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false,
});

const DOCS_ROOT = process.env.DOCS_ROOT || path.join(os.homedir(), 'photo-app', 'documents');
const upload = multer({ dest: path.join(DOCS_ROOT, '_tmp') });

// Mount route modules
app.use(require('./routes/photos')({ pool }));
app.use(require('./routes/tags')({ pool }));
app.use(require('./routes/texts')({ pool }));
app.use(require('./routes/folders')({ pool }));
app.use(require('./routes/groups')({ pool }));
app.use(require('./routes/people')({ pool }));
app.use(require('./routes/places')({ pool }));
app.use(require('./routes/things')({ pool }));
app.use(require('./routes/documents')({ pool, upload, DOCS_ROOT }));
app.use(require('./routes/accounts')({ pool }));
app.use(require('./routes/history')());

// --- Global error handler (return JSON, not HTML) ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal server error' });
});

// --- Fallback: serve index.html for SPA ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`Photo triage UI running at http://localhost:${PORT}`);
  startWatcher(pool).catch(err => console.error('[watcher] failed to start:', err.message));
});

module.exports = app;
