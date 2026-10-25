import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const tmpDirCommonPath = path.join(
  os.tmpdir(),
  'tmpdirs-serverless',
  crypto.randomBytes(12).toString('hex')
);

function getTmpDirPath() {
  return path.join(tmpDirCommonPath, crypto.randomBytes(12).toString('hex'));
}

export default getTmpDirPath;
