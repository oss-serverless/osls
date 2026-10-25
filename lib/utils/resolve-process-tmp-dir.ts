'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const tmpDirPrefix = 'node-process-';

let processTmpDirPromise;

module.exports = async () => {
  if (!processTmpDirPromise) {
    processTmpDirPromise = fsp
      .mkdtemp(path.join(os.tmpdir(), `${tmpDirPrefix}${crypto.randomBytes(12).toString('hex')}-`))
      .then((tmpDir) => {
        process.once('exit', () => {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch {
            // Best-effort cleanup during process exit.
          }
        });
        return tmpDir;
      })
      .catch((error) => {
        processTmpDirPromise = undefined;
        throw error;
      });
  }

  return processTmpDirPromise;
};
