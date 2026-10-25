'use strict';

const path = require('path');
const fsp = require('fs').promises;
const chai = require('chai');

const { expect } = chai;
const requireWithImportFallback = require('../../../../lib/utils/require-with-import-fallback');

describe('test/unit/lib/utils/require-with-import-fallback.test.js', () => {
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
