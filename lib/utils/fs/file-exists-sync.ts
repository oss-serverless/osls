'use strict';

const fs = require('fs');

function fileExistsSync(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

module.exports = fileExistsSync;
