'use strict';

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

const copySync = require('../../../../../lib/utils/fs/copy-sync');
const { getTmpDirPath } = require('../../../../utils/fs');
const skipOnDisabledSymlinksInWindows = require('../../../../lib/skip-on-disabled-symlinks-in-windows');

describe('test/unit/lib/utils/fs/copy-sync.test.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = getTmpDirPath();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies files and directories recursively', () => {
    const sourceDir = path.join(tmpDir, 'source');
    const destinationDir = path.join(tmpDir, 'nested', 'destination');

    fs.mkdirSync(path.join(sourceDir, 'dir'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'dir', 'file.txt'), 'content');

    copySync(sourceDir, destinationDir);

    expect(fs.readFileSync(path.join(destinationDir, 'dir', 'file.txt'), 'utf8')).to.equal(
      'content'
    );
  });

  it('creates missing destination parents and overwrites by default', () => {
    const sourceFile = path.join(tmpDir, 'source.txt');
    const destinationFile = path.join(tmpDir, 'nested', 'destination.txt');

    fs.writeFileSync(sourceFile, 'new');
    fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
    fs.writeFileSync(destinationFile, 'old');

    copySync(sourceFile, destinationFile);

    expect(fs.readFileSync(destinationFile, 'utf8')).to.equal('new');
  });

  it('does not overwrite existing files when force is false with dereference enabled', () => {
    const sourceFile = path.join(tmpDir, 'source.txt');
    const destinationFile = path.join(tmpDir, 'nested', 'destination.txt');

    fs.writeFileSync(sourceFile, 'new');
    fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
    fs.writeFileSync(destinationFile, 'old');

    copySync(sourceFile, destinationFile, { dereference: true, force: false });

    expect(fs.readFileSync(destinationFile, 'utf8')).to.equal('old');
  });

  it('passes filters through with source and destination paths', () => {
    const sourceDir = path.join(tmpDir, 'source');
    const destinationDir = path.join(tmpDir, 'destination');
    const filterCalls = [];

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'keep.txt'), 'keep');
    fs.writeFileSync(path.join(sourceDir, 'drop.txt'), 'drop');

    copySync(sourceDir, destinationDir, {
      filter: (sourcePath, destinationPath) => {
        filterCalls.push([sourcePath, destinationPath]);
        return !sourcePath.endsWith('drop.txt');
      },
    });

    expect(fs.readFileSync(path.join(destinationDir, 'keep.txt'), 'utf8')).to.equal('keep');
    expect(fs.existsSync(path.join(destinationDir, 'drop.txt'))).to.equal(false);
    expect(filterCalls).to.deep.include([
      path.join(sourceDir, 'keep.txt'),
      path.join(destinationDir, 'keep.txt'),
    ]);
  });

  it('supports one-argument filters', () => {
    const sourceDir = path.join(tmpDir, 'source');
    const destinationDir = path.join(tmpDir, 'destination');

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'keep.txt'), 'keep');
    fs.writeFileSync(path.join(sourceDir, 'drop.txt'), 'drop');

    copySync(sourceDir, destinationDir, {
      filter: (sourcePath) => !sourcePath.endsWith('drop.txt'),
    });

    expect(fs.readFileSync(path.join(destinationDir, 'keep.txt'), 'utf8')).to.equal('keep');
    expect(fs.existsSync(path.join(destinationDir, 'drop.txt'))).to.equal(false);
  });

  it('dereferences symlinks when requested', function () {
    const sourceDir = path.join(tmpDir, 'source');
    const destinationDir = path.join(tmpDir, 'destination');
    const targetFile = path.join(sourceDir, 'target.txt');
    const linkFile = path.join(sourceDir, 'link.txt');

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(targetFile, 'target');
    try {
      fs.symlinkSync(targetFile, linkFile);
    } catch (error) {
      skipOnDisabledSymlinksInWindows(error, this, () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });
      throw error;
    }

    copySync(sourceDir, destinationDir, { dereference: true });

    const copiedLinkStats = fs.lstatSync(path.join(destinationDir, 'link.txt'));
    expect(copiedLinkStats.isFile()).to.equal(true);
    expect(copiedLinkStats.isSymbolicLink()).to.equal(false);
    expect(fs.readFileSync(path.join(destinationDir, 'link.txt'), 'utf8')).to.equal('target');
  });
});
