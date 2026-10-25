import path from 'node:path';
import { promises as fsp } from 'node:fs';
import * as chai from 'chai';
import requireWithImportFallback from '../../../../lib/utils/require-with-import-fallback.ts';

const { expect } = chai;

describe('test/unit/lib/utils/require-with-import-fallback.test.ts', () => {
  let modulePath;

  afterEach(async () => {
    if (modulePath) await fsp.unlink(modulePath);
    modulePath = null;
  });

  it('should load ES modules whose path contains URL-significant characters', async () => {
    modulePath = path.resolve('esm-module#hash.mjs');
    await fsp.writeFile(modulePath, 'export default { value: true };');

    await expect(requireWithImportFallback(modulePath)).to.eventually.deep.equal({ value: true });
  });
});
