'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { expect } = require('chai');

const ensureFile = require('../../../../../lib/utils/fs/ensure-file');
const { getTmpDirPath } = require('../../../../utils/fs');

describe('test/unit/lib/utils/fs/ensure-file.test.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = getTmpDirPath();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates parent directories and a missing file', async () => {
    const filePath = path.join(tmpDir, 'nested', 'marker');

    await ensureFile(filePath);

    expect((await fsp.stat(filePath)).isFile()).to.equal(true);
  });

  it('does not truncate an existing file', async () => {
    const filePath = path.join(tmpDir, 'existing');
    await fsp.writeFile(filePath, 'content');

    await ensureFile(filePath);

    expect(await fsp.readFile(filePath, 'utf8')).to.equal('content');
  });

  it('rejects when the parent path is a file', async () => {
    const parentPath = path.join(tmpDir, 'parent');
    await fsp.writeFile(parentPath, 'not a directory');

    await expect(ensureFile(path.join(parentPath, 'marker'))).to.be.rejected;
  });
});
