import { promises as fsp } from 'node:fs';
import path from 'node:path';

export default async (filename, generate) => {
  const cacheDir = path.dirname(filename);
  try {
    const stats = await fsp.lstat(filename);
    if (stats.isFile()) {
      return;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  await fsp.mkdir(cacheDir, { recursive: true });
  await generate(cacheDir);
};
