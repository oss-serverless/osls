'use strict';

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

const dirExistsSync = require('../../../../../lib/utils/fs/dir-exists-sync');
const { getTmpDirPath } = require('../../../../utils/fs');

describe('test/unit/lib/utils/fs/dir-exists-sync.test.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = getTmpDirPath();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true for directories', () => {
    expect(dirExistsSync(tmpDir)).to.equal(true);
  });

  it('returns false for files', () => {
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'content');

    expect(dirExistsSync(filePath)).to.equal(false);
  });

  it('returns false for missing paths', () => {
    expect(dirExistsSync(path.join(tmpDir, 'missing'))).to.equal(false);
  });
});
