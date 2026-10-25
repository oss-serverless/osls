import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'chai';
import dirExistsSync from '../../../../../lib/utils/fs/dir-exists-sync.ts';
import { getTmpDirPath } from '../../../../utils/fs.ts';

describe('test/unit/lib/utils/fs/dir-exists-sync.test.ts', () => {
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
