const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = function() {
  const router = express.Router();

  // --- History & Bookmarks (local JSON files) ---
  const HISTORY_FILE = path.join(__dirname, '..', '..', '.history.json');
  const BOOKMARKS_FILE = path.join(__dirname, '..', '..', '.bookmarks.json');

  function readJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }
  function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  router.get('/api/history', (req, res) => {
    res.json(readJSON(HISTORY_FILE, []));
  });

  router.post('/api/history', (req, res) => {
    const { source, folder, groupId, label } = req.body;
    const history = readJSON(HISTORY_FILE, []);
    const entry = { source, folder, groupId, label, ts: new Date().toISOString() };
    // Dedupe: if top entry matches, just update ts
    if (history.length > 0) {
      const top = history[0];
      if (top.source === source && top.folder === folder && top.groupId === groupId) {
        history[0].ts = entry.ts;
        writeJSON(HISTORY_FILE, history);
        return res.json({ ok: true });
      }
    }
    history.unshift(entry);
    if (history.length > 100) history.length = 100;
    writeJSON(HISTORY_FILE, history);
    res.json({ ok: true });
  });

  router.get('/api/bookmarks', (req, res) => {
    res.json(readJSON(BOOKMARKS_FILE, []));
  });

  router.post('/api/bookmarks', (req, res) => {
    const { name, source, folder, groupId, photoId, photoFilename } = req.body;
    const bookmarks = readJSON(BOOKMARKS_FILE, []);
    const maxId = bookmarks.reduce((m, b) => Math.max(m, b.id || 0), 0);
    bookmarks.push({ id: maxId + 1, name, source, folder, groupId, photoId: photoId || null, photoFilename: photoFilename || null, ts: new Date().toISOString() });
    writeJSON(BOOKMARKS_FILE, bookmarks);
    res.json({ ok: true });
  });

  router.delete('/api/bookmarks/:id', (req, res) => {
    const bookmarks = readJSON(BOOKMARKS_FILE, []);
    const filtered = bookmarks.filter(b => b.id !== parseInt(req.params.id));
    writeJSON(BOOKMARKS_FILE, filtered);
    res.json({ ok: true });
  });

  return router;
};
