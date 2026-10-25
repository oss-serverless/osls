import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { packageRoot } from './package-root.ts';

const localNpmBinPath = path.join(packageRoot, 'node_modules/npm/bin/npm-cli.js');

export default fsp
  .stat(localNpmBinPath)
  .then(
    (stats) => stats.isFile(),
    (error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  )
  .then((isNpmInstalledLocaly) => {
    return isNpmInstalledLocaly
      ? { command: 'node', args: [localNpmBinPath] }
      : { command: 'npm', args: [] };
  });
