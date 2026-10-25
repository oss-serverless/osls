'use strict';

const crypto = require('crypto');
const fs = require('fs');

module.exports = async (filePath) => {
  const fileHash = crypto.createHash('sha256');
  fileHash.setEncoding('base64');

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(filePath);
    readStream
      .on('data', (chunk) => {
        fileHash.write(chunk);
      })
      .on('close', () => {
        fileHash.end();
        resolve(fileHash.read());
      })
      .on('error', (error) => {
        const errorMessage = error && error.message ? error.message : String(error);

        reject(
          new Error(`Could not calculate hash for "${filePath}": ${errorMessage}`, {
            cause: error,
          })
        );
      });
  });
};
