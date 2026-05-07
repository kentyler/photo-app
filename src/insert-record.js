async function insertRecord(pool, record) {
  // Skip if hash already exists
  if (record.file_hash) {
    const existing = await pool.query(
      'SELECT id FROM catalog.files WHERE file_hash = $1', [record.file_hash]
    );
    if (existing.rows.length > 0) return null;
  }

  const { rows } = await pool.query(
    `INSERT INTO catalog.files
       (original_path, source_folder, filename, extension, size_bytes, file_hash, media_type, taken_at,
        width, height, duration_secs, camera_make, camera_model)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      record.original_path,
      record.source_folder,
      record.filename,
      record.extension,
      record.size_bytes,
      record.file_hash,
      record.media_type,
      record.taken_at,
      record.width || null,
      record.height || null,
      record.duration_secs || null,
      record.camera_make || null,
      record.camera_model || null,
    ]
  );
  return rows[0].id;
}

module.exports = { insertRecord };
