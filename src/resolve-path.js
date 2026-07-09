const path = require('path');

function resolvePath(originalPath, variantType) {
  if (variantType === 'lowres') {
    return path.join(process.env.LOWRES_ROOT, originalPath);
  }
  return originalPath;
}

module.exports = { resolvePath };
