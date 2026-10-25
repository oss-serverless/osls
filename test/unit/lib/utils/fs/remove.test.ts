'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { expect } = require('chai');

const { remove, removeSync } = require('../../../../../lib/utils/fs/remove');
const { getTmpDirPath } = require('../../../../utils/fs');

describe('test/unit/lib/utils/fs/remove.test.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = getTmpDirPath();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes files and directories recursively', async () => {
    const targetPath = path.join(tmpDir, 'target');
    await fsp.mkdir(path.join(targetPath, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(targetPath, 'nested', 'file.txt'), 'content');

    await remove(targetPath);

    expect(fs.existsSync(targetPath)).to.equal(false);
  });

  it('ignores missing async paths', async () => {
    await expect(remove(path.join(tmpDir, 'missing'))).to.be.fulfilled;
  });

  it('removes files and directories recursively with the sync helper', () => {
    const targetPath = path.join(tmpDir, 'target');
    fs.mkdirSync(path.join(targetPath, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(targetPath, 'nested', 'file.txt'), 'content');

    removeSync(targetPath);

    expect(fs.existsSync(targetPath)).to.equal(false);
  });

  it('ignores missing sync paths', () => {
    expect(() => removeSync(path.join(tmpDir, 'missing'))).to.not.throw();
  });
});
