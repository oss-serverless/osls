'use strict';

const fs = require('fs');
const path = require('path');
const yazl = require('yazl');
const walkDirSync = require('./walk-dir-sync');

async function createZipFile(srcDirPath, outputFilePath) {
  const files = walkDirSync(srcDirPath).map((file) => ({
    input: file,
    output: file.replace(path.join(srcDirPath, path.sep), ''),
  }));

  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const output = fs.createWriteStream(outputFilePath);

    output.on('open', () => {
      zipfile.outputStream.pipe(output);

      files.forEach((file) => {
        // TODO: update since this is REALLY slow
        if (fs.lstatSync(file.input).isFile()) {
          zipfile.addFile(file.input, file.output, { compressionLevel: 9 });
        }
      });

      zipfile.end();
    });

    zipfile.on('error', (err) => reject(err));
    output.on('error', (err) => reject(err));
    output.on('close', () => resolve(outputFilePath));
  });
}

module.exports = createZipFile;
