'use strict';

const fs = require('fs');

function dirExistsSync(dirPath) {
  try {
    const stats = fs.statSync(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

module.exports = dirExistsSync;
