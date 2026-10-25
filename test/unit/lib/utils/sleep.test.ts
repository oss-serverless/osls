'use strict';

const sinon = require('sinon');
const { expect } = require('chai');
const sleep = require('../../../../lib/utils/sleep');

describe('sleep', () => {
  it('resolves on next tick when no timeout is provided', async () => {
    const events = [];
    const promise = sleep().then(() => events.push('sleep'));

    setTimeout(() => events.push('timer'), 0);

    await promise;

    expect(events).to.deep.equal(['sleep']);
  });

  it('normalizes numeric string delays', async () => {
    const clock = sinon.useFakeTimers();

    try {
      let resolved = false;
      const promise = sleep('10').then(() => {
        resolved = true;
      });

      await clock.tickAsync(9);
      expect(resolved).to.equal(false);

      await clock.tickAsync(1);
      await promise;

      expect(resolved).to.equal(true);
    } finally {
      clock.restore();
    }
  });

  it('normalizes invalid and negative delays to zero', async () => {
    const clock = sinon.useFakeTimers();

    try {
      let resolved = false;
      const promise = sleep(-1).then(() => {
        resolved = true;
      });

      await clock.tickAsync(0);
      await promise;

      expect(resolved).to.equal(true);
    } finally {
      clock.restore();
    }
  });

  it('rejects timeout values larger than Node supports', () => {
    expect(() => sleep(2 ** 31)).to.throw(TypeError, 'exceeds maximum possible timeout');
  });
});
