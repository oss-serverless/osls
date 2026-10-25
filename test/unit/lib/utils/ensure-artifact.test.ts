import { expect } from 'chai';
import ensureArtifact from '../../../../lib/utils/ensure-artifact.ts';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import crypto from 'node:crypto';
import { pathExists } from '../../../utils/fs.ts';

describe('#ensureArtifact', () => {
  const testArtifactName = `test-${crypto.randomBytes(12).toString('hex')}`;

  let testArtifactPath;
  let invokedCount = 0;

  const generateFunc = async (cachePath) => {
    testArtifactPath = path.resolve(cachePath, testArtifactName);
    ++invokedCount;
    await fsp.writeFile(testArtifactPath, '');
  };

  it('Should generate artifact if missing', async () => {
    await ensureArtifact(testArtifactName, generateFunc);
    const exists = await pathExists(testArtifactPath);
    expect(exists).to.be.true;
  });

  it('Should generate only on first access', async () => {
    await ensureArtifact(testArtifactName, generateFunc);
    expect(invokedCount).to.equal(1);
  });

  it('Should not generate, if generated in past', async () => {
    ensureArtifact.delete(testArtifactName);
    await ensureArtifact(testArtifactName, generateFunc);
    expect(invokedCount).to.equal(1);
  });

  it('Should return cache path', async () => {
    const cachePath = await ensureArtifact(testArtifactName, generateFunc);
    expect(cachePath).to.include(`.serverless${path.sep}artifacts`);
  });
});
