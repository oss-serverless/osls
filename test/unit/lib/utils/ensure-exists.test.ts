import * as chai from 'chai';
import * as sinon from 'sinon';
import ensureExists from '../../../../lib/utils/ensure-exists.ts';
import { getTmpDirPath } from '../../../utils/fs.ts';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import crypto from 'node:crypto';

const expect = chai.expect;

describe('test/unit/lib/utils/ensureExists.test.ts', () => {
  const testCacheDir = getTmpDirPath();

  it('Should call generate if file missing', async () => {
    const testFileName = `test-${crypto.randomBytes(12).toString('hex')}`;
    const generateStub = sinon.stub().resolves();
    await ensureExists(path.resolve(testCacheDir, testFileName), generateStub);
    expect(generateStub.calledOnce).to.be.true;
  });

  it('Should not call generate if file exists', async () => {
    const testFileName = `test-${crypto.randomBytes(12).toString('hex')}`;
    await fsp.mkdir(testCacheDir, { recursive: true });
    await fsp.writeFile(path.resolve(testCacheDir, testFileName), '');
    const generateStub = sinon.stub().resolves();
    await ensureExists(path.resolve(testCacheDir, testFileName), generateStub);
    expect(generateStub.calledOnce).to.be.false;
  });

  it('Should create nested cache directories before calling generate', async () => {
    const testFileName = `test-${crypto.randomBytes(12).toString('hex')}`;
    const testFilePath = path.resolve(testCacheDir, 'nested', 'cache', testFileName);
    const generateStub = sinon
      .stub()
      .callsFake((cacheDir) => fsp.writeFile(path.join(cacheDir, testFileName), ''));

    await ensureExists(testFilePath, generateStub);

    expect(generateStub.calledOnceWithExactly(path.dirname(testFilePath))).to.be.true;
    expect((await fsp.stat(testFilePath)).isFile()).to.equal(true);
  });
});
