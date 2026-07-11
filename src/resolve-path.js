const path = require('path');

function resolvePath(relativePath, accountRoot) {
  return path.join(accountRoot, relativePath);
}

module.exports = { resolvePath };
