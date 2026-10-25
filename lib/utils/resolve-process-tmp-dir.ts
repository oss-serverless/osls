import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const fsp = fs.promises;

const tmpDirPrefix = 'node-process-';

let processTmpDirPromise;

export default async () => {
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
