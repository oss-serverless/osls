import path from 'node:path';
import { promises as fsp } from 'node:fs';
import log2 from '../serverless-utils/log.ts';
const { log } = log2;

const npmPackageRoot = path.resolve(import.meta.dirname, '../../../');

export default async () => {
  const stats = await fsp.stat(npmPackageRoot);
  try {
    await fsp.utimes(npmPackageRoot, String(stats.atimeMs / 1000), String(stats.mtimeMs / 1000));
    return true;
  } catch (error) {
    log.info('Auto update: file access error: %O', error);
    return false;
  }
};
