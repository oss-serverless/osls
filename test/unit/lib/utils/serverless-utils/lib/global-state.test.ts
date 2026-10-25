'use strict';

const { expect } = require('chai');
const requireUncached = require('../../../../../utils/require-uncached');

describe('serverless-utils/global-state', () => {
  it('shares state across uncached module loads', () => {
    const modulePath = '../../../../../../lib/utils/serverless-utils/lib/global-state';
    const first = requireUncached(() => require(modulePath));
    const marker = {};

    first.testMarker = marker;

    const second = requireUncached(() => require(modulePath));

    expect(second.testMarker).to.equal(marker);

    delete first.testMarker;
  });
});
