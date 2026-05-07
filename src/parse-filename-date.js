function parseFilenameDate(filename) {
  // Match YYYYMMDD_HHMMSS with optional suffix (_001, (0), etc.)
  const match = filename.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, min, sec] = match;
  const date = new Date(
    parseInt(year), parseInt(month) - 1, parseInt(day),
    parseInt(hour), parseInt(min), parseInt(sec)
  );

  // Sanity check: reject invalid dates
  if (isNaN(date.getTime())) return null;
  return date;
}

module.exports = { parseFilenameDate };
