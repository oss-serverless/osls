import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import rmTmpDirIgnorableErrorCodes from './lib/private/rm-tmp-dir-ignorable-error-codes.ts';

const systemTmpDir = realpathSync(os.tmpdir());
const serverlessTmpDir = path.join(systemTmpDir, 'tmpdirs-serverless');
try {
  mkdirSync(serverlessTmpDir);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}

const processTmpDir = (function self() {
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
    rmSync(processTmpDir, { recursive: true, force: true });
  } catch (error) {
    if (rmTmpDirIgnorableErrorCodes.has(error.code)) return;
    throw error;
  }
});

export default processTmpDir;
