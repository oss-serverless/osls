import { promises as fsp } from 'node:fs';

async function fileExists(filePath) {
  return fsp
    .lstat(filePath)
    .then((stats) => stats.isFile())
    .catch(() => false);
}

export default fileExists;
