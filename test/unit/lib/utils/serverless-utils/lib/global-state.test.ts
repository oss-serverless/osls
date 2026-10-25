import { expect } from 'chai';

const moduleUrl = new URL(
  '../../../../../../lib/utils/serverless-utils/lib/global-state.ts',
  import.meta.url
);

// Each distinct query loads a separate module instance. esmock is not used here, because it
// assigns its own properties onto the default export, which is the shared state under test
const importFresh = async (instance) =>
  (await import(`${moduleUrl.href}?instance=${instance}`)).default;

describe('serverless-utils/global-state', () => {
  it('shares state across uncached module loads', async () => {
    const first = await importFresh('first');
    const marker = {};

    first.testMarker = marker;

    const second = await importFresh('second');

    expect(second.testMarker).to.equal(marker);

    delete first.testMarker;
  });
});
