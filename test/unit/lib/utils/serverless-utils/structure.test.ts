'use strict';

const fs = require('fs').promises;
const path = require('path');
const { expect } = require('chai');

const policy = require('../../../../../lib/utils/serverless-utils/policy');

const collectFiles = async (rootDir, prefix = '') => {
  const entries = await fs.readdir(path.join(rootDir, prefix), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootDir, relativePath)));
    } else {
      files.push(relativePath.replaceAll(path.sep, '/'));
    }
  }

  return files.sort();
};

describe('serverless-utils vendored structure', () => {
  it('matches the allowlisted vendored tree exactly', async () => {
    const rootDir = path.resolve(__dirname, '../../../../../lib/utils/serverless-utils');
    const actual = await collectFiles(rootDir);

    expect(actual).to.deep.equal([...policy.vendoredPaths, ...policy.maintainerPaths].sort());
  });
});
