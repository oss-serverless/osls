'use strict';

const { expect } = require('chai');
const requireUncached = require('../../utils/require-uncached');

describe('test/utils/require-uncached', () => {
  const modulePath = '../../../package.json';
  let moduleId;
  let originalCacheEntry;

  beforeEach(() => {
    moduleId = require.resolve(modulePath);
    require(modulePath);

    originalCacheEntry = require.cache[moduleId];
  });

  it('restores the require cache after synchronous callbacks return', () => {
    let wasCacheCleared = false;

    const result = requireUncached(() => {
      wasCacheCleared = !require.cache[moduleId];

      return 'result';
    });

    expect(result).to.equal('result');
    expect(wasCacheCleared).to.equal(true);
    expect(require.cache[moduleId]).to.equal(originalCacheEntry);
  });

  it('restores the require cache after synchronous callbacks throw', () => {
    const error = new Error('Failure');
    let wasCacheCleared = false;

    expect(() =>
      requireUncached(() => {
        wasCacheCleared = !require.cache[moduleId];

        throw error;
      })
    ).to.throw(error);

    expect(wasCacheCleared).to.equal(true);
    expect(require.cache[moduleId]).to.equal(originalCacheEntry);
  });

  it('restores the require cache after promises reject', async () => {
    const error = new Error('Failure');
    let wasCacheCleared = false;

    await expect(
      requireUncached(() => {
        wasCacheCleared = !require.cache[moduleId];

        return Promise.reject(error);
      })
    ).to.be.rejectedWith(error);

    expect(wasCacheCleared).to.equal(true);
    expect(require.cache[moduleId]).to.equal(originalCacheEntry);
  });

  it('restores the require cache after generic thenables settle', async () => {
    let wasCacheCleared = false;

    const result = await requireUncached(() => ({
      then(resolve) {
        wasCacheCleared = !require.cache[moduleId];
        resolve('result');
      },
    }));

    expect(result).to.equal('result');
    expect(wasCacheCleared).to.equal(true);
    expect(require.cache[moduleId]).to.equal(originalCacheEntry);
  });
});
