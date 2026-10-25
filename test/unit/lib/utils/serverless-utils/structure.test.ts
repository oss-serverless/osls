import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from 'chai';
import policy from '../../../../../lib/utils/serverless-utils/policy.ts';

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
    const rootDir = path.resolve(import.meta.dirname, '../../../../../lib/utils/serverless-utils');
    const actual = await collectFiles(rootDir);

    // The vendored sources are TypeScript now, while the policy lists the upstream `.js` names
    const toSourcePath = (policyPath) => policyPath.replace(/\.js$/, '.ts');
    expect(actual).to.deep.equal(
      [...policy.vendoredPaths, ...policy.maintainerPaths].map(toSourcePath).sort()
    );
  });
});
