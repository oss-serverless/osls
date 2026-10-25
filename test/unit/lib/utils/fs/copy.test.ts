'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { expect } = require('chai');

const copy = require('../../../../../lib/utils/fs/copy');
const { getTmpDirPath } = require('../../../../utils/fs');
const skipOnDisabledSymlinksInWindows = require('../../../../lib/skip-on-disabled-symlinks-in-windows');

describe('test/unit/lib/utils/fs/copy.test.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = getTmpDirPath();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies files and directories recursively', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    const destinationDir = path.join(tmpDir, 'nested', 'destination');

    await fsp.mkdir(path.join(sourceDir, 'dir'), { recursive: true });
    await fsp.writeFile(path.join(sourceDir, 'dir', 'file.txt'), 'content');

    await copy(sourceDir, destinationDir);

    expect(await fsp.readFile(path.join(destinationDir, 'dir', 'file.txt'), 'utf8')).to.equal(
      'content'
    );
  });

  it('creates missing destination parents and overwrites by default', async () => {
    const sourceFile = path.join(tmpDir, 'source.txt');
    const destinationFile = path.join(tmpDir, 'nested', 'destination.txt');

    await fsp.writeFile(sourceFile, 'new');
    await fsp.mkdir(path.dirname(destinationFile), { recursive: true });
    await fsp.writeFile(destinationFile, 'old');

    await copy(sourceFile, destinationFile);

    expect(await fsp.readFile(destinationFile, 'utf8')).to.equal('new');
  });

  it('does not overwrite existing files when force is false with dereference enabled', async () => {
    const sourceFile = path.join(tmpDir, 'source.txt');
    const destinationFile = path.join(tmpDir, 'nested', 'destination.txt');

    await fsp.writeFile(sourceFile, 'new');
    await fsp.mkdir(path.dirname(destinationFile), { recursive: true });
    await fsp.writeFile(destinationFile, 'old');

    await copy(sourceFile, destinationFile, { dereference: true, force: false });

    expect(await fsp.readFile(destinationFile, 'utf8')).to.equal('old');
  });

  it('passes async filter calls through with source and destination paths', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    const destinationDir = path.join(tmpDir, 'destination');
    const filterCalls = [];

    await fsp.mkdir(sourceDir, { recursive: true });
    await fsp.writeFile(path.join(sourceDir, 'keep.txt'), 'keep');
    await fsp.writeFile(path.join(sourceDir, 'drop.txt'), 'drop');

    await copy(sourceDir, destinationDir, {
      filter: async (sourcePath, destinationPath) => {
        filterCalls.push([sourcePath, destinationPath]);
        return !sourcePath.endsWith('drop.txt');
      },
    });

    expect(await fsp.readFile(path.join(destinationDir, 'keep.txt'), 'utf8')).to.equal('keep');
    await expect(fsp.access(path.join(destinationDir, 'drop.txt'))).to.be.rejected;
    expect(filterCalls).to.deep.include([
      path.join(sourceDir, 'keep.txt'),
      path.join(destinationDir, 'keep.txt'),
    ]);
  });

  it('supports one-argument filters', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    const destinationDir = path.join(tmpDir, 'destination');

    await fsp.mkdir(sourceDir, { recursive: true });
    await fsp.writeFile(path.join(sourceDir, 'keep.txt'), 'keep');
    await fsp.writeFile(path.join(sourceDir, 'drop.txt'), 'drop');

    await copy(sourceDir, destinationDir, {
      filter: (sourcePath) => !sourcePath.endsWith('drop.txt'),
    });

    expect(await fsp.readFile(path.join(destinationDir, 'keep.txt'), 'utf8')).to.equal('keep');
    await expect(fsp.access(path.join(destinationDir, 'drop.txt'))).to.be.rejected;
  });

  it('dereferences symlinks when requested', async function () {
    const sourceDir = path.join(tmpDir, 'source');
    const destinationDir = path.join(tmpDir, 'destination');
    const targetFile = path.join(sourceDir, 'target.txt');
    const linkFile = path.join(sourceDir, 'link.txt');

    await fsp.mkdir(sourceDir, { recursive: true });
    await fsp.writeFile(targetFile, 'target');
    try {
      await fsp.symlink(targetFile, linkFile);
    } catch (error) {
      skipOnDisabledSymlinksInWindows(error, this, () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });
      throw error;
    }

    await copy(sourceDir, destinationDir, { dereference: true });

    const copiedLinkStats = await fsp.lstat(path.join(destinationDir, 'link.txt'));
    expect(copiedLinkStats.isFile()).to.equal(true);
    expect(copiedLinkStats.isSymbolicLink()).to.equal(false);
    expect(await fsp.readFile(path.join(destinationDir, 'link.txt'), 'utf8')).to.equal('target');
  });
});
