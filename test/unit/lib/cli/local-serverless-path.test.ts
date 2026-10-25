import { expect } from 'chai';
import path from 'node:path';
import os from 'node:os';
import { promises as fsp } from 'node:fs';
import { ensureDir, ensureFile } from '../../../utils/fs.ts';
import localServerlessPath from '../../../../lib/cli/local-serverless-path.ts';

describe('test/unit/lib/cli/local-serverless-path.test.ts', () => {
  const resolveLocalServerlessPath = localServerlessPath;

  it('should resolve with `null` when no local installation is found', () => {
    expect(resolveLocalServerlessPath()).to.equal(null);
  });

  it('should resolve a local installation from the current working directory', async () => {
    const tmpServerlessPath = path.resolve(
      await fsp.realpath(os.homedir()),
      'node_modules/serverless'
    );
    await ensureDir(path.resolve(tmpServerlessPath, 'lib'));
    await Promise.all([
      ensureFile(path.resolve(tmpServerlessPath, 'lib/serverless.js')),
      fsp.writeFile(
        path.resolve(tmpServerlessPath, 'package.json'),
        JSON.stringify({ main: 'lib/serverless.js' })
      ),
    ]);

    expect(await fsp.realpath(resolveLocalServerlessPath())).to.equal(tmpServerlessPath);
  });
});
