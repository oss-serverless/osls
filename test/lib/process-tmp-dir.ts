'use strict';

const { mkdirSync, realpathSync, rmSync } = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const rmTmpDirIgnorableErrorCodes = require('./lib/private/rm-tmp-dir-ignorable-error-codes');

const systemTmpDir = realpathSync(os.tmpdir());
const serverlessTmpDir = path.join(systemTmpDir, 'tmpdirs-serverless');
try {
  mkdirSync(serverlessTmpDir);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}

module.exports = (function self() {
  const processTmpDir = path.join(serverlessTmpDir, crypto.randomBytes(12).toString('hex'));
  try {
    mkdirSync(processTmpDir);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return self();
  }
  return processTmpDir;
})();

process.on('exit', () => {
  try {
    rmSync(module.exports, { recursive: true, force: true });
  } catch (error) {
    if (rmTmpDirIgnorableErrorCodes.has(error.code)) return;
    throw error;
  }
});
