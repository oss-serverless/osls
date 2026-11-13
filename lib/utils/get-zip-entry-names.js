'use strict';

const yauzl = require('yauzl');

module.exports = async (zipFilePath) =>
  new Promise((resolve, reject) => {
    yauzl.open(zipFilePath, { lazyEntries: true }, (error, zipfile) => {
      if (error) {
        reject(error);
        return;
      }
      const entryNames = [];
      zipfile
        .on('entry', (entry) => {
          entryNames.push(entry.fileName);
          zipfile.readEntry();
        })
        .on('end', () => resolve(entryNames))
        .on('error', reject);
      zipfile.readEntry();
    });
  });
