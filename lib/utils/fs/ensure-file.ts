'use strict';

const fsp = require('fs').promises;
const path = require('path');

module.exports = async (filePath) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const fileHandle = await fsp.open(filePath, 'a');
  try {
    // Opening with 'a' creates the file without truncating existing content.
  } finally {
    await fileHandle.close();
  }
};
