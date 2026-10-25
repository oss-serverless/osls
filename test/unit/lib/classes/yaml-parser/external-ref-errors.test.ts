'use strict';

const { expect } = require('chai');
const {
  createExternalRefAccessDeniedError,
  getExternalRefAccessDeniedError,
} = require('../../../../../lib/classes/yaml-parser/external-ref-errors');

describe('yaml-parser/external-ref-errors', () => {
  it('finds access denied errors through nested causes and aggregate errors', () => {
    const accessDeniedError = createExternalRefAccessDeniedError('blocked');
    const aggregateError = new AggregateError([new Error('other'), accessDeniedError]);
    const wrappedError = new TypeError('fetch failed', {
      cause: new Error('connection failed', { cause: aggregateError }),
    });

    expect(getExternalRefAccessDeniedError(wrappedError)).to.equal(accessDeniedError);
  });

  it('does not recurse forever through cyclic causes', () => {
    const error = new Error('cycle');
    error.cause = error;

    expect(getExternalRefAccessDeniedError(error)).to.equal(null);
  });
});
