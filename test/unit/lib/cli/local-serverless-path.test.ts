'use strict';

const { expect } = require('chai');
const path = require('path');
const os = require('os');
const fsp = require('fs').promises;
const { ensureDir, ensureFile } = require('../../../utils/fs');

describe('test/unit/lib/cli/local-serverless-path.test.js', () => {
  const resolveLocalServerlessPath = require('../../../../lib/cli/local-serverless-path');

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
