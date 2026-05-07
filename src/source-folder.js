function sourceFolder(filePath, rootDir) {
  // Normalize to forward slashes
  const normalized = filePath.replace(/\\/g, '/');
  let root = rootDir.replace(/\\/g, '/');

  // Ensure root ends with /
  if (!root.endsWith('/')) root += '/';

  const relative = normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
  const firstSegment = relative.split('/')[0];
  return firstSegment;
}

module.exports = { sourceFolder };
