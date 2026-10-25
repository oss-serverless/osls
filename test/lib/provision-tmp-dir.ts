import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import processTmpDir from './process-tmp-dir.ts';
const { mkdir } = fs.promises;

export default () =>
  new Promise((resolve) => {
    const tmpDirName = path.join(processTmpDir, crypto.randomBytes(12).toString('hex'));
    resolve(
      mkdir(tmpDirName).then(
        () => tmpDirName,
        (error) => {
          if (error.code !== 'EEXIST') throw error;
          return module.exports(); // Name taken (rare edge case), retry
        }
      )
    );
  });
