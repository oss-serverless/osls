'use strict';

const yauzl = require('yauzl');

module.exports = async (zipFilePath) =>
  new Promise((resolve, reject) => {
    yauzl.open(zipFilePath, { lazyEntries: true, strictFileNames: true }, (error, zipfile) => {
      if (error) {
        reject(error);
        return;
      }
      const entryNames = [];
      zipfile
        .on('entry', (entry) => {
          entryNames.push(entry.fileName.replace(/^(\.\/)+/, ''));
          zipfile.readEntry();
        })
        .on('end', () => resolve(entryNames))
        .on('error', reject);
      zipfile.readEntry();
    });
  });
